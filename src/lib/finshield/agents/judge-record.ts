import type { ModelUsage } from "../model-budget";
import { FINSHIELD_MODEL } from "../manifest";
import "server-only";
import { createHash } from "node:crypto";
import { AGENTS } from "../manifest";
import type { RunSession } from "../tools/runtime";

/** AI-020·PASS-001: Judge도 실제 실행 이력을 남겨 완결성을 검사할 수 있게 한다. */
export async function recordJudgeRun(session: RunSession, input: unknown, output: unknown, startedAt: number, reasonCode: string | null, usage?: ModelUsage) {
  const spec = AGENTS.find(agent => agent.agentCode === "EVIDENCE_JUDGE")!;
  const status = output ? reasonCode ? "PARTIAL" : "SUCCEEDED" : "FAILED";
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (session.recorder) {
    await session.recorder.agentRun({ agentCode: spec.agentCode, version: spec.version, logicalKey: spec.logicalKey,
      status, startedAt, finishedAt: Date.now(), reasonCode, toolCalls: 0, evidenceCount: session.evidence.size, findingCount: 0 });
    return;
  }
  const { sql, ownerId, caseId, runId } = session;
  const attempts = await sql`select count(*)::int as n from public.agent_runs
    where verification_run_id=${runId}::uuid and logical_agent_key=${spec.logicalKey}`;
  await sql`insert into public.agent_runs
    (owner_id,case_id,verification_run_id,logical_agent_key,agent_code,agent_version,attempt_no,status,
     input_schema_version,output_schema_version,prompt_version,input_digest,output_digest,sanitized_summary,
     model_provider,model_id,input_tokens,output_tokens,cost_microunits,started_at,finished_at,latency_ms,reason_code)
    values (${ownerId}::uuid,${caseId}::uuid,${runId}::uuid,${spec.logicalKey},${spec.agentCode},${spec.version},
      ${(attempts[0].n as number)+1},${status}::public.execution_status,${spec.inputSchemaVersion},${spec.outputSchemaVersion},
      ${spec.promptVersion},${digest(input)},${output ? digest(output) : null},
      ${sql.json({schema_version:"1",tool_calls:0,evidence_count:session.evidence.size,usage_status:usage ? usage.unknownCalls?"RECONCILE_REQUIRED":"REPORTED" : "NOT_RECORDED"})},
      'anthropic',${FINSHIELD_MODEL},${usage?.inputTokens??0},${usage?.outputTokens??0},${usage?.costMicrounits??0},${new Date(startedAt).toISOString()},now(),${Date.now()-startedAt},${reasonCode})`;
}
