/**
 * 가입 전 브리핑 — 판매자에게 확인할 질문과 멈춤 신호 (R-06 · SR-202 확장).
 *
 * **문장은 전부 코드 상수다.** S-12 점검표(checklist-points)와 같은 규약 —
 * 모델을 부르지 않고, 어떤 문장을 보여줄지는 **도구가 반환한 쟁점**과 확정
 * 슬롯(상품군·채널)이 정한다. 도구가 돌려주지 않은 쟁점의 질문은 나올 수 없다.
 *
 * 질문·신호는 공개 조정례에서 반복된 분쟁 패턴을 소비자 행동으로 역산한
 * 것이다. 각 항목에 어느 쟁점·경로에서 왔는지(basis)를 붙여 화면이 근거를
 * 함께 보이게 한다 — 출처 없는 조언 문장을 만들지 않는다.
 *
 * 표현 규칙(P-2·S-02 금지사항): 특정 상품 권유·비권유 없음, 단정 없음,
 * 판매자를 잠재 가해자로 단정하는 톤 금지 — 질문은 확인 요청의 형태를 지킨다.
 */

import type { ProductCode, SlotChannel } from "../types";

export type BriefItem = {
  text: string;
  /** 어느 쟁점·경로 때문에 나온 항목인지 — 화면에 근거로 병기한다 */
  basis: string;
};

/** 상품군 대분류 — 문장 발동 조건에만 쓴다 */
function group(product: ProductCode): "INS" | "INV" | "BNK" | "ETC" {
  if (product.startsWith("INS_")) return "INS";
  if (product.startsWith("INV_")) return "INV";
  if (product.startsWith("BNK_")) return "BNK";
  return "ETC";
}

/** 어떤 조합에서도 나오는 기본 질문 — 해지·비용은 전 상품군 공통의 다툼 지점이다 */
const BASE_QUESTIONS: BriefItem[] = [
  {
    text: "중간에 해지하면 얼마를 돌려받나요? 수수료나 공제되는 금액을 알려주세요.",
    basis: "공통",
  },
  {
    text: "지금 설명하신 내용이 적힌 자료를 받아볼 수 있나요?",
    basis: "공통 — 설명 자료는 나중에 다툼이 생기면 기준 문서가 됩니다",
  },
];

/** 쟁점 태그(부록 A 31종의 부분집합) → 판매자에게 확인할 질문 */
const ISSUE_QUESTIONS: Record<string, string[]> = {
  설명의무: [
    "원금을 잃을 수 있는 상품인가요? 최대 얼마까지 잃을 수 있나요?",
  ],
  부당권유: [
    "「원금 보장」이나 「확정 수익」이라는 말씀은 서면으로 남겨 주실 수 있나요?",
  ],
  적합성원칙: [
    "이 상품이 제 성향 진단 결과와 맞는지 확인해 주세요. 성향 설문은 제가 직접 작성하겠습니다.",
  ],
  고지의무위반: [
    "제가 미리 알려야 하는 것(병력·직업 등)은 어디까지인가요? 빠뜨리면 어떻게 되나요?",
  ],
  약관해석: [
    "이 보장(계약)의 정의가 적힌 약관 조항을 함께 확인해 주세요.",
  ],
  보험금지급범위: [
    "보험금이 지급되지 않는 경우는 어떤 경우인가요?",
  ],
  면책사유: [
    "보험금이 지급되지 않는 경우는 어떤 경우인가요?",
  ],
};

/** 판매 경로별 질문 — 경로마다 「설명을 들었다」가 남는 곳이 다르다 (F-203과 같은 원리) */
const CHANNEL_QUESTIONS: Partial<Record<SlotChannel, BriefItem>> = {
  TM: {
    text: "이 통화는 녹음되나요? 나중에 녹음본을 요청하면 받을 수 있나요?",
    basis: "전화 가입 — 설명 내용이 통화에만 남습니다",
  },
  BANCA_HS: {
    text: "이 상품은 예금이 아니라는 뜻인가요? 예금자 보호가 되나요?",
    basis: "은행 창구·홈쇼핑 판매 — 예금으로 오인한 분쟁이 반복됩니다",
  },
  BRANCH: {
    text: "지금 서명하는 서류가 각각 무엇인지 하나씩 알려주세요.",
    basis: "창구 가입 — 서명한 서류가 나중에 설명 여부의 증거가 됩니다",
  },
  AGENT: {
    text: "설계사님을 거치지 않고 회사에 직접 확인할 수 있는 창구가 있나요?",
    basis: "설계사 가입 — 전달 과정의 어긋남을 확인할 길이 필요합니다",
  },
  ONLINE: {
    text: "최종 가입 조건이 지금 화면의 설명과 같은가요? 이 화면을 저장해 두겠습니다.",
    basis: "온라인 가입 — 가입 시점 화면이 곧 설명 자료입니다",
  },
};

/** 멈춤 신호 — 이런 상황이 조정례에서 분쟁으로 이어졌다. when 조건이 맞을 때만 보인다 */
const STOP_SIGNALS: {
  text: string;
  basis: string;
  when: (ctx: { issues: Set<string>; g: ReturnType<typeof group> }) => boolean;
}[] = [
  {
    text: "「무조건」·「100%」·「원금 보장」이라는 말과 함께 권할 때",
    basis: "부당권유 분쟁의 반복 패턴",
    when: ({ issues, g }) => issues.has("부당권유") || issues.has("설명의무") || g === "INV",
  },
  {
    text: "성향 설문이나 확인서를 판매자가 대신 작성해 주겠다고 할 때",
    basis: "적합성 원칙 분쟁의 반복 패턴",
    when: ({ issues, g }) => issues.has("적합성원칙") || g === "INV",
  },
  {
    text: "확인 전화(해피콜)가 오면 「무조건 예라고 하라」고 미리 안내할 때",
    basis: "설명의무 분쟁에서 확인 전화 녹취가 소비자에게 불리하게 쓰인 패턴",
    when: ({ g }) => g === "INS",
  },
  {
    text: "설명 자료 없이 서명부터 요구할 때",
    basis: "설명의무 분쟁의 반복 패턴",
    when: ({ issues }) => issues.has("설명의무") || issues.has("약관해석"),
  },
  {
    text: "지금 결정하지 않으면 조건이 사라진다며 서두르게 할 때",
    basis: "부당권유 분쟁의 반복 패턴",
    when: ({ issues, g }) => issues.has("부당권유") || g === "INV",
  },
];

export type Briefing = { questions: BriefItem[]; signals: BriefItem[] };

/**
 * 도구가 반환한 쟁점과 확정 슬롯으로 브리핑을 조립한다.
 *
 * `issues`는 `analyze_risk_pattern` 반환값의 쟁점 코드다 — 집계에 없는 쟁점의
 * 질문은 여기서 걸러져 나오지 않는다. 쟁점이 하나도 없어도(집계 폴백·무자료)
 * 기본 질문과 경로 질문은 성립한다 — 그것들은 쟁점이 아니라 공통·경로 근거다.
 */
export function buildBriefing(input: {
  product: ProductCode;
  channel?: SlotChannel;
  issues: readonly string[];
}): Briefing {
  const g = group(input.product);
  const issues = new Set(input.issues);

  const questions: BriefItem[] = [...BASE_QUESTIONS];
  const seen = new Set(questions.map((q) => q.text));
  for (const issue of input.issues) {
    for (const text of ISSUE_QUESTIONS[issue] ?? []) {
      if (seen.has(text)) continue; // 면책사유·보험금지급범위처럼 같은 질문으로 수렴하는 쟁점
      seen.add(text);
      questions.push({ text, basis: `이 조합의 「${issue}」 분쟁 대비` });
    }
  }
  const ch = input.channel && input.channel !== "UNKNOWN" ? CHANNEL_QUESTIONS[input.channel] : undefined;
  if (ch) questions.push(ch);

  const signals = STOP_SIGNALS.filter((s) => s.when({ issues, g })).map(({ text, basis }) => ({
    text,
    basis,
  }));

  return { questions, signals };
}
