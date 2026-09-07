/**
 * POST /api/finshield/cases/[id]/revalidate — 수동 재검증 (S-014).
 *
 * 지난 결과를 고치지 않는다. 같은 Claim 을 오늘의 자료로 다시 보고 새 판을
 * 쌓는다. 무엇이 달라졌는지는 데이터베이스가 두 판을 견주어 남긴다.
 *
 * 진행은 NDJSON 으로 흘린다. 가짜 백분율 대신 실제 단계만 보낸다 (S-009).
 */

import { ndjsonStream } from "@/lib/ops/ndjson";
import { jsonNoStore } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { loadRunInput } from "@/lib/finshield/run-input";
import { loadManifest } from "@/lib/finshield/registry";
import { runVerification, type RunProgress } from "@/lib/finshield/orchestrator";
import { createAgentModel, createJudgeModel } from "@/lib/finshield/agents/model-adapter";
import {
  RevalidationBusyError, dispatchNotifications, failRevalidation, finalizeRevalidation,
  heartbeat, startRevalidation,
} from "@/lib/finshield/revalidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await resolveOwner(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    throw error;
  }
  const { id: caseId } = await context.params;
  if (!UUID.test(caseId)) return jsonNoStore({ error: "잘못된 주소입니다" }, 400);

  const sql = fsql();
  let job: { jobId: string; leaseToken: string; basePassportId: string };
  try {
    job = await startRevalidation({ sql, ownerId, caseId });
  } catch (error) {
    if (error instanceof RevalidationBusyError) return jsonNoStore({ error: error.message }, 409);
    const code = String((error as { code?: string })?.code ?? "");
    if (code === "42501") return jsonNoStore({ error: "이 Case 를 찾을 수 없습니다" }, 404);
    if (code === "23514" || code === "23505") {
      return jsonNoStore({ error: "이미 진행 중인 재검증이 있습니다" }, 409);
    }
    throw error;
  }

  const events: unknown[] = [];
  const waiters: (() => void)[] = [];
  let finished = false;
  const wake = () => { while (waiters.length > 0) waiters.pop()?.(); };
  const push = (event: unknown) => { events.push(event); wake(); };
  const progress: RunProgress = push;

  const work = (async () => {
    let runId: string | null = null;
    try {
      const manifest = await loadManifest(sql);
      const created = await sql`
        select private.create_verification_run(${ownerId}::uuid, ${caseId}::uuid,
          ${manifest.manifestId}::uuid, ${`reval-run-${job.jobId}`}::text,
          ${"0".repeat(64)}::text, 'REVALIDATION'::public.verification_run_kind,
          ${job.jobId}::uuid) as id`;
      runId = created[0].id as string;
      await sql`select id from private.start_verification_run(${runId}::uuid)`;
      const input = await loadRunInput(sql, ownerId, caseId, runId);
      const claims = input.claims;
      push({ type: "run_started", run_id: runId, job_id: job.jobId });

      const result = await runVerification({
        ctx: { sql, ownerId, caseId, runId, manifest,
          signal: AbortSignal.timeout(Math.max(1, Date.parse(input.deadline_at) - Date.now() - 6000)) },
        claims: claims.map((claim) => ({
          claim_ref: claim.claim_ref, claim_type: claim.claim_type,
          statement_masked: claim.statement_masked, materiality: claim.materiality,
        })),
        // 재검증은 원문을 다시 읽지 않는다. 확정된 Claim 문장만 본다.
        maskedIntake: "",
        journeyStage: input.journey_stage,
        agentModel: createAgentModel(),
        judgeModel: createJudgeModel(),
        progress,
      });

      await heartbeat(sql, job.jobId, job.leaseToken);
      const hasProfile = input.profile_completeness === "COMPLETE";
      const saved = await finalizeRevalidation({
        sql, jobId: job.jobId, leaseToken: job.leaseToken, runId, claims, run: result, hasProfile,
      });
      if (!saved.ok) {
        await failRevalidation(sql, job.jobId, job.leaseToken, saved.reason);
        push({ type: "error", message: "결과를 남기지 못했습니다" });
        return;
      }

      // 최종화가 남긴 Outbox 를 알림으로 옮긴다. 실패해도 결과는 이미 남았다.
      await dispatchNotifications(sql).catch(() => 0);

      const diffs = await sql`
        select id, material_change, claim_changes, evidence_changes, result_changes, created_at
          from public.passport_diffs
         where revalidation_job_id = ${job.jobId}::uuid limit 1`;
      const status = await sql`
        select status, result_passport_id from public.revalidation_jobs
         where id = ${job.jobId}::uuid`;
      push({
        type: "done",
        job_status: status[0]?.status ?? null,
        passport_id: status[0]?.result_passport_id ?? null,
        partial: result.partial,
        agents: result.agentResults,
        diff: diffs[0]
          ? {
            id: diffs[0].id, material_change: diffs[0].material_change,
            claim_changes: diffs[0].claim_changes, evidence_changes: diffs[0].evidence_changes,
            result_changes: diffs[0].result_changes,
          }
          : null,
        claims: claims.map((claim) => ({ claim_id: claim.claimId, statement_masked: claim.statement_masked })),
      });
    } catch (error) {
      await failRevalidation(sql, job.jobId, job.leaseToken, "RUN_FAILED");
      push({ type: "error", message: "다시 확인하지 못했습니다", code: (error as { code?: string })?.code ?? null });
    } finally {
      finished = true;
      wake();
    }
  })();

  async function* stream(): AsyncGenerator<unknown> {
    let index = 0;
    while (!finished || index < events.length) {
      if (index < events.length) { yield events[index]; index += 1; continue; }
      await new Promise<void>((resolve) => { waiters.push(resolve); });
    }
    await work;
  }

  return ndjsonStream(stream());
}
