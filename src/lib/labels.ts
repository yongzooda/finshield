/**
 * 열거값의 한국어 표기 — 화면 전용 어휘집.
 *
 * 열거 **정의**는 `types.ts`에 있고 여기엔 표기만 둔다. 두 곳에 값을 적는 게
 * 아니라, `Record<ProductCode, string>` 형태라 **코드가 늘거나 줄면 빌드가 깨진다**
 * (기능 명세 2.3 "열거 변경 시 네 문서 동시 갱신"의 코드 쪽 안전장치).
 *
 * 표기는 기능 명세 2.1·2.3 표를 그대로 옮긴 것이다. 임의로 다듬지 않는다 —
 * 화면 문구와 명세 용어가 어긋나면 심사에서 같은 것을 두 이름으로 읽게 된다.
 */

import type { ProductCode, SlotChannel, SlotTrait } from "./types";
import type { JudgmentOutcome } from "./agents/types";

/**
 * 유보 사유 문구 (F-307) — 실패·오류 톤을 쓰지 않는다.
 *
 * 판단 결과 화면(「왜 유보했는지」)과 ④ 안내 계층(`guideWithheld`)이 같은 문장을
 * 쓴다. 이전에는 두 곳이 서로 다른 문장을 따로 들고 있었고 화면에는 이쪽만
 * 나가고 있었다 — 정본은 여기 하나다.
 */
export const WITHHELD_REASON_TEXTS: Record<
  Extract<JudgmentOutcome, { kind: "WITHHELD" }>["reason"],
  string
> = {
  LOW_CONFIDENCE:
    "근거를 모아 살펴봤지만 서로 다른 방향을 가리켜, 한쪽으로 결론 내리기에는 이릅니다.",
  INSUFFICIENT_EVIDENCE:
    "이 사건과 견줄 만한 선례와 법령을 충분히 찾지 못했습니다.",
  TOOL_BUDGET:
    "한 번에 확인할 수 있는 자료의 양을 다 썼습니다. 자료를 보태 다시 살펴보면 더 정확해집니다.",
  FORMAT_ERROR:
    "결과를 정리하는 과정에서 확인이 필요한 부분이 생겼습니다.",
};

export const PRODUCT_LABELS: Record<ProductCode, string> = {
  INS_SILSON: "실손보험",
  INS_WHOLE: "종신보험",
  INS_ANNUITY: "연금보험",
  INS_SAVINGS: "저축성보험",
  INS_AUTO: "자동차보험",
  INS_ETC: "기타 보험",
  INV_ELS: "ELS·파생결합",
  INV_FUND: "펀드·신탁",
  INV_MARGIN: "신용거래·반대매매",
  INV_ETC: "기타 투자상품",
  BNK_LOAN: "근저당·대출",
  BNK_ETC: "기타 은행상품",
  ETC_UNKNOWN: "기타·잘 모르겠음",
};

export const CHANNEL_LABELS: Record<SlotChannel, string> = {
  TM: "전화(TM)",
  BANCA_HS: "방카슈랑스·홈쇼핑",
  AGENT: "모집인·설계사",
  BRANCH: "창구·대면",
  ONLINE: "온라인·모바일",
  UNKNOWN: "잘 모르겠음",
};

/**
 * 상품군의 업권 묶음 (기능 명세 2.3 업권 2단 구조).
 *
 * `SECTORS`(DB 업권 5종)와 다른 축이다 — 이쪽은 **상품군 13종을 사람이 고를 수
 * 있게 묶은 것**이고, DB의 `sector`는 사건에 붙은 분류다. CARD 업권에 대응하는
 * 상품군 코드가 없다는 점도 두 축이 다르다는 근거다.
 */
export const PRODUCT_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  products: readonly ProductCode[];
}> = [
  // 보험이 먼저다 — 1차 적용 영역이고 기본 노출 대상이다 (기능 명세 2.3 U-7)
  { key: "INS", label: "보험", products: ["INS_SILSON", "INS_WHOLE", "INS_ANNUITY", "INS_SAVINGS", "INS_AUTO", "INS_ETC"] },
  { key: "INV", label: "금융투자", products: ["INV_ELS", "INV_FUND", "INV_MARGIN", "INV_ETC"] },
  { key: "BNK", label: "은행·여신", products: ["BNK_LOAN", "BNK_ETC"] },
  { key: "ETC", label: "그 밖에", products: ["ETC_UNKNOWN"] },
];

/** 기본으로 펼쳐 보여줄 업권 (기능 명세 2.3 — 보험 기본 노출) */
export const DEFAULT_PRODUCT_GROUP = "INS";

// ─────────────────────────────────────── 되묻기 답변 형식 (S-03)

/** 소비자 특성 표기 — ELDER는 나이에서 파생되므로 선택지에 두지 않는다 */
export const TRAIT_LABELS: Record<Exclude<SlotTrait, "ELDER">, string> = {
  PRO: "전문투자자입니다",
  INEXP: "투자 경험이 거의 없습니다",
  CAPACITY: "판단이 어려운 사정이 있었습니다",
  NONE: "해당 없음",
};

export const YES_NO_LABELS: Record<"Y" | "N" | "UNKNOWN", string> = {
  Y: "네",
  N: "아니요",
  UNKNOWN: "기억나지 않습니다",
};

export const SURVEY_WRITER_LABELS: Record<"SELF" | "SALES" | "UNKNOWN", string> = {
  SELF: "제가 직접 작성했습니다",
  SALES: "판매하는 분이 작성했습니다",
  UNKNOWN: "기억나지 않습니다",
};

/**
 * 되묻기 질문의 답변 형식.
 *
 * 열거형은 **선택지 버튼**으로만 받는다 — 자유 입력을 두면 오입력이 슬롯 검증
 * (F-605)에서 튕겨 되묻기가 반복된다. 「모름」은 상시 제공한다(CLAUDE.md 접근성).
 */
export type AnswerForm =
  | { kind: "choice"; options: { value: string; label: string }[] }
  /** 상품군은 13종이라 업권 2단으로 나눠 고른다 (S-02와 같은 구조) */
  | { kind: "product" }
  | { kind: "number"; min: number; max: number; unit: string }
  | { kind: "month" }
  | { kind: "multi"; options: { value: string; label: string }[] };

const opt = <T extends string>(m: Record<T, string>) =>
  (Object.keys(m) as T[]).map((value) => ({ value, label: m[value] }));

export function answerFormFor(slot: string): AnswerForm | null {
  switch (slot) {
    case "channel":
      return { kind: "choice", options: opt(CHANNEL_LABELS) };
    case "product":
      return { kind: "product" };
    case "age":
      return { kind: "number", min: 19, max: 120, unit: "세" };
    case "contract_ym":
      return { kind: "month" };
    case "traits":
      return { kind: "multi", options: opt(TRAIT_LABELS) };
    case "confirm_call":
    case "explained_loss":
      return { kind: "choice", options: opt(YES_NO_LABELS) };
    case "survey_writer":
      return { kind: "choice", options: opt(SURVEY_WRITER_LABELS) };
    default:
      return null;
  }
}
