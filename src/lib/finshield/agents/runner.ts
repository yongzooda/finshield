import type { ModelUsage } from "../model-budget";
import { FINSHIELD_MODEL, MODEL_TIMEOUTS } from "../manifest";
/**
 * Domain Agent 한 번 실행.
 *
 * Agent 는 자기 Allowlist 안의 Tool 을 스스로 골라 부르고, 그 결과로 만들어진
 * 근거 목록만 보고 판단한다. 어느 Tool 을 부를지 정하는 것이 Agent 의 일이고
 * (AI-002), 무엇을 근거로 쓸 수 있는지 정하는 것은 코드의 일이다 (규칙 1).
 *
 * 모델 호출은 주입받는다. 시험이 실제 Provider 를 부르지 않고도 이 경계를
 * 확인할 수 있어야 하기 때문이다.
 */

import "server-only";
import { createHash } from "node:crypto";
import { AGENTS } from "../manifest";
import {
  APPROVAL_PROOF_REQUIRED, citationProblems, domainAgentOutput, type DomainAgentInput, type DomainAgentOutput,
  type ToolEvidence,
} from "../schemas";
import { executeTool, persistToolRuns, type PendingToolRun, type RunSession, type ToolImpl } from "../tools/runtime";
import { systemPromptFor } from "./prompts";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

// P0는 한 Agent가 한 번에 고른 최대 3개 읽기 Tool만 실행한다. 다음 선택 턴을
// 반복하면 같은 조회가 시간을 잠식해 최종 판단이 deadline 직전에 잘렸다.
export const MAX_TOOL_TURNS = 1;

export type Decoded = { ok: true; value: unknown; reason?: string } | { ok: false; reason: string };

/**
 * Domain Agent 출력 해독.
 *
 * Schema 를 통과해도 인용이 틀리면 받지 않는다. 지어낸 근거 이름과 근거 없는
 * 확정을 여기서 버린다. 규칙 1 의 마지막 관문이다.
 */
export const decodeDomainOutput = (raw: unknown, session: RunSession, claims: DomainAgentInput["claims"] = []): Decoded => {
  const parsed = domainAgentOutput.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "OUTPUT_SCHEMA_INVALID" };
  let citationInvalid = false;
  const findings = parsed.data.findings.map((finding) => {
    const problems = citationProblems(finding.evidence_refs, finding.state, session.evidence, claims.find(claim => claim.claim_ref === finding.claim_ref)?.statement_masked);
    if (problems.length === 0) return finding;
    citationInvalid = true;
    // AI-015: 한 Claim의 잘못된 인용이 같은 Agent의 다른 정상 결과까지
    // 폐기하지 않게 한다. 확인된 ref만 맥락으로 남기고 확정 상태는 낮춘다.
    const knownRefs = finding.evidence_refs.filter((ref) => session.evidence.has(ref));
    return {
      ...finding,
      state: problems.includes(APPROVAL_PROOF_REQUIRED) ? "NEED_MORE_INFORMATION" as const : "UNKNOWN" as const,
      relation: "CONTEXT" as const,
      summary_masked: problems.includes(APPROVAL_PROOF_REQUIRED) ? APPROVAL_PROOF_REQUIRED : "제공된 근거로는 이 항목을 확정하지 않았습니다.",
      evidence_refs: knownRefs,
      limits: [...new Set([...finding.limits, "일부 근거 인용을 확인하지 못했습니다."])].slice(0, 5),
    };
  });
  return {
    ok: true,
    value: { ...parsed.data, findings },
    ...(citationInvalid ? { reason: "CITATION_INVALID" } : {}),
  };
};

export type ToolChoice = { toolCode: string; input: unknown };

/**
 * 모델 경계. 두 가지만 한다.
 * 1) 지금까지의 근거를 보고 더 부를 Tool 을 고른다. 없으면 빈 배열을 돌려준다.
 * 2) 마지막에 구조화된 판단을 낸다.
 */
export type AgentModel = {
  usage?: (agentCode: string) => ModelUsage;
  chooseTools: (args: {
    system: string;
    signal?: AbortSignal;
    input: DomainAgentInput;
    evidence: ToolEvidence[];
    observations: Record<string, unknown>[];
    availableTools: { toolCode: string; purposeCode: string }[];
  }) => Promise<ToolChoice[]>;
  decide: (args: {
    system: string;
    signal?: AbortSignal;
    input: DomainAgentInput;
    evidence: ToolEvidence[];
    observations: Record<string, unknown>[];
  }) => Promise<unknown>;
};

export type AgentRunResult<T = DomainAgentOutput> = {
  agentRunId: string;
  output: T | null;
  evidence: ToolEvidence[];
  /** 인용 이름과 저장된 근거 행의 연결. 최종 확정이 이 식별자로 근거를 건다. */
  evidenceIds: Map<string, string>;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  reasonCode: string | null;
  toolCalls: number;
};

export const runDomainAgent = async <T = DomainAgentOutput>(args: {
  session: RunSession;
  agentCode: string;
  input: DomainAgentInput;
  model: AgentModel;
  impls: Record<string, ToolImpl>;
  usage?: { inputTokens: number; outputTokens: number; costMicrounits: number };
  /** 다른 Schema 로 받는 Agent 를 위한 자리. 없으면 Domain Schema 로 받는다. */
  decodeOutput?: (raw: unknown, evidence: ToolEvidence[]) => Decoded;
}): Promise<AgentRunResult<T>> => {
  const { session, agentCode, input, model, impls } = args;
  const spec = AGENTS.find((agent) => agent.agentCode === agentCode);
  if (!spec) throw new Error(`Manifest 에 없는 Agent 다: ${agentCode}`);
  const system = systemPromptFor(agentCode);
  const { sql, ownerId, caseId, runId } = session;
  const startedAt = Date.now();
  const reviewAgent = ["COVE", "RED_TEAM"].includes(agentCode);
  const stageLimit = reviewAgent ? MODEL_TIMEOUTS.reviewStageMs : MODEL_TIMEOUTS.domainStageMs;
  const stageSignal = AbortSignal.timeout(stageLimit);
  const signal = session.signal ? AbortSignal.any([session.signal, stageSignal]) : stageSignal;

  const evidence: ToolEvidence[] = [];
  const observations: Record<string, unknown>[] = [];
  const pendings: PendingToolRun[] = [];
  const attempted = new Set<string>();
  let toolCalls = 0;
  let reasonCode: string | null = null;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
    // 조회가 판단 시간을 모두 소비하지 않게 한다. 전체 Run의 deadline은 별도로
    // 계속 적용되고, 이 단계의 선택·판단 상한은 Manifest 값으로 고정한다.
    if (turn > 0 && Date.now() - startedAt >= stageLimit - 6_000) break;
    let choices: ToolChoice[];
    const choiceSignal = AbortSignal.any([signal, AbortSignal.timeout(
      reviewAgent ? MODEL_TIMEOUTS.reviewChoiceMs : MODEL_TIMEOUTS.domainChoiceMs,
    )]);
    try {
      choiceSignal.throwIfAborted();
      choices = await model.chooseTools({
        system, signal: choiceSignal, input, evidence, observations, availableTools: [...spec.tools],
      });
    } catch (error) {
      reasonCode = (error as {code?:string}).code === "MODEL_BUDGET_BLOCKED" ? "TOOL_BUDGET" : choiceSignal.aborted ? "DEADLINE_EXCEEDED" : "TOOL_CHOICE_FAILED";
      break;
    }
    if (choices.length > 3) { reasonCode = "TOOL_BATCH_LIMIT"; break; }
    if (choices.length === 0) break;
    const selected: { choice: ToolChoice; purpose: string; impl: ToolImpl }[] = [];
    for (const choice of choices) {
      if (signal.aborted) { reasonCode = "DEADLINE_EXCEEDED"; break; }
      const allowed = spec.tools.find((tool) => tool.toolCode === choice.toolCode);
      if (!allowed) { reasonCode = "TOOL_NOT_ALLOWED"; continue; }
      const impl = impls[choice.toolCode];
      if (!impl) { reasonCode = "TOOL_NOT_IMPLEMENTED"; continue; }
      const key = digest({ tool: choice.toolCode, input: choice.input });
      if (attempted.has(key)) continue;
      attempted.add(key);
      selected.push({ choice, purpose: allowed.purposeCode, impl });
    }
    if (selected.length === 0) break;
    // 같은 모델 턴에서 독립적으로 요청한 읽기 도구만 함께 실행한다. 결과를 받은 다음 턴은 기다린다.
    const results = await Promise.all(selected.map(({ choice, purpose, impl }) =>
      executeTool({ ...session, signal }, agentCode, choice.toolCode, purpose, choice.input, impl)));
    for (const result of results) {
      toolCalls += 1;
      pendings.push(result.pending);
      evidence.push(...result.evidence);
      observations.push({
        kind: "tool_execution", tool_code: result.pending.toolCode, status: result.pending.status,
        reason_code: result.pending.reasonCode, error_code: result.pending.errorCode,
        provenance_complete: result.pending.provenanceComplete, evidence_count: result.evidence.length,
      });
      if (result.pending.observations) observations.push(result.pending.observations);
      if (result.pending.status !== "SUCCEEDED" || !result.pending.provenanceComplete) {
        reasonCode ??= "TOOL_LOOKUP_FAILED";
      }
    }
  }

  let output: T | null = null;
  let status: AgentRunResult["status"] = "SUCCEEDED";
  const decisionSignal = AbortSignal.any([signal, AbortSignal.timeout(
    reviewAgent ? MODEL_TIMEOUTS.reviewDecisionMs : MODEL_TIMEOUTS.domainDecisionMs,
  )]);
  try {
    decisionSignal.throwIfAborted();
    if (reasonCode === "TOOL_BUDGET") throw Object.assign(new Error("MODEL_BUDGET_BLOCKED"), {code:"MODEL_BUDGET_BLOCKED"});
    const raw = await model.decide({ system, signal: decisionSignal, input, evidence, observations });
    // 다른 Schema 로 받는 Agent 는 자기 해독기를 준다. 없으면 Domain Schema 로 받는다.
    const decoded = args.decodeOutput
      ? args.decodeOutput(raw, evidence)
      : decodeDomainOutput(raw, { ...session, evidence: new Map(evidence.map((entry) => [entry.evidence_ref, entry])) }, input.claims);
    if (!decoded.ok) {
      status = "FAILED";
      reasonCode = decoded.reason;
    } else {
      output = decoded.value as T;
      reasonCode ??= decoded.reason ?? null;
    }
  } catch (error) {
    status = "FAILED";
    reasonCode = (error as {code?:string}).code === "MODEL_BUDGET_BLOCKED" ? "TOOL_BUDGET" : decisionSignal.aborted || (error as Error).name === "APIConnectionTimeoutError" ? "DEADLINE_EXCEEDED" : (error as Error).message === "MODEL_OUTPUT_CLAIM_COVERAGE_INVALID" ? "OUTPUT_CLAIM_COVERAGE_INVALID" : /^MODEL_[A-Z_]{1,58}$/.test(String((error as {code?: string}).code ?? "")) ? String((error as {code: string}).code) : "MODEL_CALL_FAILED";
  }

  if (status === "SUCCEEDED" && reasonCode) status = "PARTIAL";

  const summary = output as { findings?: unknown[]; results?: unknown[] } | null;
  const findingCount = summary?.findings?.length ?? summary?.results?.length ?? 0;

  // 남기는 자리가 다를 수 있다. 판단은 위에서 이미 끝났고 여기서는 기록만 한다.
  if (session.recorder) {
    const agentRunId = await session.recorder.agentRun({
      agentCode: spec.agentCode, version: spec.version, logicalKey: spec.logicalKey, status,
      startedAt, finishedAt: Date.now(), reasonCode, toolCalls,
      evidenceCount: evidence.length, findingCount: findingCount,
    });
    const evidenceIds = await session.recorder.toolRuns(agentRunId, pendings);
    return { agentRunId, output, evidence, evidenceIds, status, reasonCode, toolCalls };
  }

  const measured = args.usage ?? model.usage?.(agentCode);
  const attempts = await sql`
    select count(*)::int as n from public.agent_runs
     where verification_run_id = ${runId}::uuid and logical_agent_key = ${spec.logicalKey}`;
  const created = await sql`
    insert into public.agent_runs
      (owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version,
       attempt_no, status, input_schema_version, output_schema_version, prompt_version,
       input_digest, output_digest, sanitized_summary, model_provider, model_id,
       input_tokens, output_tokens, cost_microunits, started_at, finished_at, latency_ms, reason_code)
    values (${ownerId}::uuid, ${caseId}::uuid, ${runId}::uuid, ${spec.logicalKey}, ${spec.agentCode},
            ${spec.version}, ${(attempts[0].n as number) + 1}, ${status}::public.execution_status,
            ${spec.inputSchemaVersion}, ${spec.outputSchemaVersion}, ${spec.promptVersion},
            ${digest(input)}, ${output ? digest(output) : null},
            ${sql.json({ schema_version: "1", tool_calls: toolCalls, evidence_count: evidence.length,
                         finding_count: findingCount, usage_status: measured ? model.usage?.(agentCode)?.unknownCalls ? "RECONCILE_REQUIRED" : "REPORTED" : "NOT_RECORDED" })},
            'anthropic', ${FINSHIELD_MODEL},
            ${measured?.inputTokens ?? 0}, ${measured?.outputTokens ?? 0},
            ${measured?.costMicrounits ?? 0},
            ${new Date(startedAt).toISOString()}, now(), ${Date.now() - startedAt}, ${reasonCode})
    returning id`;
  const agentRunId = created[0].id as string;

  // Tool 기록은 Agent 기록을 가리키므로 그다음에 남긴다.
  const evidenceIds = await persistToolRuns(session, agentRunId, pendings);

  return { agentRunId, output, evidence, evidenceIds, status, reasonCode, toolCalls };
};

/**
 * 독립 검증 Agent 실행 (CoVe·Red Team).
 *
 * 규칙 3 이 요구하는 분리가 여기 있다. 이 Agent 들은 Domain Agent 의 판단도
 * 그때 쓴 근거도 받지 않는다. Claim 문장만 받고 자기 도구로 처음부터 다시
 * 찾는다. 그래서 같은 결론이 나오면 두 경로가 독립적으로 이른 것이다.
 */
export const runReviewAgent = async <T>(args: {
  session: RunSession;
  agentCode: string;
  claims: DomainAgentInput["claims"];
  journeyStage: DomainAgentInput["journey_stage"];
  model: AgentModel;
  impls: Record<string, ToolImpl>;
  parse: (raw: unknown) => { ok: true; value: T } | { ok: false };
  refsOf: (value: T) => { refs: string[]; claimRef?: string; confirmed: boolean; state?: "VERIFIED" | "CONTRADICTED" | "UNKNOWN" }[];
  downgradeInvalid?: (value: T, invalidIndexes: Set<number>) => T;
}): Promise<AgentRunResult<T>> => {
  const result = await runDomainAgent<T>({
    session: args.session,
    agentCode: args.agentCode,
    input: {
      schema_version: "in-v1",
      agent_code: args.agentCode,
      scenario: "LOAN",
      journey_stage: args.journeyStage,
      claims: args.claims,
      // 초기 결론도 초기 검색도 넘기지 않는다. 그것이 분리의 실체다.
      masked_intake: "",
    },
    model: args.model,
    impls: args.impls,
    // Domain 출력 Schema 대신 이 Agent 의 Schema 로 받는다.
    decodeOutput: (raw, evidence) => {
      const parsed = args.parse(raw);
      if (!parsed.ok) return { ok: false, reason: "OUTPUT_SCHEMA_INVALID" };
      const problems: string[] = [];
      const invalidIndexes = new Set<number>();
      const pool = new Map(evidence.map((entry) => [entry.evidence_ref, entry]));
      for (const [index, entry] of args.refsOf(parsed.value).entries()) {
        const entryProblems = citationProblems(entry.refs, entry.state ?? (entry.confirmed ? "VERIFIED" : "UNKNOWN"), pool,
          args.claims.find(claim => claim.claim_ref === entry.claimRef)?.statement_masked);
        if (entryProblems.length > 0) invalidIndexes.add(index);
        problems.push(...entryProblems);
      }
      return problems.length > 0 && args.downgradeInvalid
        ? { ok: true, value: args.downgradeInvalid(parsed.value, invalidIndexes) as unknown, reason: "CITATION_INVALID" }
        : problems.length > 0
          ? { ok: false, reason: "CITATION_INVALID" }
        : { ok: true, value: parsed.value as unknown };
    },
  });
  return result;
};
