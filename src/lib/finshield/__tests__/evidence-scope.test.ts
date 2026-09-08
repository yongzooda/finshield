import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { citationProblems, type ToolEvidence } from '../schemas';
import { evidenceBrief } from '../agents/model-adapter';
import { searchOfficialWarning } from '../tools/official-warning';
import { reviewedWarningIsUsable, WARNING_REVIEW } from '../tools/warning-review';
import type { ToolCallContext } from '../tools/runtime';
const evidence: ToolEvidence = { evidence_ref:'E1', tool_code:'search_financial_product', source_type:'PRODUCT', authority_grade:'B',
 title:'합성 종료 고지', official_id:'synthetic:end', url:'https://example.invalid/end', published_at:null, fetched_at:'2026-09-08T00:00:00Z',
 content_hash:'a'.repeat(64), independence_key:'b'.repeat(64), citable:true, incomplete:false, reference_only:false,
 freshness_at_use:'FRESH', directness:'DIRECT', locator:{permitted_use:'REFUTE_CURRENT_OFFER',current_transaction_proof:false},
 excerpt_masked:'가'.repeat(450)+'출처가 불분명한 앱 설치 금지' };
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('종료 고지로 현재 가입 가능성을 뒷받침하지 못하고 반박에는 쓸 수 있다',()=>{
 const pool=new Map([['E1',evidence]]);
 expect(citationProblems(['E1'],'VERIFIED',pool)).not.toHaveLength(0);
 expect(citationProblems(['E1'],'CONTRADICTED',pool)).toEqual([]);
});
it('일반 안내로 특정 상대의 범죄를 확정하지 못한다',()=>{
 const pool=new Map([['E1',{...evidence,locator:{permitted_use:'PUBLIC_GUIDANCE_COMPARISON',current_transaction_proof:false}}]]);
 expect(citationProblems(['E1'],'VERIFIED',pool,'상대는 사기범이다')).not.toHaveLength(0);
 expect(citationProblems(['E1'],'CONTRADICTED',pool,'대출 전 보증료 선입금이 필요하다')).toEqual([]);
});
it('모델에 근거의 사용 범위와 뒤쪽 앱 안내를 전달한다',()=>{
 expect(evidenceBrief([evidence])[0]).toMatchObject({permitted_use:'REFUTE_CURRENT_OFFER',current_transaction_proof:false});
 expect(evidenceBrief([evidence])[0].excerpt).toContain('앱 설치 금지');
});
it('검토 본문의 변경·만료·미래 검토일을 차단한다',()=>{
 const now=Date.parse(WARNING_REVIEW.reviewedAt)+1000;
 expect(reviewedWarningIsUsable(WARNING_REVIEW.contentHash,now)).toBe(true);
 expect(reviewedWarningIsUsable('changed',now)).toBe(false);
 expect(reviewedWarningIsUsable(WARNING_REVIEW.contentHash,Date.parse(WARNING_REVIEW.reviewDueAt))).toBe(false);
 expect(reviewedWarningIsUsable(WARNING_REVIEW.contentHash,now-2000)).toBe(false);
});
it('실제 검토 본문을 재조회한 경우만 일반 지침 비교로 인용한다',async()=>{
 const body=JSON.parse(readFileSync('evidence/development/member-evidence-scope/kinfa-guidance-section.json','utf8')).html;
 const html='<div class="board-detail-header"><p class="tit">서민금융 사칭 예방 안내</p><li>2021-05-27</li></div>'+body+'<div class="board-detail-footer">';
 vi.useFakeTimers();vi.setSystemTime(new Date(Date.parse(WARNING_REVIEW.reviewedAt)+1000));
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(html)));
 const result=await searchOfficialWarning({query:'선입금 원격제어 앱'},{} as ToolCallContext);
 expect(result.items[0]).toMatchObject({publishedAt:'2021-05-27',freshness:'FRESH',isCitable:true,
  locator:{permitted_use:'PUBLIC_GUIDANCE_COMPARISON',current_transaction_proof:false}});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(html.replace('정상적인 금융기관','정상적인 금융기관 수정'))));
 expect((await searchOfficialWarning({query:'선입금'},{} as ToolCallContext)).items[0].isCitable).toBe(false);
});

import { normalizeJudgeOutput } from '../orchestrator';
import { decodeDomainOutput } from '../agents/runner';
import { modelEvidenceScope, providerAgentSchemaFor, settleModelBatches } from '../agents/model-adapter';
import type { RunSession } from '../tools/runtime';
it('승인 대상 안내를 무조건 승인으로 바꾸지 않고 개인 심사 자료를 요구한다',()=>{
 const claim={claim_ref:'C1',claim_type:'ELIGIBILITY',statement_masked:'햇살론15 승인 대상이라고 안내받았다.',materiality:'MATERIAL' as const};
 const pool=new Map([['E1',{...evidence,locator:{permitted_use:'PUBLIC_GUIDANCE_COMPARISON',current_transaction_proof:false}}]]);
 const result=normalizeJudgeOutput({schema_version:'out-v1',conflicts:[],claim_results:[{claim_ref:'C1',state:'CONTRADICTED',evidence_refs:['E1'],rationale_masked:'무조건 승인 안내와 배치',withheld_reason:null}]},[claim],pool);
 expect(result.output.claim_results[0]).toMatchObject({state:'NEED_MORE_INFORMATION',rationale_masked:'개인 승인 여부를 확인할 심사 자료가 없습니다.'});
 expect(citationProblems(['E1'],'CONTRADICTED',pool,'심사 없이 누구나 승인 대상이다.')).toEqual([]);
});
it('평탄한 Provider 출력에도 알려진 ref와 모든 인용의 자격을 검사한다',()=>{
 const sources=[{...evidence,locator:{}},{...evidence,evidence_ref:'E2',citable:false,reference_only:true,locator:{}}];
 const raw={schema_version:'out-v1',findings:[{claim_ref:'C1',state:'VERIFIED',relation:'SUPPORT',evidence_refs:['E1','E2'],summary_masked:'합성 판단',limits:[]}],out_of_scope_claim_refs:[]};
 expect(providerAgentSchemaFor('PRODUCT_INSTITUTION').safeParse(raw).success).toBe(true);
 expect(()=>modelEvidenceScope(sources).restore({...raw,findings:[{...raw.findings[0],evidence_refs:['E99']}]})).toThrow('MODEL_CITATION_REFERENCE_INVALID');
 const decoded=decodeDomainOutput(raw,{evidence:new Map(sources.map(e=>[e.evidence_ref,e]))} as RunSession);
 expect(decoded).toMatchObject({ok:true,reason:'CITATION_INVALID',value:{findings:[{state:'UNKNOWN'}]}});
});
it('일부 묶음이 실패해도 다른 호출의 정산이 끝날 때까지 기다린다',async()=>{
 let finish!:()=>void, rejected=false;
 const result=settleModelBatches([Promise.reject(new Error('합성 실패')),new Promise<void>(resolve=>{finish=resolve;})]).catch(()=>{rejected=true;});
 await Promise.resolve();expect(rejected).toBe(false);
 finish();await result;expect(rejected).toBe(true);
});
