import { describe, expect, it, vi, afterEach } from "vitest";
const call = vi.hoisted(() => vi.fn());
vi.mock("../model-budget", () => ({ callFinshieldModel: call, emptyModelUsage: () => ({}) }));
import { assertBatchCoverage, createAgentModel } from "../agents/model-adapter";
import type { DomainAgentInput } from "../schemas";

const claims = Array.from({ length: 6 }, (_, index) => ({
  claim_ref: `C${index + 1}`, claim_type: "CONDUCT", statement_masked: `합성 요구 ${index}`,
  materiality: "MATERIAL" as const,
}));
const input: DomainAgentInput = { schema_version: "in-v1", agent_code: "COVE", scenario: "LOAN",
  journey_stage: "PRE_TRANSACTION", claims, masked_intake: "합성 문구" };
afterEach(() => call.mockReset());

describe("독립 검토의 묶음 판단", () => {
  it("같은 독립 조회 자료와 취소 신호로 여섯 항목을 나눠 처리하고 순서를 보존한다", async () => {
    const controller = new AbortController();
    const pending: (() => void)[] = [];
    call.mockImplementation(async (options) => {
      const body = JSON.parse(options.user);
      expect(body.claims).toHaveLength(3);
      expect(body.assessed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body).not.toHaveProperty("findings");
      expect(options.signal).toBe(controller.signal);
      await new Promise<void>(resolve => pending.push(resolve));
      return { schema_version: "out-v1", results: body.claims.map((claim: {claim_ref:string}) => ({
        claim_ref: claim.claim_ref, status: "INCONCLUSIVE", evidence_refs: [], note_masked: "근거 없음",
      })) };
    });
    const result = createAgentModel().decide({ system: "합성 검토", signal: controller.signal, input, evidence: [], observations: [] });
    expect(call).toHaveBeenCalledTimes(2);
    pending[1](); pending[0]();
    expect(await result).toMatchObject({ results: claims.map(claim => ({ claim_ref: claim.claim_ref })) });
  });
  it("다른 묶음의 항목이나 중복·누락을 정상 완료로 합치지 않는다", () => {
    for (const refs of [["C1", "C2"], ["C1", "C1", "C3"], ["C1", "C2", "C4"]]) {
      expect(() => assertBatchCoverage(claims.slice(0, 3), refs)).toThrow("CLAIM_COVERAGE");
    }
  });
  it("한 묶음의 실패를 전체 검토 성공으로 바꾸지 않는다", async () => {
    call.mockRejectedValueOnce(new Error("합성 시간 초과"));
    call.mockResolvedValueOnce({ schema_version: "out-v1", results: claims.slice(3).map(claim => ({
      claim_ref: claim.claim_ref, status: "INCONCLUSIVE", evidence_refs: [], note_masked: "근거 없음",
    })) });
    await expect(createAgentModel().decide({ system: "합성 검토", input, evidence: [], observations: [] })).rejects.toThrow("합성 시간 초과");
  });
});
