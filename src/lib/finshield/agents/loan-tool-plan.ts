import type { DomainAgentInput } from "../schemas";
import type { ToolChoice } from "./runner";

/** AI-021·AI-016: 고정 P0 Agent의 읽기 경로. 결론·근거는 만들지 않는다.
 * CoVe와 Red Team은 이 계획을 받지 않고 각자 모델로 검색 질문을 만든다. */
export function loanToolPlan(input: DomainAgentInput): ToolChoice[] | null {
  const text = input.claims.map(c => c.statement_masked).join(" ");
  const query = text.slice(0, 1500);
  const call = (toolCode: string, query: string): ToolChoice => ({ toolCode, input: { query } });
  switch (input.agent_code) {
    case "PRODUCT_INSTITUTION":
      // 지원 밖 상품은 기존 모델 선택을 유지한다. 유사 이름을 햇살론15로 치환하지 않는다.
      return /햇살론\s*15(?!\d)/u.test(text) && !input.claims.some(c => c.claim_type === "INSTITUTION" && !/햇살론\s*15(?!\d)/u.test(c.statement_masked))
        ? [call("search_financial_product", "햇살론15")] : null;
    case "FRAUD_CHANNEL": {
      const urls = [...new Set(text.match(/https?:\/\/[^\s<>"']+/gu) ?? [])];
      return [call("search_consumer_warning", query), ...(urls.length ? [
        { toolCode: "parse_url_host", input: { urls: urls.slice(0, 10) } },
        { toolCode: "lookup_official_channel", input: { values: urls.slice(0, 10) } },
      ] : [])];
    }
    case "SALES_CONDUCT":
      return input.aftercare_context
        ? [call("check_documents", "금융소비자 보호에 관한 법률 제19조"), call("analyze_risk_pattern", query)]
        : [call("analyze_risk_pattern", query)];
    case "REGULATION_DISPUTE":
      return input.aftercare_context
        ? [call("lookup_statute", "금융소비자 보호에 관한 법률 제23조")]
        : /법률|법령|제\s*\d+\s*조|위법|불법/u.test(text) ? null
        : [call("lookup_statute", "금융소비자 보호에 관한 법률 제19조")];
    default: return null;
  }
}

/** 고정 Agent의 책임 분리. Agent 수·순서와 CoVe의 전체 중요 항목은 유지한다. */
export function domainClaims(input: DomainAgentInput) {
  if (input.aftercare_context) return input.claims;
  const types: Record<string, string[]> = {
    PRODUCT_INSTITUTION: ["PRODUCT_TERM", "ELIGIBILITY", "INSTITUTION"],
    FRAUD_CHANNEL: ["CONDUCT", "CHANNEL", "INSTITUTION", "OTHER"],
    SALES_CONDUCT: ["CONDUCT", "SALES_CONDUCT", "OTHER"],
    REGULATION_DISPUTE: ["CONDUCT", "SALES_CONDUCT", "OTHER"],
  };
  const selected = input.claims.filter(c => types[input.agent_code]?.includes(c.claim_type));
  // 범위 분류가 불명확하거나 독립 검토이면 모델이 원 목록에서 범위를 판단한다.
  return selected.length ? selected : input.claims;
}
