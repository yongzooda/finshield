/** 공개 Demo 결과가 회원 결과와 같은 최종화·종합 결과·행동 안내 규칙을 쓰는지 본다. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinalClaim } from "../finalize";
import type { OrchestratedRun } from "../orchestrator";
import type { ToolEvidence } from "../schemas";

const mocks = vi.hoisted(() => ({ run: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../registry", () => ({
  loadManifest: async () => ({ manifestId: "00000000-0000-4000-8000-0000000000aa", kbReleaseId: "release", agentIds: {}, toolIds: {} }),
}));
vi.mock("../agents/model-adapter", () => ({ createAgentModel: () => ({}), createJudgeModel: () => ({}) }));
vi.mock("../orchestrator", () => ({ runVerification: async () => mocks.run }));
vi.mock("../action-guide", () => ({
  buildActionGuide: async () => ({
    stored: {},
    display: {
      actions: [{ action_no: 1, action_code: "VERIFY_OFFICIAL_CHANNEL", title: "공식 창구 확인", detail: "안내" }],
      channels: [{ action_no: 1, display_value: "1397" }],
    },
  }),
}));

const { overallInputs, runDemo } = await import("../demo");

const final = (claim_id: string, status: FinalClaim["status"], reason_code = "AS_JUDGED"): FinalClaim => ({
  claim_id, status, reason_code, cove_status: "NOT_REQUIRED", red_team_status: "NOT_REQUIRED",
  decision_summary_masked: "요약", evidences: [],
});

describe("Demo 종합 결과 Matrix 입력", () => {
  const isMaterial = (id: string) => id !== "D5";

  it("중요 Claim 이 공식 자료와 다르면 중대한 위험 입력을 켠다", () => {
    const inputs = overallInputs({ finals: [final("D1", "CONTRADICTED"), final("D5", "VERIFIED")], isMaterial, agentPartial: false, guideActionCodes: [] });
    expect(inputs).toMatchObject({ materialContradicted: true, nonMaterialContradicted: false, materialUndecided: false, coverageSatisfied: true });
  });

  it("중요 Claim 이 보류되면 Coverage 를 채우지 못한 것으로 센다", () => {
    const inputs = overallInputs({ finals: [final("D1", "UNKNOWN"), final("D2", "WITHHELD")], isMaterial, agentPartial: false, guideActionCodes: [] });
    expect(inputs).toMatchObject({ materialUndecided: true, coverageSatisfied: false, materialContradicted: false });
  });

  it("보조 Claim 의 미확인과 공식 창구 확인 안내는 거래 전 추가 확인으로 센다", () => {
    expect(overallInputs({ finals: [final("D1", "VERIFIED"), final("D5", "UNKNOWN")], isMaterial, agentPartial: false, guideActionCodes: [] }).preActionRemaining).toBe(true);
    expect(overallInputs({ finals: [final("D1", "VERIFIED")], isMaterial, agentPartial: false, guideActionCodes: ["VERIFY_OFFICIAL_CHANNEL"] }).preActionRemaining).toBe(true);
    expect(overallInputs({ finals: [final("D1", "VERIFIED")], isMaterial, agentPartial: false, guideActionCodes: [] }).preActionRemaining).toBe(false);
  });

  it("위험한 행동 요구는 사실 판정과 별개로 중대한 위험 입력을 켠다", () => {
    const inputs = overallInputs({ finals: [final("D1", "UNKNOWN", "HIGH_RISK_ADVANCE_PAYMENT")], isMaterial, agentPartial: false, guideActionCodes: [] });
    expect(inputs.highRisk).toBe(true);
  });

  it("중요 Claim 의 자료 엇갈림과 부분 실행을 그대로 넘긴다", () => {
    const inputs = overallInputs({ finals: [final("D1", "CONFLICT")], isMaterial, agentPartial: true, guideActionCodes: [] });
    expect(inputs).toMatchObject({ materialConflict: true, agentPartial: true });
  });
});

describe("공개 Demo 실행 결과", () => {
  const evidence = (ref: string): ToolEvidence => ({
    evidence_ref: ref, tool_code: "search_financial_product", source_type: "PRODUCT", authority_grade: "A",
    title: "햇살론15", official_id: "data.go.kr:15094787:햇살론15:202602:1", url: null, locator: {},
    published_at: null, fetched_at: "2026-09-10T15:06:00Z", content_hash: "a".repeat(64), excerpt_masked: "대출금리 15.9%",
    independence_key: `k-${ref}`, reference_only: false, citable: true, incomplete: false,
    freshness_at_use: "FRESH", directness: "DIRECT",
  });

  const seedClaims = [
    { claim_type: "PRODUCT_TERM", statement_masked: "연 3.2% 고정금리다.", materiality: "MATERIAL" },
    { claim_type: "PRODUCT_TERM", statement_masked: "최대 2,000만원까지다.", materiality: "MATERIAL" },
  ];

  let overallCall: unknown[] | null;
  let snapshot: Record<string, unknown> | null;
  let runUpdate: unknown[] | null;
  const sql = vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join("?");
    if (query.includes("from demo.seed_versions")) return Promise.resolve([{ version: "v1", masked_input: "합성 권유문", expected_claim_manifest: { claims: seedClaims } }]);
    if (query.includes("from demo.seed_sources")) return Promise.resolve([{ source_snapshot_id: "00000000-0000-4000-8000-0000000000bb" }]);
    if (query.includes("insert into demo.runs")) return Promise.resolve([{ id: "00000000-0000-4000-8000-0000000000cc" }]);
    if (query.includes("private.decide_overall_result")) { overallCall = values; return Promise.resolve([{ overall: "MATERIAL_RISK_FOUND" }]); }
    if (query.includes("update demo.runs")) { runUpdate = values; return Promise.resolve([]); }
    if (query.includes("insert into demo.result_snapshots")) { snapshot = JSON.parse(String(values[1])); return Promise.resolve([]); }
    throw new Error(`예상하지 않은 SQL: ${query}`);
  });

  beforeEach(() => {
    overallCall = null; snapshot = null; runUpdate = null;
    const run: OrchestratedRun = {
      agentResults: ["PRODUCT_INSTITUTION", "COVE", "RED_TEAM"].map((agentCode) => ({ agentCode, status: "SUCCEEDED", reasonCode: null, toolCalls: 1 })),
      findings: [{ agent_code: "PRODUCT_INSTITUTION", claim_ref: "D1", state: "CONTRADICTED", relation: "CONTRADICT", evidence_refs: ["E1"] } as never],
      evidence: [evidence("E1"), evidence("E2")],
      judgeOutput: {
        schema_version: "out-v1",
        claim_results: [
          { claim_ref: "D1", state: "CONTRADICTED", evidence_refs: ["E1"], withheld_reason: null, rationale_masked: "공식 금리는 연 15.9%다." },
          { claim_ref: "D2", state: "CONTRADICTED", evidence_refs: ["E2"], withheld_reason: null, rationale_masked: "Judge 는 반증이라 봤다." },
        ],
        conflicts: [],
      },
      judgeReasonCode: null,
      // D1 은 독립 재확인이 같은 반증에 이르렀고, D2 는 판단하지 못했다.
      cove: { schema_version: "out-v1", results: [
        { claim_ref: "D1", status: "REFUTED", evidence_refs: ["E1"], note_masked: "" },
        { claim_ref: "D2", status: "INCONCLUSIVE", evidence_refs: [], note_masked: "" },
      ] },
      redTeam: { schema_version: "out-v1", results: [
        { claim_ref: "D1", status: "NONE_FOUND", evidence_refs: [], note_masked: "" },
        { claim_ref: "D2", status: "NONE_FOUND", evidence_refs: [], note_masked: "" },
      ] },
      evidenceIds: new Map([["E1", "E1"], ["E2", "E2"]]),
      partial: false,
    };
    mocks.run = run;
  });

  it("독립 재확인이 확인하지 못한 중요 Claim 은 Judge 판정 그대로 확정하지 않는다", async () => {
    const { manifest } = await runDemo({ sql: sql as never, session: {
      sessionId: "00000000-0000-4000-8000-0000000000dd", capabilityToken: "t", expiresAt: "2026-09-11T00:00:00Z",
      seedVersionId: "00000000-0000-4000-8000-0000000000ee",
    } });
    const claims = manifest.claims as { claim_ref: string; state: string; cove_status: string; evidence_refs: string[]; relations: Record<string, string> }[];
    expect(claims.find((claim) => claim.claim_ref === "D1")).toMatchObject({ state: "CONTRADICTED", cove_status: "CONFIRMED" });
    expect(claims.find((claim) => claim.claim_ref === "D2")).toMatchObject({ state: "UNKNOWN", cove_status: "UNRESOLVED" });
    expect(claims.find((claim) => claim.claim_ref === "D1")?.relations.E1).toBe("CONTRADICT");
  });

  it("종합 결과는 회원 Passport 와 같은 DB 함수가 정하고 행동 안내·세 축을 함께 남긴다", async () => {
    const { manifest } = await runDemo({ sql: sql as never, session: {
      sessionId: "00000000-0000-4000-8000-0000000000dd", capabilityToken: "t", expiresAt: "2026-09-11T00:00:00Z",
      seedVersionId: "00000000-0000-4000-8000-0000000000ee",
    } });
    // 인자 순서: 중요 반증·위험 행동·보조 반증·중요 충돌·중요 보류·부분 실행·Coverage·거래 전 확인.
    expect(overallCall).toEqual([true, false, false, false, true, false, false, true]);
    expect(manifest).toMatchObject({
      schema_version: "demo-result-v2",
      overall_result: "MATERIAL_RISK_FOUND",
      guide: { channels: [{ action_no: 1, display_value: "1397" }] },
    });
    expect((manifest.axes as { axis: string }[]).map((axis) => axis.axis)).toEqual(["AUTHENTICITY", "TRANSACTION_SALES_RISK", "SUITABILITY"]);
    expect(runUpdate).toContain("MATERIAL_RISK_FOUND");
    expect(snapshot).toMatchObject({ overall_result: "MATERIAL_RISK_FOUND" });
  });
});
