import { describe, expect, it, vi, afterEach } from "vitest";
const call = vi.hoisted(() => vi.fn());
vi.mock("../model-budget", () => ({ callFinshieldModel: call, emptyModelUsage: () => ({}) }));
import { assertBatchCoverage, createAgentModel, createJudgeModel } from "../agents/model-adapter";
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
      expect(body.claims).toHaveLength(1);
      expect(body.assessed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body).not.toHaveProperty("findings");
      expect(options.signal).toBe(controller.signal);
      await new Promise<void>(resolve => pending.push(resolve));
      return { schema_version: "out-v1", results: body.claims.map((claim: {claim_ref:string}) => ({
        claim_ref: claim.claim_ref, status: "INCONCLUSIVE", evidence_refs: [], note_masked: "근거 없음",
      })) };
    });
    const result = createAgentModel().decide({ system: "합성 검토", signal: controller.signal, input, evidence: [], observations: [] });
    expect(call).toHaveBeenCalledTimes(6);
    pending.reverse().forEach(resolve => resolve());
    expect(await result).toMatchObject({ results: claims.map(claim => ({ claim_ref: claim.claim_ref })) });
  });
  it("다른 묶음의 항목이나 중복·누락을 정상 완료로 합치지 않는다", () => {
    for (const refs of [["C1", "C2"], ["C1", "C1", "C3"], ["C1", "C2", "C4"]]) {
      expect(() => assertBatchCoverage(claims.slice(0, 3), refs)).toThrow("CLAIM_COVERAGE");
    }
  });
  it("한 묶음의 실패를 전체 검토 성공으로 바꾸지 않는다", async () => {
    call.mockRejectedValueOnce(new Error("합성 시간 초과"));
    call.mockResolvedValue({ schema_version: "out-v1", results: claims.slice(2,4).map(claim => ({
      claim_ref: claim.claim_ref, status: "INCONCLUSIVE", evidence_refs: [], note_masked: "근거 없음",
    })) });
    await expect(createAgentModel().decide({ system: "합성 검토", input, evidence: [], observations: [] })).rejects.toThrow("합성 시간 초과");
  });
});

it("가입 후 모델은 실제 계약 비교 항목을 판단하고 나머지 참조를 범위 밖에 보존한다", async () => {
  call.mockImplementation(async options => {
    const body = JSON.parse(options.user);
    expect(body.aftercare_context.comparison.every((row: {claim_ref:string}) => body.claims.some((claim: {claim_ref:string}) => claim.claim_ref === row.claim_ref))).toBe(true);
    return { schema_version: "out-v1", findings: body.claims.map((claim: {claim_ref:string}) => ({ claim_ref: claim.claim_ref,
      state: "UNKNOWN", evidence_refs: [], relation: "CONTEXT", summary_masked: "계약 차이 서면 확인", limits: [] })), out_of_scope_claim_refs: [] };
  });
  const output = await createAgentModel().decide({ system: "가입 후 검토", input: { ...input, agent_code: "SALES_CONDUCT",
    aftercare_context: { schema_version: "aftercare-review-v1", answers: { UNDERSTOOD_TERMS: "PARTIAL" },
      comparison: [{ claim_ref: "C6", before: "연 3%", contract: "연 8.2%", result: "DIFFERENT_TEXT" }] } }, evidence: [], observations: [] });
  expect((output as { findings: {claim_ref:string}[] }).findings.map(f=>f.claim_ref)).toEqual(["C6"]);
  expect((output as {out_of_scope_claim_refs:string[]}).out_of_scope_claim_refs).toEqual(["C1","C2","C3","C4","C5"]);
});

import { modelEvidenceScope, coveOutputSchemaFor, providerJudgeSchemaFor } from "../agents/model-adapter";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ToolEvidence } from "../schemas";

describe("호출 내부 인용 이름 정규화", () => {
  const entry = (ref: string, citable: boolean) => ({ evidence_ref: ref, citable, incomplete: false,
    reference_only: !citable, freshness_at_use: "FRESH", directness: "DIRECT" } as ToolEvidence);
  it("실행 전역 번호가 달라도 같은 Schema를 쓰며 원래 인용으로 되돌린다", () => {
    const left = modelEvidenceScope([entry("E10", false), entry("E33", true)]);
    const right = modelEvidenceScope([entry("E201", false), entry("E303", true)]);
    expect(zodOutputFormat(coveOutputSchemaFor(left.evidence)).schema).toEqual(zodOutputFormat(coveOutputSchemaFor(right.evidence)).schema);
    expect(left.localize([{ evidence_refs: ["E33", "E10"] }])).toEqual([{ evidence_refs: ["E1", "E2"] }]);
    expect(left.restore({ results: [{ evidence_refs: ["E1", "E2"] }] })).toEqual({ results: [{ evidence_refs: ["E33", "E10"] }] });
    expect(() => left.restore({ evidence_refs: ["E3"] })).toThrow("CITATION_REFERENCE");
    expect(coveOutputSchemaFor(left.evidence).safeParse({ schema_version: "out-v1", results: [{claim_ref:"C1",status:"CONFIRMED",evidence_refs:["E2"],note_masked:"맥락 근거 확정 금지"}] }).success).toBe(false);
  });

});

it("Judge의 고정 형식은 미제공 인용을 서버에서 차단한다", () => {
  const source = { evidence_ref: "E8", citable: true } as ToolEvidence;
  expect(providerJudgeSchemaFor().safeParse({schema_version:"out-v1",claim_results:[],conflicts:[]}).success).toBe(true);
  expect(()=>modelEvidenceScope([source]).restore({ evidence_refs: ["E2"] })).toThrow("MODEL_CITATION_REFERENCE_INVALID");
});

it("Judge 한 묶음의 시간 초과가 다른 묶음의 실제 판단을 버리지 않는다", async () => {
  call.mockRejectedValueOnce(Object.assign(new Error("합성 시간 초과"),{name:"APIConnectionTimeoutError"}));
  call.mockImplementation(async options => ({schema_version:"out-v1",conflicts:[],claim_results:JSON.parse(options.user).claims.map((claim: {claim_ref:string})=>({
    claim_ref:claim.claim_ref,state:"NEED_MORE_INFORMATION",evidence_refs:[],withheld_reason:"개별 자료 없음",rationale_masked:"추가 자료 확인",
  }))}));
  const model=createJudgeModel();
  const result=await model.judge({claims,findings:[],evidence:[]});
  expect(model.failureReason?.()).toBe("JUDGE_BATCH_DEADLINE_EXCEEDED");
  expect(result).toMatchObject({claim_results:[
    ...claims.slice(0,1).map(claim=>({claim_ref:claim.claim_ref,state:"UNKNOWN",evidence_refs:[],withheld_reason:"최종 판단 시간이 초과됐습니다."})),
    ...claims.slice(1).map(claim=>({claim_ref:claim.claim_ref,state:"NEED_MORE_INFORMATION",rationale_masked:"추가 자료 확인"})),
  ]});
});

it("Judge에게 전달하는 기존 판단과 근거가 같은 인용 번호를 쓰고 저장 번호로 복원된다", async () => {
  const source = { evidence_ref: "E33", citable: true, incomplete: false, reference_only: false,
    freshness_at_use: "FRESH", directness: "DIRECT", locator: {}, excerpt_masked: "합성 공식 안내" } as ToolEvidence;
  call.mockImplementation(async options => {
    const body = JSON.parse(options.user);
    expect(body.findings[0].evidence_refs).toEqual(["E1"]);
    expect(body.evidence[0].ref).toBe("E1");
    return { schema_version: "out-v1", claim_results: [{ claim_ref: "C1", state: "UNKNOWN", evidence_refs: ["E1"], withheld_reason: "추가 확인", rationale_masked: "합성 판단" }], conflicts: [] };
  });
  const result = await createJudgeModel().judge({ claims: [claims[0]], evidence: [source], findings: [{ claim_ref: "C1", evidence_refs: ["E33"], state: "UNKNOWN", relation: "CONTEXT", summary_masked: "합성 판단", limits: [], agent_code: "FRAUD_CHANNEL" }] });
  expect(result).toMatchObject({ claim_results: [{ evidence_refs: ["E33"] }] });
});

it("동일 원문 재조회는 한 번 보여주되 다른 출처·위치·인용 자격은 합치지 않는다", () => {
  const first: ToolEvidence = { source_type: "GUIDE", authority_grade: "B", title: "합성 원문", official_id: "official-a", url: "https://example.com/notice", published_at: null, evidence_ref: "E7", tool_code: "search_consumer_warning", fetched_at: "2026-09-09T00:00:00Z",
    content_hash: "a".repeat(64), independence_key: "official-a", excerpt_masked: "합성 원문", locator: { kind: "article", page: 1 },
    citable: true, incomplete: false, reference_only: false, freshness_at_use: "FRESH", directness: "DIRECT" };
  const copy = { ...first, evidence_ref: "E8", fetched_at: "2026-09-09T00:01:00Z", tool_code: "analyze_risk_pattern" };
  const scope = modelEvidenceScope([first, copy, { ...first, evidence_ref: "E9", independence_key: "official-b" },
    { ...first, evidence_ref: "E10", locator: { kind: "article", page: 2 } }, { ...first, evidence_ref: "E11", citable: false }]);
  expect(scope.evidence).toHaveLength(4);
  expect(scope.localize({ evidence_refs: ["E7", "E8"] })).toEqual({ evidence_refs: ["E1"] });
  expect(scope.restore({ evidence_refs: ["E1"] })).toEqual({ evidence_refs: ["E7"] });
  expect(copy.evidence_ref).toBe("E8");
});
