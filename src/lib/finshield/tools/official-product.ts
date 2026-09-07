import "server-only";
import { createHash } from "node:crypto";
import type { ToolCallContext, ToolOutcome } from "./runtime";

const PRODUCT_URL = "https://www.kinfa.or.kr/financialProduct/hessalLoan.do";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** EV-002·EV-009: 제목 대신 현재 공식 상품 본문의 조건과 종료 고지를 함께 읽는다. */
export function extractProductSection(html: string) {
  const start = html.indexOf('<h3 id="ConTitle"');
  const end = html.indexOf('<!--일반보증이란?-->', start);
  if (start<0 || end<start) throw new Error("OFFICIAL_PAGE_STRUCTURE_CHANGED");
  const original = html.slice(start,end);
  const text = original.replace(/<!--[\s\S]*?-->/g," ").replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
  if (!text.includes("햇살론15") || !text.includes("대출금리") || !text.includes("대출한도")) {
    throw new Error("OFFICIAL_PAGE_FIELDS_MISSING");
  }
  return { original, text };
}

export async function readOfficialProduct(_input: unknown, ctx: ToolCallContext): Promise<ToolOutcome> {
  const signal = ctx.signal ? AbortSignal.any([ctx.signal,AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
  const response = await fetch(PRODUCT_URL,{signal,redirect:"error",cache:"no-store"});
  if (!response.ok || !response.body) throw new Error("OFFICIAL_PAGE_UNAVAILABLE");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {for (;;) {const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>2*1024*1024)throw new Error("OFFICIAL_PAGE_TOO_LARGE");chunks.push(value);}}
  finally {await reader.cancel();}
  const {original,text}=extractProductSection(Buffer.concat(chunks).toString("utf8"));
  const contentHash=hash(original);
  return {provenanceComplete:true,candidateCount:1,items:[{
    sourceType:"PRODUCT",authorityGrade:"B",publisher:"서민금융진흥원",title:"햇살론15 공식 상품 안내",
    officialId:"kinfa:hessalLoan",canonicalUrl:PRODUCT_URL,publishedAt:null,
    sourceVersion:`html-section-v1:${contentHash.slice(0,24)}`,contentHash,fingerprint:hash(PRODUCT_URL),
    freshness:"FRESH",licenseCode:null,isComplete:true,isCitable:true,
    locator:{kind:"html_section",selector:"#ConTitle",end_marker:"일반보증이란?",normalization_version:"html-text-v1"},
    excerptMasked:text,directness:"DIRECT",referenceOnly:false,selectionReasonCode:"OFFICIAL_PRODUCT_BODY",
  }]};
}
