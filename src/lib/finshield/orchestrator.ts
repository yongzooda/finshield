import { APPROVAL_PROOF_REQUIRED } from "./schemas";
import { createSharedRunDeadline } from "./run-deadline";
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
  citationProblems, coveOutput, judgeOutput, judgeEnvelopeOutput, redTeamOutput, type ConfirmedClaim,
  type CoveOutput, type DomainFinding, type JudgeOutput, type RedTeamOutput, type ToolEvidence,
} from "./schemas";
import { createRunSession, type ToolCallContext } from "./tools/runtime";
import { TOOL_IMPLS, assertToolsImplemented } from "./tools";
import { runDomainAgent, runReviewAgent, type AgentModel } from "./agents/runner";
import { assertPromptsComplete } from "./agents/prompts";
import { recordJudgeRun } from "./agents/judge-record";

export type JudgeModel = {
  /** 실제 모델 묶음 실패만 보고한다. 모델 응답의 임의 필드를 믿지 않는다. */
  failureReason?: () => string | null;
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
    : deadlineSignal.aborted || (error as Error).name === "APIConnectionTimeoutError" ? "JUDGE_DEADLINE_EXCEEDED" : "JUDGE_CALL_FAILED";

/**
 * Judge의 한 Claim에 잘못된 인용이나 누락이 있어도 다른 Claim의 검증된 결과는
 * 보존한다. 모델 출력을 올려서 고치지 않고 영향 Claim만 UNKNOWN으로 낮춘다.
 */
export const normalizeJudgeOutput = (
  output: JudgeOutput,
  claims: ConfirmedClaim[],
  evidence: Map<string, ToolEvidence>,
): { output: JudgeOutput; reasonCode: string | null } => {
  const requested = new Set(claims.map((claim) => claim.claim_ref));
  const grouped = new Map<string, JudgeOutput["claim_results"]>();
  let coverageInvalid = output.claim_results.some((entry) => !requested.has(entry.claim_ref));
  let citationInvalid = false;
  let schemaInvalid = false;

  for (const entry of output.claim_results) {
    if (!requested.has(entry.claim_ref)) continue;
    const group = grouped.get(entry.claim_ref) ?? [];
    group.push(entry);
    grouped.set(entry.claim_ref, group);
  }

  const claimResults = claims.map((claim) => {
    const candidates = grouped.get(claim.claim_ref) ?? [];
    if (candidates.length !== 1) coverageInvalid = true;
    const candidate = candidates[0];
    if (!candidate) {
      return {
        claim_ref: claim.claim_ref,
        state: "UNKNOWN" as const,
        evidence_refs: [],
        withheld_reason: "판단 결과가 누락되었습니다.",
        rationale_masked: "이 항목의 판단 결과를 확인하지 못했습니다.",
      };
    }
    if (!judgeOutput.shape.claim_results.element.safeParse(candidate).success) {
      schemaInvalid = true;
      return { claim_ref: claim.claim_ref, state: "WITHHELD" as const, evidence_refs: [],
        withheld_reason: "최종 판단 문장 형식을 확인하지 못했습니다.", rationale_masked: "이 항목의 판단을 보류했습니다." };
    }
    const problems = citationProblems(candidate.evidence_refs, candidate.state, evidence, claim.statement_masked);
    if (problems.length === 0) return candidate;
    citationInvalid = true;
    return {
      ...candidate,
      state: problems.includes(APPROVAL_PROOF_REQUIRED) ? "NEED_MORE_INFORMATION" as const : "UNKNOWN" as const,
      rationale_masked: problems.includes(APPROVAL_PROOF_REQUIRED) ? APPROVAL_PROOF_REQUIRED : candidate.rationale_masked,
      evidence_refs: candidate.evidence_refs.filter((ref) => evidence.has(ref)),
      withheld_reason: problems.includes(APPROVAL_PROOF_REQUIRED) ? APPROVAL_PROOF_REQUIRED : "근거 인용을 확인하지 못했습니다.",
    };
  });

  const invalidConflictClaims = new Set<string>();
  const conflicts = output.conflicts.filter((conflict) => {
    const refs = [...new Set(conflict.evidence_refs)];
    const valid = judgeOutput.shape.conflicts.element.safeParse(conflict).success && requested.has(conflict.claim_ref)
      && refs.length >= 2
      && refs.every((ref) => evidence.has(ref));
    if (!valid) { citationInvalid = true; invalidConflictClaims.add(conflict.claim_ref); }
    return valid;
  });

  return {
    output: { schema_version: "out-v1", claim_results: claimResults.map(result => invalidConflictClaims.has(result.claim_ref)
      ? { ...result, state: "UNKNOWN" as const, withheld_reason: "충돌하는 공식 근거를 확인하지 못했습니다.",
        rationale_masked: "공식 근거의 충돌 여부를 확정하지 않았습니다." } : result), conflicts },
    reasonCode: coverageInvalid ? "JUDGE_CLAIM_COVERAGE_INVALID"
      : schemaInvalid ? "JUDGE_SCHEMA_INVALID" : citationInvalid ? "JUDGE_CITATION_INVALID" : null,
  };
};

export const selectJudgeEvidence = (
  findings: (DomainFinding & { agent_code: string })[],
  evidence: ToolEvidence[],
): ToolEvidence[] => {
  const domainRefs = new Set(findings.flatMap((finding) => finding.evidence_refs));
  return evidence.filter((item) => domainRefs.has(item.evidence_ref));
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

  const budget = createSharedRunDeadline(args.ctx.signal);
  const session = createRunSession({ ...args.ctx, signal: budget.signal });
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
      session: { ...session, signal: budget.agentSignal() },
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
        session: { ...session, signal: budget.agentSignal() }, agentCode: agent.agentCode, claims: materialClaims,
        journeyStage: args.journeyStage, model: args.agentModel, impls: TOOL_IMPLS,
        parse,
        refsOf: (value) => value.results.map((entry) => ({
          refs: entry.evidence_refs,
          state: entry.status === "CONFIRMED" ? "VERIFIED" : entry.status === "REFUTED" || entry.status === "COUNTER_EVIDENCE" ? "CONTRADICTED" : "UNKNOWN",
          // 확인·반증을 말하려면 근거가 있어야 한다. 못 찾았다는 상태는 근거가 없어도 된다.
          confirmed: entry.status === "CONFIRMED" || entry.status === "REFUTED"
            || entry.status === "COUNTER_EVIDENCE",
        })),
        downgradeInvalid: (value, invalidIndexes) => ({
          ...value,
          results: value.results.map((entry, index) => invalidIndexes.has(index)
            ? kind === "cove"
              ? { ...entry, status: "INCONCLUSIVE" as const, evidence_refs: [], note_masked: "근거 인용을 확인하지 못했습니다." }
              : { ...entry, status: "NONE_FOUND" as const, evidence_refs: [], note_masked: "근거 인용을 확인하지 못했습니다." }
            : entry),
        }) as CoveOutput | RedTeamOutput,
      });
      evidence.push(...result.evidence);
      for (const [ref, id] of result.evidenceIds) evidenceIds.set(ref, id);
      // 조회 자체가 실패한 검토의 NONE_FOUND/CONFIRMED는 독립 검증 증거가 아니다.
      const reviewed = result.status === "SUCCEEDED" || result.reasonCode === "CITATION_INVALID"
        ? result.output : null;
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
  const judgeSignal = session.signal ? AbortSignal.any([session.signal, judgeStageSignal]) : judgeStageSignal;
  try {
    // AI-013: Judge 에는 원문을 넣지 않는다. Agent 가 만든 구조와 근거만 넣는다.
    const signal = judgeSignal;
    signal.throwIfAborted();
    if (budgetExhausted) throw Object.assign(new Error("MODEL_BUDGET_BLOCKED"), {code:"MODEL_BUDGET_BLOCKED"});
    // 독립 검토 근거는 CoVe·Red Team 정책 단계에서 사용한다. Judge에는 Domain
    // 판단이 실제 인용한 근거만 보내 입력 크기와 잘못된 ref 선택 가능성을 줄인다.
    const judgeEvidence = selectJudgeEvidence(findings, evidence);
    const raw = await args.judgeModel.judge({ claims: args.claims, findings, evidence: judgeEvidence, signal });
    const parsed = judgeEnvelopeOutput.safeParse(raw);
    if (!parsed.success) {
      judgeReasonCode = "JUDGE_SCHEMA_INVALID";
    } else {
      const normalized = normalizeJudgeOutput(
        parsed.data,
        args.claims,
        new Map(judgeEvidence.map((item) => [item.evidence_ref, item])),
      );
      judged = normalized.output;
      judgeReasonCode = normalized.reasonCode ?? args.judgeModel.failureReason?.() ?? null;
    }
  } catch (error) {
    judgeReasonCode = judgeFailureReason(error, judgeSignal);
  }
  await recordJudgeRun(session, { claims: args.claims, findings }, judged, judgeStartedAt, judgeReasonCode, args.judgeModel.usage?.());
  progress({ type: "judge_finished", status: judged ? judgeReasonCode ? "PARTIAL" : "SUCCEEDED" : "FAILED" });

  return {
    agentResults,
    findings,
    evidence,
    judgeOutput: judged,
    judgeReasonCode,
    cove,
    redTeam,
    evidenceIds,
    partial: judged === null || judgeReasonCode !== null || agentResults.some((result) => result.status !== "SUCCEEDED"),
  };
};
