/**
 * 재검증 (S-014, 명세 6.6).
 *
 * 같은 Claim 을 오늘의 공식 자료로 다시 확인한다. 지난 결과를 고치지 않고 새 Run
 * 과 새 Passport 판을 만든다. 무엇이 달라졌는지는 데이터베이스가 두 판을 견주어
 * `passport_diffs` 에 남긴다. 화면은 그 값을 읽을 뿐 스스로 비교하지 않는다.
 *
 * P0 에는 Job Runner 가 없다. 그래서 요청 안에서 Job 을 만들고 그 자리에서
 * 실행한다. Job·Lease·Event 는 그대로 남기므로, 나중에 Runner 가 생겨도 같은
 * 기록 위에서 이어 갈 수 있다.
 */

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { ConfirmedClaim } from "./schemas";
import type { OrchestratedRun } from "./orchestrator";
import { buildActionGuide } from "./action-guide";
import { buildAxisResults, buildFinalClaims } from "./finalize";

type Sql = ReturnType<typeof postgres>;

export type RevalidationClaim = ConfirmedClaim & { claimId: string };

export class RevalidationBusyError extends Error {}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * 지난번에 확인하기로 정한 Claim 을 그대로 다시 가져온다.
 *
 * 새 Claim 을 여기서 만들지 않는다. 재검증은 «같은 것을 다시 본다» 는 뜻이고,
 * 무엇을 볼지 바꾸는 것은 사용자의 몫이다.
 */
export const loadConfirmedClaims = async (
  sql: Sql, ownerId: string, caseId: string,
): Promise<RevalidationClaim[]> => {
  const rows = await sql`
    select c.id, c.claim_type, r.statement_masked, r.materiality
      from public.claims c
      join lateral (
        select statement_masked, materiality, is_removed, user_confirmed
          from public.claim_revisions
         where claim_id = c.id and owner_id = ${ownerId}::uuid
         order by revision_no desc limit 1) r on true
     where c.owner_id = ${ownerId}::uuid and c.case_id = ${caseId}::uuid
       and r.user_confirmed and not r.is_removed
     order by c.created_at asc`;
  return rows.map((row, index) => ({
    claimId: row.id as string,
    claim_ref: `c${index + 1}`,
    claim_type: row.claim_type as ConfirmedClaim["claim_type"],
    statement_masked: row.statement_masked as string,
    materiality: row.materiality as ConfirmedClaim["materiality"],
  }));
};

/** 재검증 Job 을 만들고 그 자리에서 잡는다. 남의 Job 을 잡으면 손대지 않고 물러난다. */
export const startRevalidation = async (args: {
  sql: Sql; ownerId: string; caseId: string;
}): Promise<{ jobId: string; leaseToken: string; basePassportId: string }> => {
  const { sql, ownerId, caseId } = args;
  const token = randomUUID();
  const enqueued = await sql`
    select private.enqueue_revalidation(${ownerId}::uuid, ${caseId}::uuid,
      ${`reval:${caseId}:${token}`}, ${hash(`${caseId}:${token}`)}) as id`;
  const jobId = enqueued[0].id as string;

  const claimed = await sql`
    select job_id, lease_token, owner_id, base_passport_id
      from private.claim_case_revalidation_job(${ownerId}::uuid, ${jobId}::uuid, ${`web:${token.slice(0, 8)}`}, 600)`;
  const row = claimed[0];
  if (!row || row.job_id !== jobId || row.owner_id !== ownerId) {
    // 다른 Job 이 앞에 있었다. 그 Job 은 건드리지 않고 Lease 가 풀리길 기다린다.
    throw new RevalidationBusyError("지금은 다른 재검증이 실행 중입니다. 잠시 뒤 다시 해 주세요");
  }
  return {
    jobId,
    leaseToken: row.lease_token as string,
    basePassportId: row.base_passport_id as string,
  };
};

export const heartbeat = async (sql: Sql, jobId: string, leaseToken: string): Promise<void> => {
  // Lease 를 잃으면 호출자에게 실패를 전달한다.
  await sql`select private.heartbeat_revalidation_job(${jobId}::uuid, ${leaseToken}::uuid, 600)`;
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
 * 저장을 되돌리지 않는다. P0 에는 Dispatcher 가 따로 없으므로 같은 요청 안에서
 * 옮긴다.
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
    const changed = type === "MATERIAL_CHANGE_DETECTED";
    try {
      await sql`
        insert into public.notifications
          (owner_id, case_id, notification_type, revalidation_job_id, passport_diff_id, passport_id,
           deduplication_key, title, body_masked)
        values (${payload.owner_id as string}::uuid, ${payload.case_id as string}::uuid, ${type},
                ${(payload.revalidation_job_id as string) ?? null}::uuid,
                ${(payload.passport_diff_id as string) ?? null}::uuid,
                ${(payload.passport_id as string) ?? null}::uuid,
                ${String(event.deduplication_key)},
                ${changed ? "다시 확인했더니 달라진 것이 있습니다" : "다시 확인했으나 달라진 것이 없습니다"},
                ${changed
                  ? "지난 판과 견주어 결과가 달라졌습니다. 무엇이 달라졌는지 기록에서 확인하세요."
                  : "지난 판과 견주어 달라진 것이 없습니다. 이전 판단은 그대로 둡니다."})
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
