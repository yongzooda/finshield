import { describe, expect, it } from "vitest";
import { resolveInitialRunRecovery } from "../run-recovery";

describe("초기 검증 Stream 단절 복원", () => {
  const runId = "00000000-0000-4000-8000-000000000001";
  it("완료 Run과 정확히 연결된 Passport만 연다", () => {
    expect(resolveInitialRunRecovery({
      runs: [{ id: runId, kind: "INITIAL", status: "PARTIAL" }],
      passports: [{ id: "passport-other", verification_run_id: "other" }, { id: "passport-own", verification_run_id: runId }],
    }, runId)).toEqual({ kind: "PASSPORT", passportId: "passport-own" });
  });
  it("실행 중과 종결 실패를 구분하고 실패 이유를 보존한다", () => {
    expect(resolveInitialRunRecovery({ runs: [{ id: runId, kind: "INITIAL", status: "RUNNING" }] }, runId))
      .toEqual({ kind: "PENDING" });
    expect(resolveInitialRunRecovery({
      runs: [{ id: runId, kind: "INITIAL", status: "FAILED", reason_code: "CLIENT_DISCONNECTED" }],
    }, runId)).toEqual({ kind: "RETRY", reasonCode: "CLIENT_DISCONNECTED" });
  });
  it("다른 Run이나 완료했지만 Passport가 아직 없는 상태를 성공으로 표시하지 않는다", () => {
    expect(resolveInitialRunRecovery({ runs: [{ id: "other", kind: "INITIAL", status: "COMPLETED" }] }, runId))
      .toEqual({ kind: "UNKNOWN" });
    expect(resolveInitialRunRecovery({ runs: [{ id: runId, kind: "INITIAL", status: "COMPLETED" }] }, runId))
      .toEqual({ kind: "PENDING" });
  });
});
