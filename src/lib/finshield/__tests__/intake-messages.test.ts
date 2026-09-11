import { describe, expect, it } from "vitest";
import { intakeErrorMessage } from "../intake-messages";

describe("접수 실패 안내 (S-006)", () => {
  it("한도 소진·시간 초과·항목 없음을 구분해 할 수 있는 일을 알린다", () => {
    expect(intakeErrorMessage(Object.assign(new Error("x"), { code: "MODEL_BUDGET_BLOCKED" }))).toContain("확인 한도");
    expect(intakeErrorMessage(Object.assign(new Error("x"), { name: "TimeoutError" }))).toContain("시간이 오래 걸려");
    expect(intakeErrorMessage(new Error("CLAIMS_NOT_FOUND"))).toContain("금융 조건을 찾지 못했습니다");
    expect(intakeErrorMessage(new Error("CLAIM_NUMBERS_CHANGED"))).toContain("정확히 옮기지 못했습니다");
  });

  it("알 수 없는 실패는 내부 사정을 드러내지 않는다", () => {
    const text = intakeErrorMessage(new Error("connect ECONNREFUSED 10.0.0.1:5432 password=secret"));
    expect(text).toBe("접수하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  });
});
