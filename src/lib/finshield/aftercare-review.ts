import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { gateForModel } from "@/lib/agents/pii";
import { runDomainAgent, type AgentModel } from "./agents/runner";
import { confirmedClaim, type DomainAgentInput } from "./schemas";
import { createRunSession, recordSnapshot, type PendingToolRun, type RunRecorder, type ToolCallContext, type ToolImpl } from "./tools/runtime";
import { FINSHIELD_MODEL, TOOLS } from "./manifest";
import { decideAftercare, normalizeAnswers, type Decision } from "./aftercare";
import { TOOL_IMPLS } from "./tools";

export const AFTERCARE_AGENTS = ["SALES_CONDUCT", "REGULATION_DISPUTE"] as const;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const aftercareContextSchema = z.object({
  id: z.uuid(), owner_id: z.uuid(), case_id: z.uuid(), base_passport_id: z.uuid(), execution_manifest_id: z.uuid(),
  status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]),
  deadline_at: z.string(), case_active: z.boolean(),
  journey_stage: z.enum(["ENROLLED", "FUNDS_SENT_OR_DAMAGE_SUSPECTED"]),
  claims: z.array(confirmedClaim.extend({ claim_id: z.uuid(), status: z.string() })).min(1).max(8),
  input_masked: z.object({ schema_version: z.literal("aftercare-review-v1"),
    answers: z.array(z.object({ question_code: z.string(), answer_code: z.string(), question_version: z.string(), answer_text_masked: z.string().optional() })),
    comparison: z.array(z.object({ claim_id: z.uuid(), before: z.string(), contract: z.string(), result: z.enum(["SAME_TEXT", "DIFFERENT_TEXT", "NOT_PROVIDED"]) })),
  }),
});
export type AftercareContext = z.infer<typeof aftercareContextSchema>;

/** DB가 고정한 Passport 문장·답변만 재사용한다. DB 식별자는 모델에 전달하지 않는다. */
export function aftercareInput(context: AftercareContext): DomainAgentInput["aftercare_context"] {
  const answers = normalizeAnswers(Object.fromEntries(context.input_masked.answers.map(a => [a.question_code, a.answer_code])));
  if (!answers || !Object.keys(answers).length) throw new Error("AFTERCARE_INPUT_REJECTED");
  const comparison = context.input_masked.comparison.map(row => {
    const claim = context.claims.find(c => c.claim_id === row.claim_id);
    if (!claim || claim.statement_masked !== row.before) throw new Error("AFTERCARE_CLAIM_REJECTED");
    return { claim_ref: claim.claim_ref, before: row.before, contract: row.contract, result: row.result };
  });
  for (const text of [...context.claims.map(c => c.statement_masked), ...comparison.flatMap(c => [c.before, c.contract])]) {
    const gate = gateForModel(text);
    if (!gate.ok || gate.masked.text !== text) throw new Error("AFTERCARE_PII_REJECTED");
  }
  return { schema_version: "aftercare-review-v1", answers, comparison };
}

/** PC-005: 기존 두 Agent·Allowlist·Tool·출력 인용 검사를 그대로 실행한다. */
export async function runAftercareReview(args: {
  ctx: ToolCallContext; context: AftercareContext; lease: string; model: AgentModel; impls?: Record<string, ToolImpl>;
}): Promise<Decision> {
  const input = aftercareInput(args.context)!;
  const decision = decideAftercare({ answers: input.answers,
    contradictedClaims: args.context.claims.filter(c => c.status === "CONTRADICTED").length,
    contractTextDifferences: input.comparison.filter(c => c.result === "DIFFERENT_TEXT").length });
  let incomplete = false, additionalReview = false;
  // 하나의 점검에서 근거 이름은 충돌하지 않는다. 이전 Agent 판단은 다음 Agent에 주입하지 않는다.
  const session = createRunSession(args.ctx);
  for (const agentCode of AFTERCARE_AGENTS) {
    args.ctx.signal?.throwIfAborted();
    let recorded: Parameters<RunRecorder["agentRun"]>[0] | null = null;
    let pending: PendingToolRun[] = [];
    session.recorder = {
      agentRun: async meta => { recorded = meta; return randomUUID(); },
      toolRuns: async (_id, runs) => { pending = runs; return new Map(runs.flatMap(t => t.items.map(i => [i.ref, i.ref]))); },
    };
    const result = await runDomainAgent({ session, agentCode, model: args.model, impls: args.impls ?? TOOL_IMPLS,
      input: { schema_version: "in-v1", agent_code: agentCode, scenario: "LOAN", journey_stage: args.context.journey_stage,
        claims: args.context.claims, masked_intake: "", aftercare_context: input } });
    args.ctx.signal?.throwIfAborted();
    if (!recorded) throw new Error("AFTERCARE_AGENT_RECORD_MISSING");
    const findings = result.output?.findings ?? [];
    if (findings.some(f => !args.context.claims.some(c => c.claim_ref === f.claim_ref))) throw new Error("AFTERCARE_FINDING_SCOPE_REJECTED");
    for (const f of findings) {
      const gates = [f.summary_masked, ...f.limits].map(text => gateForModel(text));
      if (gates.some((gate, index) => !gate.ok || gate.masked.text !== [f.summary_masked, ...f.limits][index])) {
        // 출력의 개인정보 의심은 해당 항목만 보류한다. 원문은 저장하지
        // 않으며 실제 조회와 다른 항목까지 잃거나 재호출하지 않는다.
        f.state = "WITHHELD"; f.relation = "CONTEXT";
        f.summary_masked = "이 항목의 설명에서 개인정보로 의심되는 표현이 감지되어 표시를 보류했습니다. 자료를 확인해 주세요.";
        f.limits = ["출력 개인정보 검사로 이 항목의 설명을 표시하지 않았습니다."];
        result.status = "PARTIAL"; result.reasonCode = "OUTPUT_PII_REJECTED";
      }
    }
    const tools = [];
    for (const call of pending) {
      const sources = [];
      for (const { ref, item } of call.items) {
        const snapshotId = await recordSnapshot(args.ctx.sql, item, call.toolCode, args.context.id);
        sources.push({ ref, snapshot_id: snapshotId, content_hash: item.contentHash, source_fingerprint: item.fingerprint,
          title: item.title, url: item.canonicalUrl, excerpt_masked: item.excerptMasked, locator: item.locator,
          freshness: item.freshness, citable: item.isCitable && item.isComplete && !item.referenceOnly,
          reference_only: item.referenceOnly, incomplete: !item.isComplete });
      }
      tools.push({ tool_code: call.toolCode, version: TOOLS.find(t => t.toolCode === call.toolCode)!.version,
        purpose_code: call.purposeCode, status: call.status, provenance_complete: call.provenanceComplete,
        started_at: new Date(call.startedAt).toISOString(), finished_at: new Date(call.finishedAt).toISOString(),
        request_hash: sha(call.input), error_code: call.errorCode, reason_code: call.reasonCode, sources });
    }
    const trace = { schema_version: "aftercare-agent-trace-v1", context_prompt_version: "aftercare-context-v1", model_id: FINSHIELD_MODEL, agent_code: agentCode,
      version: (recorded as Parameters<RunRecorder["agentRun"]>[0]).version, status: result.status,
      reason_code: result.reasonCode, input_digest: sha({ agentCode, input, claims: args.context.claims, journey: args.context.journey_stage }), output: result.output,
      started_at: new Date((recorded as Parameters<RunRecorder["agentRun"]>[0]).startedAt).toISOString(),
      finished_at: new Date((recorded as Parameters<RunRecorder["agentRun"]>[0]).finishedAt).toISOString(),
      usage: args.model.usage?.(agentCode) ?? null, tools };
    const [stored] = await args.ctx.sql`select private.record_precase_agent(${args.context.id}::uuid,${args.lease}::uuid,${JSON.stringify(trace)}::text::jsonb) as ok`;
    if (!stored.ok) throw new Error("AFTERCARE_TRACE_NOT_STORED");
    incomplete ||= result.status !== "SUCCEEDED" || tools.length === 0;
    additionalReview ||= findings.length === 0 || findings.some(f => f.state !== "VERIFIED" || f.limits.length > 0);
  }
  if (incomplete || additionalReview) {
    if (decision.result === "NORMAL_MANAGEMENT") decision.result = "ADDITIONAL_EXPLANATION";
    decision.reasons.push(incomplete ? "Agent 검토 중 일부 조회·판단을 확인하지 못했습니다." : "Agent 검토에서 추가 확인이 필요한 항목이 남았습니다.");
    const explanation = decideAftercare({ answers: { UNDERSTOOD_TERMS: "NO" }, contradictedClaims: 0 }).actions;
    for (const action of explanation) if (!decision.actions.some(a => a.action_code === action.action_code)) decision.actions.push(action);
  }
  // 모델의 위법·사기 판단을 서비스 결론으로 승격하지 않는다. 공식 문의와 자료 준비까지만 연결한다.
  decision.summary_masked = decision.reasons.join(" ").slice(0, 900);
  return decision;
}
