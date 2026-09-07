import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeOcrResponse, extractWithOcr } from "../files/ocr";
import { locateFileQuote } from "../files/process";
import { citationProblems, type ToolEvidence } from "../schemas";

afterEach(()=>vi.unstubAllGlobals());
const field={inferText:"연 3% 금리",boundingPoly:{vertices:[{x:1,y:1},{x:20,y:1},{x:20,y:10},{x:1,y:10}]}};
const page=(pageIndex:number)=>({inferResult:"SUCCESS",convertedImageInfo:{pageIndex},fields:[field]});
describe("INP-006·SEC-PRI-010 파일 원문 처리 계약",()=>{
 it("거절된 동의에서는 외부 fetch를 한 번도 하지 않는다",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(extractWithOcr({bytes:Buffer.from("합성"),mime:"image/png",pageCount:1,authorize:async()=>false})).rejects.toThrow("OCR_CONSENT_REQUIRED");
  expect(fetch).not.toHaveBeenCalled();
 });
 it("PDF 인덱스로 재정렬하며 중복·누락·부분 실패를 거부한다",()=>{
  expect(decodeOcrResponse({version:"V2",requestId:"r",images:[page(1),page(0)]},"r",2,true).map(p=>p.page_no)).toEqual([1,2]);
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
it("EV-009: 최신 표시만으로 불완전·인용 불가·간접 근거를 확정에 쓰지 않는다",()=>{
 const item={evidence_ref:"E1",reference_only:false,citable:true,incomplete:false,freshness_at_use:"FRESH",directness:"DIRECT"} as ToolEvidence;
 for(const patch of [{citable:false},{incomplete:true},{directness:"INDIRECT"},{freshness_at_use:"STALE"}]) {
  expect(citationProblems(["E1"],"VERIFIED",new Map([["E1",{...item,...patch} as ToolEvidence]])).length).toBeGreaterThan(0);
 }
});
