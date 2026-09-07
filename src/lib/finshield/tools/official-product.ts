import "server-only";
import { createHash } from "node:crypto";
import type { ToolCallContext, ToolOutcome } from "./runtime";
import { extractProfileTerms } from "../product-profile-terms";

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

/** 수집 신선도와 상품의 종료 시점을 분리한다. 날짜를 읽지 못한 종료 고지도 보수적으로 제외한다. */
export function productTemporalStatus(text: string, asOf: string) {
  const endNotice = /(?:보증|판매|신규\s*가입|신규\s*대출)\s*종료/u;
  if (!endNotice.test(text)) return { status: "NO_END_NOTICE", endDate: null, citable: true } as const;
  const dated = /(?:\[|\()\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(?:보증|판매|신규\s*가입|신규\s*대출)\s*종료\s*(?:\]|\))/u.exec(text);
  if (!dated) return { status: "UNRESOLVED_END_NOTICE", endDate: null, citable: false } as const;
  const date = `${dated[1]}-${dated[2].padStart(2, "0")}-${dated[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return { status: "UNRESOLVED_END_NOTICE", endDate: null, citable: false } as const;
  }
  return { status: asOf > date ? "ENDED" : "SCHEDULED_END", endDate: date, citable: asOf <= date } as const;
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
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const day = (type: string) => parts.find(part => part.type === type)!.value;
  const asOf = `${day("year")}-${day("month")}-${day("day")}`;
  const temporal = productTemporalStatus(text, asOf);
  return {provenanceComplete:true,candidateCount:1,items:[{
    sourceType:"PRODUCT",authorityGrade:"B",publisher:"서민금융진흥원",title:temporal.citable ? "햇살론15 공식 상품 안내" : temporal.status === "ENDED" ? "햇살론15 공식 상품 안내 (보증 종료 자료)" : "햇살론15 공식 상품 안내 (종료 시점 확인 필요)",
    officialId:"kinfa:hessalLoan",canonicalUrl:PRODUCT_URL,publishedAt:null,
    sourceVersion:`html-section-v1:${contentHash.slice(0,24)}`,contentHash,fingerprint:hash(PRODUCT_URL),
    freshness:"FRESH",licenseCode:null,isComplete:true,isCitable:temporal.citable,
    locator:{kind:"html_section",selector:"#ConTitle",end_marker:"일반보증이란?",normalization_version:"html-text-v1",temporal_status:temporal.status,product_end_date:temporal.endDate,assessed_on:asOf,profile_terms:extractProfileTerms(text)},
    excerptMasked:text,directness:temporal.citable ? "DIRECT" : "CONTEXT_ONLY",referenceOnly:false,selectionReasonCode:temporal.citable ? "OFFICIAL_PRODUCT_BODY" : "PRODUCT_END_NOTICE",
  }]};
}
