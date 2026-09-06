/**
 * 화면에 쓰는 낱말.
 *
 * 데이터베이스와 실행 기록은 코드로 남는다. 그 코드를 그대로 화면에 내보내면
 * 읽는 사람이 뜻을 짐작해야 한다. 그래서 화면에 나갈 자리에서는 여기서 우리말로
 * 바꾼다. 모르는 코드는 감추지 않고 그대로 보여 준다. 값이 사라지는 편보다
 * 낯선 값이 보이는 편이 낫다.
 */

import type { ChipTone } from "./fs-shell";

const pick = (table: Record<string, string>, code: string): string => table[code] ?? code;

export const AXIS_LABEL: Record<string, string> = {
  AUTHENTICITY: "진위 확인",
  TRANSACTION_SALES_RISK: "거래·권유 위험",
  SUITABILITY: "적합성",
};

export const AXIS_RESULT: Record<string, { label: string; tone: ChipTone }> = {
  CONFIRMED: { label: "확인됨", tone: "verified" },
  CONTRADICTED: { label: "사실과 다름", tone: "contra" },
  CONFLICTING: { label: "자료가 엇갈림", tone: "caution" },
  UNCERTAIN: { label: "확정 못 함", tone: "neutral" },
  SUSPENDED: { label: "보류", tone: "neutral" },
};

export const axisResultOf = (code: string): { label: string; tone: ChipTone } =>
  AXIS_RESULT[code] ?? { label: code, tone: "neutral" };

export const RELATION_LABEL: Record<string, string> = {
  SUPPORT: "뒷받침", CONTRADICT: "반대", CONTEXT: "맥락",
};

export const FRESHNESS_LABEL: Record<string, string> = {
  FRESH: "현행", STALE: "오래됨", UNKNOWN: "현행 여부 불명",
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
};

/** 확정 상태를 그렇게 정한 이유. 낮춘 이유가 여기 남는다. */
const REASON: Record<string, string> = {
  AS_JUDGED: "확인한 근거대로",
  COVE_CONFIRMED: "다른 검색으로 다시 확인함",
  COVE_REFUTED: "다시 확인했더니 결론이 달랐음",
  COVE_INCONCLUSIVE: "다시 확인했으나 판단하지 못함",
  RED_TEAM_COUNTER_EVIDENCE: "반대되는 공식 근거를 찾음",
  NO_EVIDENCE: "인용할 근거를 찾지 못함",
};
export const reasonLabel = (code: string): string => pick(REASON, code);

export const COVE_LABEL: Record<string, string> = {
  CONFIRMED: "같은 결론", REFUTED: "다른 결론", INCONCLUSIVE: "판단 못 함",
};
export const coveLabel = (code: string): string => pick(COVE_LABEL, code);

/** 끝까지 가지 못한 이유. Agent 실행에서 나온 값이다. */
const PARTIAL: Record<string, string> = {
  AGENT_PARTIAL: "일부 단계가 끝나지 못함",
  TOOL_CHOICE_FAILED: "어떤 자료를 볼지 정하지 못함",
  TOOL_NOT_ALLOWED: "허용되지 않은 자료를 부르려 함",
  TOOL_NOT_IMPLEMENTED: "아직 연결되지 않은 자료",
  OUTPUT_SCHEMA_INVALID: "결과 형식이 맞지 않음",
  CITATION_INVALID: "근거 없이 확정하려 해 막음",
  MODEL_CALL_FAILED: "모델 호출이 실패함",
  SOURCE_UNAVAILABLE: "공식 자료를 받지 못함",
};
export const partialLabel = (code: string): string => pick(PARTIAL, code);

/** 이번 실행이 보지 못한 범위. */
const LIMITATION: Record<string, string> = {
  PRE_TRANSACTION_SCOPE: "가입 전이라 확인할 수 없는 항목이 있음",
  PROFILE_SKIPPED: "금융 프로필을 남기지 않음",
  PARTIAL_SOURCE: "일부 자료만 받음",
};
export const limitationLabel = (code: string): string => pick(LIMITATION, code);

export const RUN_STATUS_LABEL: Record<string, string> = {
  QUEUED: "대기", RUNNING: "확인 중", SUCCEEDED: "완료", PARTIAL: "일부만 확인",
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
export function nextAction(states: string[]): { title: string; detail: string } {
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
