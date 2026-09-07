import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { productTemporalStatus, readOfficialProduct } from "../tools/official-product";
import type { ToolCallContext } from "../tools/runtime";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("공식 상품의 종료 고지와 수집 신선도 분리", () => {
  it.each([
    ["[2025년 12월 31일 보증 종료]", "2026-09-07", "ENDED", false],
    ["[2026년 12월 31일 보증 종료]", "2026-09-07", "SCHEDULED_END", true],
    ["[2026년 9월 7일 판매 종료]", "2026-09-07", "SCHEDULED_END", true],
    ["[2026년 2월 30일 보증 종료]", "2026-09-07", "UNRESOLVED_END_NOTICE", false],
    ["보증 종료 안내", "2026-09-07", "UNRESOLVED_END_NOTICE", false],
    ["[2025.12.31 보증 종료]", "2026-09-07", "UNRESOLVED_END_NOTICE", false],
    ["대출금리 연 15.9%", "2026-09-07", "NO_END_NOTICE", true],
  ])("%s", (text, asOf, status, citable) => {
    expect(productTemporalStatus(text, asOf)).toMatchObject({ status, citable });
  });
  it("새로 읽은 종료 자료는 근거를 보존하면서 확정 인용을 막는다", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-07T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('<h3 id="ConTitle">햇살론15</h3><p>[2025년 12월 31일 보증 종료]</p><p>대출금리 연 15.9% 대출한도 최대 2000만원</p><!--일반보증이란?-->')));
    const result = await readOfficialProduct({}, {} as ToolCallContext);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ freshness: "FRESH", isCitable: false, isComplete: true,
      directness: "CONTEXT_ONLY", selectionReasonCode: "PRODUCT_END_NOTICE",
      locator: { temporal_status: "ENDED", product_end_date: "2025-12-31", assessed_on: "2026-09-07" } });
    expect(result.items[0].excerptMasked).toContain("보증 종료");
    expect(result.items[0].title).toContain("종료 자료");
  });
});
