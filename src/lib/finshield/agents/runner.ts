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
import { domainSystemPrompt } from "./prompts";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

export const MAX_TOOL_TURNS = 6;

export type ToolChoice = { toolCode: string; input: unknown };

/**
 * 모델 경계. 두 가지만 한다.
 * 1) 지금까지의 근거를 보고 더 부를 Tool 을 고른다. 없으면 빈 배열을 돌려준다.
 * 2) 마지막에 구조화된 판단을 낸다.
 */
export type AgentModel = {
  chooseTools: (args: {
    system: string;
    input: DomainAgentInput;
    evidence: ToolEvidence[];
    observations: Record<string, unknown>[];
    availableTools: { toolCode: string; purposeCode: string }[];
  }) => Promise<ToolChoice[]>;
  decide: (args: {
    system: string;
    input: DomainAgentInput;
    evidence: ToolEvidence[];
    observations: Record<string, unknown>[];
  }) => Promise<unknown>;
};

export type AgentRunResult = {
  agentRunId: string;
  output: DomainAgentOutput | null;
  evidence: ToolEvidence[];
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  reasonCode: string | null;
  toolCalls: number;
};

export const runDomainAgent = async (args: {
  session: RunSession;
  agentCode: string;
  input: DomainAgentInput;
  model: AgentModel;
  impls: Record<string, ToolImpl>;
  usage?: { inputTokens: number; outputTokens: number; costMicrounits: number };
}): Promise<AgentRunResult> => {
  const { session, agentCode, input, model, impls } = args;
  const spec = AGENTS.find((agent) => agent.agentCode === agentCode);
  if (!spec) throw new Error(`Manifest 에 없는 Agent 다: ${agentCode}`);
  const system = domainSystemPrompt(agentCode);
  const { sql, ownerId, caseId, runId } = session;
  const startedAt = Date.now();

  const evidence: ToolEvidence[] = [];
  const observations: Record<string, unknown>[] = [];
  const pendings: PendingToolRun[] = [];
  let toolCalls = 0;
  let reasonCode: string | null = null;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
    let choices: ToolChoice[];
    try {
      choices = await model.chooseTools({
        system, input, evidence, observations, availableTools: [...spec.tools],
      });
    } catch {
      reasonCode = "TOOL_CHOICE_FAILED";
      break;
    }
    if (choices.length === 0) break;
    for (const choice of choices) {
      const allowed = spec.tools.find((tool) => tool.toolCode === choice.toolCode);
      // Allowlist 밖을 고르면 부르지 않고 그 사실만 남긴다. 모델의 요청은 허가가 아니다.
      if (!allowed) { reasonCode = "TOOL_NOT_ALLOWED"; continue; }
      const impl = impls[choice.toolCode];
      if (!impl) { reasonCode = "TOOL_NOT_IMPLEMENTED"; continue; }
      const result = await executeTool(session, agentCode, choice.toolCode,
        allowed.purposeCode, choice.input, impl);
      toolCalls += 1;
      pendings.push(result.pending);
      evidence.push(...result.evidence);
      if (result.pending.observations) observations.push(result.pending.observations);
    }
  }

  let output: DomainAgentOutput | null = null;
  let status: AgentRunResult["status"] = "SUCCEEDED";
  try {
    const raw = await model.decide({ system, input, evidence, observations });
    const parsed = domainAgentOutput.safeParse(raw);
    if (!parsed.success) {
      status = "FAILED";
      reasonCode = "OUTPUT_SCHEMA_INVALID";
    } else {
      // 규칙 1: 지어낸 근거를 인용했거나 근거 없이 확정했으면 그 판단을 버린다.
      const problems: string[] = [];
      for (const finding of parsed.data.findings) {
        problems.push(...citationProblems(finding.evidence_refs, finding.state, session.evidence));
      }
      if (problems.length > 0) {
        status = "FAILED";
        reasonCode = "CITATION_INVALID";
      } else {
        output = parsed.data;
      }
    }
  } catch {
    status = "FAILED";
    reasonCode = "MODEL_CALL_FAILED";
  }

  if (status === "SUCCEEDED" && reasonCode) status = "PARTIAL";

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
                         finding_count: output?.findings.length ?? 0 })},
            'anthropic', ${process.env.ANTHROPIC_MODEL ?? null},
            ${args.usage?.inputTokens ?? 0}, ${args.usage?.outputTokens ?? 0},
            ${args.usage?.costMicrounits ?? 0},
            ${new Date(startedAt).toISOString()}, now(), ${Date.now() - startedAt}, ${reasonCode})
    returning id`;
  const agentRunId = created[0].id as string;

  // Tool 기록은 Agent 기록을 가리키므로 그다음에 남긴다.
  await persistToolRuns(session, agentRunId, pendings);

  return { agentRunId, output, evidence, status, reasonCode, toolCalls };
};
