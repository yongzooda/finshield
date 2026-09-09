import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeOcrResponse, extractWithOcr } from "../files/ocr";
import { lowConfidenceFields, lowConfidenceFieldsForSpan } from "../files/ocr-review";
import { locateFileQuote } from "../files/process";
import { citationProblems, type ToolEvidence } from "../schemas";

afterEach(()=>vi.unstubAllGlobals());
const field={inferText:"연 3% 금리",inferConfidence:0.991,boundingPoly:{vertices:[{x:1,y:1},{x:20,y:1},{x:20,y:10},{x:1,y:10}]}};
const page=(pageIndex:number)=>({inferResult:"SUCCESS",convertedImageInfo:{pageIndex},fields:[field]});
describe("INP-006·SEC-PRI-010 파일 원문 처리 계약",()=>{
 it("거절된 동의에서는 외부 fetch를 한 번도 하지 않는다",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(extractWithOcr({bytes:Buffer.from("합성"),mime:"image/png",pageCount:1,authorize:async()=>false})).rejects.toThrow("OCR_CONSENT_REQUIRED");
  expect(fetch).not.toHaveBeenCalled();
 });
 it("PDF 인덱스로 재정렬하며 중복·누락·부분 실패를 거부한다",()=>{
  const decoded=decodeOcrResponse({version:"V2",requestId:"r",images:[page(1),page(0)]},"r",2,true);
  expect(decoded.map(p=>p.page_no)).toEqual([1,2]);
  expect(decoded[0].words[0]).toMatchObject({confidence:0.991,bbox:[1,1,19,9]});
  for(const images of [[page(0),page(0)],[page(0)],[page(0),{...page(1),inferResult:"FAILURE"}]]) {
   expect(()=>decodeOcrResponse({version:"V2",requestId:"r",images},"r",2,true)).toThrow();
  }
 });
 it("실제 페이지 구절만 위치로 연결하고 여러 페이지에 겹치는 구절을 추측하지 않는다",()=>{
  const pages=[{page_no:1,text:"조건: 연 3% 금리"},{page_no:2,text:"연락처 확인"}];
  expect(locateFileQuote(pages,"연 3% 금리")).toMatchObject({page_no:1,start:4,end:11});
  expect(()=>locateFileQuote(pages,"연 5% 금리")).toThrow();
  expect(()=>locateFileQuote([...pages,{page_no:3,text:"연 3% 금리"}],"연 3% 금리")).toThrow("CLAIM_PAGE_AMBIGUOUS");
 });
});

it("저신뢰 핵심 필드는 위치만 남기고 해당 Claim 원문에 포함될 때만 확인을 요구한다",()=>{
  const page={page_no:1,text:"상담원 안내 주소 https://refinance.exaimple/loan 입니다",words:[
    {text:"상담원",confidence:0.942,bbox:[0,0,30,10]},
    {text:"https://refinance.exaimple/loan",confidence:0.591,bbox:[40,0,180,10]},
    {text:"햇살론15",confidence:0.989,bbox:[0,20,50,10]},
  ]};
  expect(lowConfidenceFields(page)).toEqual([{
    field_kind:"URL",confidence_milli:591,bbox:[40,0,180,10],start:10,end:41,
  }]);
  const fields=lowConfidenceFields(page);
  expect(lowConfidenceFieldsForSpan(fields,{start:3,end:44})).toEqual(fields);
  expect(lowConfidenceFieldsForSpan(fields,{start:0,end:4})).toEqual([]);
});
it("EV-009: 최신 표시만으로 불완전·인용 불가·간접 근거를 확정에 쓰지 않는다",()=>{
 const item={evidence_ref:"E1",reference_only:false,citable:true,incomplete:false,freshness_at_use:"FRESH",directness:"DIRECT"} as ToolEvidence;
 for(const patch of [{citable:false},{incomplete:true},{directness:"INDIRECT"},{freshness_at_use:"STALE"}]) {
  expect(citationProblems(["E1"],"VERIFIED",new Map([["E1",{...item,...patch} as ToolEvidence]])).length).toBeGreaterThan(0);
 }
});
it("페이지를 명시한 인용도 해당 페이지에서만 검증하고 공백 변경 후 실제 위치를 보존한다",()=>{
 const pages=[{page_no:1,text:"금리 연 3%\n 한도"},{page_no:2,text:"금리 연 3%\n 한도"},{page_no:3,text:"금리 연 5%"}];
 expect(locateFileQuote(pages,"연 3% 한도",2)).toMatchObject({page_no:2,start:3,end:11});
 expect(()=>locateFileQuote(pages,"연 3%",3)).toThrow();
 expect(()=>locateFileQuote(pages,"연 3%",4)).toThrow();
 expect(()=>locateFileQuote(pages,"연 3%")).toThrow("CLAIM_PAGE_AMBIGUOUS");
 expect(()=>locateFileQuote([{page_no:1,text:"연 3% / 연 3%"}],"연 3%",1)).toThrow("CLAIM_PAGE_AMBIGUOUS");
});

it("신뢰도 반올림·부정어·미분류 문구가 확인 경계를 빠져나가지 않는다",()=>{
 const page={page_no:1,text:"없습니다 특수기관 3%",words:[
  {text:"없습니다",confidence:0.89999,bbox:[0,0,20,10]},
  {text:"특수기관",confidence:0.5,bbox:[25,0,20,10]},
  {text:"3%",confidence:0.9,bbox:[50,0,20,10]},
 ]};
 expect(lowConfidenceFields(page).map(f=>[f.field_kind,f.confidence_milli])).toEqual([["NEGATION",899],["TEXT",500]]);
 expect(lowConfidenceFields(page,"없습니다 [이름] 3%").map(f=>f.field_kind)).toEqual(["NEGATION"]);
 const many={page_no:1,text:Array(101).fill("3%").join(" "),words:Array(101).fill({text:"3%",confidence:0.4,bbox:[0,0,20,10]})};
 expect(()=>lowConfidenceFields(many)).toThrow("OCR_REVIEW_TOO_MANY_FIELDS");
});
