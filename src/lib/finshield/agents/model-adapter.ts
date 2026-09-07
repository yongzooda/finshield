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
import { callStructured } from "@/lib/agents/model";
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

export const createAgentModel = (): AgentModel => ({
  async chooseTools({ system, signal, input, evidence, observations, availableTools }) {
    const result = await callStructured({
      system: `${system}\n\n지금은 도구를 고르는 단계다. 확인이 더 필요하면 부를 도구를 고르고,\n충분하면 calls 를 빈 배열로 둔다. 목록에 없는 도구 이름을 쓰지 않는다. query는 '햇살론15'처럼 상품명·기관명 핵심어만 넣는다. 이유는 20자 이내다.`,
      user: JSON.stringify({
        claims: input.claims,
        journey_stage: input.journey_stage,
        available_tools: availableTools.map((tool) => tool.toolCode),
        evidence_so_far: evidenceBrief(evidence),
        observations,
      }),
      schema: toolChoiceSchema,
      maxTokens: 1000, effort: "low", signal, maxRetries: 0, timeoutMs: 8_000,
    });
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
    return callStructured({
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
    });
  },
});

export const createJudgeModel = (): JudgeModel => ({
  async judge({ claims, findings, evidence, signal }) {
    return callStructured({
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
    });
  },
});

/**
 * Claim 추출. 마스킹된 문장에서 확인할 사실 주장을 뽑는다.
 *
 * 여기서 판단하지 않는다. 「무엇을 확인해야 하는가」만 남기고, 그것이 사실인지는
 * Domain Agent 가 근거를 찾아 정한다. 사용자가 목록을 보고 고치고 확정한 뒤에야
 * 검증이 시작된다 (CLM-003).
 */
export const createClaimExtractor = (): ClaimExtractor => async (maskedText) => {
  const result = await callStructured({
    system: `당신은 상담 내용에서 확인할 사실 주장을 뽑는다. 한국어로 답한다.

지켜야 할 규칙이다.

1. 문장에 실제로 있는 내용만 뽑는다. 없는 조건을 만들어 넣지 않는다.
2. 판단하지 않는다. 사실인지 아닌지는 다른 단계가 정한다.
3. 금리·한도·자격·기관·상품명·연락 경로처럼 확인할 수 있는 것만 뽑는다.
4. 거래 성립에 영향이 큰 것을 MATERIAL 로 둔다. 판단이 서지 않으면 UNDETERMINED 로 둔다.
5. 하나의 주장에 하나의 사실만 담는다. 여러 개를 한 문장에 묶지 않는다.
6. 최대 여덟 개까지 뽑는다.`,
    user: maskedText,
    schema: z.object({
      claims: z.array(z.object({
        claim_type: z.enum(["PRODUCT_TERM", "INSTITUTION", "CHANNEL", "ELIGIBILITY", "CONDUCT", "OTHER"]),
        statement_masked: z.string().min(1).max(400),
        materiality: z.enum(["MATERIAL", "NON_MATERIAL", "UNDETERMINED"]),
      })).max(8),
    }),
    maxTokens: 1600, effort: "low", maxRetries: 0, timeoutMs: 10_000,
  });
  return result.claims.map((claim) => ({
    claimType: claim.claim_type,
    statementMasked: claim.statement_masked,
    materiality: claim.materiality,
  }));
};
