import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { z } from "zod";

vi.mock("@/lib/agents/model", () => ({ callStructured: vi.fn() }));

import { callStructured } from "@/lib/agents/model";
import { createAgentModel } from "@/lib/finshield/agents/model-adapter";
import { runReviewAgent } from "@/lib/finshield/agents/runner";
import { createRunSession } from "@/lib/finshield/tools/runtime";
import { coveOutput, redTeamOutput, type DomainAgentInput } from "@/lib/finshield/schemas";

const cases = [
  { code: "COVE", schema: coveOutput, status: "INCONCLUSIVE" },
  { code: "RED_TEAM", schema: redTeamOutput, status: "NONE_FOUND" },
] as const;

const inputFor = (code: string): DomainAgentInput => ({
  schema_version: "in-v1", agent_code: code, scenario: "LOAN", journey_stage: "PRE_TRANSACTION",
  claims: [{ claim_ref: "C1", claim_type: "PRODUCT_TERM", statement_masked: "합성 대출의 조건을 확인한다", materiality: "MATERIAL" }],
  masked_intake: "",
});

describe("AI-009·AI-010·AI-017 실제 검토 출력 계약", () => {
  for (const entry of cases) {
    const output = {
      schema_version: "out-v1", results: [{
        claim_ref: "C1", status: entry.status, evidence_refs: [], note_masked: "합성 시험에서 근거를 찾지 못했다",
      }],
    };

    it(`${entry.code}: Provider에 전달한 Schema가 검토 결과를 허용한다`, async () => {
      // 모델 경계만 대체한다. decide는 제품 구현이며 실제 전달 Schema로 검사한다.
      vi.mocked(callStructured).mockImplementation(async (opts) => opts.schema.parse(output));
      const received = await createAgentModel().decide({
        system: "합성 검토 시험", input: inputFor(entry.code), evidence: [], observations: [],
      });
      expect(entry.schema.safeParse(received).success).toBe(true);
    });

    it(`${entry.code}: 유효한 results 응답을 실행 기록에 저장하고 종결한다`, async () => {
      const agentRun = vi.fn(async () => "audit-agent");
      const session = createRunSession({
        sql: vi.fn(() => { throw new Error("이 시험에서는 DB에 접근하지 않는다"); }) as unknown as ReturnType<typeof postgres>,
        ownerId: "audit-owner", caseId: "audit-case", runId: "audit-run",
        manifest: { manifestId: "audit-manifest", kbReleaseId: "audit-kb", agentIds: {}, toolIds: {} },
        recorder: { agentRun, toolRuns: async () => new Map() },
      });
      const result = await runReviewAgent<z.infer<typeof entry.schema>>({
        session, agentCode: entry.code, claims: inputFor(entry.code).claims, journeyStage: "PRE_TRANSACTION",
        model: { chooseTools: async () => [], decide: async () => output }, impls: {},
        parse: (raw) => {
          const parsed = entry.schema.safeParse(raw);
          return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
        },
        refsOf: (value) => value.results.map((row) => ({ refs: row.evidence_refs, confirmed: false })),
      });
      expect(result.status).toBe("SUCCEEDED");
      expect(result.output).toEqual(output);
      expect(agentRun).toHaveBeenCalledWith(expect.objectContaining({ findingCount: 1 }));
    });
  }
});
