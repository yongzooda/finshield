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

export const failRevalidation = async (
  sql: Sql, jobId: string, leaseToken: string, code: string,
): Promise<void> => {
  await sql`select private.fail_revalidation_job(${jobId}::uuid, ${leaseToken}::uuid, ${code})`
    .catch(() => undefined);
};

/**
 * Outbox 에 쌓인 알림 요청을 실제 알림으로 옮긴다.
 *
 * 최종화는 알림을 직접 만들지 않고 Outbox 만 남긴다. 그래야 알림 실패가 결과
 * 저장을 되돌리지 않는다. 재검증 Workflow의 최종화 뒤에 옮긴다.
 */
export const dispatchNotifications = async (sql: Sql): Promise<number> => {
  const events = await sql`select * from private.claim_notification_events(20)`;
  let made = 0;
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.event_type !== "NOTIFICATION_REQUESTED") {
      continue;
    }
    const type = String(payload.notification_type ?? "");
    const copy = type === "VERIFICATION_COMPLETED"
      ? {title:"검증 결과가 저장되었습니다",body:"판단과 확인 범위를 검증 기록에서 확인하세요."}
      : type === "MATERIAL_CHANGE_DETECTED"
      ? {title:"다시 확인했더니 달라진 것이 있습니다",body:"지난 판과 견주어 결과가 달라졌습니다. 무엇이 달라졌는지 기록에서 확인하세요."}
      : type === "REVALIDATION_NO_CHANGE"
      ? {title:"다시 확인했으나 달라진 것이 없습니다",body:"확인한 범위에서 중요한 변화가 없었습니다. 이전 기록과 새 기록을 함께 확인하세요."}
      : null;
    try {
      if (!copy) throw new Error("NOTIFICATION_TYPE_UNSUPPORTED");
      await sql`
        insert into public.notifications
          (owner_id, case_id, notification_type, revalidation_job_id, passport_diff_id, passport_id,
           deduplication_key, title, body_masked)
        values (${payload.owner_id as string}::uuid, ${payload.case_id as string}::uuid, ${type},
                ${(payload.revalidation_job_id as string) ?? null}::uuid,
                ${(payload.passport_diff_id as string) ?? null}::uuid,
                ${(payload.passport_id as string) ?? null}::uuid,
                ${String(event.deduplication_key)},
                ${copy.title},${copy.body})
        on conflict (owner_id, channel, deduplication_key) do nothing`;
      await sql`select private.finish_outbox_event(${event.id as string}::uuid, null)`;
      made += 1;
    } catch {
      await sql`select private.finish_outbox_event(${event.id as string}::uuid, 'NOTIFY_FAILED')`
        .catch(() => undefined);
    }
  }
  return made;
};
