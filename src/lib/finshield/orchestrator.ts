/**
 * Run 오케스트레이터.
 *
 * Domain Agent 넷을 순서대로 돌리고, 그 결과 구조를 Evidence Judge 에 넘긴다.
 * Orchestrator 는 결론을 만들지 않는다 (AI-020). 어떤 Agent 를 어떤 순서로
 * 돌릴지만 정하고, 판단은 Agent 와 Judge 가 한다.
 *
 * 동적 Agent 선택과 병렬 실행은 AI-003·AI-004 의 P1 Gate 를 통과한 뒤에 연다.
 * 그래서 순서는 Manifest 배열 그대로다.
 */

import "server-only";
import { DOMAIN_AGENTS } from "./manifest";
import { loadManifest } from "./registry";
import {
  citationProblems, judgeOutput, type ConfirmedClaim, type DomainFinding, type JudgeOutput,
  type ToolEvidence,
} from "./schemas";
import { createRunSession, type ToolCallContext } from "./tools/runtime";
import { TOOL_IMPLS, assertToolsImplemented } from "./tools";
import { runDomainAgent, type AgentModel } from "./agents/runner";
import { assertPromptsComplete } from "./agents/prompts";

export type JudgeModel = {
  judge: (args: {
    claims: ConfirmedClaim[];
    findings: (DomainFinding & { agent_code: string })[];
    evidence: ToolEvidence[];
  }) => Promise<unknown>;
};

export type RunProgress = (event:
  | { type: "agent_started"; agentCode: string }
  | { type: "agent_finished"; agentCode: string; status: string; findings: number; toolCalls: number }
  | { type: "judge_started" }
  | { type: "judge_finished"; status: string }
) => void;

export type OrchestratedRun = {
  agentResults: { agentCode: string; status: string; reasonCode: string | null; toolCalls: number }[];
  findings: (DomainFinding & { agent_code: string })[];
  evidence: ToolEvidence[];
  judgeOutput: JudgeOutput | null;
  judgeReasonCode: string | null;
  /** 하나라도 Agent 가 온전히 끝나지 않았으면 참이다. 화면 맨 위에 알려야 한다 (RES-008). */
  partial: boolean;
};

export const runVerification = async (args: {
  ctx: ToolCallContext;
  claims: ConfirmedClaim[];
  maskedIntake: string;
  journeyStage: "PRE_TRANSACTION" | "ENROLLED" | "FUNDS_SENT_OR_DAMAGE_SUSPECTED";
  agentModel: AgentModel;
  judgeModel: JudgeModel;
  progress?: RunProgress;
}): Promise<OrchestratedRun> => {
  assertPromptsComplete();
  assertToolsImplemented();
  await loadManifest(args.ctx.sql);

  const session = createRunSession(args.ctx);
  const agentResults: OrchestratedRun["agentResults"] = [];
  const findings: (DomainFinding & { agent_code: string })[] = [];
  const evidence: ToolEvidence[] = [];
  const progress = args.progress ?? (() => {});

  for (const agent of DOMAIN_AGENTS) {
    progress({ type: "agent_started", agentCode: agent.agentCode });
    const result = await runDomainAgent({
      session,
      agentCode: agent.agentCode,
      input: {
        schema_version: "in-v1",
        agent_code: agent.agentCode,
        scenario: "LOAN",
        journey_stage: args.journeyStage,
        claims: args.claims,
        masked_intake: args.maskedIntake,
      },
      model: args.agentModel,
      impls: TOOL_IMPLS,
    });
    agentResults.push({
      agentCode: agent.agentCode, status: result.status,
      reasonCode: result.reasonCode, toolCalls: result.toolCalls,
    });
    evidence.push(...result.evidence);
    for (const finding of result.output?.findings ?? []) {
      findings.push({ ...finding, agent_code: agent.agentCode });
    }
    progress({
      type: "agent_finished", agentCode: agent.agentCode, status: result.status,
      findings: result.output?.findings.length ?? 0, toolCalls: result.toolCalls,
    });
  }

  progress({ type: "judge_started" });
  let judged: JudgeOutput | null = null;
  let judgeReasonCode: string | null = null;
  try {
    // AI-013: Judge 에는 원문을 넣지 않는다. Agent 가 만든 구조와 근거만 넣는다.
    const raw = await args.judgeModel.judge({ claims: args.claims, findings, evidence });
    const parsed = judgeOutput.safeParse(raw);
    if (!parsed.success) {
      judgeReasonCode = "JUDGE_SCHEMA_INVALID";
    } else {
      const problems: string[] = [];
      for (const result of parsed.data.claim_results) {
        problems.push(...citationProblems(result.evidence_refs, result.state, session.evidence));
      }
      if (problems.length > 0) judgeReasonCode = "JUDGE_CITATION_INVALID";
      else judged = parsed.data;
    }
  } catch {
    judgeReasonCode = "JUDGE_CALL_FAILED";
  }
  progress({ type: "judge_finished", status: judged ? "SUCCEEDED" : "FAILED" });

  return {
    agentResults,
    findings,
    evidence,
    judgeOutput: judged,
    judgeReasonCode,
    partial: judged === null || agentResults.some((result) => result.status !== "SUCCEEDED"),
  };
};
