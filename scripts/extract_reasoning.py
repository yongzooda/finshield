#!/usr/bin/env python3
"""
위원회판단 섹션 재추출

기존 파이프라인(src/parse/batch_parse.py)은 위원회판단을 파싱하지만 저장하지 않는다.
  · golden_candidates.json / parse_report.json 의 sections 는 **길이(int)** — batch_parse.py:239
  · input_text 는 기초사실 + 당사자주장만 (검증셋 정답 누출 방지)

쟁점 태그(U-9)는 기획서 6.3의 집계 정의상 "위원회 판단부에 명시된 것"만 인정하므로
판단부 원문이 필요하다. HWP 원본이 있으므로 기존 파서를 재사용해 판단부만 다시 뽑는다.

새로 수집하는 것이 아니라 **이미 있는 원본을 다시 읽는 것**이다.

사용법
  python scripts/extract_reasoning.py --project ~/Downloads/프리케이스
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path


def load_parser(project: Path):
    """batch_parse.py 를 모듈로 로드해 hwp_to_text · split_sections 를 재사용."""
    path = project / "src" / "parse" / "batch_parse.py"
    if not path.exists():
        sys.exit(f"파서를 찾을 수 없다: {path}")
    spec = importlib.util.spec_from_file_location("batch_parse", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["batch_parse"] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="프리케이스 파이프라인 폴더")
    ap.add_argument("--out", default=None, help="기본: <project>/data/panel_reasoning.json")
    args = ap.parse_args()

    project = Path(args.project).expanduser()
    data_dir = project / "data"
    out_path = Path(args.out).expanduser() if args.out else data_dir / "panel_reasoning.json"

    bp = load_parser(project)

    # 적재 대상 360건만 처리 (전체 668건을 다 읽을 필요 없음)
    corpus = json.loads((data_dir / "corpus.json").read_text(encoding="utf-8"))
    evalset = json.loads((data_dir / "eval_set.json").read_text(encoding="utf-8"))
    targets = {r["id"]: r for r in corpus + evalset}

    dec_dir = data_dir / "raw" / "cases" / "decision"
    sum_dir = data_dir / "raw" / "cases" / "summary"

    out: dict[str, dict] = {}
    missing, failed = [], []

    for rid in targets:
        path = dec_dir / rid
        if not path.exists():
            path = sum_dir / rid
        if not path.exists():
            missing.append(rid)
            continue
        try:
            text = bp.hwp_to_text(str(path))
            sec = bp.split_sections(text)
            out[rid] = {
                "reasoning": (sec.get("위원회판단") or "").strip(),
                "conclusion": (sec.get("결론") or "").strip(),
                "order": (sec.get("주문") or "").strip(),
            }
        except Exception as e:  # noqa: BLE001
            failed.append({"id": rid, "error": f"{type(e).__name__}: {e}"[:200]})

    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    have = sum(1 for v in out.values() if v["reasoning"])
    print(f"대상 {len(targets)}건")
    print(f"  판단부 확보 : {have}")
    print(f"  판단부 공란 : {len(out) - have}")
    print(f"  파일 없음   : {len(missing)}")
    print(f"  파싱 실패   : {len(failed)}")
    if missing:
        print("  없음 예시:", missing[:5])
    if failed:
        print("  실패 예시:", failed[:3])
    lens = [len(v["reasoning"]) for v in out.values() if v["reasoning"]]
    if lens:
        lens.sort()
        print(f"  판단부 길이 중앙값 {lens[len(lens)//2]:,}자 (최소 {lens[0]:,} / 최대 {lens[-1]:,})")
    print(f"\n저장: {out_path}")


if __name__ == "__main__":
    main()
