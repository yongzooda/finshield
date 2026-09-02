#!/usr/bin/env python3
"""
코퍼스 360건 라벨 분류 — 쟁점·상품군·채널·특성 4종 동시 추출

원본 데이터에 없는 필드를 위원회판단 섹션에서 모델로 분류한다.
결과는 data/labels_v1.json 에 저장되며, load_corpus.py 가 이를 병합해 적재한다.

원칙
  · 위원회가 **실제로 심리한 것**만 쟁점으로 잡는다 (신청인 주장만 있는 것 제외)
  · 근거가 없으면 값을 지어내지 않고 null / 빈 배열을 반환한다
  · 쟁점 후보는 기획서에서 도출한 10종이되, 없으면 새 태그 생성 허용 (U-9)

사용법
  export ANTHROPIC_API_KEY=sk-ant-...
  python scripts/classify_corpus.py --data-dir ~/Downloads/프리케이스/data --limit 5   # 시험
  python scripts/classify_corpus.py --data-dir ~/Downloads/프리케이스/data            # 전체

체크포인트를 남기므로 중단해도 이어서 실행된다.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

MODEL = os.environ.get("CLASSIFY_MODEL", "claude-sonnet-5")

# 기능 요구사항 2.3 — 상품군 13종
PRODUCTS = [
    "INS_SILSON", "INS_WHOLE", "INS_ANNUITY", "INS_SAVINGS", "INS_AUTO", "INS_ETC",
    "INV_ELS", "INV_FUND", "INV_MARGIN", "INV_ETC",
    "BNK_LOAN", "BNK_ETC", "ETC_UNKNOWN",
]
CHANNELS = ["TM", "BANCA_HS", "AGENT", "BRANCH", "ONLINE"]
TRAITS = ["PRO", "ELDER", "INEXP", "CAPACITY"]

# 쟁점 후보 — 기획서에 등장한 것들. 정본이 아니라 출발점이며 새 태그 추가 가능
ISSUE_SEEDS = [
    "설명의무", "적합성원칙", "적정성원칙", "부당권유", "고지의무위반",
    "약관해석", "계약서류사후교부", "설문대리작성", "전자문서도달효력",
    "과실상계", "면책사유", "보험금지급범위", "사기기망취소",
]

SYSTEM = f"""당신은 금융분쟁조정 결정문을 읽고 구조화 라벨을 붙이는 분류기다.

## 절대 규칙
1. **위원회가 실제로 심리·판단한 것만** 쟁점으로 잡는다. 신청인이 주장만 하고 위원회가 다루지 않은 것은 제외한다.
2. 본문에 근거가 없으면 **값을 지어내지 않는다.** channel은 null, traits는 빈 배열로 둔다.
3. 추측하지 않는다. "아마 창구일 것"이라는 식의 판단은 금지다.

## 출력 스키마 (JSON만, 설명 금지)
{{
  "issues": ["쟁점태그", ...],
  "product_code": "코드 또는 null",
  "channel": "코드 또는 null",
  "traits": ["코드", ...],
  "issue_evidence": "쟁점 판단의 근거가 된 원문 한 구절 (30자 내외)"
}}

## issues
아래 후보에서 고르되, 어느 것에도 해당하지 않으면 **새 태그를 만들어도 된다**(한글 명사구, 공백 없이).
{", ".join(ISSUE_SEEDS)}
1~3개. 위원회 판단의 핵심 쟁점만.

⚠️ 태그 의미 구분 — 혼동 금지:
- **고지의무위반** = 보험계약자(소비자)가 병력 등 중요사항을 알리지 않음 (상법 제651조). **보험 사건 전용.**
- 판매자가 허위·부실 자료로 권유한 것은 **부당권유** 또는 **사기기망취소**(민법 제110조 계약취소 쟁점)다. 고지의무위반이 아니다.
- **설명의무** = 판매자가 상품 내용·위험을 설명하지 않거나 부실 설명.

## product_code
{", ".join(PRODUCTS)}
- INS_*: 실손/종신/연금/저축성/자동차/기타보험
- INV_ELS: ELS·DLS·파생결합증권(공모·사모 불문) | INV_FUND: **펀드·수익증권·특정금전신탁 등 신탁 일체** | INV_MARGIN: 신용거래·반대매매
- BNK_LOAN: 대출·근저당 | BNK_ETC: 예적금 등
- 카드 사건이나 분류 불가는 ETC_UNKNOWN
- 같은 상품군 사건은 같은 코드여야 한다 — 신탁을 ELS나 ETC로 보내지 말 것

## channel (가입·판매 경로가 본문에 명시된 경우만)
TM(전화) | BANCA_HS(방카슈랑스·홈쇼핑) | AGENT(모집인·설계사) | BRANCH(창구·대면) | ONLINE(온라인·모바일)

## traits (본문에 명시된 것만)
PRO(전문투자자·전문금융소비자) | ELDER(60세 이상 명시) | INEXP(투자경험 부족) | CAPACITY(의사능력 제약)
"""

USER_TMPL = """다음 금융분쟁조정 사건을 분류하라.

[업권] {sector}
[결론] {label}

[기초사실]
{facts}

[위원회 판단]
{reasoning}

JSON만 출력하라."""


def load_sources(data_dir: Path) -> list[dict]:
    """corpus + eval 360건에 기초사실·위원회판단을 병합한다.

    위원회판단은 extract_reasoning.py 가 만든 panel_reasoning.json 에서 온다.
    기존 산출물의 sections 는 길이(int)라 본문이 없다 (batch_parse.py:239).
    """
    corpus = json.loads((data_dir / "corpus.json").read_text(encoding="utf-8"))
    evalset = json.loads((data_dir / "eval_set.json").read_text(encoding="utf-8"))

    pr_path = data_dir / "panel_reasoning.json"
    if not pr_path.exists():
        sys.exit(
            f"{pr_path} 없음.\n"
            "먼저 판단부를 추출할 것:\n"
            "  python scripts/extract_reasoning.py --project ~/Downloads/프리케이스"
        )
    panel = json.loads(pr_path.read_text(encoding="utf-8"))

    out = []
    for rec in corpus + evalset:
        rid = rec["id"]
        p = panel.get(rid) or {}
        out.append({
            "id": rid,
            "sector": rec.get("sector") or "미상",
            "label": rec.get("label"),
            # 기초사실 + 당사자주장 (정답 누출 없는 입력부)
            "facts": (rec.get("text") or "")[:2500],
            # 위원회가 실제로 심리한 부분 — 쟁점 판정의 근거
            "reasoning": ((p.get("reasoning") or "") + "\n" + (p.get("conclusion") or ""))[:4000],
        })
    return out


def parse_json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def normalize(raw: dict) -> dict:
    """열거 밖 값을 걸러낸다. 지어낸 값이 DB로 새는 것을 막는 마지막 관문."""
    issues = [str(t).strip().replace(" ", "") for t in (raw.get("issues") or []) if str(t).strip()]
    product = raw.get("product_code")
    channel = raw.get("channel")
    traits = [t for t in (raw.get("traits") or []) if t in TRAITS]
    return {
        "issues": issues[:3],
        "product_code": product if product in PRODUCTS else None,
        "channel": channel if channel in CHANNELS else None,
        "traits": sorted(set(traits)),
        "issue_evidence": (raw.get("issue_evidence") or "")[:120],
    }


def classify_one(client, rec: dict, retries: int = 2) -> dict:
    msg = USER_TMPL.format(
        sector=rec["sector"], label=rec["label"],
        facts=rec["facts"] or "(없음)", reasoning=rec["reasoning"] or "(없음)",
    )
    for attempt in range(retries + 1):
        try:
            resp = client.messages.create(
                model=MODEL, max_tokens=1500, system=SYSTEM,
                messages=[{"role": "user", "content": msg}],
            )
            # thinking 블록이 앞에 붙을 수 있으므로 텍스트 블록만 골라 읽는다
            text = "".join(
                b.text for b in resp.content if getattr(b, "type", "") == "text")
            parsed = parse_json(text)
            if parsed:
                return {"id": rec["id"], **normalize(parsed), "ok": True}
        except Exception as e:  # noqa: BLE001
            if attempt == retries:
                return {"id": rec["id"], "ok": False, "error": str(e)[:200],
                        "issues": [], "product_code": None, "channel": None, "traits": []}
            time.sleep(2 ** attempt)
    return {"id": rec["id"], "ok": False, "error": "parse failed",
            "issues": [], "product_code": None, "channel": None, "traits": []}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True, help="corpus.json 등이 있는 폴더")
    ap.add_argument("--out", default=None, help="기본: <data-dir>/labels_v1.json")
    ap.add_argument("--limit", type=int, default=0, help="시험용 N건만")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY 미설정")
    try:
        from anthropic import Anthropic
    except ImportError:
        sys.exit("pip install anthropic")

    data_dir = Path(args.data_dir).expanduser()
    out_path = Path(args.out).expanduser() if args.out else data_dir / "labels_v1.json"

    records = load_sources(data_dir)
    if args.limit:
        records = records[: args.limit]
    print(f"대상 {len(records)}건 · 모델 {MODEL}")

    done: dict[str, dict] = {}
    if out_path.exists():
        prev = json.loads(out_path.read_text(encoding="utf-8"))
        done = {r["id"]: r for r in prev if r.get("ok")}   # 실패 건은 버리고 재시도
        n_fail = len(prev) - len(done)
        print(f"체크포인트 {len(done)}건 발견 — 이어서 실행"
              + (f" (실패 {n_fail}건 재시도)" if n_fail else ""))
    todo = [r for r in records if r["id"] not in done]
    if not todo:
        print("이미 전부 완료")
        return

    client = Anthropic()
    lock = Lock()
    t0 = time.time()

    def save() -> None:
        out_path.write_text(
            json.dumps(list(done.values()), ensure_ascii=False, indent=1), encoding="utf-8")

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(classify_one, client, r): r for r in todo}
        for n, fut in enumerate(as_completed(futs), 1):
            res = fut.result()
            with lock:
                done[res["id"]] = res
                if n % 10 == 0 or n == len(todo):
                    save()
                    el = time.time() - t0
                    print(f"  {n}/{len(todo)} · {el:.0f}s · 잔여 {el/n*(len(todo)-n):.0f}s")
    save()

    # ---- 요약 ----
    vals = list(done.values())
    fail = [r for r in vals if not r.get("ok")]
    from collections import Counter
    issues = Counter(t for r in vals for t in r["issues"])
    print(f"\n완료 {len(vals)}건 · 실패 {len(fail)}건 → {out_path}")
    print(f"product_code 부착 {sum(1 for r in vals if r['product_code'])}/{len(vals)}")
    print(f"channel 부착      {sum(1 for r in vals if r['channel'])}/{len(vals)}")
    print(f"traits 부착       {sum(1 for r in vals if r['traits'])}/{len(vals)}")
    print(f"\n=== U-9 쟁점 태그 후보 {len(issues)}종 ===")
    for tag, cnt in issues.most_common():
        flag = "  ⚠ 소수" if cnt < 3 else ""
        print(f"  {cnt:>4}건  {tag}{flag}")
    if fail:
        print("\n실패 예시:", [r["id"] for r in fail][:5])


if __name__ == "__main__":
    main()
