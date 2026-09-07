import { FINSHIELD_MODEL } from "../manifest";
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
  citationProblems, domainAgentOutput, type DomainAgentInput, type DomainAgentOutput,
  type ToolEvidence,
} from "../schemas";
import { executeTool, persistToolRuns, type PendingToolRun, type RunSession, type ToolImpl } from "../tools/runtime";
import { systemPromptFor } from "./prompts";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

export const MAX_TOOL_TURNS = 6;

export type Decoded = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Domain Agent 출력 해독.
 *
 * Schema 를 통과해도 인용이 틀리면 받지 않는다. 지어낸 근거 이름과 근거 없는
 * 확정을 여기서 버린다. 규칙 1 의 마지막 관문이다.
 */
const decodeDomainOutput = (raw: unknown, session: RunSession): Decoded => {
  const parsed = domainAgentOutput.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "OUTPUT_SCHEMA_INVALID" };
  const problems: string[] = [];
  for (const finding of parsed.data.findings) {
    problems.push(...citationProblems(finding.evidence_refs, finding.state, session.evidence));
  }
  if (problems.length > 0) return { ok: false, reason: "CITATION_INVALID" };
  return { ok: true, value: parsed.data };
};

export type ToolChoice = { toolCode: string; input: unknown };

/**
 * 모델 경계. 두 가지만 한다.
 * 1) 지금까지의 근거를 보고 더 부를 Tool 을 고른다. 없으면 빈 배열을 돌려준다.
 * 2) 마지막에 구조화된 판단을 낸다.
 */
export type AgentModel = {
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
  const stageLimit = ["COVE", "RED_TEAM"].includes(agentCode) ? 12_000 : 8_000;
  const stageSignal = AbortSignal.timeout(stageLimit);
  const signal = session.signal ? AbortSignal.any([session.signal, stageSignal]) : stageSignal;

  const evidence: ToolEvidence[] = [];
  const observations: Record<string, unknown>[] = [];
  const pendings: PendingToolRun[] = [];
  const attempted = new Set<string>();
  let toolCalls = 0;
  let reasonCode: string | null = null;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
    // 조회가 판단 시간을 모두 소비하지 않게 한다. 첫 조회 뒤에는 구조화 판단에
    // 최소 6초를 남긴다. 전체 Run의 원래 deadline은 별도로 계속 적용된다.
    if (turn > 0 && Date.now() - startedAt >= stageLimit - 6_000) break;
    let choices: ToolChoice[];
    try {
      signal.throwIfAborted();
      choices = await model.chooseTools({
        system, signal, input, evidence, observations, availableTools: [...spec.tools],
      });
    } catch {
      reasonCode = signal.aborted ? "DEADLINE_EXCEEDED" : "TOOL_CHOICE_FAILED";
      break;
    }
    if (choices.length === 0) break;
    let executedThisTurn = 0;
    for (const choice of choices) {
      if (signal.aborted) { reasonCode = "DEADLINE_EXCEEDED"; break; }
      const allowed = spec.tools.find((tool) => tool.toolCode === choice.toolCode);
      // Allowlist 밖을 고르면 부르지 않고 그 사실만 남긴다. 모델의 요청은 허가가 아니다.
      if (!allowed) { reasonCode = "TOOL_NOT_ALLOWED"; continue; }
      const impl = impls[choice.toolCode];
      if (!impl) { reasonCode = "TOOL_NOT_IMPLEMENTED"; continue; }
      const key = digest({ tool: choice.toolCode, input: choice.input });
      if (attempted.has(key)) continue;
      attempted.add(key);
      executedThisTurn += 1;
      const result = await executeTool({ ...session, signal }, agentCode, choice.toolCode,
        allowed.purposeCode, choice.input, impl);
      toolCalls += 1;
      pendings.push(result.pending);
      evidence.push(...result.evidence);
      observations.push({
        kind: "tool_execution", tool_code: choice.toolCode, status: result.pending.status,
        reason_code: result.pending.reasonCode, error_code: result.pending.errorCode,
        provenance_complete: result.pending.provenanceComplete, evidence_count: result.evidence.length,
      });
      if (result.pending.observations) observations.push(result.pending.observations);
      if (result.pending.status !== "SUCCEEDED" || !result.pending.provenanceComplete) {
        reasonCode ??= "TOOL_LOOKUP_FAILED";
      }
    }
    if (executedThisTurn === 0) break;
  }

  let output: T | null = null;
  let status: AgentRunResult["status"] = "SUCCEEDED";
  try {
    signal.throwIfAborted();
    const raw = await model.decide({ system, signal, input, evidence, observations });
    // 다른 Schema 로 받는 Agent 는 자기 해독기를 준다. 없으면 Domain Schema 로 받는다.
    const decoded = args.decodeOutput
      ? args.decodeOutput(raw, evidence)
      : decodeDomainOutput(raw, { ...session, evidence: new Map(evidence.map((entry) => [entry.evidence_ref, entry])) });
    if (!decoded.ok) {
      status = "FAILED";
      reasonCode = decoded.reason;
    } else {
      output = decoded.value as T;
    }
  } catch {
    status = "FAILED";
    reasonCode = signal.aborted ? "DEADLINE_EXCEEDED" : "MODEL_CALL_FAILED";
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
                         finding_count: findingCount })},
            'anthropic', ${FINSHIELD_MODEL},
            ${args.usage?.inputTokens ?? 0}, ${args.usage?.outputTokens ?? 0},
            ${args.usage?.costMicrounits ?? 0},
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
  refsOf: (value: T) => { refs: string[]; confirmed: boolean }[];
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
      for (const entry of args.refsOf(parsed.value)) {
        problems.push(...citationProblems(entry.refs, entry.confirmed ? "VERIFIED" : "UNKNOWN", new Map(evidence.map((entry) => [entry.evidence_ref, entry]))));
      }
      return problems.length > 0
        ? { ok: false, reason: "CITATION_INVALID" }
        : { ok: true, value: parsed.value as unknown };
    },
  });
  return result;
};
