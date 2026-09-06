/**
 * 금융 프로필 범주.
 *
 * 금액과 잔액을 그대로 받지 않는다. 적합성을 판단하는 데 필요한 것은 구간이지
 * 정확한 숫자가 아니다. 숫자를 받으면 지켜야 할 것이 늘고, 새는 곳도 는다
 * (AUTH-006).
 *
 * 각 항목에는 왜 묻는지를 함께 둔다. 화면이 그 문장을 그대로 보여 준다.
 * 모든 항목은 건너뛸 수 있고, 건너뛰면 적합성 축만 판단을 미룬다 (AUTH-007).
 */

export const PROFILE_SCHEMA_VERSION = "v1";

export type ProfileField = {
  key: ProfileKey;
  label: string;
  why: string;
  options: { value: string; label: string }[];
};

export type ProfileKey =
  | "income_band" | "debt_burden_band" | "emergency_fund_band"
  | "purpose_code" | "horizon_code" | "liquidity_need" | "loss_tolerance";

const SKIP = { value: "UNSPECIFIED", label: "답하지 않음" };

export const PROFILE_FIELDS: readonly ProfileField[] = Object.freeze([
  {
    key: "income_band",
    label: "월 소득 구간",
    why: "갚을 수 있는 범위를 넘는 조건인지 보기 위해 구간만 받습니다.",
    options: [
      { value: "BAND_1", label: "200만원 미만" },
      { value: "BAND_2", label: "200만원 이상 350만원 미만" },
      { value: "BAND_3", label: "350만원 이상 500만원 미만" },
      { value: "BAND_4", label: "500만원 이상" },
      SKIP,
    ],
  },
  {
    key: "debt_burden_band",
    label: "지금의 빚 부담",
    why: "새 대출이 기존 상환에 얹히는지 보기 위해 부담 정도만 받습니다.",
    options: [
      { value: "NONE", label: "없음" },
      { value: "LOW", label: "낮음" },
      { value: "MEDIUM", label: "보통" },
      { value: "HIGH", label: "높음" },
      SKIP,
    ],
  },
  {
    key: "emergency_fund_band",
    label: "비상 자금",
    why: "갑자기 돈이 필요할 때 버틸 수 있는지 보기 위해 기간만 받습니다.",
    options: [
      { value: "BAND_0", label: "거의 없음" },
      { value: "BAND_1", label: "한 달 치 미만" },
      { value: "BAND_2", label: "한 달에서 세 달 치" },
      { value: "BAND_3", label: "세 달 치 이상" },
      SKIP,
    ],
  },
  {
    key: "purpose_code",
    label: "이번 거래의 목적",
    why: "목적과 상품이 맞는지 보기 위해 받습니다.",
    options: [
      { value: "LOAN_REFINANCE", label: "기존 대출 정리" },
      { value: "LOAN_LIVING", label: "생활 자금" },
      { value: "LOAN_BUSINESS", label: "사업 자금" },
      { value: "SAVINGS", label: "목돈 마련" },
      { value: "INVESTMENT", label: "투자" },
      SKIP,
    ],
  },
  {
    key: "horizon_code",
    label: "예상 기간",
    why: "기간과 상품 조건이 맞는지 보기 위해 받습니다.",
    options: [
      { value: "SHORT", label: "1년 이내" },
      { value: "MEDIUM", label: "1년에서 3년" },
      { value: "LONG", label: "3년 이상" },
      SKIP,
    ],
  },
  {
    key: "liquidity_need",
    label: "중간에 돈을 찾을 필요",
    why: "중도 해지·상환 조건이 문제가 되는지 보기 위해 받습니다.",
    options: [
      { value: "LOW", label: "낮음" },
      { value: "MEDIUM", label: "보통" },
      { value: "HIGH", label: "높음" },
      SKIP,
    ],
  },
  {
    key: "loss_tolerance",
    label: "손실을 견딜 수 있는 정도",
    why: "원금이 줄어들 수 있는 상품인지 볼 때 씁니다.",
    options: [
      { value: "LOW", label: "낮음" },
      { value: "MEDIUM", label: "보통" },
      { value: "HIGH", label: "높음" },
      SKIP,
    ],
  },
]);

export type ProfileValues = Record<ProfileKey, string>;

export const EMPTY_PROFILE: ProfileValues = Object.freeze({
  income_band: "UNSPECIFIED",
  debt_burden_band: "UNSPECIFIED",
  emergency_fund_band: "UNSPECIFIED",
  purpose_code: "UNSPECIFIED",
  horizon_code: "UNSPECIFIED",
  liquidity_need: "UNSPECIFIED",
  loss_tolerance: "UNSPECIFIED",
});

/** 범주 밖의 값은 받지 않는다. 자유 입력이 그대로 저장되는 자리를 만들지 않는다. */
export const normalizeProfile = (input: unknown): ProfileValues | null => {
  if (input === null || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const field of PROFILE_FIELDS) {
    const value = source[field.key];
    if (value === undefined || value === null) { out[field.key] = "UNSPECIFIED"; continue; }
    if (typeof value !== "string") return null;
    if (!field.options.some((option) => option.value === value)) return null;
    out[field.key] = value;
  }
  return out as ProfileValues;
};

export const completenessOf = (values: ProfileValues): "SKIPPED" | "PARTIAL" | "COMPLETE" => {
  const answered = PROFILE_FIELDS.filter((field) => values[field.key] !== "UNSPECIFIED").length;
  if (answered === 0) return "SKIPPED";
  return answered === PROFILE_FIELDS.length ? "COMPLETE" : "PARTIAL";
};

/** 적합성 축을 판단할 수 있는지. 하나도 답하지 않았으면 판단하지 않는다. */
export const usableForSuitability = (values: ProfileValues | null): boolean =>
  values !== null && completenessOf(values) !== "SKIPPED";
