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
 const body=readFileSync('evidence/development/member-evidence-scope/kinfa-guidance-section.html','utf8');
 const html='<div class="board-detail-header"><p class="tit">서민금융 사칭 예방 안내</p><li>2021-05-27</li></div>'+body+'<div class="board-detail-footer">';
 vi.useFakeTimers();vi.setSystemTime(new Date(Date.parse(WARNING_REVIEW.reviewedAt)+1000));
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(html)));
 const result=await searchOfficialWarning({query:'선입금 원격제어 앱'},{} as ToolCallContext);
 expect(result.items[0]).toMatchObject({publishedAt:'2021-05-27',freshness:'FRESH',isCitable:true,
  locator:{permitted_use:'PUBLIC_GUIDANCE_COMPARISON',current_transaction_proof:false}});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(html.replace('정상적인 금융기관','정상적인 금융기관 수정'))));
 expect((await searchOfficialWarning({query:'선입금'},{} as ToolCallContext)).items[0].isCitable).toBe(false);
});
