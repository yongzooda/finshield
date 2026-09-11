import 'server-only';
import {createHash} from 'node:crypto';
import {filterToolText} from '@/lib/tools/filter';
import type {ToolCallContext,ToolOutcome} from './runtime';
import { WARNING_REVIEW, reviewedWarningIsUsable } from './warning-review';
import { warningSectionBounds } from './warning-section.mjs';

const URL='https://www.kinfa.or.kr/notificationPromotion/noticeDetail.do?seq=24020';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const plain=(text:string)=>text.replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

/** EV-009: 선택한 진흥원 안내 문서의 날짜·본문 위치를 보존한다. */
export function extractWarningSection(html:string){
 const {header,original}=warningSectionBounds(html);
 const title=plain(header.match(/<p class="tit">([\s\S]*?)<\/p>/)?.[1]??'');
 const publishedAt=header.replace(/<!--[\s\S]*?-->/g,'').match(/\d{4}-\d{2}-\d{2}/)?.[0];
 const paragraphs=[...original.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)].map(m=>plain(m[1]));
 const relevant=paragraphs.filter(p=>/문자메시지나 전화|정상적인 금융기관|출처가 불분명한 앱|신용도에 관계없이|적법한 대출/.test(p));
 if(!title||!publishedAt||relevant.length<3)throw new Error('OFFICIAL_WARNING_FIELDS_MISSING');
 return {original,title,publishedAt,excerpt:filterToolText(relevant.join('\n')).text};
}

/** 고정한 공식 안내 한 건의 제한된 검색이다. 전체 경보 목록 검색으로 표현하지 않는다. */
export async function searchOfficialWarning(input:unknown,ctx:ToolCallContext):Promise<ToolOutcome>{
 const query=String((input as {query?:unknown})?.query??'').trim();
 if(!query)return {items:[],provenanceComplete:true,candidateCount:0,reasonCode:'EMPTY_QUERY'};
 if(!/대출|금융|햇살론|보이스|사칭|선입금|수수료|금리|앱|인증|개인정보|정부지원|보증료/.test(query)){
  return {items:[],provenanceComplete:true,candidateCount:0,reasonCode:'NO_MATCH_IN_CURATED_GUIDE'};
 }
 const signal=ctx.signal?AbortSignal.any([ctx.signal,AbortSignal.timeout(3000)]):AbortSignal.timeout(3000);
 const response=await fetch(URL,{signal,redirect:'error',cache:'no-store'});
 if(!response.ok||!response.body)throw new Error('OFFICIAL_WARNING_UNAVAILABLE');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error('OFFICIAL_WARNING_TOO_LARGE');chunks.push(value);}}
 finally{await reader.cancel();}
 const section=extractWarningSection(Buffer.concat(chunks).toString('utf8'));const contentHash=hash(section.original);
 const reviewed=reviewedWarningIsUsable(contentHash,Date.now()) && section.publishedAt === "2021-05-27";
 return {provenanceComplete:true,candidateCount:1,observations:{kind:'curated_warning_scope',document_count:1,published_at:section.publishedAt,limitation_code:'GUIDANCE_NOT_CURRENT_TRANSACTION_PROOF',reviewed,review_due_at:WARNING_REVIEW.reviewDueAt},items:[{
  sourceType:'GUIDE',authorityGrade:'B',publisher:'서민금융진흥원',title:section.title,officialId:'kinfa:notice:24020',canonicalUrl:URL,
  publishedAt:section.publishedAt,sourceVersion:`notice-html-${reviewed?'review-20260908':'v1'}:${contentHash.slice(0,24)}`,contentHash,fingerprint:hash(URL),
  // 작성일은 유지한다. 검토 Hash·기한과 실제 재조회가 모두 맞는 일반 지침만 비교한다.
  freshness:reviewed?'FRESH':'STALE',licenseCode:null,isComplete:true,isCitable:reviewed,
  locator:{kind:'html_section',selector:'.board-detail-con',paragraph_selection:'financial-advertising-payment-app-guidance-v1',permitted_use:'PUBLIC_GUIDANCE_COMPARISON',current_transaction_proof:false,reviewed_at:WARNING_REVIEW.reviewedAt,review_due_at:WARNING_REVIEW.reviewDueAt},
  excerptMasked:section.excerpt,directness:reviewed?'DIRECT':'CONTEXT_ONLY',referenceOnly:!reviewed,selectionReasonCode:'CURATED_KINFA_GUIDE',
 }]};
}
