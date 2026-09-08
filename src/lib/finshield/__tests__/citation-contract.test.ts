import { expect, it, vi } from "vitest";
import { citationContract, createAgentModel, createJudgeModel, modelEvidenceScope } from "../agents/model-adapter";
import { citationProblems, judgeEnvelopeOutput, type ConfirmedClaim, type ToolEvidence } from "../schemas";

const call = vi.hoisted(() => vi.fn());
vi.mock("../model-budget", () => ({ callFinshieldModel: call, emptyModelUsage: () => ({inputTokens:0,outputTokens:0,costMicrounits:0,unknownCalls:0}) }));
const claim = (statement_masked: string): ConfirmedClaim => ({ claim_ref:"C1", claim_type:"CONDUCT", statement_masked, materiality:"MATERIAL" });
const source: ToolEvidence = { evidence_ref:"E41",tool_code:"search_consumer_warning",source_type:"WARNING",authority_grade:"B",
 title:"합성 공식 안내",official_id:"synthetic",url:null,published_at:null,fetched_at:"2026-09-08T00:00:00Z",
 content_hash:"a".repeat(64),independence_key:"b".repeat(64),citable:true,incomplete:false,reference_only:false,
 freshness_at_use:"FRESH",directness:"DIRECT",excerpt_masked:"보증료를 먼저 송금하라는 요구에 주의하세요.",
 locator:{permitted_use:"PUBLIC_GUIDANCE_COMPARISON",current_transaction_proof:false} };

it("개인 승인·개별 마감·범죄는 일반 지침으로 확정하지 않지만 행동 요구 비교는 남긴다", () => {
 for (const text of ["햇살론15 승인 대상이다.","오늘 신청해야 한다.","상대는 사기범이다."]) {
  expect(citationContract([claim(text)],[source])[0]).toMatchObject({verified_refs:[],contradicted_refs:[],context_refs:["E41"]});
 }
 expect(citationContract([claim("대출 전 보증료 선입금이 필요하다.")],[source])[0].contradicted_refs).toEqual(["E41"]);
});

it("종료 자료·참고/오래된 자료를 섞어 가입 가능성을 확정하지 못하고 원본을 바꾸지 않는다", () => {
 const sources=[{...source,locator:{permitted_use:"REFUTE_CURRENT_OFFER"}}, {...source,evidence_ref:"E42",reference_only:true}, {...source,evidence_ref:"E43",freshness_at_use:"STALE" as const}];
 const before=JSON.stringify(sources);
 const scope=modelEvidenceScope(sources);
 const c=claim("지금 햇살론15에 가입할 수 있다.");
 const contract=citationContract([c],scope.evidence)[0];
 expect(contract.verified_refs).toEqual([]);
 expect(contract.contradicted_refs).toEqual(["E1"]);
 expect(scope.restore({evidence_refs:contract.contradicted_refs})).toEqual({evidence_refs:["E41"]});
 const pool=new Map(sources.map(e=>[e.evidence_ref,e]));
 expect(citationProblems(["E41","E42"],"CONTRADICTED",pool,c.statement_masked).length).toBeGreaterThan(0);
 expect(citationProblems(["E99"],"UNKNOWN",pool).length).toBeGreaterThan(0);
 expect(JSON.stringify(sources)).toBe(before);
});

it("Domain·CoVe·Red Team 실제 모델 경계에 같은 항목별 계약과 분리된 미확정 상태를 전달한다", async () => {
 for (const code of ["PRODUCT_INSTITUTION","COVE","RED_TEAM"]) {
  call.mockReset();
  call.mockResolvedValue(code==="PRODUCT_INSTITUTION"
   ? {schema_version:"out-v1",findings:[{claim_ref:"C1",state:"NEED_MORE_INFORMATION",relation:"CONTEXT",evidence_refs:[],summary_masked:"개인 심사 자료 필요",limits:[]}],out_of_scope_claim_refs:[]}
   : {schema_version:"out-v1",results:[{claim_ref:"C1",status:code==="COVE"?"INCONCLUSIVE":"NONE_FOUND",evidence_refs:[],note_masked:"개인 심사 자료 필요"}]});
  await createAgentModel().decide({system:"합성 Agent",input:{schema_version:"in-v1",agent_code:code,scenario:"LOAN",journey_stage:"PRE_TRANSACTION",claims:[claim("햇살론15 승인 대상이다.")],masked_intake:""},evidence:[source],observations:[]});
  const args=call.mock.calls[0][0];
  expect(JSON.parse(args.user).citation_contract).toEqual([{claim_ref:"C1",verified_refs:[],contradicted_refs:[],context_refs:["E1"]}]);
  expect(args.system).toContain("Red Team은 NONE_FOUND");
  expect(args.maxRetries).toBe(0);
 }
});

it("Judge에도 현재 묶음의 계약만 전달하고 실제 출력 ref는 원래 번호로 복원한다", async () => {
 call.mockReset();
 call.mockResolvedValue({schema_version:"out-v1",claim_results:[{claim_ref:"C1",state:"CONTRADICTED",evidence_refs:["E1"],withheld_reason:null,rationale_masked:"공식 지침과 다름"}],conflicts:[]});
 const result=await createJudgeModel().judge({claims:[claim("보증료 선입금이 필요하다.")],findings:[{agent_code:"FRAUD_CHANNEL",claim_ref:"C1",state:"CONTRADICTED",relation:"CONTRADICT",evidence_refs:["E41"],summary_masked:"공식 지침 비교",limits:[]}],evidence:[source]});
 expect(JSON.parse(call.mock.calls[0][0].user).citation_contract[0].contradicted_refs).toEqual(["E1"]);
 expect(judgeEnvelopeOutput.parse(result).claim_results[0].evidence_refs).toEqual(["E41"]);
});
