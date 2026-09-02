#!/usr/bin/env python3
"""
코퍼스 360건 적재 + U-9(쟁점 태그) 확정

입력을 병합해 DB에 넣는다.
  data/corpus.json(240) + eval_set.json(120)      ← 기본 필드·검증셋 분리
  data/golden_candidates.json(225)                ← 섹션 분리·주문유형·배상비율
  data/summary_candidates.json(135)               ← 요약 계열 섹션
  data/labels_v1.json                             ← classify_corpus.py 분류 결과

품질 게이트(Q-1 누출 / Q-2 인용 요건 / Q-5 열거 무결성)를 통과해야 적재한다.
게이트 실패 시 아무것도 적재하지 않는다.

사용법
  python scripts/load_corpus.py --data-dir ~/Downloads/프리케이스/data --dry-run
  python scripts/load_corpus.py --data-dir ~/Downloads/프리케이스/data

환경변수: BATCH_DATABASE_URL (.env.local 에서 자동 로드)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

# ---------------------------------------------------------------- 열거 (기능 요구사항 2장)
SECTORS = {"INSURANCE", "INVESTMENT", "BANKING", "CARD", "UNKNOWN"}
PRODUCTS = {
    "INS_SILSON", "INS_WHOLE", "INS_ANNUITY", "INS_SAVINGS", "INS_AUTO", "INS_ETC",
    "INV_ELS", "INV_FUND", "INV_MARGIN", "INV_ETC",
    "BNK_LOAN", "BNK_ETC", "ETC_UNKNOWN",
}
CHANNELS = {"TM", "BANCA_HS", "AGENT", "BRANCH", "ONLINE"}
TRAITS = {"PRO", "ELDER", "INEXP", "CAPACITY"}
VERDICTS = {"UPHELD", "REJECTED"}

SECTOR_MAP = {"보험": "INSURANCE", "증권": "INVESTMENT", "은행": "BANKING",
              "카드": "CARD", "미상": "UNKNOWN"}
VERDICT_MAP = {"인용": "UPHELD", "기각": "REJECTED"}
ORDER_MAP = {
    "인용(금액명시)": "UPHELD_AMOUNT", "인용(금액미명시)": "UPHELD_NO_AMOUNT",
    "인용(확인)": "UPHELD_CONFIRM", "기각": "REJECTED", "각하": "DISMISSED",
}

EXPECTED_TOTAL, EXPECTED_VALIDATION = 360, 120

# 쟁점 태그 별칭 — 동일 개념의 표기 변형만 통합한다. 법적으로 다른 개념은 통합 금지
# (예: 착오취소(민법 109) vs 사기기망취소(민법 110)는 별개 유지)
TAG_ALIASES = {
    "착오송금반환의무": "착오송금반환",
}

RE_DECISION = re.compile(r"제?\s*(\d{4})\s*-\s*(\d+)\s*호")
RE_YEAR = re.compile(r"(19|20)\d{2}")


@dataclass
class CaseRecord:
    id: str
    source_type: str
    sector: str
    verdict: str
    facts_summary: str
    is_validation: bool
    board: str | None = None
    post_no: str | None = None
    decision_no: str | None = None
    decision_date: date | None = None
    product_code: str | None = None
    channel: str | None = None
    compensation_rate: int | None = None
    panel_reasoning: str | None = None
    source_url: str | None = None
    case_year: int | None = None
    order_type: str | None = None
    label_source: str = "ORIGINAL"
    issues: list[str] = field(default_factory=list)
    traits: list[str] = field(default_factory=list)


def _year_from_id(rid: str) -> int | None:
    tail = rid.split("_", 1)[1] if "_" in rid else rid
    m = RE_YEAR.search(tail)
    if m:
        y = int(m.group(0))
        if 1990 <= y <= 2026:
            return y
    return None


def build_records(data_dir: Path) -> list[CaseRecord]:
    corpus = json.loads((data_dir / "corpus.json").read_text(encoding="utf-8"))
    evalset = json.loads((data_dir / "eval_set.json").read_text(encoding="utf-8"))
    golden = {r["file"]: r for r in
              json.loads((data_dir / "golden_candidates.json").read_text(encoding="utf-8"))}

    # 위원회판단 — extract_reasoning.py 산출물 (없으면 panel_reasoning 없이 적재)
    pr_path = data_dir / "panel_reasoning.json"
    panel: dict[str, dict] = {}
    if pr_path.exists():
        panel = json.loads(pr_path.read_text(encoding="utf-8"))
        print(f"  판단부 {sum(1 for v in panel.values() if v.get('reasoning'))}건 로드")
    else:
        print("  ⚠️  panel_reasoning.json 없음 — panel_reasoning 컬럼이 비게 된다")

    labels_path = data_dir / "labels_v1.json"
    labels: dict[str, dict] = {}
    if labels_path.exists():
        labels = {r["id"]: r for r in json.loads(labels_path.read_text(encoding="utf-8"))}
        print(f"  분류 라벨 {len(labels)}건 로드")
    else:
        print("  ⚠️  labels_v1.json 없음 — 쟁점·상품군·채널·특성 없이 적재된다")

    out: list[CaseRecord] = []
    for rec in [(r, False) for r in corpus] + [(r, True) for r in evalset]:
        raw, is_val = rec
        rid = raw["id"]

        # 기초사실+당사자주장은 corpus/eval 의 text 가 정본 (정답 누출 없는 입력부)
        facts = (raw.get("text") or "").strip()
        # 위원회판단은 재추출 산출물에서
        reasoning = (panel.get(rid, {}).get("reasoning") or "").strip()

        order_type = None
        comp = raw.get("ratio")
        if rid in golden:
            lab = golden[rid].get("label") or {}
            order_type = ORDER_MAP.get(lab.get("주문유형"))
            if comp is None and lab.get("배상비율") is not None:
                comp = lab["배상비율"]

        # 의결번호 — 파일명에서 추출
        dno = None
        m = RE_DECISION.search(rid)
        if m:
            dno = f"제{m.group(1)}-{m.group(2)}호"

        lab = labels.get(rid, {})
        has_model = bool(lab.get("issues") or lab.get("product_code")
                         or lab.get("channel") or lab.get("traits"))

        out.append(CaseRecord(
            id=rid,
            source_type="DECISION" if raw.get("source") == "decision" else "SUMMARY",
            sector=SECTOR_MAP.get(raw.get("sector") or "미상", "UNKNOWN"),
            verdict=VERDICT_MAP.get(raw.get("label"), ""),
            facts_summary=facts,
            panel_reasoning=reasoning or None,
            is_validation=is_val,
            board=raw.get("board"),
            post_no=rid.split("_")[0] or None,
            decision_no=dno,
            decision_date=None,           # 원본에 의결일 없음 — 의결번호만 존재
            case_year=raw.get("year") or _year_from_id(rid),
            compensation_rate=int(comp) if comp is not None else None,
            order_type=order_type,
            product_code=lab.get("product_code"),
            channel=lab.get("channel"),
            issues=[TAG_ALIASES.get(t, t) for t in (lab.get("issues") or [])],
            traits=lab.get("traits") or [],
            label_source="MODEL" if has_model else "ORIGINAL",
        ))
    return out


# ---------------------------------------------------------------- 품질 게이트
def gate_q5_enums(recs: list[CaseRecord]) -> list[str]:
    errs = []
    for r in recs:
        if r.sector not in SECTORS:
            errs.append(f"{r.id}: sector {r.sector!r}")
        if r.verdict not in VERDICTS:
            errs.append(f"{r.id}: verdict {r.verdict!r}")
        if r.product_code and r.product_code not in PRODUCTS:
            errs.append(f"{r.id}: product_code {r.product_code!r}")
        if r.channel and r.channel not in CHANNELS:
            errs.append(f"{r.id}: channel {r.channel!r}")
        for t in r.traits:
            if t not in TRAITS:
                errs.append(f"{r.id}: trait {t!r}")
        if not r.facts_summary:
            errs.append(f"{r.id}: facts_summary 비어 있음")
    return errs


def gate_q2_citation(recs: list[CaseRecord]) -> list[str]:
    return [f"{r.id}: DECISION인데 의결번호 없음"
            for r in recs if r.source_type == "DECISION" and not r.decision_no]


def _shingles(t: str, n: int = 4) -> set[str]:
    t = re.sub(r"\s+", "", t)
    return {t[i:i + n] for i in range(max(0, len(t) - n + 1))}


def gate_q1_leakage(recs: list[CaseRecord], out_path: Path | None = None,
                    warn_at: float = 0.30, block_at: float = 0.60) -> list[str]:
    """Q-1 누출 차단 — 2단계.

    warn_at 초과: 근접 사건으로 기록만 한다. 같은 게시물의 형제 사건(같은 펀드,
      다른 신청인)이 실제로 존재하며, 이는 데이터의 성질이지 적재 결함이 아니다.
      검증 재측정 시 leave-one-out으로 처리한다 (기획서 6.2).
    block_at 초과: 사실상 동일 문서이므로 차단한다.
    """
    val = [(r, _shingles(r.facts_summary)) for r in recs if r.is_validation]
    pool = [(r, _shingles(r.facts_summary)) for r in recs if not r.is_validation]
    errs, near, worst = [], [], 0.0
    for vr, vs in val:
        if not vs:
            continue
        for pr, ps in pool:
            if not ps:
                continue
            j = len(vs & ps) / len(vs | ps)
            if j > worst:
                worst = j
            if j > block_at:
                errs.append(f"동일 문서 의심 {j:.2f}: {vr.id} ↔ {pr.id}")
            elif j > warn_at:
                near.append({"jaccard": round(j, 3),
                             "validation_id": vr.id, "validation_verdict": vr.verdict,
                             "corpus_id": pr.id, "corpus_verdict": pr.verdict})
    print(f"    최대 자카드 {worst:.3f} (경고 {warn_at} / 차단 {block_at})")
    if near:
        near.sort(key=lambda x: -x["jaccard"])
        print(f"    근접 사건 {len(near)}쌍 — 검증 재측정 시 leave-one-out 대상")
        for p in near[:5]:
            flip = " ⚠ 결론 상이" if p["validation_verdict"] != p["corpus_verdict"] else ""
            print(f"      {p['jaccard']:.2f}  {p['validation_id']} ({p['validation_verdict']})"
                  f" ↔ {p['corpus_id']} ({p['corpus_verdict']}){flip}")
        if out_path:
            out_path.write_text(json.dumps(near, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"      → {out_path.name} 저장")
    return errs


def warn_counts(recs: list[CaseRecord]) -> list[str]:
    w = []
    if len(recs) != EXPECTED_TOTAL:
        w.append(f"총 {len(recs)}건 ≠ 문서 기준 {EXPECTED_TOTAL}")
    v = sum(r.is_validation for r in recs)
    if v != EXPECTED_VALIDATION:
        w.append(f"검증셋 {v}건 ≠ {EXPECTED_VALIDATION}")
    up = sum(1 for r in recs if r.is_validation and r.verdict == "UPHELD")
    rj = sum(1 for r in recs if r.is_validation and r.verdict == "REJECTED")
    if abs(up - rj) > 2:
        w.append(f"검증셋 균형: 인용 {up} : 기각 {rj}")
    return w


def resolve_issue_tags(recs: list[CaseRecord]) -> list[tuple[str, str, int]]:
    """U-9 확정 — 분류 결과에서 실제 등장한 태그만 채택."""
    c = Counter(t for r in recs for t in r.issues)
    return [(re.sub(r"\s+", "_", lbl), lbl, n) for lbl, n in c.most_common()]


def load_env(repo_root: Path) -> str:
    envf = repo_root / ".env.local"
    if envf.exists():
        for line in envf.read_text(encoding="utf-8").splitlines():
            if line.startswith("BATCH_DATABASE_URL"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    url = os.environ.get("BATCH_DATABASE_URL")
    if not url:
        sys.exit("BATCH_DATABASE_URL 미설정 (.env.local 또는 환경변수)")
    return url


def load(recs, tags, version, dsn) -> None:
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("select count(*) from cases")
        if cur.fetchone()[0]:
            sys.exit("cases 테이블이 비어 있지 않다. 재적재하려면 먼저 비울 것.")

        cur.executemany(
            "insert into issue_tags (code, label_ko) values (%s,%s) on conflict (code) do nothing",
            [(c, l) for c, l, _ in tags])
        cur.execute("select code, id from issue_tags")
        tid = dict(cur.fetchall())

        for r in recs:
            cur.execute(
                """insert into cases
                   (source_type, decision_no, decision_date, sector, product_code, channel,
                    verdict, compensation_rate, facts_summary, panel_reasoning, source_url,
                    case_year, is_validation, corpus_version, order_type, board, post_no,
                    label_source)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   returning id""",
                (r.source_type, r.decision_no, r.decision_date, r.sector, r.product_code,
                 r.channel, r.verdict, r.compensation_rate, r.facts_summary, r.panel_reasoning,
                 r.source_url, r.case_year, r.is_validation, version, r.order_type,
                 r.board, r.post_no, r.label_source))
            cid = cur.fetchone()[0]
            for lbl in {t for t in r.issues if t}:
                code = re.sub(r"\s+", "_", lbl)
                if code in tid:
                    cur.execute("insert into case_issues values (%s,%s) on conflict do nothing",
                                (cid, tid[code]))
            for t in set(r.traits):
                cur.execute("insert into case_traits values (%s,%s) on conflict do nothing",
                            (cid, t))
        conn.commit()
    print(f"\n✅ 적재 완료 — {len(recs)}건 · 쟁점 태그 {len(tags)}종 · version={version}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--version", default=f"v{date.today():%Y%m%d}")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    data_dir = Path(args.data_dir).expanduser()

    print("입력 병합")
    recs = build_records(data_dir)
    print(f"  {len(recs)}건 (검증셋 {sum(r.is_validation for r in recs)})")

    print("\n품질 게이트")
    errors: list[str] = []
    for name, fn in (("Q-5 열거 무결성", gate_q5_enums),
                     ("Q-2 인용 최소 요건", gate_q2_citation),
                     ("Q-1 누출 차단",
                      lambda r: gate_q1_leakage(r, data_dir / "leakage_report.json"))):
        e = fn(recs)
        print(f"  {'❌' if e else '✅'} {name}" + (f" — {len(e)}건" if e else ""))
        errors += e[:15]
    for w in warn_counts(recs):
        print(f"  ⚠️  {w}")

    if errors:
        print("\n실패 상세:")
        for e in errors:
            print("   ", e)
        sys.exit("\n게이트 실패 — 적재하지 않았다.")

    # 부착률
    print("\n라벨 부착률")
    n = len(recs)
    for f in ("product_code", "channel"):
        print(f"  {f:<14} {sum(1 for r in recs if getattr(r, f))}/{n}")
    print(f"  {'traits':<14} {sum(1 for r in recs if r.traits)}/{n}")
    print(f"  {'issues':<14} {sum(1 for r in recs if r.issues)}/{n}")
    print(f"  {'decision_no':<14} {sum(1 for r in recs if r.decision_no)}/{n}")
    print(f"  {'case_year':<14} {sum(1 for r in recs if r.case_year)}/{n}")

    tags = resolve_issue_tags(recs)
    print(f"\n{'=' * 58}\nU-9 쟁점 태그 확정 — {len(tags)}종\n{'=' * 58}")
    for code, label, cnt in tags:
        print(f"  {cnt:>4}건  {code:<26} {label}" + ("  ⚠ 소수" if cnt < 3 else ""))
    print("=" * 58)
    print("→ 확정 후 DB 명세서 부록 · 용어 정의 7장 · 데이터 요구사항 3장 동시 갱신 (N-801)\n")

    if args.dry_run:
        print("dry-run — 적재하지 않음")
        return
    load(recs, tags, args.version, load_env(repo_root))


if __name__ == "__main__":
    main()
