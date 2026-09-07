import { describe, expect, it } from "vitest";
import { MODEL_TIMEOUTS } from "../manifest";
import { judgeFailureReason } from "../orchestrator";

describe("N-PERF-004·B-DEMO-01 모델 시간 제한 계약", () => {
  it("각 Agent 단계에 선택 뒤 판단 시간이 남는다", () => {
    expect(MODEL_TIMEOUTS.domainChoiceMs + MODEL_TIMEOUTS.domainDecisionMs)
      .toBeLessThan(MODEL_TIMEOUTS.domainStageMs);
    expect(MODEL_TIMEOUTS.reviewChoiceMs + MODEL_TIMEOUTS.reviewDecisionMs)
      .toBeLessThan(MODEL_TIMEOUTS.reviewStageMs);
  });

  it("순차 실행 최악 상한이 공개 Demo 전체 기한 안에 든다", () => {
    const stageBudget = 4 * MODEL_TIMEOUTS.domainStageMs
      + 2 * MODEL_TIMEOUTS.reviewStageMs
      + MODEL_TIMEOUTS.judgeMs;
    expect(stageBudget).toBeLessThan(MODEL_TIMEOUTS.demoRunMs);
  });

  it("Judge 시간 초과를 일반 호출 실패와 구분한다", () => {
    const controller = new AbortController();
    controller.abort();
    expect(judgeFailureReason(new Error("합성 시간 초과"), controller.signal))
      .toBe("JUDGE_DEADLINE_EXCEEDED");
    expect(judgeFailureReason(new Error("합성 Provider 실패"), new AbortController().signal))
      .toBe("JUDGE_CALL_FAILED");
    expect(judgeFailureReason(
      Object.assign(new Error("합성 예산 거부"), { code: "MODEL_BUDGET_BLOCKED" }),
      controller.signal,
    )).toBe("TOOL_BUDGET");
  });
});
