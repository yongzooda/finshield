/**
 * S-02 사전 점검의 단계 판정 — **순수 함수**.
 *
 * 화면은 「입력 단계 → 결과 단계」를 한 화면 안에서 진행하는데(화면 명세 S-02),
 * 그 진행 상태를 **URL 질의 문자열**로 들고 간다. 클라이언트 상태를 쓰지 않는
 * 이유가 셋 있다:
 *
 *   1. **모델 미사용 축은 자바스크립트도 최소로 간다.** 예방 축은 모델이 죽어도
 *      동작해야 하고(F-201~203), 같은 이유로 스크립트가 실패해도 동작하는 편이
 *      낫다. 링크와 GET 폼만으로 전 단계가 굴러간다
 *   2. 카카오톡 인앱 브라우저(N-701)에서 스크립트 의존이 적을수록 안전하다
 *   3. 뒤로가기가 「이전 질문」이 된다 — 고령 이용자에게 가장 익숙한 되돌리기다
 *
 * 질의 문자열은 사용자가 직접 고칠 수 있으므로 **전부 열거 대조를 거친다**.
 * 열거 밖 값은 무시하고 해당 질문으로 되돌린다 (F-605와 같은 태도).
 */

import {
  AGE_MAX,
  AGE_MIN,
  PRODUCT_CODES,
  SLOT_CHANNELS,
  deriveTraits,
  type ProductCode,
  type SlotChannel,
  type SlotTrait,
} from "@/lib/types";
import { DEFAULT_PRODUCT_GROUP, PRODUCT_GROUPS } from "@/lib/labels";
import { buildBriefing, type Briefing } from "@/lib/precheck/briefing";

/** Next.js가 넘겨주는 형태 그대로 받는다 */
export type RawParams = Record<string, string | string[] | undefined>;

export type PrecheckStep =
  /** ① 상품군 — 업권 2단 선택. `group`이 현재 펼쳐진 업권이다 */
  | { kind: "product"; group: string }
  /** ② 판매채널 */
  | { kind: "channel"; product: ProductCode }
  /** ③ 연령 — `error`·`raw`는 형식이 어긋났을 때만 채워진다 */
  | { kind: "age"; product: ProductCode; channel: SlotChannel; error?: string; raw?: string }
  /** 결과 단계 — `view`가 어느 절을 보여줄지 정한다 */
  | {
      kind: "result";
      product: ProductCode;
      channel: SlotChannel;
      age: number | "UNKNOWN";
      traits: SlotTrait[];
      view: ResultView;
    };

/**
 * 결과 단계의 하위 화면 — **절 하나가 한 화면이다.**
 *
 * 입력 단계가 「한 화면에 하나의 질문」(A11Y-4)인데 결과만 8화면짜리 두루마리였다.
 * 같은 화면 안에서 앞뒤가 다른 원칙으로 만들어져 있던 것을 맞춘다 (2026.09.01).
 *
 * `all`은 **전부 이어 붙인 화면**이다. 접는 것이 아니라 나누는 것이므로 나뉜
 * 전체를 언제든 한 장으로 볼 수 있어야 한다 — 인쇄해 창구에 들고 가는 경로가
 * 여기에 걸린다(globals.css `@media print`). 데모(`/demo/prevention`)도 `all`이다.
 *
 * 어떤 절이 실제로 존재하는지는 도구 반환값에 달렸다(멈춤 신호는 조건 미충족 시
 * 절 자체가 없고, 확인 전화는 보험 상품군에만 있다). **여기서는 요청만 해석하고,
 * 실재 여부는 도구를 부른 뒤 화면이 판정한다** — 이 파일은 DB를 모르는 순수 함수다.
 */
export const RESULT_VIEWS = ["ask", "stop", "call", "docs", "why", "all"] as const;
export type ResultView = (typeof RESULT_VIEWS)[number];

/** 열거 밖 값은 첫 절로 되돌린다 (질의 문자열은 사용자가 고칠 수 있다) */
const asView = (v: string | null): ResultView =>
  v && (RESULT_VIEWS as readonly string[]).includes(v) ? (v as ResultView) : "ask";

/** `all`을 뺀 실제 절 */
export type ResultSectionKey = Exclude<ResultView, "all">;

/**
 * 이번 조합에 **실제로 존재하는 절**을, 이용자의 시간 순서로.
 *
 * 창구에서 물어본다 → 이상하면 멈춘다 → 가입하면 확인 전화가 온다 → 자료를
 * 챙긴다 → 그 목록이 나온 근거를 본다. 멈춤 신호는 조건 미충족 시 절 자체가
 * 없고(브리핑 규약), 확인 전화는 보험 상품군에만 있다. 그래서 단계 수가
 * 조합마다 다르다 — 화면의 「n단계 중 m단계」는 이 배열을 센 값이다.
 */
export function resultSections(input: {
  brief: Briefing;
  product: ProductCode;
}): ResultSectionKey[] {
  return [
    "ask" as const,
    ...(input.brief.signals.length > 0 ? (["stop"] as const) : []),
    ...(input.product.startsWith("INS_") ? (["call"] as const) : []),
    "docs" as const,
    "why" as const,
  ];
}

/**
 * 브리핑과 절 목록을 한 번에. 한 화면씩 보는 경로와 전부 보는 경로가 같은 계산을
 * 따로 하지 않도록 여기 한 곳에 둔다.
 *
 * R-06 브리핑 — 문장은 코드 상수, 발동은 도구가 반환한 쟁점과 확정 슬롯이 정한다
 * (S-12 점검표와 같은 규약). 도구가 주지 않은 쟁점의 질문은 여기서 걸러져 나온다.
 */
export function buildResultModel(input: {
  issues: readonly string[];
  product: ProductCode;
  channel?: SlotChannel;
}): { brief: Briefing; sections: ResultSectionKey[] } {
  const brief = buildBriefing({
    product: input.product,
    channel: input.channel,
    issues: input.issues,
  });
  return { brief, sections: resultSections({ brief, product: input.product }) };
}

function one(params: RawParams, key: string): string | null {
  const v = params[key];
  if (typeof v === "string") return v;
  // 같은 키가 여러 번 오면 첫 값만 본다. 배열을 그대로 흘리지 않는다
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

const asProduct = (v: string | null): ProductCode | null =>
  v && (PRODUCT_CODES as readonly string[]).includes(v) ? (v as ProductCode) : null;

const asChannel = (v: string | null): SlotChannel | null =>
  v && (SLOT_CHANNELS as readonly string[]).includes(v) ? (v as SlotChannel) : null;

/**
 * 나이 해석. 「밝히지 않음」은 UNKNOWN이고, **형식이 어긋난 값은 UNKNOWN으로
 * 접지 않는다** — 조용히 넘기면 이용자는 자기가 넣은 값이 반영된 줄 안다.
 */
function readAge(v: string | null): { ok: true; age: number | "UNKNOWN" } | { ok: false; error: string } {
  if (v === null || v === "") return { ok: false, error: "" };
  if (v === "UNKNOWN") return { ok: true, age: "UNKNOWN" };

  const n = Number(v);
  if (!Number.isInteger(n)) {
    return { ok: false, error: "나이는 숫자로 적어 주세요. 예: 67" };
  }
  if (n < AGE_MIN || n > AGE_MAX) {
    return { ok: false, error: `${AGE_MIN}세부터 ${AGE_MAX}세까지 입력할 수 있습니다.` };
  }
  return { ok: true, age: n };
}

const knownGroup = (v: string | null): string =>
  v && PRODUCT_GROUPS.some((g) => g.key === v) ? v : DEFAULT_PRODUCT_GROUP;

/** 앞 질문의 답이 없으면 뒤 질문으로 넘어가지 않는다 — 한 화면에 하나의 질문(A11Y-4) */
export function resolveStep(params: RawParams): PrecheckStep {
  const product = asProduct(one(params, "product"));
  if (!product) return { kind: "product", group: knownGroup(one(params, "group")) };

  const channel = asChannel(one(params, "channel"));
  if (!channel) return { kind: "channel", product };

  const rawAge = one(params, "age");
  const age = readAge(rawAge);
  if (!age.ok) {
    return {
      kind: "age",
      product,
      channel,
      error: age.error || undefined,
      raw: age.error ? (rawAge ?? undefined) : undefined,
    };
  }

  return {
    kind: "result",
    product,
    channel,
    age: age.age,
    // ELDER 자동 파생 (기능 명세 2.1). 사용자에게 「고령」이라는 말을 돌려주지
    // 않는다 — 조회 축으로만 쓴다 (화면 명세 S-02 입력 단계)
    traits: deriveTraits(age.age, ["NONE"]),
    view: asView(one(params, "view")),
  };
}

/** 현재까지의 답을 유지한 채 한 항목만 바꾼 링크를 만든다 */
export function stepHref(base: Record<string, string>, patch: Record<string, string | null>): string {
  const q = new URLSearchParams(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `/precheck?${s}` : "/precheck";
}
