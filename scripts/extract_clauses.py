#!/usr/bin/env python3
"""A-1 + A-2 · 약관 조항(DR-102) + 용어 정의(DR-103) 추출·적재.

원천은 `panel_reasoning.json`(위원회 판단 360건)이다. corpus.json의 text는
[기초사실] 위주라 조항 인용이 거의 없다 — 실측 33건 vs 518건.

**정규식만 쓴다. 모델 호출 없음.**
조정례의 조항 인용이 대부분 `“…”` 안에 원문 그대로 들어 있어서, 윈도우를 자르는 대신
인용부호 구간을 그대로 뜨면 경계가 정확하다. 표본 검수에서 10건 중 9건이 깨끗했고,
나머지 1건(중첩 인용으로 닫는 따옴표를 넘어간 경우)은 TAIL_CUT으로 처리한다.

**sector·product_code는 재분류하지 않는다.** cases에 이미 라벨이 있으므로 같은 행에서
가져온다 — 모델 비용 0, 열거 무결성(Q-5) 자동 보장.

**source_case_id는 panel_reasoning 텍스트 정합으로 얻는다.** cases.panel_reasoning
304건이 전부 고유값이고 JSON과 304/304 일치한다(불일치 0). 파일명 매핑이 필요 없다.

사용:
  .venv/bin/python scripts/extract_clauses.py --data-dir ~/Downloads/프리케이스/data --dry-run
  .venv/bin/python scripts/extract_clauses.py --data-dir ~/Downloads/프리케이스/data

환경변수: BATCH_DATABASE_URL(적재) · DATABASE_URL(조회) — .env.local 에서 자동 로드
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------- 추출 패턴
# 약관/특약/규약 인용 — 조문번호는 선택(있으면 더 정확, 없어도 인용부호가 경계를 잡는다)
_HEAD = r'(?:이 사건\s*)?(?:보험|여신|신탁|대출|투자|공제|특별|보통|표준)?\s*(?:약관|특약|규약)'
_ART = r'(?:\s*제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?)?'
CLAUSE = re.compile(_HEAD + _ART + r'[^“”]{0,80}?“([^”]{15,600})”')

# 용어 정의 — 3형태. 같은 용어가 여러 정의를 갖는 건 허용(상품군마다 다르다)
TERM_PATS = [
    re.compile(r'[‘“]([^’”\n]{2,30})[’”](?:이)?(?:라|란)\s*함은\s*([^\n]{10,300}?)(?:을|를)?\s*(?:말한다|말합니다|의미한다)'),
    re.compile(r'[‘“]([^’”\n]{2,30})[’”](?:이란|란)\s*([^\n]{10,300}?)(?:을|를)?\s*(?:말한다|말합니다|의미한다)'),
    re.compile(r'[‘“]([^’”\n]{2,30})[’”](?:이라|라)\s*(?:함은|하면)\s*([^\n]{10,300}?)(?:이다|한다|합니다)'),
]

# 중첩 인용으로 닫는 따옴표를 넘어간 경우의 꼬리 절단
TAIL_CUT = re.compile(r'\s*(?:라고|고)\s*(?:규정하고 있|정하고 있|규정한|정한|규정하|하고 있)')

# 용어 정의 패턴 T3가 '말한다'의 '한다'에 걸려 '…을 말' 같은 조각을 남긴다.
# 이걸 떼야 T1 결과와 동일해져 중복이 접힌다.
TAIL_FRAG = re.compile(r'(?:(?:을|를|이|가)\s*)?(?:말|의미|뜻)$')

MIN_LEN, MAX_LEN = 15, 600


def norm(s: str) -> str:
    return re.sub(r'\s+', '', s)


def clean(raw: str) -> str | None:
    """공백 정규화 + 꼬리 절단. 기준 미달이면 None."""
    t = re.sub(r'\s+', ' ', raw).strip()
    m = TAIL_CUT.search(t)
    if m and m.start() >= MIN_LEN:      # 자르고도 본문이 남을 때만
        t = t[:m.start()].strip()
    t = TAIL_FRAG.sub('', t).strip()
    t = t.strip(' ,.·;')
    return t if MIN_LEN <= len(t) <= MAX_LEN else None


# ---------------------------------------------------------------- 추출
def extract(panel: dict, cases: dict) -> tuple[list, list, dict]:
    """cases: {panel_reasoning_text: (id, sector, product_code, is_validation)}"""
    clauses, terms = [], []
    seen_c, seen_t = set(), set()
    stat = {"matched": 0, "unmatched": 0, "no_reasoning": 0, "trimmed": 0, "dropped": 0,
            "term_prefix_dropped": 0}

    for key, v in panel.items():
        reasoning = (v.get("reasoning") or "").strip()
        if not reasoning:
            stat["no_reasoning"] += 1
            continue
        row = cases.get(reasoning)
        if not row:
            stat["unmatched"] += 1
            continue
        stat["matched"] += 1
        cid, sector, product, is_val = row
        pool = reasoning + "\n" + (v.get("conclusion") or "")

        for m in CLAUSE.finditer(pool):
            raw = m.group(1)
            t = clean(raw)
            if t is None:
                stat["dropped"] += 1
                continue
            if norm(t) != norm(raw):
                stat["trimmed"] += 1
            k = norm(t)
            if k in seen_c:
                continue
            seen_c.add(k)
            clauses.append((t, sector, product, cid, is_val))

        for pat in TERM_PATS:
            for m in pat.finditer(pool):
                term = re.sub(r'\s+', ' ', m.group(1)).strip(' ‘’“”,.')
                defi = clean(m.group(2))
                if not term or defi is None:
                    continue
                k = (norm(term), norm(defi))
                if k in seen_t:
                    continue
                seen_t.add(k)
                terms.append((term, defi, cid, is_val))

    # (용어, 출처사건) 그룹에서 한쪽이 다른 쪽의 접두면 긴 쪽만 남긴다
    kept = []
    for i, (t, d, cid, v) in enumerate(terms):
        nd = norm(d)
        if any(j != i and terms[j][2] == cid and norm(terms[j][0]) == norm(t)
               and norm(terms[j][1]) != nd and norm(terms[j][1]).startswith(nd)
               for j in range(len(terms))):
            stat["term_prefix_dropped"] += 1
            continue
        kept.append((t, d, cid, v))

    return clauses, kept, stat


# ---------------------------------------------------------------- 게이트
# 마이그레이션 0003 기준 — ETC는 제거되고 CARD·UNKNOWN이 추가됐다.
# 0001_init.sql의 4종을 보고 쓰면 안 된다 (실제 분포: 보험149·증권111·은행54·미상39·카드7)
ENUM_SECTOR = {"INSURANCE", "INVESTMENT", "BANKING", "CARD", "UNKNOWN"}
ENUM_PRODUCT = {
    "INS_SILSON", "INS_WHOLE", "INS_ANNUITY", "INS_SAVINGS", "INS_AUTO", "INS_ETC",
    "INV_ELS", "INV_FUND", "INV_MARGIN", "INV_ETC", "BNK_LOAN", "BNK_ETC", "ETC_UNKNOWN"}


def gate(clauses: list, terms: list, stat: dict) -> None:
    fail = []

    # Q-5 열거 무결성 — cases에서 가져왔으므로 어긋날 수 없지만 실증한다
    bad = {s for _, s, _, _, _ in clauses} - ENUM_SECTOR
    if bad:
        fail.append(f"  sector 열거 위반: {bad}")
    bad = {p for _, _, p, _, _ in clauses if p is not None} - ENUM_PRODUCT
    if bad:
        fail.append(f"  product_code 열거 위반: {bad}")

    # 텍스트 기준
    if any(not t or len(t) < MIN_LEN or len(t) > MAX_LEN for t, *_ in clauses):
        fail.append("  clause_text 길이 기준 위반")
    if any(not t or not d for t, d, _, _ in terms):
        fail.append("  용어/정의 빈 값")

    # 매칭 — 불일치가 있으면 FK 근거가 흔들린 것이다
    if stat["unmatched"]:
        fail.append(f"  panel_reasoning 텍스트 불일치 {stat['unmatched']}건 — FK 근거 확인 필요")

    if fail:
        print("게이트 실패:", file=sys.stderr)
        print("\n".join(fail), file=sys.stderr)
        sys.exit("\n적재하지 않았다.")

    # Q-1 누출 — 차단이 아니라 기록. check_documents는 사건을 인용하지 않으므로 누출이 아니다
    cv = sum(1 for *_, v in clauses if v)
    tv = sum(1 for *_, v in terms if v)
    print(f"게이트 통과 — 열거 무결성 OK · 길이 기준 OK · FK 매칭 {stat['matched']}건 불일치 0")
    print(f"  Q-1 참고: 검증셋 출처 조항 {cv}/{len(clauses)} · 용어 {tv}/{len(terms)} "
          f"(cases.is_validation 조인으로 언제든 필터 가능. check_documents는 사건을 인용하지 않는다)")


# ---------------------------------------------------------------- DB
def read_env(repo_root: Path, key: str) -> str:
    envf = repo_root / ".env.local"
    if envf.exists():
        for line in envf.read_text(encoding="utf-8").splitlines():
            if line.startswith(key):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    url = os.environ.get(key)
    if not url:
        sys.exit(f"{key} 미설정 (.env.local 또는 환경변수)")
    return url


def fetch_cases(dsn: str) -> tuple[dict, str]:
    import psycopg
    with psycopg.connect(dsn) as c, c.cursor() as cur:
        cur.execute("""select panel_reasoning, id, sector, product_code, is_validation, corpus_version
                       from cases where panel_reasoning is not null""")
        rows = cur.fetchall()
    idx = {r[0]: (r[1], r[2], r[3], r[4]) for r in rows}
    versions = {r[5] for r in rows}
    if len(versions) != 1:
        sys.exit(f"corpus_version이 단일하지 않다: {versions}")
    return idx, versions.pop()


def load(clauses: list, terms: list, version: str, dsn: str) -> None:
    import psycopg
    with psycopg.connect(dsn) as c, c.cursor() as cur:
        cur.execute("delete from terms_clauses")
        cur.execute("delete from glossary_terms")
        cur.executemany(
            """insert into terms_clauses (clause_text, sector, product_code, source_case_id, corpus_version)
               values (%s,%s,%s,%s,%s)""",
            [(t, s, p, cid, version) for t, s, p, cid, _ in clauses])
        cur.executemany(
            """insert into glossary_terms (term, definition, source_case_id, corpus_version)
               values (%s,%s,%s,%s) on conflict (term, definition) do nothing""",
            [(t, d, cid, version) for t, d, cid, _ in terms])
        c.commit()

        cur.execute("select count(*) from terms_clauses")
        nc = cur.fetchone()[0]
        cur.execute("select count(*) from glossary_terms")
        nt = cur.fetchone()[0]
        cur.execute("""select count(*) from terms_clauses tc join cases c on c.id = tc.source_case_id""")
        fk = cur.fetchone()[0]
        print(f"\n적재 완료:\n  terms_clauses    {nc}행 (FK 유효 {fk})\n  glossary_terms   {nt}행")
        cur.execute("""select sector, count(*) from terms_clauses group by 1 order by 2 desc""")
        print("  업권 분포:", ", ".join(f"{s} {n}" for s, n in cur.fetchall()))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True, help="panel_reasoning.json 이 있는 폴더")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--sample", type=int, default=6, help="표본 출력 건수")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    panel = json.loads((Path(args.data_dir).expanduser() / "panel_reasoning.json")
                       .read_text(encoding="utf-8"))
    cases, version = fetch_cases(read_env(root, "DATABASE_URL"))
    print(f"cases {len(cases)}건 로드 (corpus_version={version}) · panel_reasoning.json {len(panel)}건")

    clauses, terms, stat = extract(panel, cases)
    print(f"\n추출: 약관 조항 {len(clauses)}건 · 용어 정의 {len(terms)}건 "
          f"(고유 용어 {len({t for t, *_ in terms})}종)")
    print(f"  매칭 {stat['matched']} · reasoning 없음 {stat['no_reasoning']} · "
          f"불일치 {stat['unmatched']} · 꼬리절단 {stat['trimmed']} · 기준미달 폐기 {stat['dropped']} · "
          f"용어 접두중복 제거 {stat['term_prefix_dropped']}")

    gate(clauses, terms, stat)

    if args.sample:
        print(f"\n=== 약관 조항 표본 {args.sample}건 ===")
        for t, s, p, _, _ in clauses[:args.sample]:
            print(f"  [{s:10} {p:11} {len(t):3}자] {t[:110]}")
        print(f"\n=== 용어 정의 표본 {args.sample}건 ===")
        for t, d, _, _ in terms[:args.sample]:
            print(f"  · {t:20} {d[:90]}")

    if args.dry_run:
        print("\ndry-run — 적재하지 않음")
        return

    load(clauses, terms, version, read_env(root, "BATCH_DATABASE_URL"))


if __name__ == "__main__":
    main()
