/**
 * ① 상담 계층 (F-301·302·308 · SR-401).
 *
 * **원문을 보는 유일한 계층이다.** 여기서 나가는 것은 확정 슬롯과 정제
 * 사실관계뿐이며, 마스킹된 원문조차 아래로 내려가지 않는다 (권한 매트릭스).
 *
 * 하는 일 셋:
 *   - 진술에서 슬롯 값을 뽑는다 (열거 밖 값은 F-605가 막는다)
 *   - 부족하면 **한 번에 하나만** 되묻는다 (A11Y-4)
 *   - 판단에 쓸 **정제 사실관계**를 만든다 — 감정·추측·요구를 제외한 사실 문장
 *
 * 범위 밖 요청은 여기서 거절한다 (F-604). 금융 분쟁이 아닌 상담이 아래로
 * 내려가면 도구도 판단도 의미가 없다.
 */

import "server-only";
import { z } from "zod";
import { callStructured, type Effort } from "./model";
import { PRODUCT_CODES, SLOT_CHANNELS, SLOT_TRAITS, type Slots } from "../types";
import { applySlots, nextQuestion, slotStatus } from "./slots";
import type { ConsultInput, RefinedFacts } from "./types";

const EFFORT: Effort = "medium";

/**
 * 슬롯 추출 결과. 모델이 **모르는 값을 지어내지 않도록** 전부 optional이며,
 * 확신이 없으면 비우도록 프롬프트에서 지시한다.
 */
const ConsultOutput = z.object({
  /** 금융 분쟁·소비자보호 범위 안의 상담인지 (F-604) */
  inScope: z.boolean(),
  /**
   * 범위 밖 사유. 화면에는 쓰지 않는다 — 모델이 쓴 사유를 그대로 보여주면
   * 틀렸을 때 고칠 방법이 없다. 판정 근거를 명시하게 만들어 boolean의 품질을
   * 올리는 것이 이 필드의 목적이다.
   */
  outOfScopeReason: z.string().nullable(),

  /** 진술에서 확실히 읽어낸 슬롯만. 추측한 값은 넣지 않는다 */
  slots: z.object({
    channel: z.enum(SLOT_CHANNELS).nullable(),
    age: z.number().int().nullable(),
    product: z.enum(PRODUCT_CODES).nullable(),
    contract_ym: z.string().nullable(),
    traits: z.array(z.enum(SLOT_TRAITS)).nullable(),
    confirm_call: z.enum(["Y", "N", "UNKNOWN"]).nullable(),
    survey_writer: z.enum(["SELF", "SALES", "UNKNOWN"]).nullable(),
    explained_loss: z.enum(["Y", "N", "UNKNOWN"]).nullable(),
  }),

  /** 쟁점 태그 (issue_tags.code). 조사·판단이 이걸로 움직인다 */
  issues: z.array(z.string()),

  /** 정제 사실관계 — 판단 계층이 읽을 유일한 사실 서술 */
  facts: z.array(z.string()),

  /** 진술에서 확인되지 않은 것. 판단 결과에 함께 표시된다 (기획서 9.2) */
  unresolved: z.array(z.string()),
});

export type ConsultResult =
  | { kind: "OUT_OF_SCOPE"; message: string }
  | {
      kind: "ASK";
      /** 되물을 슬롯 하나 */
      slot: string;
      question: string;
      slots: Partial<Slots>;
      issues: string[];
    }
  | {
      kind: "READY";
      slots: Partial<Slots>;
      facts: RefinedFacts;
    };

const SYSTEM = `당신은 금융 불완전판매 분쟁 상담의 첫 단계를 맡는다.
이용자의 진술에서 사실을 추려내고, 판단에 필요한 항목이 빠졌으면 하나만 되묻는다.

## 하지 않는 것
- 판단하지 않는다. 배상 가능성·승소 여부를 말하지 않는다.
- 법률 자문을 하지 않는다.
- 진술에 없는 값을 채우지 않는다. 확실하지 않으면 반드시 비워 둔다(null).

## 슬롯
- channel: TM(전화) BANCA_HS(방카슈랑스·홈쇼핑) AGENT(모집인·설계사) BRANCH(창구·대면) ONLINE(온라인·모바일) UNKNOWN
  방카슈랑스는 은행에서 파는 **보험**이다. 은행 창구에서 판 ELS·펀드·대출은 BRANCH다.
- age: 가입 당시 만 나이. 지금 나이가 아니다. 둘이 다르면 가입 당시를 쓴다.
- product: 상품군 코드. 보험 INS_*, 투자 INV_*, 은행 BNK_*, 분류 불가 ETC_UNKNOWN
- contract_ym: 가입 연월 YYYY-MM. 연도만 알면 비워 둔다.
- traits: PRO(전문투자자) ELDER(고령) INEXP(투자경험 부족) CAPACITY(의사능력 제약) NONE
  ELDER는 나이에서 자동 계산되므로 직접 넣지 않는다.
- confirm_call: 사후확인콜(해피콜) 여부 Y/N/UNKNOWN
- survey_writer: 적합성 설문을 누가 작성했는지 SELF(본인)/SALES(판매자)/UNKNOWN
- explained_loss: 원금손실 가능성 설명을 들었는지 Y/N/UNKNOWN

## 쟁점 태그
진술에 나타난 쟁점만 고른다. 없으면 빈 배열.
설명의무 적합성원칙 부당권유 고지의무위반 약관해석 보험금지급범위 면책사유 과실상계 사기기망취소 착오취소

## 정제 사실관계(facts)
- 판단에 필요한 **사실만** 짧은 문장으로 나열한다.
- 감정 표현, 추측, 요구사항, 상대에 대한 평가는 제외한다.
- 이용자가 말하지 않은 것을 추가하지 않는다.
- 예: "2019년 5월 전화로 종신보험에 가입했다", "원금 손실 가능성 설명을 듣지 못했다고 진술한다"

## 확인되지 않은 것(unresolved)
진술만으로는 알 수 없는데 판단에 영향을 주는 항목을 적는다.
예: "약관 교부 여부", "설명 확인서 서명 여부"

## 범위 판정
금융상품 가입·판매 과정의 분쟁이 아니면 inScope=false로 하고 사유를 한 문장으로 적는다.`;

/** 되묻기 문구 — 선택지 버튼으로 렌더되므로 질문만 준다 (A11Y-4·화면 4.2) */
const QUESTIONS: Record<string, string> = {
  product: "어떤 상품에 가입하셨나요?",
  contract_ym: "언제 가입하셨나요? (연도와 월)",
  channel: "어떤 경로로 가입하셨나요?",
  age: "가입하실 당시 나이가 어떻게 되셨나요?",
  traits: "가입 당시 상황에 해당하는 것이 있으신가요?",
  confirm_call: "가입 후에 보험사에서 확인 전화(해피콜)를 받으셨나요?",
  survey_writer: "투자자 성향 설문지는 누가 작성했나요?",
  explained_loss: "원금이 손실될 수 있다는 설명을 들으셨나요?",
};

const OUT_OF_SCOPE_MESSAGE =
  "프리케이스는 금융상품 가입·판매 과정에서 생긴 분쟁만 다룹니다. " +
  "말씀하신 내용은 그 범위 밖이라 도움을 드리기 어렵습니다. " +
  "금융 관련 상담은 금융감독원 1332로 문의하실 수 있습니다.";

/**
 * 상담 user 프롬프트를 만든다. **테스트가 이 함수를 직접 호출한다** —
 * 유보 이어가기 블록이 재진입에만 붙고 신규 상담에는 붙지 않는 것,
 * 그리고 SYSTEM이 아니라 user에만 붙는 것(9/1 슬롯 측정과 신규 경로에
 * 영향이 없어야 한다)을 완성된 프롬프트로 검사해야 한다.
 */
export function buildConsultUser(input: ConsultInput): string {
  const known = Object.entries(input.slots)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");

  // 유보 이어가기 (F-308 확장) — 판단 결론·확신도는 여기 없다 (ConsultInput 주석).
  // 이전 사실관계를 넘기는 이유: 재진입 진술은 보탠 내용만 담고 있어, 이것 없이
  // 정제하면 READY에서 facts가 새 진술만으로 덮여 이전 사실이 유실된다.
  const reentry = input.reentry
    ? [
        `\n\n## 이어가기 — 직전 상담에서 정리된 사실관계`,
        input.reentry.priorFacts.statements.map((x) => `- ${x}`).join("\n"),
        `\n확인이 필요하다고 안내한 자료:`,
        input.reentry.needed.map((x) => `- ${x}`).join("\n"),
        `\n위 사실관계를 유지하면서, 이번 진술이 보태는 사실을 반영해 facts를 갱신하라.`,
        `이번 진술과 모순되는 항목만 고치고, 나머지는 그대로 둔다.`,
        `안내한 자료가 확인됐다면 unresolved에서 지우고 확인된 사실로 옮겨 적는다.`,
      ].join("\n")
    : "";

  return [
    `이용자 진술:\n${input.maskedStatement}`,
    known ? `\n이미 확인된 슬롯: ${known}` : "",
    reentry,
  ].join("");
}

export async function consult(
  input: ConsultInput,
  /** 슬롯 검증 실패를 실행 로그에 남기기 위한 콜백 (F-402 · EP-6) */
  onReject?: (errors: string[]) => void,
): Promise<ConsultResult> {
  const out = await callStructured({
    system: SYSTEM,
    user: buildConsultUser(input),
    schema: ConsultOutput,
    effort: EFFORT,
  });

  if (!out.inScope) {
    return { kind: "OUT_OF_SCOPE", message: OUT_OF_SCOPE_MESSAGE };
  }

  // null을 걷어내 부분 슬롯으로 만든다. 모델이 비운 값은 「모른다」이지
  // 「UNKNOWN이라고 답했다」가 아니므로 슬롯에 넣지 않는다.
  const patch: Partial<Slots> = {};
  const s = out.slots;
  if (s.channel) patch.channel = s.channel;
  if (s.age !== null) patch.age = s.age;
  if (s.product) patch.product = s.product;
  if (s.contract_ym) patch.contract_ym = s.contract_ym;
  if (s.traits?.length) patch.traits = s.traits;
  if (s.confirm_call) patch.confirm_call = s.confirm_call;
  if (s.survey_writer) patch.survey_writer = s.survey_writer;
  if (s.explained_loss) patch.explained_loss = s.explained_loss;

  // 병합은 반드시 applySlots를 거친다 — 열거 밖 값 차단(F-605)과 ELDER 자동
  // 파생이 거기에 들어 있다. 직접 spread하면 둘 다 건너뛴다.
  const applied = applySlots(input.slots, patch);
  if (!applied.ok) {
    // 모델이 열거 밖 값을 냈다. 값을 버리고 기존 슬롯으로 계속 간다 (EX-101).
    onReject?.(applied.errors);
  }
  const merged = applied.ok ? applied.slots : input.slots;
  const status = slotStatus(merged, out.issues);

  if (!status.complete) {
    const slot = nextQuestion(status)!;
    return {
      kind: "ASK",
      slot,
      question: QUESTIONS[slot] ?? "한 가지만 더 여쭤보겠습니다.",
      slots: merged,
      issues: out.issues,
    };
  }

  return {
    kind: "READY",
    slots: merged,
    facts: { statements: out.facts, issues: out.issues, unresolved: out.unresolved },
  };
}
