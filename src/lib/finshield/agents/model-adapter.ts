/**
 * 실제 모델 호출로 Agent·Judge 경계를 채운다.
 *
 * 두 단계로 나눈다. 먼저 어떤 Tool 을 부를지 고르게 하고, 그다음 근거를 보고
 * 판단하게 한다. 한 번의 자유 서술로 둘을 섞지 않는다. 그래야 「무엇을 보고
 * 무엇을 판단했는가」가 실행 기록에 남는다.
 *
 * 모델에 넘기는 것은 마스킹된 문장과 근거 요약뿐이다. 원문과 도구 응답 원문은
 * 넣지 않는다. 근거는 이름과 요약만 넘겨 모델이 이름으로만 인용하게 한다.
 */

import "server-only";
import { z } from "zod";
import { FINSHIELD_MODEL } from "../manifest";
import { callFinshieldModel, emptyModelUsage, type ModelBudgetContext, type ModelUsage } from "../model-budget";
import type { AgentModel } from "./runner";
import type { JudgeModel } from "../orchestrator";
import { JUDGE_SYSTEM } from "./prompts";
import { coveOutput, redTeamOutput, domainAgentOutput, type ToolEvidence } from "../schemas";
import type { ClaimExtractor } from "../intake";

const MAX_EXCERPT = 400;

/** 모델이 보는 근거 요약. 원문 전체가 아니라 인용에 필요한 만큼만 준다. */
export const evidenceBrief = (evidence: ToolEvidence[]) => evidence.map((item) => ({
  ref: item.evidence_ref,
  source: item.source_type,
  grade: item.authority_grade,
  title: item.title,
  published_at: item.published_at,
  freshness: item.freshness_at_use,
  directness: item.directness,
  reference_only: item.reference_only,
  citable: item.citable,
  incomplete: item.incomplete,
  excerpt: item.excerpt_masked.slice(0, MAX_EXCERPT),
}));

const toolChoiceSchema = z.object({
  calls: z.array(z.object({
    tool_code: z.string(),
    // 도구 입력은 도구마다 다르므로 몇 가지 공통 자리만 둔다.
    query: z.string().optional(),
    values: z.array(z.string()).optional(),
    urls: z.array(z.string()).optional(),
  })).max(3),
  reason_masked: z.string().max(300),
});

export const createAgentModel = (context?: ModelBudgetContext): AgentModel => {
  const usage = new Map<string, ModelUsage>();
  const usageFor = (code: string) => {
    if (!usage.has(code)) usage.set(code, emptyModelUsage());
    return usage.get(code)!;
  };
  return ({
  usage: usageFor,
  async chooseTools({ system, signal, input, evidence, observations, availableTools }) {
    const result = await callFinshieldModel({
      model: FINSHIELD_MODEL,
      system: `${system}\n\n지금은 도구를 고르는 단계다. 확인이 더 필요하면 부를 도구를 고르고,\n충분하거나 필요한 자료가 미연결·조회 실패 상태면 calls 를 빈 배열로 둔다. 같은 도구에 같은 입력을 반복하지 않는다. 목록에 없는 도구 이름을 쓰지 않는다. query에는 도구에 맞는 짧은 핵심어를 넣는다. 상품 조회는 상품명, 법령 조회는 법령명, 소비자 안내는 권유의 행동 요구를 쓴다. 이유는 20자 이내다.`,
      user: JSON.stringify({
        claims: input.claims,
        journey_stage: input.journey_stage,
        available_tools: availableTools.map((tool) => ({ code: tool.toolCode, purpose: tool.purposeCode })),
        evidence_so_far: evidenceBrief(evidence),
        observations,
      }),
      schema: toolChoiceSchema,
      maxTokens: 1000, effort: "low", signal, maxRetries: 0, timeoutMs: 8_000,
    }, context, usageFor(input.agent_code));
    return result.calls.map((call) => ({
      toolCode: call.tool_code,
      input: {
        ...(call.query !== undefined ? { query: call.query } : {}),
        ...(call.values !== undefined ? { values: call.values } : {}),
        ...(call.urls !== undefined ? { urls: call.urls } : {}),
      },
    }));
  },

  async decide({ system, signal, input, evidence, observations }) {
    return callFinshieldModel({
      model: FINSHIELD_MODEL,
      system: `${system}\n\n지금은 판단하는 단계다. 아래 근거 목록의 ref 만 인용한다. summary_masked와 note_masked는 각각 40자 이내 한 문장으로 답한다. limits는 꼭 필요한 항목만 한 개 이하로 답한다.`,
      user: JSON.stringify({
        claims: input.claims,
        journey_stage: input.journey_stage,
        evidence: evidenceBrief(evidence),
        observations,
      }),
      schema: input.agent_code === "COVE" ? coveOutput
        : input.agent_code === "RED_TEAM" ? redTeamOutput : domainAgentOutput,
      maxTokens: 2400, effort: "low", signal, maxRetries: 0, timeoutMs: 12_000,
    }, context, usageFor(input.agent_code));
  },
});
};

export const createJudgeModel = (context?: ModelBudgetContext): JudgeModel => {
 const usage = emptyModelUsage();
 return ({ usage: () => usage,
  async judge({ claims, findings, evidence, signal }) {
    return callFinshieldModel({
      model: FINSHIELD_MODEL,
      system: `${JUDGE_SYSTEM}\n각 rationale_masked는 핵심 근거를 담은 40자 이내 한 문장이다. withheld_reason은 20자 이내다. 입력 Claim마다 정확히 한 결과를 낸다.`,
      user: JSON.stringify({ claims, findings, evidence: evidenceBrief(evidence) }),
      schema: z.object({
        schema_version: z.literal("out-v1"),
        claim_results: z.array(z.object({
          claim_ref: z.string(),
          state: z.enum(["VERIFIED", "CONTRADICTED", "CONFLICT", "UNKNOWN", "NEED_MORE_INFORMATION", "WITHHELD"]),
          evidence_refs: z.array(z.string()),
          withheld_reason: z.string().nullable(),
          rationale_masked: z.string(),
        })),
        conflicts: z.array(z.object({
          claim_ref: z.string(),
          evidence_refs: z.array(z.string()),
          note_masked: z.string(),
        })),
      }),
      maxTokens: 2400, effort: "low", signal, maxRetries: 0, timeoutMs: 8_000,
    }, context, usage);
  },
});
};

/**
 * Claim 추출. 마스킹된 문장에서 확인할 사실 주장을 뽑는다.
 *
 * 여기서 판단하지 않는다. 「무엇을 확인해야 하는가」만 남기고, 그것이 사실인지는
 * Domain Agent 가 근거를 찾아 정한다. 사용자가 목록을 보고 고치고 확정한 뒤에야
 * 검증이 시작된다 (CLM-003).
 */
export const createClaimExtractor = (): ClaimExtractor => async (maskedText, options) => {
  const result = await callFinshieldModel({
      model: FINSHIELD_MODEL,
    system: `당신은 상담 내용에서 확인할 사실 주장을 뽑는다. 한국어로 답한다.

지켜야 할 규칙이다.

1. 문장에 실제로 있는 내용만 뽑는다. 없는 조건을 만들어 넣지 않는다.
2. 판단하지 않는다. 사실인지 아닌지는 다른 단계가 정한다.
3. 금리·한도·자격·기관·상품명·연락 경로처럼 확인할 수 있는 것만 뽑는다.
4. 거래 성립에 영향이 큰 것을 MATERIAL 로 둔다. 판단이 서지 않으면 UNDETERMINED 로 둔다.
5. 하나의 주장에 하나의 사실만 담는다. 여러 개를 한 문장에 묶지 않는다.
6. 최대 여덟 개까지 뽑는다.
7. 입력은 이미 개인정보 검사를 거쳤다. 상품명·기관명·금리·금액·기간·한도는 판단에 필요한 공개 조건이다. 지우거나 [상품명], [금리] 같은 자리표시자로 바꾸지 않는다.
8. source_quote에는 입력에 그대로 존재하는 해당 주장의 짧은 구절을 복사한다. statement_masked에는 상품 문맥을 포함한 한 문장을 쓰되 source_quote의 숫자·단위·부정 표현을 보존한다.`,
    user: maskedText,
    schema: z.object({
      claims: z.array(z.object({
        claim_type: z.enum(["PRODUCT_TERM", "INSTITUTION", "CHANNEL", "ELIGIBILITY", "CONDUCT", "OTHER"]),
        statement_masked: z.string().min(1).max(400),
        source_quote: z.string().min(1).max(400),
        materiality: z.enum(["MATERIAL", "NON_MATERIAL", "UNDETERMINED"]),
      })).max(8),
    }),
    maxTokens: 1600, effort: "low", maxRetries: 0, timeoutMs: 10_000, signal: options?.signal,
  }, options?.budget);
  return result.claims.map((claim) => {
    assertClaimSource(maskedText, claim.source_quote, claim.statement_masked);
    return { sourceQuote: claim.source_quote, claimType: claim.claim_type, statementMasked: claim.statement_masked, materiality: claim.materiality };
  });
};

/** CLM-002: 추출은 금융 조건을 익명 자리표시자로 바꾸거나 숫자를 만들어서는 안 된다. */
export function assertClaimSource(input: string, quote: string, statement: string) {
  const normalize = (text: string) => text.normalize("NFC").replace(/\s+/g, "");
  const original = normalize(input); const source = normalize(quote); const result = normalize(statement);
  if (!source || !original.includes(source)) throw new Error("CLAIM_SOURCE_NOT_FOUND");
  const introduced = statement.match(/\[(?:상품명|기관명|금리|금액|기간|한도)\]/g) ?? [];
  if (introduced.some(token => !input.includes(token))) throw new Error("CLAIM_FACTS_REMOVED");
  const numbers = (text: string): string[] => text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  if (numbers(source).some(value => !numbers(result).includes(value))
    || numbers(result).some(value => !numbers(original).includes(value))) throw new Error("CLAIM_NUMBERS_CHANGED");
}
