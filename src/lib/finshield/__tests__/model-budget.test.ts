import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type postgres from "postgres";
const core=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/agents/model",()=>({callStructured:core}));
import { callFinshieldModel, emptyModelUsage, modelCost } from "../model-budget";
import { FINSHIELD_MODEL } from "../manifest";
const options={model:FINSHIELD_MODEL,system:"합성 시험",user:"연 3%",schema:z.object({ok:z.boolean()}),maxTokens:100};
beforeEach(()=>vi.clearAllMocks());
it("예약이 거부되면 Provider 호출은 0회다",async()=>{
 const sql=vi.fn().mockRejectedValue(new Error("BUDGET_EXCEEDED"));
 await expect(callFinshieldModel(options,{sql:sql as unknown as ReturnType<typeof postgres>,runId:"run"})).rejects.toThrow("BUDGET_EXCEEDED");
 expect(core).not.toHaveBeenCalled();
});
it("거절 응답도 실제 토큰을 정산한 뒤 실패를 전달한다",async()=>{
 const sql=vi.fn().mockResolvedValue([{id:"reservation"}]);const usage=emptyModelUsage();
 core.mockImplementation(async opts=>{
  await opts.onUsage({usage:{input_tokens:100,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0},elapsedMs:30,requestId:"request",statusCategory:"REFUSAL"});
  throw new Error("refusal");
 });
 await expect(callFinshieldModel(options,{sql:sql as unknown as ReturnType<typeof postgres>,runId:"run"},usage)).rejects.toThrow("refusal");
 expect(usage).toEqual({inputTokens:100,outputTokens:20,costMicrounits:400,unknownCalls:0});
 expect(sql).toHaveBeenCalledTimes(2);
 expect(core.mock.calls[0][0].skipLegacyMeter).toBe(true);
});
it("시간 초과는 예약을 해제하지 않고 대조 대상으로 남긴다",async()=>{
 const sql=vi.fn().mockResolvedValue([{id:"reservation"}]);const usage=emptyModelUsage();core.mockRejectedValue(new Error("timeout"));
 await expect(callFinshieldModel(options,{sql:sql as unknown as ReturnType<typeof postgres>,runId:"run"},usage)).rejects.toThrow("timeout");
 expect(usage.unknownCalls).toBe(1);
 const queries=sql.mock.calls.map(call=>call[0].join("?")).join("\n");
 expect(queries).toContain("flag_usage_reconciliation");expect(queries).not.toContain("release_usage_budget");
});
it("과금하지 않은 429는 예약을 해제하고 자동 재호출하지 않는다",async()=>{
 const sql=vi.fn().mockResolvedValue([{id:"reservation"}]);core.mockRejectedValue(Object.assign(new Error("rate"),{status:429}));
 await expect(callFinshieldModel(options,{sql:sql as unknown as ReturnType<typeof postgres>,runId:"run"})).rejects.toThrow();
 expect(core).toHaveBeenCalledTimes(1);expect(sql.mock.calls[1][0].join("")).toContain("release_usage_budget");
});
it("예상하지 않은 캐시 쓰기를 무료 사용으로 정산하지 않는다",()=>{
 expect(()=>modelCost({input_tokens:1,output_tokens:1,cache_creation_input_tokens:10} as never)).toThrow("UNEXPECTED_CACHE_CREATION");
});
it("가입 후 점검 비용은 과거 Run을 사용하지 않고 전용 예약에 연결한다",async()=>{
 const sql=vi.fn().mockRejectedValue(new Error("SYNTHETIC_STOP_BEFORE_PROVIDER"));
 await expect(callFinshieldModel(options,{sql:sql as unknown as ReturnType<typeof postgres>,ownerId:"owner",caseId:"case",aftercareJobId:"review"})).rejects.toThrow("SYNTHETIC_STOP_BEFORE_PROVIDER");
 expect(sql.mock.calls[0][0].join("")).toContain("reserve_precase_usage");expect(core).not.toHaveBeenCalled();
 sql.mockClear();await expect(callFinshieldModel(options,{sql:sql as unknown as ReturnType<typeof postgres>,ownerId:"owner",caseId:"case",runId:"old-run",aftercareJobId:"review"})).rejects.toThrow("AFTERCARE_BUDGET_CONTEXT_REJECTED");
 expect(sql).not.toHaveBeenCalled();
});
