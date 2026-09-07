/** 모델에 넘기는 것은 인용에 필요한 만큼이다 */

import { describe, expect, it } from "vitest";
import {
  citationReferenceSchema, claimBrief, domainOutputSchemaFor, evidenceBrief, judgeOutputSchemaFor,
} from "../agents/model-adapter";
import type { ToolEvidence } from "../schemas";

const evidence = (over: Partial<ToolEvidence> = {}): ToolEvidence => ({
  evidence_ref: "E1",
  tool_code: "lookup_statute",
  source_type: "LAW",
  authority_grade: "A",
  title: "서민의 금융생활 지원에 관한 법률",
  official_id: "law.go.kr:1",
  url: null,
  locator: { law_id: "1", secret_field: "내부 값" },
  published_at: "2026-01-01",
  fetched_at: "2026-09-07T00:00:00Z",
  content_hash: "a".repeat(64),
  excerpt_masked: "가".repeat(900),
  independence_key: "b".repeat(64),
  reference_only: false,
  citable: true,
  incomplete: false,
  freshness_at_use: "FRESH",
  directness: "DIRECT",
  ...over,
});

describe("근거 요약", () => {
  it("Claim의 DB ID와 부가 속성을 모델 본문에 전달하지 않는다", () => {
    const input = { claim_ref: "C1", claim_type: "PRODUCT_TERM", statement_masked: "연 금리 3%", materiality: "MATERIAL" as const,
      claim_id: "private-row-id", claimId: "private-row-id", owner_id: "private-owner-id" };
    expect(claimBrief([input])).toEqual([{ claim_ref: "C1", claim_type: "PRODUCT_TERM", statement_masked: "연 금리 3%", materiality: "MATERIAL" }]);
    expect(JSON.stringify(claimBrief([input]))).not.toContain("private-");
  });
  it("본문은 인용에 필요한 만큼만 넘긴다", () => {
    const [brief] = evidenceBrief([evidence()]);
    expect(brief.excerpt.length).toBe(400);
  });

  it("locator 와 해시 같은 내부 값은 넘기지 않는다", () => {
    const [brief] = evidenceBrief([evidence()]);
    const keys = Object.keys(brief);
    expect(keys).not.toContain("locator");
    expect(keys).not.toContain("content_hash");
    expect(keys).not.toContain("independence_key");
    expect(JSON.stringify(brief)).not.toContain("내부 값");
  });

  it("인용 이름과 판정에 필요한 표시는 넘긴다", () => {
    const [brief] = evidenceBrief([evidence({ reference_only: true, freshness_at_use: "STALE" })]);
    expect(brief.ref).toBe("E1");
    // 참고용인지와 신선도는 판정 규칙에 직접 쓰이므로 모델이 알아야 한다.
    expect(brief.reference_only).toBe(true);
    expect(brief.freshness).toBe("STALE");
    expect(brief.grade).toBe("A");
  });
});

describe("AI-017 모델 출력 Citation 목록", () => {
  it("이번 호출에 전달한 ref와 빈 배열만 허용한다", () => {
    const schema = citationReferenceSchema([evidence({ evidence_ref: "E1" }), evidence({ evidence_ref: "E2" })]);
    expect(schema.safeParse(["E1", "E2"]).success).toBe(true);
    expect(schema.safeParse([]).success).toBe(true);
    expect(schema.safeParse(["E99"]).success).toBe(false);
  });

  it("근거가 없으면 비어 있지 않은 Citation 배열을 거부한다", () => {
    const schema = citationReferenceSchema([]);
    expect(schema.safeParse([]).success).toBe(true);
    expect(schema.safeParse(["E1"]).success).toBe(false);
  });

  it("Domain과 Judge의 중첩된 Citation에도 같은 목록을 적용한다", () => {
    const domain = domainOutputSchemaFor([evidence()]);
    const judge = judgeOutputSchemaFor([evidence()]);
    expect(domain.safeParse({
      schema_version: "out-v1",
      findings: [{ claim_ref: "C1", state: "VERIFIED", relation: "SUPPORT", evidence_refs: ["E99"], summary_masked: "합성 판단", limits: [] }],
      out_of_scope_claim_refs: [],
    }).success).toBe(false);
    expect(judge.safeParse({
      schema_version: "out-v1",
      claim_results: [{ claim_ref: "C1", state: "UNKNOWN", evidence_refs: ["E99"], withheld_reason: "합성 보류", rationale_masked: "합성 판단" }],
      conflicts: [],
    }).success).toBe(false);
  });
});
