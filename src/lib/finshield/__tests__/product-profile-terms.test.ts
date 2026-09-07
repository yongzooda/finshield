import { describe, expect, it } from "vitest";
import { extractProfileTerms } from "../product-profile-terms";
describe("명시된 공식 상품 조건만 구조화", () => {
  it("만기 선택지를 읽고 수수료·가입 승인은 추측하지 않는다", () => {
    expect(extractProfileTerms("대출기간 3년 또는 5년 우대금리 성실상환시 금리 인하 상환방법 원리금균등분할상환 지원대상 연소득 요건"))
      .toMatchObject({ term_months: [36, 60], repayment_method: "원리금균등분할상환", early_repayment_fee: "UNKNOWN", income_eligibility_basis: "ANNUAL_INCOME_AND_OTHER_CRITERIA" });
  });
  it("다른 숫자와 불명확한 범위는 대출기간으로 해석하지 않는다", () => {
    expect(extractProfileTerms("대출금리 3% 또는 5% 우대금리 대출기간 3~5년 조건 적용").term_months).toEqual([]);
    expect(extractProfileTerms("대출기간 최대 5년 우대금리").term_months).toEqual([]);
    expect(extractProfileTerms("대출기간 3년 또는 5년 우대금리 대출기간 2년 또는 4년 우대금리").term_months).toEqual([]);
  });
});
