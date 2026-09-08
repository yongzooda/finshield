import type { ToolEvidence } from "./schemas";
import { reviewedWarningIsUsable, WARNING_REVIEW } from "./tools/warning-review";

/** RES-004·요구사항 2.2: 입력의 행동 요구 경고는 거래 발생·위법의 사실 판정이 아니다. */
export function highRiskAction(statement: string, evidence: ToolEvidence[]) {
  const guide = evidence.find(item => item.official_id === WARNING_REVIEW.officialId
    && item.citable && !item.incomplete && !item.reference_only && item.directness === "DIRECT"
    && item.freshness_at_use === "FRESH" && item.locator.permitted_use === WARNING_REVIEW.scope
    && reviewedWarningIsUsable(item.content_hash, Date.now()));
  if (!guide) return null;
  // 명시적 요구만 고른다. 거절·예방 안내·부정 문구를 요구로 뒤집지 않는다.
  if (/금지|거절|말라|마세요|말아|않|없|안\s*(?:해|하|설치|입금|송금)|하지\s*마/u.test(statement)) return null;
  const demand = /(?:요구|요청|해야|하라|해\s*달|하세요)/u;
  if (!demand.test(statement)) return null;
  if (/(?:보증료|수수료|선입금|선납)/u.test(statement)
    && /(?:먼저|선입금|선납|사전)/u.test(statement) && /(?:입금|송금|납부)/u.test(statement)) {
    return { code: "HIGH_RISK_ADVANCE_PAYMENT", ref: guide.evidence_ref,
      summary: "권유문에 대출 전 비용을 먼저 보내라는 요구가 있습니다. 공식 예방 지침에 따라 입금 전에 공식 창구로 확인하세요. 실제 사기 여부를 확정한 결과는 아닙니다." };
  }
  if (/원격\s*제어/u.test(statement) && /(?:앱|프로그램)/u.test(statement) && /설치/u.test(statement)) {
    return { code: "HIGH_RISK_REMOTE_CONTROL", ref: guide.evidence_ref,
      summary: "권유문에 원격제어 앱 설치 요구가 있습니다. 설치를 멈추고 공식 창구로 확인하세요. 실제 발신자나 앱의 악성 여부를 확정한 결과는 아닙니다." };
  }
  return null;
}

export const hasHighRiskAction = (claims: { reason_code: string }[]) =>
  claims.some(claim => ["HIGH_RISK_ADVANCE_PAYMENT", "HIGH_RISK_REMOTE_CONTROL"].includes(claim.reason_code));
