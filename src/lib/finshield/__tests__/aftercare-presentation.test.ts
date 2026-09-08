import { describe, expect, it } from "vitest";
import { aftercarePresentation, annualRateDifference } from "../aftercare-presentation";
import type { ContractComparison } from "../contract-comparison";
const row: ContractComparison = {claim_id:"rate",before:"가입 전 연 3% 고정금리라고 안내받았다.",contract:"합성 계약의 금리는 연 8.2%입니다.",result:"DIFFERENT_TEXT"};
describe("PC-004 가입 후 입력 비교와 서면 요청",()=>{
  it("단일 연 금리의 차이만 계산하며 원본은 보존한다",()=>{
    const original=JSON.stringify(row);expect(annualRateDifference(row)).toEqual({before:3,contract:8.2,delta:5.2});expect(JSON.stringify(row)).toBe(original);
    expect(annualRateDifference({...row,before:row.contract,contract:row.before})?.delta).toBe(-5.2);
  });
  it.each(["최저 연 3% 금리", "연 3%~8% 금리", "월 3% 금리", "연 3% 금리와 연체 연 8%", "연 3% 우대금리", "3% 금리", "연 3% 변동금리", "연 3% 중도상환수수료", "연 3% 수수료"])("다른 조건 또는 모호한 수치는 차이로 확정하지 않는다: %s",before=>{expect(annualRateDifference({...row,before})).toBeNull()});
  it("미입력을 검증 실패나 일치로 세지 않고 요청에 포함하지 않는다",()=>{
    const info=aftercarePresentation([{...row,claim_id:"empty",result:"NOT_PROVIDED",contract:""},row],{EXPLAINED_RATE_AND_FEES:"PARTIAL",EXPLAINED_PENALTY:"NO",UNDERSTOOD_TERMS:"PARTIAL"});
    expect(info.provided).toEqual([row]);expect(info.missing).toHaveLength(1);expect(info.gaps).toHaveLength(3);
    expect(info.draft).toContain("연 8.2%");expect(info.draft).toContain("중도상환수수료");expect(info.draft).not.toMatch(/위법입니다|사기입니다|총이자|5.2배/);
  });
  it("정상 답변·동일 문구에 차이 또는 불필요한 정정 요청을 만들지 않는다",()=>{
    const info=aftercarePresentation([{...row,contract:row.before,result:"SAME_TEXT"}],{EXPLAINED_RATE_AND_FEES:"YES",UNDERSTOOD_TERMS:"YES",HAS_CONTRACT_COPY:"YES"});
    expect(info.rate).toBeUndefined();expect(info.different).toHaveLength(0);expect(info.draft).toBeNull();
  });
  it("문구가 다르더라도 같은 금리면 금리 증가를 만들지 않는다",()=>{expect(annualRateDifference({...row,contract:"계약 금리는 연 3%입니다."})).toBeNull()});
});
