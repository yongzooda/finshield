import type { ToolEvidence } from "./schemas";
import { extractProfileTerms } from "./product-profile-terms";

/** RES-008·EV-004: 보류해도 실제 확인한 공식 조건은 출처와 함께 설명한다.
 * 종료 전 조건은 현재 신청 조건이나 개인 승인 판단으로 승격하지 않는다. */
export function productDisclosure(statement: string, evidence: ToolEvidence[]) {
  if (!/햇살론\s*15(?!\d)/u.test(statement) || !/금리|한도|대출\s*가능|대출금|최대/u.test(statement)) return null;
  const source = evidence.find(item => item.official_id === "kinfa:hessalLoan"
    && item.locator.temporal_status === "ENDED" && item.locator.kind === "html_section"
    && item.freshness_at_use === "FRESH" && !item.incomplete
    && /\d{4}-\d{2}-\d{2}/u.test(String(item.locator.product_end_date))
    && item.excerpt_masked.includes("대출금리") && item.excerpt_masked.includes("대출한도"));
  if (!source) return null;
  const terms = extractProfileTerms(source.excerpt_masked);
  const fact = /금리/u.test(statement) && terms.annual_rate_percent !== null
    ? `종료 전 공식 안내의 기본 금리는 연 ${terms.annual_rate_percent}%입니다.`
    : /한도|대출\s*가능|대출금|최대/u.test(statement) && terms.maximum_amount_krw !== null
      ? `종료 전 공식 안내의 한도는 최대 ${terms.maximum_amount_krw / 10000}만 원입니다.` : "";
  if (!fact) return null;
  return { ref: source.evidence_ref,
    summary: `${fact} 보증은 ${source.locator.product_end_date} 종료됐으므로 현재 이 조건으로 신규 가입할 수 있다는 안내로 받아들이면 안 됩니다. 과거 계약의 적용 조건은 가입 당시 자료를 확인해야 합니다.` };
}
