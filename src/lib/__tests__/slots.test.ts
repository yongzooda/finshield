/** F-605 슬롯 타입 검증 — 열거·정수 외 값은 하위 계층에 내려가지 않는다. */

import { describe, expect, it } from "vitest";
import { AGE_MAX, AGE_MIN, deriveTraits, SlotsSchema } from "../types";

const valid = {
  channel: "TM",
  age: 67,
  product: "INV_ELS",
  contract_ym: "2021-02",
  traits: ["INEXP"],
} as const;

describe("SlotsSchema (F-605)", () => {
  it("정상 슬롯 통과", () => {
    expect(SlotsSchema.safeParse(valid).success).toBe(true);
  });

  it("UNKNOWN 허용 — 채널·나이·가입시점", () => {
    const r = SlotsSchema.safeParse({
      ...valid, channel: "UNKNOWN", age: "UNKNOWN", contract_ym: "UNKNOWN",
    });
    expect(r.success).toBe(true);
  });

  it("열거 밖 값 거부 — 자유 문자열이 슬롯으로 내려가는 경로 차단", () => {
    expect(SlotsSchema.safeParse({ ...valid, channel: "전화로 가입했어요" }).success).toBe(false);
    expect(SlotsSchema.safeParse({ ...valid, product: "PRODUCT_X" }).success).toBe(false);
    expect(SlotsSchema.safeParse({ ...valid, traits: ["노인"] }).success).toBe(false);
  });

  it("나이 경계 — 가입 당시 만 나이 19~120", () => {
    expect(SlotsSchema.safeParse({ ...valid, age: AGE_MIN }).success).toBe(true);
    expect(SlotsSchema.safeParse({ ...valid, age: AGE_MAX }).success).toBe(true);
    expect(SlotsSchema.safeParse({ ...valid, age: AGE_MIN - 1 }).success).toBe(false);
    expect(SlotsSchema.safeParse({ ...valid, age: AGE_MAX + 1 }).success).toBe(false);
    expect(SlotsSchema.safeParse({ ...valid, age: 67.5 }).success).toBe(false);
  });

  it("가입 연월 형식 — YYYY-MM만", () => {
    for (const bad of ["2021-13", "2021-0", "21-02", "2021/02", "2021-02-15"]) {
      expect(SlotsSchema.safeParse({ ...valid, contract_ym: bad }).success).toBe(false);
    }
  });

  it("NONE은 단독으로만 — 다른 특성과 동시 선택 모순 차단", () => {
    expect(SlotsSchema.safeParse({ ...valid, traits: ["NONE"] }).success).toBe(true);
    expect(SlotsSchema.safeParse({ ...valid, traits: ["NONE", "ELDER"] }).success).toBe(false);
  });

  it("정의 밖 필드 거부 — 원문이 슬롯 객체에 실려 내려가는 경로 차단", () => {
    expect(SlotsSchema.safeParse({ ...valid, rawStatement: "사실은…" }).success).toBe(false);
  });

  it("조건부 슬롯 — 값 형식만 검증 (승격 판정은 에이전트 계층)", () => {
    expect(SlotsSchema.safeParse({ ...valid, explained_loss: "N" }).success).toBe(true);
    expect(SlotsSchema.safeParse({ ...valid, survey_writer: "대필" }).success).toBe(false);
  });
});

describe("deriveTraits — ELDER 자동 파생", () => {
  it("60세 이상이면 ELDER 추가", () => {
    expect(deriveTraits(67, ["INEXP"])).toContain("ELDER");
    expect(deriveTraits(60, ["NONE"])).toEqual(["ELDER"]); // NONE 단독이 깨지므로 제거
  });
  it("60세 미만·UNKNOWN이면 그대로", () => {
    expect(deriveTraits(45, ["INEXP"])).toEqual(["INEXP"]);
    expect(deriveTraits("UNKNOWN", ["NONE"])).toEqual(["NONE"]);
  });
});
