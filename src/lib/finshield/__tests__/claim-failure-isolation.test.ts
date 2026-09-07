import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { decodeDomainOutput } from "../agents/runner";
import { normalizeJudgeOutput, selectJudgeEvidence } from "../orchestrator";
import type { ConfirmedClaim, DomainFinding, JudgeOutput, ToolEvidence } from "../schemas";
import { createRunSession } from "../tools/runtime";

const claims: ConfirmedClaim[] = [
  { claim_ref: "C1", claim_type: "PRODUCT_TERM", statement_masked: "합성 금리는 연 3%다", materiality: "MATERIAL" },
  { claim_ref: "C2", claim_type: "CHANNEL", statement_masked: "합성 연락 경로는 공식 채널이다", materiality: "MATERIAL" },
];

const evidence = (ref: string): ToolEvidence => ({
  evidence_ref: ref,
  tool_code: "search_financial_product",
  source_type: "OFFICIAL_PRODUCT",
  authority_grade: "A",
  title: "합성 공식 상품 자료",
  official_id: "fixture-product",
  url: null,
  locator: {},
  published_at: "2026-01-01",
  fetched_at: "2026-09-08T00:00:00Z",
  content_hash: "a".repeat(64),
  excerpt_masked: "합성 상품 조건",
  independence_key: "b".repeat(64),
  reference_only: false,
  citable: true,
  incomplete: false,
  freshness_at_use: "FRESH",
  directness: "DIRECT",
});

describe("AI-015 복수 Claim 부분 실패 격리", () => {
  it("Domain Agent의 잘못된 인용 Claim만 UNKNOWN으로 낮춘다", () => {
    const session = createRunSession({
      sql: vi.fn() as unknown as ReturnType<typeof postgres>,
      ownerId: "fixture", caseId: "fixture", runId: "fixture",
      manifest: { manifestId: "fixture", kbReleaseId: "fixture", agentIds: {}, toolIds: {} },
    });
    session.evidence.set("E1", evidence("E1"));
    const decoded = decodeDomainOutput({
      schema_version: "out-v1",
      findings: [
        { claim_ref: "C1", state: "VERIFIED", relation: "SUPPORT", evidence_refs: ["E1"], summary_masked: "공식 자료와 일치한다", limits: [] },
        { claim_ref: "C2", state: "VERIFIED", relation: "SUPPORT", evidence_refs: ["E99"], summary_masked: "공식 경로라고 주장한다", limits: [] },
      ],
      out_of_scope_claim_refs: [],
    }, session);

    expect(decoded).toMatchObject({ ok: true, reason: "CITATION_INVALID" });
    if (!decoded.ok) throw new Error("합성 출력 해독 실패");
    const output = decoded.value as { findings: DomainFinding[] };
    expect(output.findings[0]).toMatchObject({ claim_ref: "C1", state: "VERIFIED", evidence_refs: ["E1"] });
    expect(output.findings[1]).toMatchObject({ claim_ref: "C2", state: "UNKNOWN", relation: "CONTEXT", evidence_refs: [] });
  });

  it("Judge의 잘못된 인용 Claim만 낮추고 정상 Claim은 보존한다", () => {
    const raw: JudgeOutput = {
      schema_version: "out-v1",
      claim_results: [
        { claim_ref: "C1", state: "VERIFIED", evidence_refs: ["E1"], withheld_reason: null, rationale_masked: "공식 조건과 일치한다" },
        { claim_ref: "C2", state: "VERIFIED", evidence_refs: ["E99"], withheld_reason: null, rationale_masked: "공식 경로라고 판단한다" },
      ],
      conflicts: [],
    };
    const normalized = normalizeJudgeOutput(raw, claims, new Map([["E1", evidence("E1")]]));
    expect(normalized.reasonCode).toBe("JUDGE_CITATION_INVALID");
    expect(normalized.output.claim_results[0]).toMatchObject({ claim_ref: "C1", state: "VERIFIED", evidence_refs: ["E1"] });
    expect(normalized.output.claim_results[1]).toMatchObject({ claim_ref: "C2", state: "UNKNOWN", evidence_refs: [] });
  });

  it("Judge가 누락한 Claim을 만들어 확정하지 않고 UNKNOWN으로 채운다", () => {
    const raw: JudgeOutput = {
      schema_version: "out-v1",
      claim_results: [
        { claim_ref: "C1", state: "VERIFIED", evidence_refs: ["E1"], withheld_reason: null, rationale_masked: "공식 조건과 일치한다" },
      ],
      conflicts: [],
    };
    const normalized = normalizeJudgeOutput(raw, claims, new Map([["E1", evidence("E1")]]));
    expect(normalized.reasonCode).toBe("JUDGE_CLAIM_COVERAGE_INVALID");
    expect(normalized.output.claim_results).toHaveLength(2);
    expect(normalized.output.claim_results[1]).toMatchObject({ claim_ref: "C2", state: "UNKNOWN", evidence_refs: [] });
  });

  it("Judge에는 Domain 판단이 실제 인용한 근거만 전달한다", () => {
    const findings = [{
      claim_ref: "C1", state: "VERIFIED", relation: "SUPPORT", evidence_refs: ["E1"],
      summary_masked: "공식 조건과 일치한다", limits: [], agent_code: "PRODUCT_INSTITUTION",
    }] satisfies (DomainFinding & { agent_code: string })[];
    expect(selectJudgeEvidence(findings, [evidence("E1"), evidence("E2")]).map((item) => item.evidence_ref))
      .toEqual(["E1"]);
  });
});
