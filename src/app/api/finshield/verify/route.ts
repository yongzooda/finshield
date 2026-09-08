import { cleanupCaseFiles } from "@/lib/finshield/files/cleanup";
/**
 * POST /api/finshield/verify — 확정한 Claim 으로 검증을 실행한다.
 *
 * 진행 상황을 NDJSON 으로 흘린다. 가짜 백분율을 만들지 않는다. 실제로 어느
 * Agent 가 시작하고 끝났는지, 도구를 몇 번 불렀는지만 보낸다 (S-009).
 *
 * 결과에는 근거 이름이 붙는다. 화면은 그 이름으로 근거 상세를 연다 (EV-001).
 */

import { ndjsonStream } from "@/lib/ops/ndjson";
import { jsonNoStore, readJson } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { bearerToken, resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { loadInitialVerificationPreparation, loadRunInput, maskSelection, prepareInitialVerificationStart, selectionSchema } from "@/lib/finshield/run-input";
import { loadManifest } from "@/lib/finshield/registry";
import { runVerification, type RunProgress } from "@/lib/finshield/orchestrator";
import { buildFinalClaims, finalizeRun } from "@/lib/finshield/finalize";
import { createAgentModel, createJudgeModel } from "@/lib/finshield/agents/model-adapter";
import { createHash, randomUUID } from "node:crypto";
import { dispatchNotifications } from "@/lib/finshield/revalidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;



export async function POST(request: Request): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await resolveOwner(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    throw error;
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonNoStore({ error: "요청 형식이 올바르지 않습니다" }, 400);
  const body = selectionSchema.safeParse(parsed.value);
  if (!body.success) return jsonNoStore({ error: "확인할 항목을 다시 선택해 주세요" }, 400);
  const caseId = body.data.case_id;
  const token = bearerToken(request);
  if (!token) return jsonNoStore({ error: "로그인이 필요합니다" }, 401);
  let selected: ReturnType<typeof maskSelection>;
  try { selected = maskSelection(body.data); }
  catch { return jsonNoStore({ error: "수정한 문장에서 개인정보를 지운 뒤 다시 확인해 주세요" }, 400); }

  // 진행 이벤트를 큐에 쌓고 소비자가 깨어나면 흘린다. 가짜 백분율 대신
  // 실제로 일어난 단계만 보낸다.
  const events: unknown[] = [];
  const waiters: (() => void)[] = [];
  let finished = false;
  const wake = () => {
    while (waiters.length > 0) waiters.pop()?.();
  };
  const push = (event: unknown) => {
    events.push(event);
    wake();
  };
  const progress: RunProgress = (event) => push(event);

  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  const heartbeat = setInterval(() => push({ type: "heartbeat" }), 8000);
  let activeRunId: string | null = null;
  const work = (async () => {
    try {
      const manifest = await loadManifest(fsql());
      const preparation = await loadInitialVerificationPreparation(fsql(), token, caseId);
      const runId = await fsql().begin(async sql => {
        // 이전 Stream이 끊겨 화면이 실패를 확인했거나 deadline이 지난 Run만
        // 먼저 terminal로 만든다. 살아 있는 다른 Run은 DB가 거부한다.
        await prepareInitialVerificationStart(sql,ownerId,caseId,body.data.replace_run_id,preparation);
        await sql`select private.confirm_case_claims(${ownerId}::uuid, ${caseId}::uuid,
          ${JSON.stringify(selected)}::text::jsonb)`;
        const run = await sql`select private.create_verification_run(${ownerId}::uuid, ${caseId}::uuid,
          ${manifest.manifestId}::uuid, ${`run-${randomUUID()}`}::text,
          ${createHash("sha256").update(JSON.stringify(selected)).digest("hex")}::text,
          'INITIAL'::public.verification_run_kind, null) as id`;
        return run[0].id as string;
      });
      activeRunId = runId;
      await cleanupCaseFiles(fsql(),ownerId,caseId).catch(()=>undefined);
      const input = await loadRunInput(fsql(), ownerId, caseId, runId);
      const claims = input.claims;
      await fsql()`select id from private.start_verification_run(${runId}::uuid)`;
      push({ type: "run_started", run_id: runId, claims });

      const result = await runVerification({
        ctx: { sql: fsql(), ownerId, caseId, runId, manifest,
          signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Date.parse(input.deadline_at) - Date.now() - 6000))]) },
        claims: claims.map((claim) => ({
          claim_ref: claim.claim_ref, claim_type: claim.claim_type,
          statement_masked: claim.statement_masked, materiality: claim.materiality,
        })),
        maskedIntake: "",
        journeyStage: input.journey_stage,
        agentModel: createAgentModel({sql:fsql(),ownerId,caseId,runId}),
        judgeModel: createJudgeModel({sql:fsql(),ownerId,caseId,runId}),
        progress,
      });

      // 결과를 남긴다. 저장에 실패하면 확정된 것처럼 보여 주지 않는다.
      const withIds = claims.map((claim) => ({
        claimId: claim.claim_id, claim_ref: claim.claim_ref, claim_type: claim.claim_type,
        statement_masked: claim.statement_masked, materiality: claim.materiality,
      }));
      const finals = buildFinalClaims({ claims: withIds, run: result });
      const hasProfile = input.profile_completeness === "COMPLETE";
      const saved = await finalizeRun({ sql: fsql(), runId, ownerId, claims: withIds, run: result, hasProfile });

      if (!saved.ok) await fsql()`select id from private.fail_verification_run(${runId}::uuid,'FINALIZE_FAILED',${saved.reason})`;
      else await dispatchNotifications(fsql()).catch(()=>0);
      push({
        type: "done",
        guide: saved.ok ? saved.guide : null,
        axes: saved.ok ? saved.axes : null,
        axes_pending_restore: saved.ok && saved.axes === null,
        saved: saved.ok,
        save_reason: saved.ok ? null : saved.reason,
        // 독립 검증이 상태를 낮췄으면 그 결과를 보여 준다. 화면과 저장이 같은 값을 쓴다.
        final_claims: finals.map((entry) => ({
          claim_ref: claims.find((claim) => claim.claim_id === entry.claim_id)?.claim_ref ?? "",
          state: entry.status, reason_code: entry.reason_code,
          cove_status: entry.cove_status, red_team_status: entry.red_team_status,
          summary_masked: entry.decision_summary_masked,
        })),
        run_id: runId,
        // RES-008: 온전히 끝나지 않았으면 결과 맨 위에 알린다.
        partial: result.partial,
        agents: result.agentResults,
        claim_results: result.judgeOutput?.claim_results ?? [],
        conflicts: result.judgeOutput?.conflicts ?? [],
        judge_reason_code: result.judgeReasonCode,
        evidence: result.evidence.map((item) => ({
          ref: item.evidence_ref, title: item.title, source: item.source_type,
          grade: item.authority_grade, official_id: item.official_id, url: item.url,
          published_at: item.published_at, fetched_at: item.fetched_at,
          content_hash: item.content_hash, freshness: item.freshness_at_use,
          directness: item.directness, reference_only: item.reference_only,
          excerpt: item.excerpt_masked,
        })),
      });
    } catch (error) {
      const errorName = (error as { name?: string })?.name;
      const deadline = errorName === "AbortError" || errorName === "TimeoutError";
      const clientDisconnected = abort.signal.aborted || request.signal.aborted;
      if (activeRunId) await fsql()`select id from private.fail_verification_run(${activeRunId}::uuid,
        ${clientDisconnected ? "CLIENT_DISCONNECTED" : deadline ? "DEADLINE_EXCEEDED" : "VERIFICATION_FAILED"},null)`.catch(()=>undefined);
      // 내부 사정을 화면에 흘리지 않는다. 무엇이 안 됐는지만 알린다.
      push({ type: "error", message: deadline
        ? "제한 시간 안에 검증을 끝내지 못했습니다. 같은 항목으로 다시 시도해 주세요."
        : "검증을 끝내지 못했습니다. 같은 항목으로 다시 시도해 주세요.",
        code: (error as { code?: string })?.code ?? null });
    } finally {
      clearInterval(heartbeat);
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

  return ndjsonStream(stream(), () => abort.abort());
}
