import type { ModelUsage } from "./model-budget";
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
import { COVE_AGENT, DOMAIN_AGENTS, MODEL_TIMEOUTS, RED_TEAM_AGENT } from "./manifest";
import { loadManifest } from "./registry";
import {
  citationProblems, coveOutput, judgeOutput, redTeamOutput, type ConfirmedClaim,
  type CoveOutput, type DomainFinding, type JudgeOutput, type RedTeamOutput, type ToolEvidence,
} from "./schemas";
import { createRunSession, type ToolCallContext } from "./tools/runtime";
import { TOOL_IMPLS, assertToolsImplemented } from "./tools";
import { runDomainAgent, runReviewAgent, type AgentModel } from "./agents/runner";
import { assertPromptsComplete } from "./agents/prompts";
import { recordJudgeRun } from "./agents/judge-record";

export type JudgeModel = {
  usage?: () => ModelUsage;
  judge: (args: {
    signal?: AbortSignal;
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
  cove: CoveOutput | null;
  redTeam: RedTeamOutput | null;
  /** 인용 이름과 저장된 근거 행의 연결. 최종 확정이 이 식별자로 근거를 건다. */
  evidenceIds: Map<string, string>;
  /** 하나라도 Agent 가 온전히 끝나지 않았으면 참이다. 화면 맨 위에 알려야 한다 (RES-008). */
  partial: boolean;
};

export const judgeFailureReason = (error: unknown, deadlineSignal: AbortSignal): string =>
  (error as { code?: string }).code === "MODEL_BUDGET_BLOCKED" ? "TOOL_BUDGET"
    : deadlineSignal.aborted ? "JUDGE_DEADLINE_EXCEEDED" : "JUDGE_CALL_FAILED";

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
  let budgetExhausted = false;
  const findings: (DomainFinding & { agent_code: string })[] = [];
  const evidence: ToolEvidence[] = [];
  const evidenceIds = new Map<string, string>();
  const progress = args.progress ?? (() => {});

  for (const agent of DOMAIN_AGENTS) {
    session.signal?.throwIfAborted();
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
    for (const [ref, id] of result.evidenceIds) evidenceIds.set(ref, id);
    for (const finding of result.output?.findings ?? []) {
      findings.push({ ...finding, agent_code: agent.agentCode });
    }
    progress({
      type: "agent_finished", agentCode: agent.agentCode, status: result.status,
      findings: result.output?.findings.length ?? 0, toolCalls: result.toolCalls,
    });
    if (result.reasonCode === "TOOL_BUDGET") { budgetExhausted = true; break; }
  }

  // 규칙 3: 중요 Claim 은 독립 재확인과 반대 근거 찾기를 거친다. 두 Agent 는
  // Domain Agent 의 판단도 그때 쓴 근거도 받지 않는다.
  const materialClaims = args.claims.filter((claim) => claim.materiality === "MATERIAL");
  let cove: CoveOutput | null = null;
  let redTeam: RedTeamOutput | null = null;

  if (!budgetExhausted && materialClaims.length > 0 && COVE_AGENT && RED_TEAM_AGENT) {
    for (const [agent, kind] of [[COVE_AGENT, "cove"], [RED_TEAM_AGENT, "red_team"]] as const) {
      session.signal?.throwIfAborted();
      progress({ type: "agent_started", agentCode: agent.agentCode });
      const parse = (raw: unknown) => {
        const schema = kind === "cove" ? coveOutput : redTeamOutput;
        const parsed = schema.safeParse(raw);
        return parsed.success ? ({ ok: true, value: parsed.data } as const) : ({ ok: false } as const);
      };
      const result = await runReviewAgent<CoveOutput | RedTeamOutput>({
        session, agentCode: agent.agentCode, claims: materialClaims,
        journeyStage: args.journeyStage, model: args.agentModel, impls: TOOL_IMPLS,
        parse,
        refsOf: (value) => value.results.map((entry) => ({
          refs: entry.evidence_refs,
          // 확인·반증을 말하려면 근거가 있어야 한다. 못 찾았다는 상태는 근거가 없어도 된다.
          confirmed: entry.status === "CONFIRMED" || entry.status === "REFUTED"
            || entry.status === "COUNTER_EVIDENCE",
        })),
      });
      evidence.push(...result.evidence);
      for (const [ref, id] of result.evidenceIds) evidenceIds.set(ref, id);
      // 조회 자체가 실패한 검토의 NONE_FOUND/CONFIRMED는 독립 검증 증거가 아니다.
      const reviewed = result.status === "SUCCEEDED" ? result.output : null;
      if (kind === "cove") cove = (reviewed as CoveOutput | null);
      else redTeam = (reviewed as RedTeamOutput | null);
      agentResults.push({
        agentCode: agent.agentCode, status: result.status,
        reasonCode: result.reasonCode, toolCalls: result.toolCalls,
      });
      progress({
        type: "agent_finished", agentCode: agent.agentCode, status: result.status,
        findings: result.output?.results.length ?? 0, toolCalls: result.toolCalls,
      });
      if (result.reasonCode === "TOOL_BUDGET") { budgetExhausted = true; break; }
    }
  }

  session.signal?.throwIfAborted();
  progress({ type: "judge_started" });
  const judgeStartedAt = Date.now();
  let judged: JudgeOutput | null = null;
  let judgeReasonCode: string | null = null;
  const judgeStageSignal = AbortSignal.timeout(MODEL_TIMEOUTS.judgeMs);
  try {
    // AI-013: Judge 에는 원문을 넣지 않는다. Agent 가 만든 구조와 근거만 넣는다.
    const signal = session.signal ? AbortSignal.any([session.signal, judgeStageSignal]) : judgeStageSignal;
    signal.throwIfAborted();
    if (budgetExhausted) throw Object.assign(new Error("MODEL_BUDGET_BLOCKED"), {code:"MODEL_BUDGET_BLOCKED"});
    const raw = await args.judgeModel.judge({ claims: args.claims, findings, evidence, signal });
    const parsed = judgeOutput.safeParse(raw);
    if (!parsed.success) {
      judgeReasonCode = "JUDGE_SCHEMA_INVALID";
    } else {
      const problems: string[] = [];
      const requested = new Set(args.claims.map(claim => claim.claim_ref));
      const returned = parsed.data.claim_results.map(claim => claim.claim_ref);
      if (new Set(returned).size !== requested.size || returned.length !== requested.size || returned.some(ref => !requested.has(ref))) {
        problems.push("CLAIM_COVERAGE_INVALID");
      }
      for (const result of parsed.data.claim_results) {
        problems.push(...citationProblems(result.evidence_refs, result.state, session.evidence));
      }
      if (problems.length > 0) judgeReasonCode = "JUDGE_CITATION_INVALID";
      else judged = parsed.data;
    }
  } catch (error) {
    judgeReasonCode = judgeFailureReason(error, judgeStageSignal);
  }
  await recordJudgeRun(session, { claims: args.claims, findings }, judged, judgeStartedAt, judgeReasonCode, args.judgeModel.usage?.());
  progress({ type: "judge_finished", status: judged ? "SUCCEEDED" : "FAILED" });

  return {
    agentResults,
    findings,
    evidence,
    judgeOutput: judged,
    judgeReasonCode,
    cove,
    redTeam,
    evidenceIds,
    partial: judged === null || agentResults.some((result) => result.status !== "SUCCEEDED"),
  };
};
