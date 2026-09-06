/** 규칙 3 — 독립 검증은 상태를 낮추기만 하고 올리지 않는다 */

import { describe, expect, it } from "vitest";
import { applyIndependentChecks, buildAxisResults, type FinalClaim } from "../finalize";

describe("독립 검증 반영", () => {
  it("재확인이 같은 결론이면 확정을 남긴다", () => {
    expect(applyIndependentChecks("VERIFIED", true, "CONFIRMED", "NONE_FOUND"))
      .toEqual({ state: "VERIFIED", reasonCode: "COVE_CONFIRMED" });
  });

  it("재확인이 판단하지 못하면 확정을 거둔다", () => {
    expect(applyIndependentChecks("VERIFIED", true, "INCONCLUSIVE", "NONE_FOUND"))
      .toEqual({ state: "UNKNOWN", reasonCode: "COVE_INCONCLUSIVE" });
  });

  it("재확인이 반대로 말하면 한쪽으로 정하지 않는다", () => {
    expect(applyIndependentChecks("VERIFIED", true, "REFUTED", "NONE_FOUND").state).toBe("CONFLICT");
    expect(applyIndependentChecks("CONTRADICTED", true, "REFUTED", "NONE_FOUND").state).toBe("CONFLICT");
  });

  it("반대 근거를 찾으면 확정 대신 엇갈림으로 둔다", () => {
    expect(applyIndependentChecks("VERIFIED", true, "CONFIRMED", "COUNTER_EVIDENCE"))
      .toEqual({ state: "CONFLICT", reasonCode: "RED_TEAM_COUNTER_EVIDENCE" });
  });

  it("확정이 아닌 상태는 재확인이 올려 주지 않는다", () => {
    // 재확인이 확인이라고 해도 Judge 가 보류한 것을 확정으로 바꾸지 않는다.
    expect(applyIndependentChecks("UNKNOWN", true, "CONFIRMED", "NONE_FOUND"))
      .toEqual({ state: "UNKNOWN", reasonCode: "AS_JUDGED" });
    expect(applyIndependentChecks("NEED_MORE_INFORMATION", true, "CONFIRMED", "NONE_FOUND").state)
      .toBe("NEED_MORE_INFORMATION");
  });

  it("중요하지 않은 항목은 재확인을 요구하지 않는다", () => {
    expect(applyIndependentChecks("VERIFIED", false, "NOT_REQUIRED", "NOT_REQUIRED"))
      .toEqual({ state: "VERIFIED", reasonCode: "AS_JUDGED" });
  });
});

describe("축 결과", () => {
  const claim = (status: FinalClaim["status"]): FinalClaim => ({
    claim_id: "c", status, reason_code: "AS_JUDGED", cove_status: "NOT_REQUIRED",
    red_team_status: "NOT_REQUIRED", decision_summary_masked: "요약", evidences: [],
  });

  it("세 축을 모두 낸다", () => {
    const axes = buildAxisResults([claim("VERIFIED")], true);
    expect(axes.map((a) => a.axis)).toEqual(["AUTHENTICITY", "TRANSACTION_SALES_RISK", "SUITABILITY"]);
  });

  it("사실과 다른 항목이 하나라도 있으면 그 축이 끌려간다", () => {
    const axes = buildAxisResults([claim("VERIFIED"), claim("CONTRADICTED")], true);
    expect(axes[0].result_code).toBe("CONTRADICTED");
  });

  it("프로필을 건너뛰면 적합성 축만 보류한다", () => {
    const axes = buildAxisResults([claim("VERIFIED")], false);
    expect(axes[2].result_code).toBe("SUSPENDED");
    expect(axes[2].limitation_codes).toContain("PROFILE_SKIPPED");
    // 다른 축은 그대로 진행한다.
    expect(axes[0].result_code).toBe("CONFIRMED");
  });
});
