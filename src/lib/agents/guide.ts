/**
 * ④ 안내 계층 (F-306 · F-307 · SR-204).
 *
 * **판단을 바꾸지 않는다.** 입력은 `Readonly<Judgment>`이고, 결론·확신도·
 * 판단이 달라지는 조건은 그대로 통과시킨다. 이 계층이 하는 일은 표현 변환뿐이다.
 *
 * 「위반 가능성 낮음」일 때 반드시 들어가야 하는 네 가지가 있다 (기획서 9.5):
 *   ① 분쟁조정 신청권은 이용자에게 있다
 *   ② 금융감독원 1332 안내
 *   ③ 신청을 말리는 표현 금지
 *   ④ 판단이 달라지는 조건 제시
 *
 * 이걸 프롬프트로만 요구하면 어느 날 조용히 빠진다. 그래서 **①②④는 코드가
 * 붙이고, ③은 코드가 검사한다.** 모델은 사실관계 설명 문단만 쓴다 — 필수 항목이
 * 모델의 성실성에 걸리지 않게 하는 것이 이 설계의 요점이다.
 */

import "server-only";
import { callText, ModelFormatError } from "./model";
import { stripUnbackedCitations } from "./citations";
import { citation } from "../tools/search_case";
import { WITHHELD_REASON_TEXTS } from "../labels";
import type { Trace } from "./trace";
import type { GuideInput, JudgmentOutcome } from "./types";

/** ② 금감원 안내 — 문구를 한 곳에서만 관리한다 */
export const FSS_CONTACT =
  "금융감독원 금융민원센터 1332(평일 09:00~18:00)로 상담·분쟁조정을 신청하실 수 있습니다.";

/** ① 신청권 고지 — 결론이 「낮음」이어도 신청 여부는 이용자가 정한다 */
export const RIGHT_TO_APPLY =
  "이 결과와 관계없이 분쟁조정을 신청할 권리는 이용자 본인에게 있습니다. " +
  "프리케이스의 판단은 참고 자료일 뿐이며, 신청 여부를 대신 결정하지 않습니다.";

/**
 * ③ 신청을 말리는 표현. 모델 문장에 이런 게 섞이면 잘라낸다.
 * 「권하지 않습니다」류를 완곡하게 쓰는 경우가 많아 어미까지 넓게 잡는다.
 */
const DISCOURAGING: RegExp[] = [
  /신청\s*(?:하지|을?\s*하지)\s*(?:마|않)/,
  /신청\s*(?:해도|하셔도)\s*(?:소용|의미|실익)/,
  /신청\s*(?:할|하실)\s*(?:필요|실익)\s*(?:는?\s*)?(?:없|적)/,
  /(?:권|추천)\s*(?:하지|해\s*드리지)\s*않/,
  /(?:포기|단념)\s*(?:하|하시)/,
  // 「시간과 비용만 낭비」처럼 사이에 조사·부사가 끼는 형태가 흔하다
  /(?:시간|비용|돈)[^.。]{0,12}낭비/,
  /무의미\s*합?니/,
  /가능성이\s*(?:거의\s*)?없으므로/,
];

export type GuideResult = {
  /** 한 줄 요약. 결론 문구는 판단 결과에서 그대로 온다 */
  headline: string;
  /** 모델이 쓴 설명 문단 (말리는 표현은 제거된 상태) */
  explanation: string;
  /** 판단이 달라지는 조건 — 판단 결과를 그대로 전달한다 (④) */
  changesIf: readonly string[];
  /** 다음 단계 안내. ①② 고정 문구가 항상 포함된다 */
  nextSteps: string[];
  /**
   * 판단에 필요한 자료 (F-307). **문장에 접어 넣지 않고 항목으로 둔다** —
   * 실주행에서 6개 항목이 한 줄로 뭉쳐 나왔다. 고령 이용자가 읽을 수 없다.
   */
  needed: string[];
  /** 준비할 자료 (F-309) */
  documents: { label: string; why: string }[];
  /** 참고 조정례 인용 표기 — 판단 근거가 아니라 참고 자료다 (기획서 6.5) */
  referenceCases: string[];
  /** ③ 위반이 검출돼 잘라낸 문장 수. 0이 아니면 실행 로그에 남는다 */
  removed: number;
};

const CONCLUSION_LABEL: Record<"LIKELY" | "UNLIKELY", string> = {
  LIKELY: "위반 가능성 높음",
  UNLIKELY: "위반 가능성 낮음",
};

const SYSTEM = `당신은 이미 내려진 판단을 이용자에게 설명하는 역할이다.
고령 이용자가 읽는다고 생각하고 쓴다.

## 절대 규칙
- **판단을 바꾸지 않는다.** 결론을 완화하거나 강화하지 않는다. 확신도를 언급하지 않는다.
- **새로운 법령·판례·사례를 만들지 않는다.** 제시된 근거에 없는 것은 쓰지 않는다.
- **신청을 말리지 않는다.** "신청할 필요 없다", "소용없다", "권하지 않는다" 같은 표현을 절대 쓰지 않는다.
  결론이 「위반 가능성 낮음」이어도 마찬가지다.
- 배상액·배상비율을 말하지 않는다. 소송 전망을 말하지 않는다.
- 변호사가 하는 말투를 쓰지 않는다. 법률 자문이 아니다.

## 문체
- 3~5문장. 짧은 문장으로 쓴다.
- 어려운 말은 풀어 쓴다. 「적합성 원칙」처럼 꼭 필요한 용어는 한 번 풀어 설명한다.
- 존댓말을 쓴다.
- 마크다운 제목·목록을 쓰지 않는다. 문단 하나로 쓴다.

## 쓸 내용
왜 그런 판단이 나왔는지, 어떤 법령과 사실이 그 근거인지 설명한다.
근거 법령은 「금융소비자 보호에 관한 법률 제19조」처럼 법령명과 조문번호를 함께 적는다.`;

/**
 * 말리는 표현이 든 문장을 통째로 뺀다 — 부분 치환은 뜻이 뒤틀린다.
 * 기획서 9.5 ③의 유일한 집행 지점이라 테스트가 직접 호출한다.
 */
export function stripDiscouraging(text: string): { text: string; removed: number } {
  const sentences = text.split(/(?<=[.!?。]|다\.)\s+/);
  const kept = sentences.filter((s) => !DISCOURAGING.some((re) => re.test(s)));
  return { text: kept.join(" ").trim(), removed: sentences.length - kept.length };
}

function buildUser(input: GuideInput): string {
  const j = input.judgment;
  const statutes = input.evidence.statutes
    .map((s) => `- ${s.lawName} ${s.articleNo}${s.articleTitle ? ` (${s.articleTitle})` : ""}`)
    .join("\n");

  return `## 판단 결과 (바꾸지 말 것)
결론: ${CONCLUSION_LABEL[j.conclusion]}
쟁점: ${j.issues.join(", ") || "미확정"}
판단 이유: ${j.reasoning}

## 인용 가능한 근거 법령 (여기 없는 법령은 쓰지 말 것)
${statutes || "없음 — 법령을 인용하지 말고 사실관계만 설명한다"}

## 사건 정보
상품군 ${input.slots.product} · 채널 ${input.slots.channel} · 가입 ${input.slots.contract_ym} · 특성 ${input.slots.traits.join(", ")}

위 판단을 이용자에게 설명하는 문단 하나를 쓰라.`;
}

/**
 * 유보 안내 (F-307) — 실패가 아니라 안전한 종착이다. 모델을 부르지 않는다.
 * 사유 문구는 어휘집의 정본을 쓴다 — 화면(「왜 유보했는지」)과 같은 문장이어야 한다.
 * (이전에는 여기 다른 문장 한 벌이 더 있었고, 화면에는 나가지 않는 죽은 사본이었다)
 */
export function guideWithheld(outcome: Extract<JudgmentOutcome, { kind: "WITHHELD" }>): GuideResult {
  return {
    headline: "판단을 보류했습니다",
    explanation: WITHHELD_REASON_TEXTS[outcome.reason],
    changesIf: [],
    nextSteps: [
      ...(outcome.needed.length ? ["다음 자료가 있으면 판단을 이어갈 수 있습니다."] : []),
      RIGHT_TO_APPLY,
      FSS_CONTACT,
    ],
    needed: outcome.needed,
    documents: [],
    referenceCases: [],
    removed: 0,
  };
}

export async function guide(input: GuideInput, trace: Trace): Promise<GuideResult> {
  const j = input.judgment;

  let raw: string;
  try {
    raw = await callText({
      system: SYSTEM,
      user: buildUser(input),
      // 표현 변환이다. 판단은 이미 끝났으므로 깊게 생각할 일이 없다.
      effort: "low",
      maxTokens: 2_000,
    });
  } catch (e) {
    if (!(e instanceof ModelFormatError)) throw e;
    // 설명 문단이 없어도 결론과 필수 안내는 나가야 한다 (EP-1).
    trace.warn("GUIDE", "설명 문단을 생성하지 못해 판단 이유를 그대로 표시합니다");
    raw = j.reasoning;
  }

  const { text: kept, removed } = stripDiscouraging(raw);
  if (removed > 0) {
    // 기획서 9.5 ③ 위반이다. 잘라내고 남긴다 — 조용히 넘기면 재발을 못 잡는다.
    trace.warn("GUIDE", "신청을 만류하는 표현을 제거했습니다", { removed });
  }

  // F-603 — 수집한 근거에 없는 인용은 문장째 뺀다. 프롬프트로 지시해 두었지만
  // 지시는 지켜지지 않을 수 있고, 그때 화면에 지어낸 조문이 나간다 (N-405).
  const { text, removed: unbacked } = stripUnbackedCitations(kept, input.evidence);
  if (unbacked > 0) {
    trace.warn("GUIDE", "근거에 없는 인용이 든 문장을 제거했습니다", { removed: unbacked });
  }

  // ④ 판단이 달라지는 조건도 모델 텍스트다. 같은 대조를 거친다
  const changesIf = j.changesIf.filter(
    (c) => stripUnbackedCitations(c, input.evidence).removed === 0,
  );

  // ①②는 결론과 무관하게 항상 붙인다. 「높음」일 때도 신청 주체는 이용자다.
  const nextSteps: string[] = [];
  nextSteps.push(RIGHT_TO_APPLY, FSS_CONTACT);
  const missing = (input.evidence.documents?.missing ?? []).map((d) => d.label);

  return {
    headline: CONCLUSION_LABEL[j.conclusion],
    explanation: text || j.reasoning,
    // ④ 판단이 달라지는 조건 — 판단 결과 그대로다. 여기서 만들지 않는다.
    // 다만 근거에 없는 인용이 든 항목은 뺀다 (F-603).
    changesIf,
    nextSteps,
    needed: missing,
    documents: (input.evidence.documents?.required ?? []).map((d) => ({
      label: d.label,
      why: d.why,
    })),
    referenceCases: input.evidence.cases.map(citation),
    removed: removed + unbacked,
  };
}
