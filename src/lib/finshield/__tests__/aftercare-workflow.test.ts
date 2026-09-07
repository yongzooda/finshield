import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sql: vi.fn(), run: vi.fn(), model: vi.fn() }));
vi.mock("../db", () => ({ fsql: () => m.sql }));
vi.mock("../aftercare-review", () => ({ runAftercareReview: m.run, aftercareContextSchema: { parse: (x: unknown) => x } }));
vi.mock("../agents/model-adapter", () => ({ createAgentModel: m.model }));
import { executeAftercareStep } from "../workflows/aftercare-step";
beforeEach(() => vi.clearAllMocks());
it.each(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"])("종결 %s 응답 유실 뒤 모델을 재호출하지 않는다", async status => {
  m.sql.mockResolvedValueOnce([{ token: null }]).mockResolvedValueOnce([{ context: { status } }]);
  expect(await executeAftercareStep("job")).toEqual({ status }); expect(m.model).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled();
});
it("유효한 다른 Worker Lease가 있으면 같은 모델을 중복 실행하지 않는다", async () => {
  m.sql.mockResolvedValueOnce([{ token: null }]).mockResolvedValueOnce([{ context: { status: "RUNNING" } }]);
  await expect(executeAftercareStep("job")).rejects.toThrow("AFTERCARE_LEASE_BUSY"); expect(m.run).not.toHaveBeenCalled();
});
it("삭제된 Case의 작업은 Provider 없이 종결한다", async () => {
  m.sql.mockResolvedValueOnce([{ token: null }]).mockResolvedValueOnce([{ context: null }]);
  expect(await executeAftercareStep("job")).toEqual({ status: "CANCELLED" }); expect(m.run).not.toHaveBeenCalled();
});
