import 'server-only';
import {createHash} from 'node:crypto';
import {filterToolText} from '@/lib/tools/filter';
import type {ToolCallContext,ToolOutcome} from './runtime';

const URL='https://www.kinfa.or.kr/notificationPromotion/noticeDetail.do?seq=24020';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const plain=(text:string)=>text.replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

/** EV-009: 선택한 진흥원 안내 문서의 날짜·본문 위치를 보존한다. */
export function extractWarningSection(html:string){
 const headerStart=html.indexOf('<div class="board-detail-header">');
 const start=html.indexOf('<div class="board-detail-con ',headerStart);
 const end=html.indexOf('<div class="board-detail-footer">',start);
 if(headerStart<0||start<0||end<0)throw new Error('OFFICIAL_WARNING_STRUCTURE_CHANGED');
 const header=html.slice(headerStart,start);const original=html.slice(start,end);
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
 return {provenanceComplete:true,candidateCount:1,observations:{kind:'curated_warning_scope',document_count:1,published_at:section.publishedAt,limitation_code:'DATED_GUIDE_NOT_CURRENT_TRANSACTION_PROOF'},items:[{
  sourceType:'GUIDE',authorityGrade:'B',publisher:'서민금융진흥원',title:section.title,officialId:'kinfa:notice:24020',canonicalUrl:URL,
  publishedAt:section.publishedAt,sourceVersion:`notice-html-v1:${contentHash.slice(0,24)}`,contentHash,fingerprint:hash(URL),
  // 수동 경보의 다음 검토일이 등록되지 않았다. 최신 경보로 취급하지 않는다.
  freshness:'STALE',licenseCode:null,isComplete:true,isCitable:false,
  locator:{kind:'html_section',selector:'.board-detail-con',paragraph_selection:'financial-advertising-payment-app-guidance-v1'},
  excerptMasked:section.excerpt,directness:'CONTEXT_ONLY',referenceOnly:true,selectionReasonCode:'CURATED_KINFA_GUIDE',
 }]};
}
