import { describe, expect, it } from "vitest";
import { QUESTIONS, decideAftercare, normalizeAnswers } from "../aftercare";

describe("가입 후 점검 규칙", () => {
  const allGood = {
    EXPLAINED_RATE_AND_FEES: "YES", EXPLAINED_PENALTY: "YES", UNDERSTOOD_TERMS: "YES",
    CONTRACT_MATCHES_EXPLANATION: "SAME", SIGNED_UNDER_PRESSURE: "NO",
    HAS_CONTRACT_COPY: "YES", HAS_RECORDING: "YES",
  };

  it("계약이 설명과 다르면 분쟁 준비로 올린다", () => {
    const decision = decideAftercare({
      answers: { ...allGood, CONTRACT_MATCHES_EXPLANATION: "DIFFERENT" },
      contradictedClaims: 0,
    });
    expect(decision.result).toBe("DISPUTE_PREPARATION");
    expect(decision.actions.map((a) => a.action_code)).toContain("REPORT_IMPERSONATION");
  });

  it("거래 전에 사실과 다른 항목이 있었으면 답이 좋아도 문의로 남긴다", () => {
    const decision = decideAftercare({ answers: allGood, contradictedClaims: 2 });
    expect(decision.result).toBe("CORRECTION_OR_INQUIRY");
    expect(decision.reasons.join(" ")).toContain("2건");
  });

  it("설명을 다 듣지 못했으면 서면 요청과 공식 창구를 함께 준다", () => {
    const decision = decideAftercare({
      answers: { ...allGood, EXPLAINED_PENALTY: "NO" }, contradictedClaims: 0,
    });
    expect(decision.result).toBe("CORRECTION_OR_INQUIRY");
    expect(decision.actions.map((a) => a.action_code))
      .toEqual(expect.arrayContaining(["REQUEST_WRITTEN_EXPLANATION", "ASK_OFFICIAL_CHANNEL"]));
  });

  it("이해만 부족하면 추가 설명으로 남긴다", () => {
    const decision = decideAftercare({
      answers: { ...allGood, UNDERSTOOD_TERMS: "PARTIAL" }, contradictedClaims: 0,
    });
    expect(decision.result).toBe("ADDITIONAL_EXPLANATION");
  });

  it("문제가 없으면 조치 없음이지만 자료 보관은 언제나 남는다", () => {
    const decision = decideAftercare({ answers: allGood, contradictedClaims: 0 });
    expect(decision.result).toBe("NORMAL_MANAGEMENT");
    expect(decision.actions[0].action_code).toBe("KEEP_CONTRACT_AND_RECORDS");
  });

  it("답하지 않은 항목이 있으면 결과에 그 사실을 적는다", () => {
    const decision = decideAftercare({
      answers: { EXPLAINED_RATE_AND_FEES: "YES" }, contradictedClaims: 0,
    });
    expect(decision.reasons.join(" ")).toContain("답하지 않은 항목");
  });

  it("같은 답은 언제나 같은 결과를 낸다", () => {
    const first = decideAftercare({ answers: allGood, contradictedClaims: 1 });
    const second = decideAftercare({ answers: allGood, contradictedClaims: 1 });
    expect(second).toEqual(first);
  });

  it("정해진 값이 아닌 답은 받지 않는다", () => {
    expect(normalizeAnswers({ EXPLAINED_RATE_AND_FEES: "아마도" })).toBeNull();
    expect(normalizeAnswers({ EXPLAINED_RATE_AND_FEES: "YES", 몰라: "x" }))
      .toEqual({ EXPLAINED_RATE_AND_FEES: "YES" });
    expect(normalizeAnswers("문장")).toBeNull();
  });

  it("질문 Code 는 데이터베이스가 요구하는 형식을 지킨다", () => {
    for (const question of QUESTIONS) {
      expect(question.code).toMatch(/^[A-Z][A-Z0-9_]{2,63}$/);
    }
  });
});
