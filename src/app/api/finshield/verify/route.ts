/**
 * POST /api/finshield/verify — 확정한 Claim 으로 검증을 실행한다.
 *
 * 진행 상황을 NDJSON 으로 흘린다. 가짜 백분율을 만들지 않는다. 실제로 어느
 * Agent 가 시작하고 끝났는지, 도구를 몇 번 불렀는지만 보낸다 (S-009).
 *
 * 결과에는 근거 이름이 붙는다. 화면은 그 이름으로 근거 상세를 연다 (EV-001).
 */

import { ndjsonStream } from "@/lib/ops/ndjson";
import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { confirmClaims } from "@/lib/finshield/intake";
import { loadManifest } from "@/lib/finshield/registry";
import { runVerification, type RunProgress } from "@/lib/finshield/orchestrator";
import { buildFinalClaims, finalizeRun } from "@/lib/finshield/finalize";
import { createAgentModel, createJudgeModel } from "@/lib/finshield/agents/model-adapter";
import type { ConfirmedClaim } from "@/lib/finshield/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STAGES = ["PRE_TRANSACTION", "ENROLLED", "FUNDS_SENT_OR_DAMAGE_SUSPECTED"] as const;

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
  const body = parsed.value as { case_id?: unknown; claims?: unknown; journey_stage?: unknown; masked_text?: unknown };
  const caseId = str(body, "case_id");
  if (!caseId) return jsonNoStore({ error: "Case 를 지정해 주세요" }, 400);
  const stage = STAGES.includes(body.journey_stage as (typeof STAGES)[number])
    ? (body.journey_stage as (typeof STAGES)[number]) : "PRE_TRANSACTION";
  const selected = Array.isArray(body.claims) ? body.claims : [];
  const claims = selected.filter((claim): claim is { claim_id: string } & ConfirmedClaim =>
    typeof (claim as { claim_id?: unknown })?.claim_id === "string"
    && typeof (claim as { claim_ref?: unknown })?.claim_ref === "string");
  if (claims.length === 0) return jsonNoStore({ error: "확인할 Claim 을 하나 이상 골라 주세요" }, 400);
  const maskedText = (str(body, "masked_text") ?? "").slice(0, 4000);

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

  const work = (async () => {
    try {
      await confirmClaims({ sql: fsql(), ownerId, caseId, claimIds: claims.map((claim) => claim.claim_id) });
      await fsql()`select private.transition_financial_case(${ownerId}::uuid, ${caseId}::uuid,
        'INPUT_REVIEW'::public.case_lifecycle, 'USER', 'CLAIMS_CONFIRMED') as ok`;
      const manifest = await loadManifest(fsql());
      const run = await fsql()`
        select private.create_verification_run(${ownerId}::uuid, ${caseId}::uuid,
          ${manifest.manifestId}::uuid, ${`run-${caseId}-${Date.now()}`}::text,
          ${"0".repeat(64)}::text, 'INITIAL'::public.verification_run_kind, null) as id`;
      const runId = run[0].id as string;
      await fsql()`select id from private.start_verification_run(${runId}::uuid)`;
      push({ type: "run_started", run_id: runId });

      const result = await runVerification({
        ctx: { sql: fsql(), ownerId, caseId, runId, manifest },
        claims: claims.map((claim) => ({
          claim_ref: claim.claim_ref, claim_type: claim.claim_type,
          statement_masked: claim.statement_masked, materiality: claim.materiality,
        })),
        // 접수 단계에서 Gate 를 지난 문장이다. 브라우저가 이미 들고 있는 값이라
        // 새로 드러나는 것이 없다. Judge 에는 넘어가지 않고 Domain Agent 만 본다.
        maskedIntake: maskedText,
        journeyStage: stage,
        agentModel: createAgentModel(),
        judgeModel: createJudgeModel(),
        progress,
      });

      // 결과를 남긴다. 저장에 실패하면 확정된 것처럼 보여 주지 않는다.
      const withIds = claims.map((claim) => ({
        claimId: claim.claim_id, claim_ref: claim.claim_ref, claim_type: claim.claim_type,
        statement_masked: claim.statement_masked, materiality: claim.materiality,
      }));
      const finals = buildFinalClaims({ claims: withIds, run: result });
      const saved = await finalizeRun({ sql: fsql(), runId, claims: withIds, run: result, hasProfile: true });

      push({
        type: "done",
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
      // 내부 사정을 화면에 흘리지 않는다. 무엇이 안 됐는지만 알린다.
      push({ type: "error", message: "검증을 끝내지 못했습니다", code: (error as { code?: string })?.code ?? null });
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
