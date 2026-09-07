/**
 * 재검증 (S-014, 명세 6.6).
 *
 * 같은 Claim 을 오늘의 공식 자료로 다시 확인한다. 지난 결과를 고치지 않고 새 Run
 * 과 새 Passport 판을 만든다. 무엇이 달라졌는지는 데이터베이스가 두 판을 견주어
 * `passport_diffs` 에 남긴다. 화면은 그 값을 읽을 뿐 스스로 비교하지 않는다.
 *
 * 재검증은 Workflow에서 Job·Lease를 통해 실행하고 화면은 저장된 상태를 읽는다.
 */

import "server-only";
import type postgres from "postgres";
import type { ConfirmedClaim } from "./schemas";
import type { OrchestratedRun, RunProgress } from "./orchestrator";
import { buildActionGuide } from "./action-guide";
import { buildAxisResults, buildFinalClaims } from "./finalize";

type Sql = ReturnType<typeof postgres>;

/** REV-001: 진행 정보는 기존 HEARTBEAT 이벤트 계약의 하위 유형으로 저장한다. */
export async function recordRevalidationProgress(sql: Sql, jobId: string, event: Parameters<RunProgress>[0]) {
  await sql`select private.append_revalidation_event(${jobId}::uuid,'HEARTBEAT_PROGRESS',${JSON.stringify(event)}::text::jsonb)`;
}

export type RevalidationClaim = ConfirmedClaim & { claimId: string };

export const heartbeat = async (sql: Sql, jobId: string, leaseToken: string): Promise<void> => {
  // Lease 를 잃으면 호출자에게 실패를 전달한다.
  const rows = await sql`select private.heartbeat_revalidation_job(${jobId}::uuid, ${leaseToken}::uuid, 600) as ok`;
  if (!rows[0]?.ok) throw new Error("REVALIDATION_LEASE_LOST");
};

export const finalizeRevalidation = async (args: {
  sql: Sql;
  jobId: string;
  leaseToken: string;
  runId: string;
  claims: RevalidationClaim[];
  run: OrchestratedRun;
  hasProfile: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const finals = buildFinalClaims({ claims: args.claims, run: args.run });
  const axes = buildAxisResults(finals, args.hasProfile);
  const partialReasons = args.run.agentResults
    .filter((entry) => entry.status !== "SUCCEEDED")
    .map((entry) => entry.reasonCode ?? "AGENT_PARTIAL");
  try {
    const guide = await buildActionGuide(args.sql);
    await args.sql`
      select private.finalize_revalidation(${args.jobId}::uuid, ${args.leaseToken}::uuid,
        ${args.runId}::uuid, ${JSON.stringify(finals)}::text::jsonb,
        ${JSON.stringify(axes)}::text::jsonb, ${JSON.stringify(guide.stored)}::text::jsonb,
        ${partialReasons}::text[], 'p1') as id`;
    return { ok: true };
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "FINALIZE_FAILED");
    return { ok: false, reason: code };
  }
};

/** 실패 Job에 연결된 활성 Run도 같은 트랜잭션 안에서 종결한다. */
const failActiveRevalidationRuns = async (tx: postgres.TransactionSql, jobId: string, code: string) => {
  const runs = await tx`select id from public.verification_runs
    where revalidation_job_id=${jobId}::uuid and status in ('QUEUED','RUNNING') order by id`;
  for (const run of runs) {
    await tx`select id from private.fail_verification_run(${run.id as string}::uuid,${code},null)`;
  }
};

/** 응답 유실과 과거의 분리 쓰기로 남은 Run을 복구한 뒤 종결을 확인한다. */
export const confirmRevalidationTerminal = async (sql: Sql, jobId: string): Promise<string> => {
  try {
    return await sql.begin(async tx => {
      const rows = await tx`select private.revalidation_context(${jobId}::uuid) as context`;
      const status = rows[0]?.context?.status as unknown;
      if (status !== "FAILED" && status !== "NO_CHANGE" && status !== "CHANGED") {
        throw new Error("REVALIDATION_TERMINAL_UNCONFIRMED");
      }
      // FAILED는 최종 상태다. 과거 Job만 실패한 기록은 모델 재호출 없이 복구한다.
      if (status === "FAILED") await failActiveRevalidationRuns(tx,jobId,"WORKFLOW_INTERRUPTED");
      const active = await tx`select id from public.verification_runs
        where revalidation_job_id=${jobId}::uuid and status in ('QUEUED','RUNNING') limit 1`;
      if (active.length) throw new Error("REVALIDATION_TERMINAL_UNCONFIRMED");
      return status;
    });
  } catch {
    throw new Error("REVALIDATION_TERMINAL_UNCONFIRMED");
  }
};

export const failRevalidation = async (
  sql: Sql, jobId: string, leaseToken: string, code: string,
): Promise<string> => {
  // Job 잠금·Lease 검사를 먼저 거친다. 만료 Worker가 다른 Run을 종결하면 안 된다.
  // Run 쓰기 실패 시 Job·Lease 해제·실패 이벤트도 함께 rollback한다.
  await sql.begin(async tx => {
    await tx`select private.fail_revalidation_job(${jobId}::uuid,${leaseToken}::uuid,${code})`;
    await failActiveRevalidationRuns(tx,jobId,code);
  }).catch(() => undefined);
  return await confirmRevalidationTerminal(sql,jobId);
};

/**
 * Outbox 에 쌓인 알림 요청을 실제 알림으로 옮긴다.
 *
 * 최종화는 알림을 직접 만들지 않고 Outbox 만 남긴다. 그래야 알림 실패가 결과
 * 저장을 되돌리지 않는다. 재검증 Workflow의 최종화 뒤에 옮긴다.
 */
export const dispatchNotifications = async (sql: Sql, ownerId: string | null = null): Promise<number> => {
  const [row] = await sql`select private.deliver_notification_batch(${ownerId}::uuid,20) as result`;
  return Number(row?.result?.delivered ?? 0);
};
