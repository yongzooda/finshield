import { beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

vi.mock("../rest", () => ({ restSelect: vi.fn() }));

import { restSelect } from "../rest";
import { loadInitialVerificationPreparation, prepareInitialVerificationStart } from "../run-input";

const ownerId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const asSql = (mock: ReturnType<typeof vi.fn>) => mock as unknown as ReturnType<typeof postgres>;
const queryOf = (mock: ReturnType<typeof vi.fn>, index = 0) => mock.mock.calls[index][0].join("");

describe("초기 검증 준비", () => {
  beforeEach(() => vi.mocked(restSelect).mockReset());

  it("0045 함수가 있으면 사용자 View를 추가 조회하지 않는다", async () => {
    const sql = vi.fn().mockResolvedValue([{ ok: true }]);
    await expect(loadInitialVerificationPreparation(asSql(sql), "token", caseId)).resolves.toEqual({ native: true });
    expect(restSelect).not.toHaveBeenCalled();
  });

  it("0045 함수가 없으면 RLS 적용 Case View에서 활성 Run을 복원한다", async () => {
    const sql = vi.fn().mockResolvedValue([{ ok: false }]);
    vi.mocked(restSelect).mockResolvedValue([{
      id: caseId,
      lifecycle: "VERIFYING",
      runs: [{ run_id: runId, kind: "INITIAL", status: "RUNNING", deadline_at: "2099-01-01T00:00:00Z" }],
    }]);

    await expect(loadInitialVerificationPreparation(asSql(sql), "token", caseId)).resolves.toEqual({
      native: false,
      lifecycle: "VERIFYING",
      activeRun: { run_id: runId, deadline_at: "2099-01-01T00:00:00Z" },
    });
    expect(restSelect).toHaveBeenCalledWith({
      token: "token",
      path: "case_detail_v",
      query: { select: "id,lifecycle,runs", id: `eq.${caseId}` },
    });
  });

  it("최초 DRAFT는 Base table 조회 없이 정의자 전이 함수로 준비한다", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    await prepareInitialVerificationStart(asSql(sql), ownerId, caseId, undefined, {
      native: false, lifecycle: "DRAFT", activeRun: null,
    });

    expect(sql).toHaveBeenCalledTimes(1);
    expect(queryOf(sql)).toContain("private.transition_financial_case");
    expect(queryOf(sql)).not.toContain("from public.financial_cases");
    expect(queryOf(sql)).not.toContain("from public.verification_runs");
  });

  it("살아 있는 다른 Run은 상태를 바꾸지 않고 거부한다", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    await expect(prepareInitialVerificationStart(asSql(sql), ownerId, caseId, undefined, {
      native: false,
      lifecycle: "VERIFYING",
      activeRun: { run_id: runId, deadline_at: "2099-01-01T00:00:00Z" },
    })).rejects.toMatchObject({ code: "23505" });
    expect(sql).not.toHaveBeenCalled();
  });

  it("사용자가 받은 정확한 Run ID만 CLIENT_RETRY로 종결한다", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    await prepareInitialVerificationStart(asSql(sql), ownerId, caseId, runId, {
      native: false,
      lifecycle: "VERIFYING",
      activeRun: { run_id: runId, deadline_at: "2099-01-01T00:00:00Z" },
    });

    expect(sql).toHaveBeenCalledTimes(1);
    expect(queryOf(sql)).toContain("private.fail_verification_run");
    expect(sql.mock.calls[0]).toContain("CLIENT_RETRY");
  });

  it("만료 Run은 화면의 Run ID가 없어도 DEADLINE_EXCEEDED로 회수한다", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    await prepareInitialVerificationStart(asSql(sql), ownerId, caseId, undefined, {
      native: false,
      lifecycle: "VERIFYING",
      activeRun: { run_id: runId, deadline_at: "2000-01-01T00:00:00Z" },
    });

    expect(queryOf(sql)).toContain("private.fail_verification_run");
    expect(sql.mock.calls[0]).toContain("DEADLINE_EXCEEDED");
  });

  it("0045 함수 경로는 기존 원자 함수를 그대로 사용한다", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    await prepareInitialVerificationStart(asSql(sql), ownerId, caseId, runId, { native: true });
    expect(queryOf(sql)).toContain("private.prepare_initial_verification_retry");
  });
});
