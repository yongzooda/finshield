/**
 * 가입 후 점검 (S-016, 명세 6.7).
 *
 * 거래 전 검증과 다른 것을 본다. 상품이 진짜인지가 아니라, 설명을 제대로
 * 들었는지와 계약이 설명과 같은지를 본다. 그래서 상태 축도 따로 둔다 (규칙 6).
 *
 * 판단은 모델이 하지 않는다. 답변과 이미 확정된 Claim 상태만 보고 정해진
 * 규칙으로 결정한다. 규칙이므로 같은 답변은 언제나 같은 결과를 낸다.
 *
 * 연락처와 신고처는 만들지 않는다. 공식 채널 Registry 에 있는 값만 쓴다
 * (RES-007). 없으면 없다고 적는다.
 */

export const AFTERCARE_SCHEMA_VERSION = "aftercare-v2";

export type AftercareResult =
  | "NORMAL_MANAGEMENT" | "ADDITIONAL_EXPLANATION" | "CORRECTION_OR_INQUIRY" | "DISPUTE_PREPARATION";

export type Question = {
  code: string;
  text: string;
  help?: string;
  options: { value: string; label: string }[];
};

const YES_PARTIAL_NO = [
  { value: "YES", label: "들었습니다" },
  { value: "PARTIAL", label: "일부만 들었습니다" },
  { value: "NO", label: "듣지 못했습니다" },
];

export const QUESTIONS: readonly Question[] = Object.freeze([
  {
    code: "EXPLAINED_RATE_AND_FEES",
    text: "금리와 수수료를 계약 전에 설명받으셨습니까?",
    help: "총 얼마를 더 내게 되는지까지 들으셨는지를 기준으로 골라 주세요.",
    options: YES_PARTIAL_NO,
  },
  {
    code: "EXPLAINED_PENALTY",
    text: "중도 상환과 연체에 따르는 불이익을 설명받으셨습니까?",
    options: YES_PARTIAL_NO,
  },
  {
    code: "UNDERSTOOD_TERMS",
    text: "설명을 듣고 계약 내용을 이해하셨습니까?",
    options: [
      { value: "YES", label: "이해했습니다" },
      { value: "PARTIAL", label: "일부만 이해했습니다" },
      { value: "NO", label: "이해하지 못했습니다" },
    ],
  },
  {
    code: "CONTRACT_MATCHES_EXPLANATION",
    text: "계약서 내용이 들으신 설명과 같습니까?",
    help: "금리, 한도, 기간, 수수료 가운데 하나라도 다르면 다르다고 골라 주세요.",
    options: [
      { value: "SAME", label: "같습니다" },
      { value: "DIFFERENT", label: "다른 부분이 있습니다" },
      { value: "UNKNOWN", label: "확인하지 못했습니다" },
    ],
  },
  {
    code: "SIGNED_UNDER_PRESSURE",
    text: "재촉을 받아 충분히 보지 못한 채 서명하셨습니까?",
    options: [
      { value: "NO", label: "아니요" },
      { value: "YES", label: "그렇습니다" },
    ],
  },
  {
    code: "HAS_CONTRACT_COPY",
    text: "계약서 사본을 가지고 계십니까?",
    help: "사본을 여기에 올리실 필요는 없습니다. 가지고 계신지만 확인합니다.",
    options: [
      { value: "YES", label: "가지고 있습니다" },
      { value: "NO", label: "없습니다" },
    ],
  },
  {
    code: "HAS_RECORDING",
    text: "권유받을 때의 문자나 통화 기록을 가지고 계십니까?",
    options: [
      { value: "YES", label: "가지고 있습니다" },
      { value: "NO", label: "없습니다" },
    ],
  },
]);

export type Answers = Record<string, string>;

export type PlannedAction = {
  action_code: string;
  label: string;
  detail: string;
  required_material_codes: string[];
  /** 공식 창구가 필요한 행동이면 어느 기관인지. Registry 조회에 쓴다. */
  institution_code?: string;
  channel_type?: "URL" | "PHONE" | "BRANCH" | "REPORTING";
};

export type Decision = {
  result: AftercareResult;
  summary_masked: string;
  actions: PlannedAction[];
  /** 왜 이 결과가 됐는지. 화면이 그대로 보여 준다. */
  reasons: string[];
};

/** 답변이 정해진 값인지 본다. 자유 입력을 그대로 받지 않는다. */
export const normalizeAnswers = (input: unknown): Answers | null => {
  if (input === null || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const out: Answers = {};
  for (const question of QUESTIONS) {
    const value = source[question.code];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return null;
    if (!question.options.some((option) => option.value === value)) return null;
    out[question.code] = value;
  }
  return out;
};

const ACTIONS: Record<string, PlannedAction> = {
  KEEP_CONTRACT_AND_RECORDS: {
    action_code: "KEEP_CONTRACT_AND_RECORDS",
    label: "계약서와 권유 기록을 모아 두세요",
    detail: "계약서 사본, 문자, 통화 기록, 상담 화면을 한곳에 모아 두세요. 나중에 설명이 달랐다고 말하려면 그때의 자료가 필요합니다. 저희 서버에 올리실 필요는 없습니다.",
    required_material_codes: ["CONTRACT", "SALES_RECORD"],
  },
  REQUEST_WRITTEN_EXPLANATION: {
    action_code: "REQUEST_WRITTEN_EXPLANATION",
    label: "설명받지 못한 부분을 서면으로 요청하세요",
    detail: "듣지 못한 항목을 적어 금융회사에 서면으로 요청하세요. 말로 다시 듣는 것보다 남는 기록이 됩니다.",
    required_material_codes: ["CONTRACT"],
  },
  ASK_OFFICIAL_CHANNEL: {
    action_code: "ASK_OFFICIAL_CHANNEL",
    label: "공식 상담 창구로 확인하세요",
    detail: "권유했던 사람의 번호가 아니라 아래 공식 번호로 거세요. 계약 번호와 다른 점을 정리해 두고 통화하시면 짧게 끝납니다.",
    required_material_codes: ["CONTRACT"],
    institution_code: "INST_KINFA",
    channel_type: "PHONE",
  },
  REPORT_IMPERSONATION: {
    action_code: "REPORT_IMPERSONATION",
    label: "공식 신고 창구를 확인하세요",
    detail: "설명과 계약이 다르거나 사칭이 의심되면 아래 공식 신고 창구로 알리실 수 있습니다. 접수 전에 계약서와 권유 기록을 정리해 두세요.",
    required_material_codes: ["CONTRACT", "SALES_RECORD"],
    institution_code: "INST_KINFA",
    channel_type: "REPORTING",
  },
};

/**
 * 결정 규칙.
 *
 * 위에서부터 무거운 쪽으로 본다. 답하지 않은 항목은 없는 것으로 세지 않고
 * 확인하지 못한 것으로 남긴다.
 */
export const decideAftercare = (args: {
  answers: Answers;
  /** 거래 전 검증에서 사실과 다르다고 확정된 항목 수. */
  contradictedClaims: number;
  contractTextDifferences?: number;
}): Decision => {
  const { answers, contradictedClaims } = args;
  const reasons: string[] = [];
  const actions: PlannedAction[] = [ACTIONS.KEEP_CONTRACT_AND_RECORDS];

  const mismatch = answers.CONTRACT_MATCHES_EXPLANATION === "DIFFERENT";
  const pressured = answers.SIGNED_UNDER_PRESSURE === "YES";
  const missingExplanation = ["EXPLAINED_RATE_AND_FEES", "EXPLAINED_PENALTY"]
    .filter((code) => answers[code] === "NO" || answers[code] === "PARTIAL");
  const notUnderstood = answers.UNDERSTOOD_TERMS === "NO" || answers.UNDERSTOOD_TERMS === "PARTIAL";

  let result: AftercareResult = "NORMAL_MANAGEMENT";

  if (mismatch) {
    result = "CORRECTION_OR_INQUIRY";
    reasons.push("계약서가 설명과 다른 부분이 있다고 답하셨습니다. 차이가 난 조건과 적용 시점을 서면으로 확인하고 정정을 문의하세요. 이 답변만으로 위법이나 사칭이 확인된 것은 아닙니다.");
    actions.push(ACTIONS.REQUEST_WRITTEN_EXPLANATION, ACTIONS.ASK_OFFICIAL_CHANNEL);
  } else if ((args.contractTextDifferences ?? 0) > 0) {
    result = "CORRECTION_OR_INQUIRY";
    reasons.push(`이전 권유와 다른 계약 문구가 ${args.contractTextDifferences}건 있습니다. 문구 차이가 실제 조건 변경인지 서면으로 확인해 주세요.`);
    actions.push(ACTIONS.REQUEST_WRITTEN_EXPLANATION, ACTIONS.ASK_OFFICIAL_CHANNEL);
  } else if (contradictedClaims > 0) {
    result = "CORRECTION_OR_INQUIRY";
    reasons.push(`거래 전 확인에서 공식 자료와 다른 항목이 ${contradictedClaims}건 있었습니다.`);
    actions.push(ACTIONS.ASK_OFFICIAL_CHANNEL);
  } else if (missingExplanation.length > 0 || pressured) {
    result = "CORRECTION_OR_INQUIRY";
    if (missingExplanation.length > 0) reasons.push("설명을 다 듣지 못한 항목이 있습니다.");
    if (pressured) reasons.push("충분히 보지 못한 채 서명하셨다고 답하셨습니다.");
    actions.push(ACTIONS.REQUEST_WRITTEN_EXPLANATION, ACTIONS.ASK_OFFICIAL_CHANNEL);
  } else if (notUnderstood) {
    result = "ADDITIONAL_EXPLANATION";
    reasons.push("설명은 들으셨지만 이해되지 않은 부분이 남아 있습니다.");
    actions.push(ACTIONS.REQUEST_WRITTEN_EXPLANATION);
  } else if (Object.keys(answers).length < QUESTIONS.length || answers.CONTRACT_MATCHES_EXPLANATION === "UNKNOWN") {
    result = "ADDITIONAL_EXPLANATION";
    reasons.push("확인하지 못한 설명·계약 항목이 남아 있습니다.");
    actions.push(ACTIONS.REQUEST_WRITTEN_EXPLANATION);
  } else {
    reasons.push("설명과 계약 내용에서 지금 조치가 필요한 부분은 나오지 않았습니다.");
  }

  if (answers.HAS_CONTRACT_COPY === "NO") {
    reasons.push("계약서 사본이 없다고 답하셨습니다. 금융회사에 사본을 요청하세요.");
  }
  if (Object.keys(answers).length < QUESTIONS.length) {
    reasons.push("답하지 않은 항목은 확인하지 못한 것으로 남깁니다. 이 결과는 답하신 범위까지입니다.");
  }

  const summary = `${reasons[0]} 이 결과는 답하신 내용과 이미 확정된 검증 결과만 보고 정한 것입니다.`;
  return { result, summary_masked: summary.slice(0, 4000), actions, reasons };
};

/** 저장된 행동 코드를 표시 문구로 바꾼다. 과거 결과를 재판정하지 않는다. */
export const aftercareAction = (code: string): PlannedAction | null => ACTIONS[code] ?? null;
