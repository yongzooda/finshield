/** RES-001·AUTH-006: 모델이 만든 수치가 아닌 공식 표의 명시적 조건만 읽는다. */
export function extractProfileTerms(text: string) {
  // 이 Parser는 햇살론15 공식 섹션 전용이다. 다른 상품에 이름만 바꾸어 재사용하지 않는다.
  const terms = [...text.matchAll(/대출기간\s+(\d{1,2})년\s*(?:또는|,)\s*(\d{1,2})년\s+우대금리/gu)];
  const term = terms.length === 1 ? terms[0] : null;
  const repayment = /상환방법\s+(원리금균등분할상환|원금균등분할상환|만기일시상환)\s+지원대상/u.exec(text);
  return {
    schema_version: "kinfa-hessal-profile-terms-v1",
    product_id: "kinfa:hessalLoan", product_name: "햇살론15", product_kind: "LOAN",
    term_months: term ? [...new Set([Number(term[1]) * 12, Number(term[2]) * 12])].sort((a, b) => a - b) : [],
    repayment_method: repayment?.[1] ?? null,
    // 별도 본문 확인이 필요한 조건은 '없음'으로 바꾸지 않는다.
    early_repayment_fee: "UNKNOWN",
    income_eligibility_basis: /지원대상[\s\S]*연소득/u.test(text) ? "ANNUAL_INCOME_AND_OTHER_CRITERIA" : "UNKNOWN",
  };
}
