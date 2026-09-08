import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { highRiskAction } from "../high-risk-actions";
import { WARNING_REVIEW } from "../tools/warning-review";
import { buildAxisResults, buildFinalClaims } from "../finalize";
import type { ToolEvidence } from "../schemas";
import type { OrchestratedRun } from "../orchestrator";
const guide: ToolEvidence = { evidence_ref: "E1", official_id: WARNING_REVIEW.officialId, content_hash: WARNING_REVIEW.contentHash,
  tool_code: "search_consumer_warning", source_type: "GUIDE", authority_grade: "B", title: "합성 시험의 공식 안내 경계",
  url: "https://www.kinfa.or.kr/notificationPromotion/noticeDetail.do?seq=24020", published_at: "2021-05-27",
  fetched_at: WARNING_REVIEW.reviewedAt, excerpt_masked: "공식 예방 안내",
  citable: true, incomplete: false, reference_only: false, freshness_at_use: "FRESH", directness: "DIRECT",
  locator: { permitted_use: WARNING_REVIEW.scope }, independence_key: "same-official-guide" };
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(Date.parse(WARNING_REVIEW.reviewedAt)+1000));});
afterEach(()=>vi.useRealTimers());
it.each([
 "선입금이나 보증료를 송금하지 마세요.", "상담원의 원격제어 앱 설치 요구를 거절해야 한다.",
 "은행 공식 앱에서 직접 신청할 수 있다고 안내받았다.", "원격제어 앱을 설치해 달라는 요청은 없었다.",
 "보증료를 먼저 입금할 필요가 없다고 안내받았다.",
])("정상·예방 문구를 위험 요구로 뒤집지 않는다: %s",statement=>expect(highRiskAction(statement,[guide])).toBeNull());
it("확인된 공식 안내 없이는 행동 경고를 근거 있는 결과로 올리지 않는다",()=>{
 const statement="대출 보증료를 먼저 입금해야 한다.";
 for(const evidence of [[],[{...guide,citable:false}],[{...guide,content_hash:'a'.repeat(64)}],[{...guide,freshness_at_use:'STALE' as const}]])
  expect(highRiskAction(statement,evidence)).toBeNull();
 vi.setSystemTime(new Date(WARNING_REVIEW.reviewDueAt));expect(highRiskAction(statement,[guide])).toBeNull();
});
it.each([
 ["진행하려면 보증료 30만 원을 먼저 입금해야 한다.","HIGH_RISK_ADVANCE_PAYMENT"],
 ["상담원이 원격제어 앱을 설치하라고 요청하였다.","HIGH_RISK_REMOTE_CONTROL"],
])("Judge 보류를 유지하면서 행동 요구·공식 근거·거래 위험을 남긴다",(statement,code)=>{
 const run={findings:[],evidence:[guide],evidenceIds:new Map([['E1','source-evidence']]),judgeOutput:null,
  judgeReasonCode:'JUDGE_BATCH_CALL_FAILED',cove:null,redTeam:null,agentResults:[],partial:true} as OrchestratedRun;
 const finals=buildFinalClaims({claims:[{claimId:'synthetic-claim',claim_ref:'C1',claim_type:'CONDUCT',statement_masked:statement,materiality:'MATERIAL'}],run});
 expect(finals[0]).toMatchObject({status:'WITHHELD',reason_code:code,evidences:[{evidence_id:'source-evidence',relation:'CONTEXT',is_independent:false}]});
 expect(finals[0].decision_summary_masked).toContain('공식 창구');
 expect(buildAxisResults(finals,false)[1].result_code).toBe('HIGH_RISK_ACTION');
 expect(buildAxisResults(finals,false)[2].result_code).toBe('NEED_MORE_INFORMATION');
});
