/**
 * 화면에 쓰는 낱말.
 *
 * 데이터베이스와 실행 기록은 코드로 남는다. 그 코드를 그대로 화면에 내보내면
 * 읽는 사람이 뜻을 짐작해야 한다. 그래서 화면에 나갈 자리에서는 여기서 우리말로
 * 바꾼다. 새 내부 코드는 사용자용 일반 안내로 표시하며 원본은 실행 원장에 보존한다.
 */

import type { ChipTone } from "./fs-shell";

const pick = (table: Record<string, string>, code: string): string => table[code] ?? code;

export const AXIS_LABEL: Record<string, string> = {
  AUTHENTICITY: "상품·기관 정보",
  TRANSACTION_SALES_RISK: "거래·권유 위험",
  SUITABILITY: "적합성",
};

export const AXIS_RESULT: Record<string, { label: string; tone: ChipTone }> = {
  CONFIRMED: { label: "확인됨", tone: "verified" },
  CONTRADICTED: { label: "공식 자료와 불일치", tone: "contra" },
  HIGH_RISK_ACTION: { label: "위험한 행동 요구", tone: "contra" },
  CONFLICTING: { label: "자료가 엇갈림", tone: "caution" },
  UNCERTAIN: { label: "확정 못 함", tone: "neutral" },
  NEED_MORE_INFORMATION: { label: "정보 부족", tone: "caution" },
  SUSPENDED: { label: "보류", tone: "neutral" },
};

export const axisResultOf = (code: string, axis?: string): { label: string; tone: ChipTone } => {
  if (axis === "AUTHENTICITY" && code === "CONTRADICTED") return { label: "불일치 항목 있음", tone: "contra" };
  if (axis === "SUITABILITY" && code === "UNCERTAIN") return { label: "적합성 판단 보류", tone: "caution" };
  return AXIS_RESULT[code] ?? { label: "결과 확인 필요", tone: "neutral" };
};

export const RELATION_LABEL: Record<string, string> = {
  SUPPORT: "뒷받침", CONTRADICT: "반대", CONTEXT: "맥락",
};

export const FRESHNESS_LABEL: Record<string, string> = {
  FRESH: "최근 수집", STALE: "재확인 필요", UNKNOWN: "최신성 미확인",
};

export const DIRECTNESS_LABEL: Record<string, string> = {
  DIRECT: "본문 직접", INDIRECT: "간접", CONTEXT_ONLY: "맥락 참고",
};

export const AGENT_LABEL: Record<string, string> = {
  PRODUCT_INSTITUTION: "상품·기관 확인",
  FRAUD_CHANNEL: "사칭·접근 경로 확인",
  SALES_CONDUCT: "설명·권유 방식 확인",
  REGULATION_DISPUTE: "법령·분쟁 선례 확인",
  COVE: "독립 재확인",
  RED_TEAM: "반대 근거 찾기",
  EVIDENCE_JUDGE: "최종 근거 판단",
};

/** 확정 상태를 그렇게 정한 이유. 낮춘 이유가 여기 남는다. */
const REASON: Record<string, string> = {
  AS_JUDGED: "조회한 공식 자료를 바탕으로 판단",
  HIGH_RISK_ADVANCE_PAYMENT: "공식 예방 지침과 대조한 선입금 요구",
  HIGH_RISK_REMOTE_CONTROL: "공식 예방 지침과 대조한 원격제어 요구",
  INDEPENDENT_REVIEW_FAILED: "독립 검토를 마치지 못해 보류함",
  COVE_CONFIRMED: "다른 검색으로 다시 확인함",
  COVE_REFUTED: "다시 확인했더니 결론이 달랐음",
  COVE_INCONCLUSIVE: "다시 확인했으나 판단하지 못함",
  RED_TEAM_COUNTER_EVIDENCE: "반대되는 공식 근거를 찾음",
  NO_EVIDENCE: "인용할 근거를 찾지 못함",
};
export const reasonLabel = (code: string): string => REASON[code] ?? "판단 근거의 추가 확인이 필요함";

export const COVE_LABEL: Record<string, string> = {
  CHALLENGED: "다른 결론", UNRESOLVED: "판단 못 함", FAILED: "검토 실패",
  CONFIRMED: "같은 결론", REFUTED: "다른 결론", INCONCLUSIVE: "판단 못 함",
};
export const coveLabel = (code: string): string => COVE_LABEL[code] ?? "검토 상태 확인 필요";

/** 끝까지 가지 못한 이유. Agent 실행에서 나온 값이다. */
const PARTIAL: Record<string, string> = {
  CITATION_INVALID: "일부 근거가 해당 판단을 뒷받침하는지 확인하지 못했습니다.",
  SOURCE_UNAVAILABLE: "일부 공식 자료를 가져오지 못했습니다.",
  TOOL_NOT_IMPLEMENTED: "검증에 필요한 일부 자료가 아직 연결되지 않았습니다.",
  TOOL_NOT_ALLOWED: "이번 검증 범위에서 사용할 수 없는 자료가 있었습니다.",
  TOOL_CHOICE_FAILED: "추가 확인에 필요한 자료를 선택하지 못했습니다.",
};
export const partialLabel = (code: string): string => {
  if (PARTIAL[code]) return PARTIAL[code];
  if (/CITATION/.test(code)) return PARTIAL.CITATION_INVALID;
  if (/DEADLINE|TIMEOUT|TIMED_OUT/.test(code)) return "제한 시간 안에 일부 검토를 마치지 못했습니다.";
  if (/BUDGET|QUOTA/.test(code)) return "이번 검증의 사용 한도에 도달해 일부 검토를 중단했습니다.";
  if (/SCHEMA|OUTPUT|FORMAT|COVERAGE/.test(code)) return "일부 검토 결과의 형식이나 누락 항목을 확인하지 못했습니다.";
  return "일부 검토 결과를 받지 못했습니다.";
};

/** RES-008: 같은 원인은 한 번만 설명하되, 영향을 받은 검토 범위는 남긴다. */
export function partialExplanation(codes: readonly string[]) {
  const areas: string[] = [];
  const causes: string[] = [];
  for (const code of codes) {
    const match = code.match(/^AGENT_(.+)_(?:PARTIAL|FAILED)$/);
    if (match && AGENT_LABEL[match[1]]) areas.push(AGENT_LABEL[match[1]]);
    else causes.push(partialLabel(code));
  }
  return { areas: [...new Set(areas)], causes: [...new Set(causes)] };
}

/** 이번 실행이 보지 못한 범위. */
const LIMITATION: Record<string, string> = {
  PRE_TRANSACTION_SCOPE: "가입 전이라 확인할 수 없는 항목이 있음",
  PROFILE_SKIPPED: "금융 프로필을 남기지 않음",
  PARTIAL_SOURCE: "일부 자료만 받아 전체 내용을 확인하지 못했습니다.",
  CURRENT_PRODUCT_CONDITIONS_UNVERIFIED: "현재 유효한 상품 조건을 확인하지 못했습니다.",
  REPAYMENT_AMOUNT_MISSING: "대출 실행액·월 상환액·필수 지출이 없어 상환 부담을 판단하지 못했습니다.",
  ELIGIBILITY_NOT_ASSESSED: "연소득·신용평점 등 가입 요건을 확인하지 못했습니다.",
  EARLY_REPAYMENT_TERMS_MISSING: "조기 상환 가능 여부와 수수료를 확인하지 못했습니다.",
  NOT_CREDIT_APPROVAL: "금융회사의 대출 승인 여부를 판단한 결과는 아닙니다.",
  PROFILE_SCHEMA_OR_SCENARIO_UNSUPPORTED: "이번 프로필 또는 상품 유형은 적합성 비교를 지원하지 않습니다.",
  PROFILE_PARTIAL: "프로필에 입력하지 않은 정보가 있어 비교 범위가 제한됩니다.",
  PROFILE_INCOMPLETE: "프로필에 입력하지 않은 정보가 있어 비교 범위가 제한됩니다.",
};
export const limitationLabel = (code: string): string => LIMITATION[code] ?? "추가로 확인해야 할 조건이 있습니다.";

export const RUN_STATUS_LABEL: Record<string, string> = {
  QUEUED: "대기", RUNNING: "확인 중", COMPLETED: "완료", SUCCEEDED: "완료", PARTIAL: "일부만 확인",
  FAILED: "실패", BLOCKED: "중단됨", CANCELLED: "취소됨",
};
export const runStatusLabel = (code: string): string => pick(RUN_STATUS_LABEL, code);

export const LIFECYCLE_LABEL: Record<string, { label: string; tone: ChipTone }> = {
  DRAFT: { label: "작성 중", tone: "neutral" },
  INPUT_REVIEW: { label: "입력 검토", tone: "neutral" },
  VERIFYING: { label: "확인 중", tone: "caution" },
  VERIFIED: { label: "확인 완료", tone: "verified" },
  NEED_MORE_INFORMATION: { label: "정보 부족", tone: "caution" },
  STOPPED_BY_USER: { label: "중단함", tone: "neutral" },
  CLOSED: { label: "종료", tone: "neutral" },
};

export const SCENARIO_LABEL: Record<string, string> = {
  LOAN: "대출", SAVINGS: "예적금", INVESTMENT: "투자",
};

/** Case 에 남는 사건. 사용자가 무엇을 했고 무엇이 일어났는지를 시간 순으로 읽는다. */
const EVENT: Record<string, string> = {
  CASE_CREATED: "검증 건을 만들었습니다",
  CASE_INPUT_CREATED: "확인할 내용을 받았습니다",
  CASE_INPUT_CLAIMS_CONFIRMED: "확인할 항목을 정했습니다",
  CASE_INPUT_STOPPED: "사용자가 중단했습니다",
  CASE_LIFECYCLE_CHANGED: "건의 상태가 바뀌었습니다",
  CASE_DELETION_REQUESTED: "삭제를 요청했습니다",
  CASE_DELETED: "건을 삭제했습니다",
  RUN_CREATED: "확인을 준비했습니다",
  RUN_STARTED: "확인을 시작했습니다",
  RUN_COMPLETED: "확인을 마쳤습니다",
  RUN_FINALIZED: "결과를 확정했습니다",
  RUN_FAILED: "확인이 실패했습니다",
  REVALIDATION_REQUESTED: "재확인을 요청했습니다",
  REVALIDATION_COMPLETED: "재확인을 마쳤습니다",
  REVALIDATION_NO_CHANGE: "재확인했으나 달라진 것이 없습니다",
  JOURNEY_ENROLLED: "가입 뒤 보호를 시작했습니다",
};
export const eventLabel = (code: string): string => pick(EVENT, code);

export const ACTOR_LABEL: Record<string, string> = {
  USER: "본인", SYSTEM: "시스템", AGENT: "확인 단계",
};
export const actorLabel = (code: string): string => pick(ACTOR_LABEL, code);

export const OVERALL_RESULT: Record<string, { label: string; tone: ChipTone }> = {
  MATERIAL_RISK_FOUND: { label: "중대한 위험 신호", tone: "contra" },
  HIGH_CAUTION: { label: "높은 주의 필요", tone: "caution" },
  INSUFFICIENT_INFORMATION: { label: "판단 정보 부족", tone: "neutral" },
  VERIFY_BEFORE_PROCEEDING: { label: "거래 전 추가 확인", tone: "caution" },
  NO_SPECIAL_RISK_IN_VERIFIED_SCOPE: { label: "확인 범위 내 특이 위험 없음", tone: "verified" },
  CONFIRMED_RISK: { label: "위험 확인", tone: "contra" },
  NO_RISK_FOUND: { label: "확인된 위험 없음", tone: "verified" },
  UNCERTAIN: { label: "확정 못 함", tone: "neutral" },
  NEED_MORE_INFORMATION: { label: "정보 부족", tone: "caution" },
  PARTIAL: { label: "일부만 확인", tone: "caution" },
};
export const overallResultOf = (code: string): { label: string; tone: ChipTone } =>
  OVERALL_RESULT[code] ?? { label: code, tone: "neutral" };

/**
 * 결과에서 사용자가 지금 할 수 있는 일을 먼저 정한다 (RES-005).
 *
 * 검증 직후 화면과 나중에 다시 연 기록 화면이 같은 말을 해야 한다. 그래서 두
 * 화면이 이 함수를 함께 쓴다.
 */
export function nextAction(states: string[], highRiskAction = false): { title: string; detail: string } {
  if (highRiskAction) return {
    title: "송금·원격제어 앱 설치를 멈추세요",
    detail: "권유문에 선입금 또는 원격제어 앱 설치 요구가 있습니다. 공식 예방 지침에 따라 먼저 공식 창구로 확인하세요. 아래의 미확인 사실과 별도로 주의할 행동 요구입니다.",
  };
  if (states.includes("CONTRADICTED")) {
    return {
      title: "송금하거나 가입하기 전에 멈추세요",
      detail: "들으신 내용과 공식 자료가 다른 항목이 있습니다. 아래에서 어떤 자료가 다르게 적고 있는지 확인하시고, 상대에게 그 근거를 요구하세요.",
    };
  }
  if (states.includes("CONFLICT")) {
    return {
      title: "공식 자료가 엇갈립니다. 공식 창구로 확인하세요",
      detail: "자료마다 다르게 적고 있어 한쪽으로 정하지 않았습니다. 아래 근거를 들고 해당 기관의 공식 번호로 직접 확인하시는 편이 안전합니다.",
    };
  }
  if (states.length > 0 && states.every((state) => state === "VERIFIED")) {
    return {
      title: "고르신 항목은 공식 자료와 맞습니다",
      detail: "다만 확인한 것은 고르신 항목뿐입니다. 확인하지 않은 조건이 남아 있을 수 있으니 계약서를 함께 보세요.",
    };
  }
  return {
    title: "확인하지 못한 항목이 있습니다",
    detail: "근거를 찾지 못한 항목은 안전하다는 뜻이 아닙니다. 아래에서 무엇을 확인하지 못했는지 보시고 공식 창구로 확인하세요.",
  };
}

export const JOURNEY_STAGE: Record<string, string> = {
  PRE_TRANSACTION: "가입 전",
  ENROLLED: "가입함",
  FUNDS_SENT_OR_DAMAGE_SUSPECTED: "송금·피해 의심",
};

export const AFTERCARE_STATUS: Record<string, string> = {
  NOT_STARTED: "가입 후 점검 전",
  IN_PROGRESS: "점검 중",
  ACTION_REQUIRED: "할 일 있음",
  COMPLETED: "점검 완료",
};

export const AFTERCARE_RESULT: Record<string, { label: string; tone: ChipTone }> = {
  NORMAL_MANAGEMENT: { label: "계약 자료 보관", tone: "neutral" },
  ADDITIONAL_EXPLANATION: { label: "추가 설명 필요", tone: "caution" },
  CORRECTION_OR_INQUIRY: { label: "정정·문의 필요", tone: "caution" },
  DISPUTE_PREPARATION: { label: "분쟁 준비", tone: "contra" },
};

export const ACTION_LABEL: Record<string, string> = {
  KEEP_CONTRACT_AND_RECORDS: "계약서와 권유 기록 모아 두기",
  REQUEST_WRITTEN_EXPLANATION: "설명받지 못한 부분을 서면으로 요청하기",
  ASK_OFFICIAL_CHANNEL: "공식 상담 창구로 확인하기",
  REPORT_IMPERSONATION: "공식 신고 창구 확인하기",
};

/** Claim 상태를 낱말로만 옮긴다. 칩이 필요 없는 자리에서 쓴다. */
export const CLAIM_STATE_LABEL: Record<string, string> = {
  VERIFIED: "공식 자료와 일치",
  CONTRADICTED: "공식 자료와 불일치",
  CONFLICT: "자료가 엇갈림",
  UNKNOWN: "확인 근거 부족",
  NEED_MORE_INFORMATION: "추가 정보 필요",
  WITHHELD: "판단 보류",
};
