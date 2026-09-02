/**
 * S-03 되묻기 답변 형식 검증.
 *
 * 핵심은 **열거형 슬롯에 자유 입력이 열리지 않는 것**이다. 자유 입력을 두면
 * 오입력이 슬롯 검증(F-605)에서 튕겨 같은 질문이 반복된다. 그리고 어떤
 * 질문에서든 「모른다」고 답할 길이 있어야 한다 — 없으면 이용자가 아무거나
 * 고르고, 그건 틀린 슬롯이 되어 판단을 망친다.
 */

import { describe, expect, it } from "vitest";
import { answerFormFor, CHANNEL_LABELS, PRODUCT_LABELS, TRAIT_LABELS } from "@/lib/labels";
import { REQUIRED_SLOTS } from "@/lib/agents/slots";
import { SLOT_CHANNELS, SLOT_TRAITS } from "@/lib/types";

const CONDITIONAL = ["confirm_call", "survey_writer", "explained_loss"];

describe("S-03 답변 형식", () => {
  it("필수 5종·조건부 3종 전부 답변 형식이 있다 — 없으면 되묻기가 막힌다", () => {
    for (const slot of [...REQUIRED_SLOTS, ...CONDITIONAL]) {
      expect(answerFormFor(slot), `${slot} 답변 형식 없음`).not.toBeNull();
    }
  });

  it("모르는 슬롯 이름에는 형식을 만들어내지 않는다", () => {
    expect(answerFormFor("무언가_새_슬롯")).toBeNull();
  });

  it("열거형은 선택지 버튼이다 — 자유 입력을 열지 않는다 (F-605)", () => {
    for (const slot of ["channel", "confirm_call", "survey_writer", "explained_loss"]) {
      expect(answerFormFor(slot)?.kind).toBe("choice");
    }
    expect(answerFormFor("product")?.kind).toBe("product");
    expect(answerFormFor("traits")?.kind).toBe("multi");
  });

  it("채널 선택지가 열거 6종을 그대로 덮는다", () => {
    const form = answerFormFor("channel");
    if (form?.kind !== "choice") throw new Error("선택지여야 한다");
    expect(form.options.map((o) => o.value).sort()).toEqual([...SLOT_CHANNELS].sort());
  });

  it("특성 선택지는 ELDER를 빼고 나머지를 덮는다 — 나이에서 파생되므로 직접 고르게 하지 않는다", () => {
    const form = answerFormFor("traits");
    if (form?.kind !== "multi") throw new Error("복수 선택이어야 한다");
    const values = form.options.map((o) => o.value).sort();
    expect(values).not.toContain("ELDER");
    expect(values).toEqual([...SLOT_TRAITS].filter((t) => t !== "ELDER").sort());
  });

  it("모든 질문에 「모른다」로 답할 길이 있다", () => {
    // 선택지형 — UNKNOWN 값이 들어 있다
    for (const slot of ["channel", "confirm_call", "survey_writer", "explained_loss"]) {
      const form = answerFormFor(slot);
      if (form?.kind !== "choice") throw new Error("선택지여야 한다");
      expect(form.options.some((o) => o.value === "UNKNOWN"), `${slot}에 모름 없음`).toBe(true);
    }
    // 특성 — 「해당 없음」(NONE)이 그 역할이다
    const traits = answerFormFor("traits");
    if (traits?.kind !== "multi") throw new Error("복수 선택이어야 한다");
    expect(traits.options.some((o) => o.value === "NONE")).toBe(true);
    // 상품군 — 「기타·잘 모르겠음」(ETC_UNKNOWN)
    expect(PRODUCT_LABELS.ETC_UNKNOWN).toContain("모르겠음");
    // 숫자·연월은 컴포넌트가 「기억나지 않습니다」 버튼으로 UNKNOWN을 보낸다
    expect(answerFormFor("age")?.kind).toBe("number");
    expect(answerFormFor("contract_ym")?.kind).toBe("month");
  });

  it("표기가 비어 있지 않다", () => {
    for (const v of Object.values(CHANNEL_LABELS)) expect(v.length).toBeGreaterThan(0);
    for (const v of Object.values(TRAIT_LABELS)) expect(v.length).toBeGreaterThan(0);
  });
});

/**
 * 가입 시점 표시 — 기준일(F-303)이 여기서 나오고, 기준일이 적용 법령을 가른다
 * (금소법 2021-03-25). 무엇을 보내는지 이용자가 보고 눌러야 한다.
 *
 * iOS에서 **칸을 누르는 것만으로 이번 달이 채워진다**(WKWebView 실측). 고르지
 * 않은 값이 조용히 확정되면 다른 법으로 판단하게 된다.
 */
describe("가입 시점 표기", () => {
  it("YYYY-MM을 사람이 읽는 형태로 바꾼다 — 앞의 0을 남기지 않는다", async () => {
    const { monthLabel } = await import("../answer-input");
    expect(monthLabel("2019-05")).toBe("2019년 5월");
    expect(monthLabel("2021-12")).toBe("2021년 12월");
    expect(monthLabel("2003-01")).toBe("2003년 1월");
  });

  it("형식이 아닌 값은 손대지 않는다 — 「기억나지 않습니다」가 그대로 지나간다", async () => {
    const { monthLabel } = await import("../answer-input");
    expect(monthLabel("UNKNOWN")).toBe("UNKNOWN");
  });
});

/**
 * 미래 월 차단 — `max` 속성만으로는 막히지 않는다. iOS 휠 피커는 `max`를 넘겨도
 * 2030년까지 굴려 준다(2026.08.24 WKWebView 실측). 가입 시점은 기준일이고
 * 기준일이 적용 법령을 가르므로(F-303 · 금소법 2021-03-25) 값을 다시 본다.
 */
describe("가입 시점 상한", () => {
  it("지난 달·이번 달은 받는다", async () => {
    const { monthAnswerable } = await import("../answer-input");
    expect(monthAnswerable("2019-05", "2026-08")).toBe(true);
    expect(monthAnswerable("2026-08", "2026-08")).toBe(true);
  });

  it("아직 오지 않은 달은 받지 않는다 — max 속성이 iOS에서 안 먹는다", async () => {
    const { monthAnswerable } = await import("../answer-input");
    expect(monthAnswerable("2026-09", "2026-08")).toBe(false);
    expect(monthAnswerable("2030-12", "2026-08")).toBe(false);
    // 해가 바뀌는 경계
    expect(monthAnswerable("2027-01", "2026-12")).toBe(false);
    expect(monthAnswerable("2026-12", "2027-01")).toBe(true);
  });

  it("형식이 아니면 받지 않는다", async () => {
    const { monthAnswerable } = await import("../answer-input");
    for (const bad of ["", "2019", "2019-5", "2019-13", "2019-00", "UNKNOWN"]) {
      expect(monthAnswerable(bad, "2026-08"), bad).toBe(false);
    }
  });
});
