/**
 * 브리핑 발동 로직 (R-06) — 문장은 상수, 발동은 도구 반환 쟁점·슬롯이 정한다.
 * 도구가 주지 않은 쟁점의 질문이 나오지 않는 것이 핵심 계약이다 (S-12와 같은 규약).
 */

import { describe, expect, it } from "vitest";
import { buildBriefing } from "../briefing";

describe("buildBriefing — 판매자 질문", () => {
  it("쟁점이 없어도 공통 질문은 성립한다 — 해지·설명 자료", () => {
    const b = buildBriefing({ product: "BNK_LOAN", issues: [] });
    expect(b.questions.some((q) => q.text.includes("해지하면"))).toBe(true);
    expect(b.questions.some((q) => q.basis.startsWith("공통"))).toBe(true);
  });

  it("도구가 반환한 쟁점의 질문만 나온다", () => {
    const b = buildBriefing({ product: "INS_WHOLE", issues: ["설명의무"] });
    expect(b.questions.some((q) => q.text.includes("원금을 잃을 수"))).toBe(true);
    // 반환되지 않은 쟁점(고지의무위반)의 질문은 나올 수 없다
    expect(b.questions.some((q) => q.text.includes("미리 알려야"))).toBe(false);
  });

  it("같은 질문으로 수렴하는 쟁점은 한 번만 나온다 — 보험금지급범위·면책사유", () => {
    const b = buildBriefing({ product: "INS_SILSON", issues: ["보험금지급범위", "면책사유"] });
    const dup = b.questions.filter((q) => q.text.includes("지급되지 않는 경우"));
    expect(dup.length).toBe(1);
  });

  it("경로를 고르면 그 경로의 질문이 붙고, 모름이면 붙지 않는다", () => {
    const tm = buildBriefing({ product: "INS_WHOLE", channel: "TM", issues: [] });
    expect(tm.questions.some((q) => q.text.includes("녹음"))).toBe(true);
    const unknown = buildBriefing({ product: "INS_WHOLE", channel: "UNKNOWN", issues: [] });
    expect(unknown.questions.some((q) => q.text.includes("녹음"))).toBe(false);
  });
});

describe("buildBriefing — 멈춤 신호", () => {
  it("보험이면 해피콜 신호가 나온다", () => {
    const b = buildBriefing({ product: "INS_SAVINGS", issues: [] });
    expect(b.signals.some((s) => s.text.includes("해피콜"))).toBe(true);
  });

  it("투자성 상품이면 쟁점이 비어도 원금 보장·대리 작성 신호가 나온다", () => {
    const b = buildBriefing({ product: "INV_ELS", issues: [] });
    expect(b.signals.some((s) => s.text.includes("원금 보장"))).toBe(true);
    expect(b.signals.some((s) => s.text.includes("대신 작성"))).toBe(true);
  });

  it("은행·여신에서 쟁점이 비면 근거 없는 신호를 만들지 않는다", () => {
    const b = buildBriefing({ product: "BNK_LOAN", issues: [] });
    expect(b.signals.length).toBe(0);
  });

  it("모든 항목에 근거(basis)가 붙어 있다", () => {
    const b = buildBriefing({ product: "INV_FUND", channel: "BRANCH", issues: ["설명의무", "부당권유"] });
    for (const item of [...b.questions, ...b.signals]) {
      expect(item.basis.length).toBeGreaterThan(0);
    }
  });
});
