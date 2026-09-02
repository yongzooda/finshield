/**
 * 슬롯 시스템 — 필수 5종 + 조건부 3종 (기능 명세 2장 · F-302 · F-605).
 *
 * 「조건부」는 생략 가능이 아니라 **발동 조건이 충족되면 필수**라는 뜻이다.
 * 발동 판정에는 쟁점이 필요하므로 이 모듈은 (슬롯, 쟁점)을 함께 받는다.
 *
 * 되묻기는 **한 번에 하나**다 (A11Y-4 · 기획서 7.2). 그래서 「다음에 물을 것」을
 * 하나만 돌려주며, 무엇을 먼저 물을지의 우선순위도 여기서 정한다.
 */

import { deriveTraits, SlotsBaseSchema, SlotsSchema, type Slots, type SlotTrait } from "../types";

/** 필수 5종 — 이게 다 차야 조사 계층으로 넘어간다 */
export const REQUIRED_SLOTS = ["channel", "age", "product", "contract_ym", "traits"] as const;
export type RequiredSlot = (typeof REQUIRED_SLOTS)[number];

export type ConditionalSlot = "confirm_call" | "survey_writer" | "explained_loss";

/**
 * 조건부 슬롯의 발동 조건 (기능 명세 2.2).
 * 조건이 참이면 그 슬롯은 그 순간부터 필수로 승격된다.
 */
const TRIGGERS: Record<
  ConditionalSlot,
  { when: (s: Partial<Slots>, issues: readonly string[]) => boolean; why: string }
> = {
  confirm_call: {
    when: (s, issues) =>
      typeof s.product === "string" &&
      s.product.startsWith("INS_") &&
      issues.includes("설명의무"),
    why: "보험 상품에서 설명의무가 쟁점이면 사후확인콜 내용이 판단을 가른다",
  },
  survey_writer: {
    when: (_s, issues) => issues.includes("적합성원칙"),
    why: "적합성 설문을 누가 작성했는지가 반복 쟁점이다 (기획서 3.3)",
  },
  explained_loss: {
    when: (s, issues) =>
      typeof s.product === "string" &&
      s.product.startsWith("INV_") &&
      issues.includes("설명의무"),
    why: "투자성 상품은 원금손실 설명 여부가 핵심이다",
  },
};

export type SlotStatus = {
  /** 지금 채워져야 하는 슬롯 — 필수 5 + 발동된 조건부 */
  needed: string[];
  /** 아직 값이 없는 슬롯 */
  missing: string[];
  /** 발동된 조건부 슬롯과 그 이유 (실행 로그·되묻기 문구에 쓴다) */
  promoted: { slot: ConditionalSlot; why: string }[];
  complete: boolean;
};

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export function slotStatus(slots: Partial<Slots>, issues: readonly string[]): SlotStatus {
  const promoted = (Object.keys(TRIGGERS) as ConditionalSlot[])
    .filter((k) => TRIGGERS[k].when(slots, issues))
    .map((slot) => ({ slot, why: TRIGGERS[slot].why }));

  const needed = [...REQUIRED_SLOTS, ...promoted.map((p) => p.slot)];
  const missing = needed.filter((k) => isEmpty(slots[k as keyof Slots]));

  return { needed, missing, promoted, complete: missing.length === 0 };
}

/**
 * 되묻기 우선순위. 먼저 물어야 나머지 질문이 달라지는 것부터 간다.
 *
 * `product`가 앞선 이유 — 상품군이 정해져야 조건부 슬롯 발동 여부가 결정되고,
 * 그래야 쓸데없는 질문을 줄일 수 있다. `contract_ym`은 기준일 산정에 직결돼
 * UNKNOWN이면 시점별 법령 적용이 불가하므로 그다음이다 (기능 명세 2.1).
 */
const ASK_ORDER: readonly string[] = [
  "product",
  "contract_ym",
  "channel",
  "age",
  "traits",
  "survey_writer",
  "explained_loss",
  "confirm_call",
];

/** 다음에 물을 슬롯 하나. 없으면 null (A11Y-4 — 한 화면에 하나의 질문) */
export function nextQuestion(status: SlotStatus): string | null {
  for (const k of ASK_ORDER) if (status.missing.includes(k)) return k;
  return status.missing[0] ?? null;
}

const fmt = (e: { issues: { path: PropertyKey[]; message: string }[] }): string[] =>
  e.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

export type SlotPatchResult =
  | { ok: true; slots: Partial<Slots> }
  | { ok: false; errors: string[] };

/**
 * 되묻기 중의 슬롯 병합 (F-302 · F-605).
 *
 * **부분 검증이다.** 되묻기는 한 번에 하나씩 채우므로, 여기서 전체 스키마를
 * 요구하면 아직 안 물어본 슬롯 때문에 매번 거부되어 값이 영영 쌓이지 않는다.
 * 들어온 필드의 타입·열거만 본다 — 그것만으로도 "열거 밖 값은 내려가지 않는다"는
 * F-605의 목적은 달성된다. 완성 검증은 `finalizeSlots`가 맡는다.
 *
 * 실패는 예외가 아니라 되묻기 회귀 신호다 (EX-101).
 */
export function applySlots(
  current: Partial<Slots>,
  patch: Partial<Slots>,
): SlotPatchResult {
  const parsedPatch = SlotsBaseSchema.partial().safeParse(patch);
  if (!parsedPatch.success) return { ok: false, errors: fmt(parsedPatch.error) };

  const merged: Partial<Slots> = { ...current, ...parsedPatch.data };

  // 나이를 알게 되면 ELDER를 자동 파생한다 — 고령 여부를 직접 묻지 않기 위함이다.
  // 특성이 아직 없어도 파생값만으로 채워둔다(나중에 사용자가 고른 값과 합쳐진다).
  if (merged.age !== undefined) {
    merged.traits = deriveTraits(merged.age, (merged.traits ?? []) as SlotTrait[]);
    if (merged.traits.length === 0) delete merged.traits;
  }
  return { ok: true, slots: merged };
}

export type SlotFinalizeResult =
  | { ok: true; slots: Slots }
  | { ok: false; errors: string[] };

/**
 * 조사 계층으로 넘기기 직전의 완성 검증.
 * 여기를 통과해야 `Slots`(완전형) 타입이 되고, 그래야 `InvestigateInput`을
 * 만들 수 있다 — 미완 슬롯이 하위 계층으로 내려갈 경로가 타입으로 막힌다.
 */
export function finalizeSlots(slots: Partial<Slots>): SlotFinalizeResult {
  const parsed = SlotsSchema.safeParse(slots);
  if (!parsed.success) return { ok: false, errors: fmt(parsed.error) };
  return { ok: true, slots: parsed.data };
}

/**
 * 기준일 산정 (F-303) — `contract_ym`에서 만든다.
 * 가입 월의 1일을 기준일로 삼는다. UNKNOWN이면 시점별 법령 적용이 불가하므로
 * null을 돌려주고, 조사 계층은 시점 무관 법령만 조회하게 된다.
 */
export function basisDateFrom(slots: Pick<Slots, "contract_ym">): string | null {
  return slots.contract_ym === "UNKNOWN" ? null : `${slots.contract_ym}-01`;
}

/** 금소법 시행일 이후 계약인지 — 적용 법령 판정에 쓴다 */
export function isAfterFsca(basisDate: string | null): boolean | null {
  if (!basisDate) return null;
  return basisDate >= "2021-03-25";
}
