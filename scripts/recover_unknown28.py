#!/usr/bin/env python3
"""결론 불명 정식 결정서 28건 회수 (R-03 잔여 실행분 · 2026.08.30)

batch_parse.py가 「불명」으로 남긴 28건의 원인은 둘이었다:
  · 기타(8건)   — 주문은 읽었으나 결론 매핑 규칙이 못 덮는 문언
                  (「환급하라」「보상하라」「청구를 인용한다」「배상할 책임이 있다」…)
  · 주문없음(20건) — HWP **배포용 문서**. BodyText에 안내문만 있고 본문은
                  암호화된 ViewText에 있다 (시드 XOR + AES-ECB + zlib)

이 스크립트는 둘 다 회수한다. 결론은 규칙(v2)으로 판정하고 주문 원문을
증거로 남긴다 — 모델이 결론을 정하지 않는다. 쟁점·상품군·채널·특성
라벨만 classify_corpus.py와 같은 프롬프트로 분류한다(label_source=MIXED).

단계 (분리 실행 — 각 단계 산출물을 눈으로 확인하고 다음으로):
  1) 파싱+결론:  python scripts/recover_unknown28.py --zip ~/Documents/precase-원자료-hwp-20260826.zip
  2) 라벨 분류:  … --classify           (ANTHROPIC_API_KEY 필요, 28건 호출)
  3) DB 적재:    … --load               (BATCH_DATABASE_URL, 증분 insert)

산출물: measure/recovered-28.json (파싱·결론·증거·라벨 전부)
적재 후 scripts/aggregate_patterns.sql 재실행이 필요하다 (risk_patterns).
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import tempfile
import zipfile
import zlib
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "measure/experiment/src/parse"))
import batch_parse  # noqa: E402  (hwp_to_text · split_sections · RATIO_PATTERNS)

OUT_PATH = REPO / "measure/recovered-28.json"
PARSE_REPORT = REPO / "measure/experiment/data/parse_report.json"
CORPUS_VERSION = "v20260830-r03"

# ─────────────────────────── 배포용 문서(ViewText) 복호 ───────────────────────────
# pyhwp distdoc 알고리즘. 각 ViewText 섹션은
# [4B 레코드 헤더][256B 시드 블록][AES-128-ECB 암호문]이다.


def _ms_rand(seed: int):
    state = seed & 0xFFFFFFFF
    while True:
        state = (state * 214013 + 2531011) & 0xFFFFFFFF
        yield (state >> 16) & 0x7FFF


def _aes_key_from_head(head: bytes) -> bytes:
    data = bytearray(head)
    seed = struct.unpack("<I", head[0:4])[0]
    rnd = _ms_rand(seed)
    n = 0
    key = 0
    for i in range(256):
        if n == 0:
            key = next(rnd) & 0xFF
            n = (next(rnd) & 0xF) + 1
        if i >= 4:
            data[i] ^= key
        n -= 1
    offset = 4 + (seed & 0xF)
    return bytes(data[offset : offset + 16])


def _viewtext_to_text(path: str) -> str:
    import olefile
    from Crypto.Cipher import AES

    ole = olefile.OleFileIO(path)
    try:
        compressed = bool(ole.openstream("FileHeader").read()[36] & 1)
        secs = sorted(
            ("/".join(e) for e in ole.listdir() if e[0] == "ViewText"),
            key=lambda s: int(re.sub(r"\D", "", s.split("/")[-1]) or 0),
        )
        if not secs:
            raise ValueError("ViewText 없음")
        chunks: list[str] = []
        for sec in secs:
            raw = ole.openstream(sec).read()
            hdr = struct.unpack("<I", raw[0:4])[0]
            pos = 4
            if (hdr >> 20) & 0xFFF == 0xFFF:
                pos = 8
            aes_key = _aes_key_from_head(raw[pos : pos + 256])
            tail = raw[pos + 256 :]
            tail = tail[: len(tail) - (len(tail) % 16)]
            plain = AES.new(aes_key, AES.MODE_ECB).decrypt(tail)
            if compressed:
                plain = zlib.decompressobj(-15).decompress(plain)
            # 일반 섹션과 같은 레코드 스트림 — 텍스트 레코드(tag 67)만 잇는다
            p = 0
            while p + 4 <= len(plain):
                h = int.from_bytes(plain[p : p + 4], "little")
                p += 4
                tag, ln = h & 0x3FF, (h >> 20) & 0xFFF
                if ln == 0xFFF:
                    ln = int.from_bytes(plain[p : p + 4], "little")
                    p += 4
                payload = plain[p : p + ln]
                p += ln
                if tag == 67:
                    chunks.append(batch_parse._decode(payload))
        return "\n".join(chunks)
    finally:
        ole.close()


def full_text(path: str) -> tuple[str, str]:
    """(본문 텍스트, 추출 경로). 배포용이면 ViewText를 복호한다."""
    text = batch_parse.hwp_to_text(path)
    if "배포용 문서입니다" in text[:300] or len(text.strip()) < 200:
        return _viewtext_to_text(path), "VIEWTEXT"
    return text, "BODYTEXT"


# ─────────────────────────── 결론 판정 v2 ───────────────────────────
# 원칙은 v1과 같다 — 주문 문언만 본다. v1이 못 덮던 이행명령 일반형과
# 「청구를 인용한다」를 더하고, 인용·기각이 병존하는 주문(대량 신청인
# 사건의 일부 인용)을 UPHELD로 매핑한다 (채점 매핑 높음↔UPHELD와 동일 방향,
# 일부 인용 여부는 order_type·note에 보존).

UP_CMD = (
    r"(?:지급|배상|환급|반환|보상|상환|승낙|이행|말소|회복|복구|원상회복|발급|교부|정정|감액)"
    r"(?:하라|한다|할것|하여야|하기로한다|하고)"
)
UP_DECL = r"청구를인용|신청을인용|인용한다|인정한다|확인한다|존재하지아니|책임이있다"


def classify_order_v2(order: str) -> dict:
    o = re.sub(r"\s", "", order)
    if not o:
        return {"order_type": None, "verdict": None, "note": "주문없음"}
    has_rej = bool(re.search(r"기각한다|기각함|이유없", o))
    has_dis = bool(re.search(r"각하", o))
    has_up = bool(re.search(UP_CMD, o) or re.search(UP_DECL, o))
    amount = bool(re.search(r"[\d,]{6,}원", o))
    if has_up and (has_rej or has_dis):
        return {
            "order_type": "UPHELD_AMOUNT" if amount else "UPHELD_NO_AMOUNT",
            "verdict": "UPHELD",
            "note": "일부인용 — 주문에 인용·기각 병존 (대량 신청인)",
        }
    if has_rej:
        return {"order_type": "REJECTED", "verdict": "REJECTED", "note": None}
    if has_dis:
        return {"order_type": "DISMISSED", "verdict": "REJECTED", "note": None}
    if has_up:
        if re.search(r"인정한다|확인한다|존재하지아니|책임이있다", o) and not re.search(UP_CMD, o):
            return {"order_type": "UPHELD_CONFIRM", "verdict": "UPHELD", "note": None}
        return {
            "order_type": "UPHELD_AMOUNT" if amount else "UPHELD_NO_AMOUNT",
            "verdict": "UPHELD",
            "note": None,
        }
    return {"order_type": None, "verdict": None, "note": "불명 — v2 규칙으로도 매핑 실패"}


# ─────────────────────────── 파싱 ───────────────────────────


def parse_one(path: Path) -> dict:
    text, via = full_text(str(path))
    sec = batch_parse.split_sections(text)
    flat = re.sub(r"[ \t]+", "", text)

    meta: dict = {}
    m = re.search(r"제\s*(\d{4})\s*[-–]\s*(\d+)\s*호", text[:4000])
    if not m:
        m = re.search(r"(\d{4})\s*[-–]\s*(\d+)", path.name)
    if m:
        meta["case_year"] = int(m.group(1))
        meta["decision_no"] = f"제{m.group(1)}-{m.group(2)}호"
    m = re.search(r"결\s*정\s*일\s*자\s*[::]\s*(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})", text[:2000])
    if m:
        meta["decision_date"] = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r"안\s*건\s*명\s*[::]?\s*(.+)", text)
    if m:
        meta["title"] = re.sub(r"\s+", " ", m.group(1)).strip(" :")[:120]
    for kind in ["증권", "은행", "생명보험", "생명", "화재", "손해보험", "카드", "캐피탈", "자산운용", "저축은행"]:
        if kind in flat[:3000]:
            meta["sector_raw"] = kind
            break

    order = sec.get("주문", "")
    label = classify_order_v2(order)

    comp = None
    hay = sec.get("결론", "") + "\n" + sec.get("위원회판단", "")
    for p in batch_parse.RATIO_PATTERNS:
        m = re.search(p, hay)
        if m and 0 < float(m.group(1)) <= 100:
            comp = float(m.group(1))
            break

    facts = "\n\n".join(
        f"[{k}]\n{sec[k]}"
        for k in ["기초사실", "신청인주장", "피신청인주장", "당사자주장"]
        if sec.get(k) and not (k == "당사자주장" and "신청인주장" in sec)
    )
    reasoning = sec.get("위원회판단", "")
    conclusion = sec.get("결론", "")

    return {
        "file": path.name,
        "via": via,
        "meta": meta,
        "label": label,
        "compensation_rate": comp,
        "order_text": re.sub(r"\s+", " ", order).strip()[:500],
        "sections": {k: len(v) for k, v in sec.items()},
        "facts": facts,
        "reasoning": (reasoning + ("\n" + conclusion if conclusion else "")).strip(),
    }


def step_parse(zip_path: Path) -> None:
    report = json.loads(PARSE_REPORT.read_text(encoding="utf-8"))
    targets = {r["file"] for r in report["ok"] if r["label"].get("결론") == "불명"}
    print(f"회수 대상 {len(targets)}건 (parse_report 기준)")

    with tempfile.TemporaryDirectory() as td, zipfile.ZipFile(zip_path) as zf:
        # 파일명 정규화(NFC/NFD)가 갈릴 수 있어 숫자 접두어로 대조한다
        members = {n.split("/")[-1]: n for n in zf.namelist() if n.endswith(".hwp") and "/decision/" in n}
        by_prefix = {n.split("_")[0]: full for n, full in members.items()}
        out = []
        for fname in sorted(targets):
            member = members.get(fname) or by_prefix.get(fname.split("_")[0])
            if not member:
                out.append({"file": fname, "error": "zip에서 못 찾음"})
                continue
            local = Path(td) / fname
            local.write_bytes(zf.read(member))
            try:
                out.append(parse_one(local))
            except Exception as e:  # noqa: BLE001
                out.append({"file": fname, "error": f"{type(e).__name__}: {e}"})

    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    ok = [r for r in out if r.get("label", {}).get("verdict")]
    fail = [r for r in out if not r.get("label", {}).get("verdict")]
    print(f"\n결론 회수 {len(ok)}/{len(out)}건 → {OUT_PATH.relative_to(REPO)}")
    for r in out:
        if "error" in r:
            print(f"  ✗ {r['file']}: {r['error']}")
            continue
        lab = r["label"]
        mark = "✓" if lab["verdict"] else "✗"
        print(
            f"  {mark} {r['meta'].get('decision_no', '?'):<12} [{r['via'][:4]}]"
            f" {lab['verdict'] or '불명'}/{lab['order_type'] or '-'}"
            + (f" ({lab['note']})" if lab["note"] else "")
        )
        print(f"      주문: {r['order_text'][:150]}")
    if fail:
        print(f"\n⚠️ 미회수 {len(fail)}건 — 위 ✗ 행. 수동 확인 필요")


# ─────────────────────────── 라벨 분류 (쟁점·상품군·채널·특성) ───────────────────────────


def _env_from_dotenv(name: str) -> str | None:
    """`.env.local`에서 값을 읽는다 — 값이 따옴표로 감싸져 있어 shell export가 깨진다."""
    import os
    if os.environ.get(name):
        return os.environ[name]
    for line in (REPO / ".env.local").read_text(encoding="utf-8").splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def step_classify() -> None:
    import os
    sys.path.insert(0, str(REPO / "scripts"))
    import classify_corpus  # SYSTEM · USER_TMPL · parse_json · normalize 재사용

    from anthropic import Anthropic

    key = _env_from_dotenv("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("ANTHROPIC_API_KEY 미설정")
    os.environ["ANTHROPIC_API_KEY"] = key

    rows = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    todo = [r for r in rows if r.get("label", {}).get("verdict") and not r.get("labels_v2")]
    print(f"분류 대상 {len(todo)}건 · 모델 {classify_corpus.MODEL}")
    client = Anthropic()
    for i, r in enumerate(todo, 1):
        verdict_ko = "인용" if r["label"]["verdict"] == "UPHELD" else "기각"
        msg = classify_corpus.USER_TMPL.format(
            sector=r["meta"].get("sector_raw") or "미상",
            label=verdict_ko,
            facts=(r["facts"] or "(없음)")[:2500],
            reasoning=(r["reasoning"] or "(없음)")[:4000],
        )
        resp = client.messages.create(
            model=classify_corpus.MODEL, max_tokens=1500,
            system=classify_corpus.SYSTEM,
            messages=[{"role": "user", "content": msg}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        parsed = classify_corpus.parse_json(text)
        if not parsed:
            print(f"  ✗ {r['meta'].get('decision_no')}: 분류 파싱 실패")
            continue
        r["labels_v2"] = classify_corpus.normalize(parsed)
        print(f"  {i}/{len(todo)} {r['meta'].get('decision_no')}: {r['labels_v2']['issues']}"
              f" · {r['labels_v2']['product_code']} · {r['labels_v2']['channel']}")
    OUT_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {OUT_PATH.relative_to(REPO)} 갱신")


# ─────────────────────────── DB 적재 (증분) ───────────────────────────


def _shingles(t: str, n: int = 4) -> set[str]:
    t = re.sub(r"\s+", "", t)
    return {t[i : i + n] for i in range(max(0, len(t) - n + 1))}


def step_load() -> None:
    import psycopg

    dsn = None
    envf = REPO / ".env.local"
    for line in envf.read_text(encoding="utf-8").splitlines():
        if line.startswith("BATCH_DATABASE_URL"):
            dsn = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not dsn:
        sys.exit("BATCH_DATABASE_URL 미설정")

    SECTOR_MAP = {"증권": "INVESTMENT", "은행": "BANKING", "카드": "CARD",
                  "생명보험": "INSURANCE", "생명": "INSURANCE", "화재": "INSURANCE",
                  "손해보험": "INSURANCE", "캐피탈": "BANKING", "자산운용": "INVESTMENT",
                  "저축은행": "BANKING"}

    # U-9 별칭 — 동일 개념의 표기 변형만 통합한다 (load_corpus.py TAG_ALIASES와 같은 원칙).
    # 사용자책임(민법 756)의 두 표기를 하나로. 계약후알릴의무위반(상법 652)은
    # 고지의무위반(상법 651·계약 전)과 법적으로 다른 개념이라 통합하지 않는다.
    TAG_ALIASES = {"사용자배상책임": "사용자책임"}

    rows = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    ready = [r for r in rows if r.get("label", {}).get("verdict") and r.get("labels_v2")]
    for r in ready:
        r["labels_v2"]["issues"] = [TAG_ALIASES.get(t, t) for t in r["labels_v2"].get("issues", [])]
    print(f"적재 후보 {len(ready)}건 (결론 회수 + 라벨 분류 완료분)")

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        # 게이트 1 — 중복 (decision_no 기준)
        cur.execute("select decision_no from cases where decision_no is not null")
        existing = {x[0] for x in cur.fetchall()}
        dup = [r for r in ready if r["meta"].get("decision_no") in existing]
        if dup:
            print(f"  이미 적재된 {len(dup)}건 건너뜀: {[r['meta']['decision_no'] for r in dup]}")
        ready = [r for r in ready if r["meta"].get("decision_no") not in existing]

        # 게이트 2 — Q-1 누출: 검증셋과 자카드 0.60 초과 시 차단 (load_corpus와 동일 임계)
        cur.execute("select decision_no, facts_summary from cases where is_validation")
        val = [(d, _shingles(f or "")) for d, f in cur.fetchall()]
        blocked = []
        for r in ready:
            rs = _shingles(r["facts"])
            for vd, vs in val:
                if not rs or not vs:
                    continue
                j = len(rs & vs) / len(rs | vs)
                if j > 0.60:
                    blocked.append((r["meta"].get("decision_no"), vd, round(j, 2)))
                    r["_blocked"] = f"검증셋 {vd}와 자카드 {j:.2f}"
                    break
        if blocked:
            print(f"  ⚠️ 누출 차단 {len(blocked)}건: {blocked}")
        ready = [r for r in ready if "_blocked" not in r]

        # 게이트 3 — 열거 무결성
        for r in ready:
            assert r["label"]["verdict"] in ("UPHELD", "REJECTED")
            assert r["label"]["order_type"] in (
                "UPHELD_AMOUNT", "UPHELD_NO_AMOUNT", "UPHELD_CONFIRM", "REJECTED", "DISMISSED")
            assert r["facts"], f"{r['file']}: facts 비어 있음"
            assert r["meta"].get("decision_no"), f"{r['file']}: decision_no 없음"

        cur.execute("select code, id from issue_tags")
        tid = dict(cur.fetchall())
        inserted = 0
        for r in ready:
            lab2 = r["labels_v2"]
            cur.execute(
                """insert into cases
                   (source_type, decision_no, decision_date, sector, product_code, channel,
                    verdict, compensation_rate, facts_summary, panel_reasoning, source_url,
                    case_year, is_validation, corpus_version, order_type, board, post_no,
                    label_source)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   returning id""",
                ("DECISION", r["meta"]["decision_no"], r["meta"].get("decision_date"),
                 SECTOR_MAP.get(r["meta"].get("sector_raw"), "UNKNOWN"),
                 lab2.get("product_code"), lab2.get("channel"),
                 r["label"]["verdict"],
                 int(r["compensation_rate"]) if r.get("compensation_rate") else None,
                 r["facts"], r["reasoning"] or None, None,
                 r["meta"].get("case_year"), False, CORPUS_VERSION,
                 r["label"]["order_type"], "조정결정서", r["file"].split("_")[0],
                 "MIXED"),  # 결론=규칙(RULE) + 라벨=모델(MODEL)
            )
            cid = cur.fetchone()[0]
            for lbl in {t for t in lab2.get("issues", []) if t}:
                code = re.sub(r"\s+", "_", lbl)
                if code not in tid:
                    cur.execute(
                        "insert into issue_tags (code, label_ko) values (%s,%s)"
                        " on conflict (code) do nothing returning id", (code, lbl))
                    got = cur.fetchone()
                    if got:
                        tid[code] = got[0]
                if code in tid:
                    cur.execute("insert into case_issues values (%s,%s) on conflict do nothing",
                                (cid, tid[code]))
            for t in set(lab2.get("traits", [])):
                cur.execute("insert into case_traits values (%s,%s) on conflict do nothing",
                            (cid, t))
            inserted += 1
        conn.commit()
    OUT_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n✅ 적재 {inserted}건 · version={CORPUS_VERSION}")
    print("→ scripts/aggregate_patterns.sql 재실행 필요 (risk_patterns)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=str(Path.home() / "Documents/precase-원자료-hwp-20260826.zip"))
    ap.add_argument("--classify", action="store_true")
    ap.add_argument("--load", action="store_true")
    args = ap.parse_args()
    if args.classify:
        step_classify()
    elif args.load:
        step_load()
    else:
        step_parse(Path(args.zip).expanduser())


if __name__ == "__main__":
    main()
