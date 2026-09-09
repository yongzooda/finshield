import { expect, it, vi } from "vitest";
import type postgres from "postgres";
import { aftercareInput, runAftercareReview, type AftercareContext } from "../aftercare-review";
import type { AgentModel } from "../agents/runner";
import type { ToolCallContext, ToolImpl } from "../tools/runtime";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context: AftercareContext = { id: id(1), owner_id: id(2), case_id: id(3), base_passport_id: id(4), execution_manifest_id: id(5),
  status: "RUNNING", deadline_at: new Date(Date.now() + 120000).toISOString(), case_active: true, journey_stage: "ENROLLED",
  claims: [{ claim_id: id(6), claim_ref: "C1", claim_type: "SALES_CONDUCT", statement_masked: "계약 전에 금리를 설명합니다", materiality: "MATERIAL", status: "UNKNOWN" }],
  input_masked: { schema_version: "aftercare-review-v1", answers: [{ question_code: "UNDERSTOOD_TERMS", answer_code: "NO", question_version: "aftercare-v2" }],
    comparison: [{ claim_id: id(6), before: "계약 전에 금리를 설명합니다", contract: "계약 후 금리를 알려줍니다", result: "DIFFERENT_TEXT" }] } };
function setup(failedTool = false) {
  const sql = vi.fn().mockResolvedValue([{ ok: true }]);
  const ctx: ToolCallContext = { sql: sql as unknown as ReturnType<typeof postgres>, ownerId: id(2), caseId: id(3), runId: id(1), aftercareJobId: id(1),
    manifest: { manifestId: id(5), kbReleaseId: id(7), agentIds: {}, toolIds: {} } };
  const tool: ToolImpl = vi.fn(async () => ({ items: [], provenanceComplete: !failedTool, candidateCount: 0, ...(failedTool ? { errorCode: "SOURCE_NOT_AVAILABLE" } : {}) }));
  const model: AgentModel = { chooseTools: vi.fn(async ({ input }) => [{ toolCode: input.agent_code === "SALES_CONDUCT" ? "check_documents" : "lookup_statute", input: { query: "설명의무" } }]),
    decide: vi.fn(async () => ({ schema_version: "out-v1", findings: [{ claim_ref: "C1", state: "UNKNOWN", relation: "CONTEXT", evidence_refs: [], summary_masked: "설명 자료 추가 확인 필요", limits: [] }], out_of_scope_claim_refs: [] })) };
  return { sql, ctx, model, tool, impls: { check_documents: tool, lookup_statute: tool } };
}
it("기준 Passport 비교를 모델용 참조로 바꾸고 DB 식별자를 보내지 않는다", () => {
  const input = aftercareInput(context)!;
  expect(input.comparison[0]).toEqual({ claim_ref: "C1", before: "계약 전에 금리를 설명합니다", contract: "계약 후 금리를 알려줍니다", result: "DIFFERENT_TEXT" });
  expect(JSON.stringify(input)).not.toContain(id(6));
  const wrong = structuredClone(context); wrong.input_masked.comparison[0].before = "사용자가 바꾼 이전 문장";
  expect(() => aftercareInput(wrong)).toThrow("AFTERCARE_CLAIM_REJECTED");
  wrong.input_masked.comparison[0].before = context.claims[0].statement_masked; wrong.input_masked.comparison[0].contract = "문의 010-1234-5678";
  expect(() => aftercareInput(wrong)).toThrow("AFTERCARE_PII_REJECTED");
});
it("실제 공통 Runner로 두 Agent·서로 다른 Allowlist Tool을 순차 실행하고 점검 기록에 귀속한다", async () => {
  const s = setup(); const result = await runAftercareReview({ ...s, context, lease: id(8) });
  expect(s.tool).toHaveBeenCalledTimes(2); expect(s.model.decide).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(s.model.decide).mock.calls;
  expect(calls.map(c => c[0].input.agent_code)).toEqual(["SALES_CONDUCT", "REGULATION_DISPUTE"]);
  expect(calls.every(c => c[0].input.aftercare_context?.answers.UNDERSTOOD_TERMS === "NO")).toBe(true);
  expect(s.sql).toHaveBeenCalledTimes(2);
  expect(s.sql.mock.calls.every(c => c[0].join("").includes("record_precase_agent"))).toBe(true);
  expect(result.result).toBe("CORRECTION_OR_INQUIRY");
});
it("조회 실패의 Agent 결과를 정상 관리로 높이지 않고 기록에 부분 실패를 보존한다", async () => {
  const s = setup(true); const result = await runAftercareReview({ ...s, context, lease: id(8) });
  const trace = JSON.parse(s.sql.mock.calls[0][3]);
  expect(trace.status).toBe("PARTIAL"); expect(trace.tools[0].sources).toEqual([]);
  expect(result.reasons.join(" ")).toContain("확인하지 못했습니다");
  expect(result.result).not.toBe("NORMAL_MANAGEMENT");
});
it("취소된 점검은 다음 모델과 Tool을 호출하지 않는다", async () => {
  const s = setup(); s.ctx.signal = AbortSignal.abort();
  await expect(runAftercareReview({ ...s, context, lease: id(8) })).rejects.toThrow();
  expect(s.model.chooseTools).not.toHaveBeenCalled(); expect(s.tool).not.toHaveBeenCalled();
});

it("모델 출력의 개인정보 의심 항목을 보류하고 두 Agent 조회와 다른 결과를 보존한다", async () => {
  const s=setup();vi.mocked(s.model.decide).mockResolvedValue({schema_version:"out-v1",findings:[{claim_ref:"C1",state:"UNKNOWN",relation:"CONTEXT",evidence_refs:[],summary_masked:"연락처 010-1234-5678로 문의",limits:[]}],out_of_scope_claim_refs:[]});
  const result=await runAftercareReview({...s,context,lease:id(8)});
  expect(s.sql).toHaveBeenCalledTimes(2);
  for(const call of s.sql.mock.calls){const trace=JSON.parse(call[3]);expect(trace.status).toBe("PARTIAL");expect(trace.reason_code).toBe("OUTPUT_PII_REJECTED");expect(JSON.stringify(trace)).not.toContain("010-1234-5678");expect(trace.output.findings[0].state).toBe("WITHHELD");}
  expect(result.result).not.toBe("NORMAL_MANAGEMENT");
});
