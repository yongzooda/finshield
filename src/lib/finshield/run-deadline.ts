import { MODEL_TIMEOUTS } from "./manifest";

/** N-PERF-004·009: 단계별 최대 대기를 더하지 않고 하나의 실제 기한을 공유한다.
 * 마지막 판단과 저장의 시간을 앞선 도구 선택이 모두 소비하지 않게 한다. */
export function createSharedRunDeadline(parent?: AbortSignal, now = Date.now()) {
  const deadline = now + MODEL_TIMEOUTS.demoRunMs - 6000;
  const signal = parent
    ? AbortSignal.any([parent, AbortSignal.timeout(Math.max(1, deadline - Date.now()))])
    : AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  return {
    signal,
    agentSignal: () => AbortSignal.any([signal,
      AbortSignal.timeout(Math.max(1, deadline - Date.now() - MODEL_TIMEOUTS.judgeReserveMs)),
    ]),
  };
}
