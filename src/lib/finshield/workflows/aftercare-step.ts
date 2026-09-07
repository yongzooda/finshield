import { RetryableError } from "workflow";
import { fsql } from "../db";
import { aftercareContextSchema, runAftercareReview } from "../aftercare-review";
import { createAgentModel } from "../agents/model-adapter";
import { loadManifest } from "../registry";

export async function executeAftercareStep(jobId: string) {
  "use step";
  const sql = fsql();
  const [claimed] = await sql`select private.claim_precase_review(${jobId}::uuid) as token`;
  const [row] = await sql`select private.precase_review_context(${jobId}::uuid) as context`;
  if (!row.context) return { status: "CANCELLED" };
  if (!claimed.token) {
    if (["QUEUED", "RUNNING"].includes(row.context.status)) throw new RetryableError("AFTERCARE_LEASE_BUSY", { retryAfter: "30s" });
    return { status: row.context.status };
  }
  const lease = claimed.token as string;
  const abort = new AbortController(); let pulseBusy = false;
  const pulse = setInterval(() => {
    if (pulseBusy) return; pulseBusy = true;
    void sql`select private.heartbeat_precase_review(${jobId}::uuid,${lease}::uuid) as ok`
      .then(rows => { if (!rows[0]?.ok) abort.abort(); }).catch(() => abort.abort()).finally(() => { pulseBusy = false; });
  }, 2000);
  try {
    const context = aftercareContextSchema.parse(row.context);
    const manifest = await loadManifest(sql);
    if (manifest.manifestId !== context.execution_manifest_id) throw new Error("AFTERCARE_MANIFEST_DRIFT");
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, Date.parse(context.deadline_at) - Date.now() - 6000))]);
    const decision = await runAftercareReview({ context, lease,
      ctx: { sql, ownerId: context.owner_id, caseId: context.case_id, runId: jobId, aftercareJobId: jobId, manifest, signal },
      model: createAgentModel({ sql, ownerId: context.owner_id, caseId: context.case_id, aftercareJobId: jobId }) });
    abort.signal.throwIfAborted();
    const institutions = decision.actions.map(a => a.institution_code).filter((v): v is string => Boolean(v));
    const channels = await sql`select id,institution_code,channel_type from kb.official_channel_registry
      where institution_code=any(${institutions}::text[]) and (valid_to is null or valid_to>=current_date)`;
    const actions = decision.actions.map(a => ({ action_code: a.action_code, required_material_codes: a.required_material_codes,
      official_channel_registry_id: channels.find(c => c.institution_code === a.institution_code && c.channel_type === a.channel_type)?.id ?? "" }));
    const [saved] = await sql`select private.finish_precase_review(${jobId}::uuid,${lease}::uuid,${decision.result}::public.aftercare_result,
      ${decision.summary_masked},${JSON.stringify(actions)}::text::jsonb) as id`;
    if (!saved.id) throw new Error("AFTERCARE_FINALIZE_UNCONFIRMED");
    const [final] = await sql`select private.precase_review_context(${jobId}::uuid) as context`;
    return { status: final.context.status };
  } catch {
    const [failed] = await sql`select private.fail_precase_review(${jobId}::uuid,${lease}::uuid,'REVIEW_FAILED') as ok`;
    if (!failed.ok) {
      const [final] = await sql`select private.precase_review_context(${jobId}::uuid) as context`;
      if (final.context && ["QUEUED", "RUNNING"].includes(final.context.status)) throw new RetryableError("AFTERCARE_TERMINAL_UNCONFIRMED", { retryAfter: "30s" });
      return { status: final.context?.status ?? "CANCELLED" };
    }
    return { status: "FAILED" };
  } finally { clearInterval(pulse); }
}
executeAftercareStep.maxRetries = 8;
