import { createSharedRunDeadline } from "../run-deadline";
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

  it("앞 단계가 늦어도 Judge와 저장 시간을 남기고 전체 기한에 실제 중단한다", async () => {
    // 기한 직전 시점을 주입해 실제 AbortSignal 동작을 짧은 시간에 확인한다.
    const beforeJudge = createSharedRunDeadline(undefined, Date.now() - MODEL_TIMEOUTS.demoRunMs + 6000 + 200);
    const agent = beforeJudge.agentSignal();
    await new Promise(resolve => setTimeout(resolve, 8));
    expect(agent.aborted).toBe(true);
    expect(beforeJudge.signal.aborted).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 205));
    expect(beforeJudge.signal.aborted).toBe(true);
    expect(MODEL_TIMEOUTS.demoRunMs).toBeLessThan(120_000);
  });

  it("상위 취소는 공유 기한과 모든 Agent에 즉시 전달된다", () => {
    const parent = new AbortController();
    const run = createSharedRunDeadline(parent.signal);
    const agent = run.agentSignal();
    parent.abort();
    expect(run.signal.aborted).toBe(true);
    expect(agent.aborted).toBe(true);
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
