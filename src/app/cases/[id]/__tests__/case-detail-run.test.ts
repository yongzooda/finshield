import { describe, expect, it } from "vitest";
import { pickResultRun } from "../case-detail";

const run = (id: string, status: string) => ({ id, status });

describe("기록 화면이 결과로 보여 줄 실행 (S-011)", () => {
  it("재검증이 실패하면 이전 확정 실행을 결과로 두고 실패는 따로 알린다", () => {
    const picked = pickResultRun({
      case: { latest_successful_run_id: "r1" },
      runs: [run("r2", "FAILED"), run("r1", "SUCCEEDED")],
      passports: [{ verification_run_id: "r1" }],
    });
    expect(picked.latest?.id).toBe("r1");
    expect(picked.newest?.id).toBe("r2");
    expect(picked.newestPending).toBe(true);
  });

  it("재검증이 진행 중이어도 이전 확정 결과를 계속 보여 준다", () => {
    const picked = pickResultRun({
      case: { latest_successful_run_id: "r1" },
      runs: [run("r2", "RUNNING"), run("r1", "SUCCEEDED")],
      passports: [{ verification_run_id: "r1" }],
    });
    expect(picked.latest?.id).toBe("r1");
    expect(picked.newestPending).toBe(true);
  });

  it("확정 표시가 없으면 Passport 가 있는 가장 최근 실행을 쓰고, 둘 다 없으면 최신 실행을 쓴다", () => {
    expect(pickResultRun({
      case: { latest_successful_run_id: null },
      runs: [run("r3", "FAILED"), run("r2", "PARTIAL"), run("r1", "SUCCEEDED")],
      passports: [{ verification_run_id: "r2" }, { verification_run_id: "r1" }],
    }).latest?.id).toBe("r2");
    const first = pickResultRun({ case: { latest_successful_run_id: null }, runs: [run("r1", "RUNNING")], passports: [] });
    expect(first.latest?.id).toBe("r1");
    expect(first.newestPending).toBe(false);
  });
});
