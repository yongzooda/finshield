import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { embedQuery, rerankFast } from "../retrieval-provider";
import type { ToolCallContext } from "../tools/runtime";
const sql = vi.fn(); const fetchMock = vi.fn();
const ctx = { sql, ownerId: "synthetic-owner", caseId: "synthetic-case", runId: "synthetic-run" } as unknown as ToolCallContext;
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("COHERE_API_KEY", "synthetic-no-key"); sql.mockResolvedValue([{ id: "synthetic-reservation" }]); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("예약을 거부하면 외부 전송이 없다", async () => {
  sql.mockRejectedValueOnce(new Error("BUDGET_LIMIT_MISSING"));
  await expect(embedQuery("대출 금리 확인", ctx)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
});
it("실제 과금 토큰으로 정산하고 1024차원 응답만 받는다", async () => {
  fetchMock.mockResolvedValue(Response.json({ id: "synthetic-request", embeddings: { float: [Array(1024).fill(.1)] }, meta: { billed_units: { input_tokens: 20 } } }));
  expect((await embedQuery("대출 금리 확인", ctx)).length).toBe(1024);
  expect(sql.mock.calls[1][0].join(" ")).toContain("settle_usage_budget"); expect(sql.mock.calls[1]).toContain(3);
  expect(fetchMock.mock.calls[0][1].redirect).toBe("error"); expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it.each(["network", "usage"])("불명확한 %s 응답은 예약을 보존하고 자동 재호출하지 않는다", async kind => {
  if (kind === "network") fetchMock.mockRejectedValue(new Error("private provider detail"));
  else fetchMock.mockResolvedValue(Response.json({ id: "synthetic-request", embeddings: { float: [] } }));
  await expect(embedQuery("대출 금리 확인", ctx)).rejects.toThrow(/RETRIEVAL_/);
  expect(fetchMock).toHaveBeenCalledOnce(); expect(sql.mock.calls.at(-1)![0].join(" ")).toContain("flag_usage_reconciliation");
});
it("과금 확인 뒤 잘못된 Vector도 비용을 0으로 지우지 않는다", async () => {
  fetchMock.mockResolvedValue(Response.json({ id: "synthetic-request", embeddings: { float: [[.1]] }, meta: { billed_units: { input_tokens: 10 } } }));
  await expect(embedQuery("대출 금리 확인", ctx)).rejects.toThrow("RETRIEVAL_VECTOR_INVALID");
  expect(sql.mock.calls.at(-1)![0].join(" ")).toContain("settle_usage_budget");
});
it("Fast는 명시적인 합성 소유자 설정 없이는 호출하지 않는다", async () => {
  await expect(rerankFast("대출 금리", ["공식 상품 금리"], ctx)).rejects.toThrow("RERANK_DEVELOPMENT_ONLY"); expect(fetchMock).not.toHaveBeenCalled();
});
it("Fast의 원래 후보 순서와 과금 search unit을 복원한다", async () => {
  vi.stubEnv("FINSHIELD_RERANK_FAST_DEVELOPMENT", "1"); vi.stubEnv("FINSHIELD_PROBE_OWNER_ID", ctx.ownerId);
  fetchMock.mockResolvedValue(Response.json({ id: "synthetic-rerank", results: [{ index: 1, relevance_score: .9 }, { index: 0, relevance_score: .1 }], meta: { billed_units: { search_units: 1 } } }));
  expect(await rerankFast("대출 금리", ["상품 수수료", "상품 금리"], ctx)).toEqual([.1, .9]); expect(sql.mock.calls[1]).toContain(2000);
});
it("이미 취소된 검색은 예약·전송하지 않는다", async () => {
  await expect(embedQuery("대출 금리", { ...ctx, signal: AbortSignal.abort() })).rejects.toThrow(); expect(sql).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
