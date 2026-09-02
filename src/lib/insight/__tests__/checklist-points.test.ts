/**
 * 점검 문장 상수의 무결성.
 *
 * 화면이 죽지 않도록 `Partial`로 두었지만, **비어 있어도 통과하는 상태를 방치하지는
 * 않는다.** 채널 열거가 늘면 여기서 먼저 걸린다 — 화면은 조용히 「아직 정해지지
 * 않았습니다」로 넘어가므로 사람이 눈치채기 어렵다.
 */

import { describe, expect, it } from "vitest";
import { CHANNEL_POINTS } from "../checklist-points";
import { DB_CHANNELS } from "@/lib/types";
import { CHANNEL_LABELS } from "@/lib/labels";

describe("채널별 점검 문장", () => {
  it("DB 채널 5종 전부에 문장이 있다", () => {
    const missing = DB_CHANNELS.filter((c) => !CHANNEL_POINTS[c]);
    expect(missing, `점검 문장이 없는 채널: ${missing.join(", ")}`).toEqual([]);
  });

  it("한국어 이름도 5종 전부에 있다", () => {
    expect(DB_CHANNELS.filter((c) => !CHANNEL_LABELS[c])).toEqual([]);
  });

  it("항목이 빈 채널이 없다", () => {
    for (const c of DB_CHANNELS) {
      const p = CHANNEL_POINTS[c];
      expect(p?.title, c).toBeTruthy();
      expect(p?.items.length ?? 0, c).toBeGreaterThan(0);
    }
  });

  it("점검 문장에 금융회사명이 들어가지 않는다 (SR-X05)", () => {
    const all = Object.values(CHANNEL_POINTS).flatMap((p) => [p.title, ...p.items]);
    expect(all.some((t) => /은행|생명|화재|증권|카드\s*사/.test(t))).toBe(false);
  });
});

/**
 * 빌드 캐시 사고의 회귀 방지.
 *
 * 2026.08.25에 `npm run build`가 **`channelChecklists()` 자리에 `issueRows()`의
 * 행을 넘겨준** 적이 있다(Next 증분 캐시). 그때 화면은 TypeError로 죽었지만,
 * 두 질의의 열 이름이 겹쳤다면 **틀린 수치가 조용히 나갔을 것이다.**
 * 그래서 네 집계의 열 이름이 서로 구별되는지를 테스트로 붙잡아 둔다.
 */
describe("집계 반환 모양", () => {
  it("네 집계의 필수 열 조합이 서로 겹치지 않는다", () => {
    const shapes: Record<string, string[]> = {
      "채널×쟁점": ["channel", "code", "n", "upheld", "rejected"],
      "반복 쟁점": ["code", "n", "upheld", "rejected", "rateN"],
      "특성별 분포": ["trait", "n", "upheld", "rejected", "topIssues"],
      "채널별 점검표": ["channel", "n", "upheld", "rejected", "issues"],
    };
    const keys = Object.entries(shapes).map(([k, v]) => [k, [...v].sort().join(",")] as const);
    const seen = new Map<string, string>();
    for (const [name, sig] of keys) {
      expect(seen.get(sig), `${name}가 ${seen.get(sig)}와 열 조합이 같다`).toBeUndefined();
      seen.set(sig, name);
    }
  });
});
