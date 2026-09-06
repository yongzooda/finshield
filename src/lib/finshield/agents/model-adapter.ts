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
import type { ToolEvidence } from "../schemas";

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
  async chooseTools({ system, input, evidence, observations, availableTools }) {
    const result = await callStructured({
      system: `${system}\n\n지금은 도구를 고르는 단계다. 확인이 더 필요하면 부를 도구를 고르고,\n충분하면 calls 를 빈 배열로 둔다. 목록에 없는 도구 이름을 쓰지 않는다.`,
      user: JSON.stringify({
        claims: input.claims,
        journey_stage: input.journey_stage,
        available_tools: availableTools.map((tool) => tool.toolCode),
        evidence_so_far: evidenceBrief(evidence),
        observations,
      }),
      schema: toolChoiceSchema,
      maxTokens: 2000,
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

  async decide({ system, input, evidence, observations }) {
    return callStructured({
      system: `${system}\n\n지금은 판단하는 단계다. 아래 근거 목록의 ref 만 인용한다.`,
      user: JSON.stringify({
        claims: input.claims,
        journey_stage: input.journey_stage,
        evidence: evidenceBrief(evidence),
        observations,
      }),
      // Schema 는 호출부가 다시 검사한다. 여기서는 모델이 형태를 맞추게만 한다.
      schema: z.object({
        schema_version: z.literal("out-v1"),
        findings: z.array(z.object({
          claim_ref: z.string(),
          state: z.enum(["VERIFIED", "CONTRADICTED", "CONFLICT", "UNKNOWN", "NEED_MORE_INFORMATION", "WITHHELD"]),
          relation: z.enum(["SUPPORT", "CONTRADICT", "CONTEXT"]),
          evidence_refs: z.array(z.string()),
          summary_masked: z.string(),
          limits: z.array(z.string()),
        })),
        out_of_scope_claim_refs: z.array(z.string()),
      }),
      maxTokens: 6000,
    });
  },
});

export const createJudgeModel = (): JudgeModel => ({
  async judge({ claims, findings, evidence }) {
    return callStructured({
      system: JUDGE_SYSTEM,
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
      maxTokens: 6000,
    });
  },
});
