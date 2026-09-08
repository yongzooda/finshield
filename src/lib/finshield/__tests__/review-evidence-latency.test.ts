import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loanToolPlan, domainClaims } from "../agents/loan-tool-plan";
import { aftercareBatchContext } from "../agents/model-adapter";
import { productDisclosure } from "../product-disclosure";
import { reviewFindings, selectJudgeEvidence } from "../orchestrator";
import { citationProblems, type DomainAgentInput, type ToolEvidence } from "../schemas";

const input: DomainAgentInput = { schema_version: "in-v1", agent_code: "PRODUCT_INSTITUTION", scenario: "LOAN", journey_stage: "PRE_TRANSACTION",
  claims: [{ claim_ref: "C1", claim_type: "PRODUCT_TERM", statement_masked: "햇살론15는 연 3% 고정금리이다", materiality: "MATERIAL" }], masked_intake: "" };
const source = { evidence_ref: "E2", official_id: "kinfa:hessalLoan", freshness_at_use: "FRESH", incomplete: false,
  tool_code: "search_financial_product", source_type: "PRODUCT", authority_grade: "B", title: "공식 상품", url: "https://www.kinfa.or.kr/financialProduct/hessalLoan.do",
  published_at: null, fetched_at: "2026-09-09T00:00:00Z", content_hash: "a".repeat(64), independence_key: "source", reference_only: false, citable: false, directness: "CONTEXT_ONLY",
  excerpt_masked: "햇살론15 [2025년 12월 31일 보증 종료] 대출한도 최대 2000만원 대출금리 연 15.9% (단일금리)",
  locator: { kind: "html_section", temporal_status: "ENDED", product_end_date: "2025-12-31" } } as ToolEvidence;
it("현재 금리 보류에서도 실제 종료 전 수치를 근거와 연결하고 만료·다른 상품에는 재사용하지 않는다", () => {
  expect(productDisclosure(input.claims[0].statement_masked, [source])).toMatchObject({ ref: "E2", summary: expect.stringContaining("연 15.9%") });
  expect(productDisclosure("햇살론15 최대 한도", [source])?.summary).toContain("2000만 원");
  expect(productDisclosure("햇살론150 금리", [source])).toBeNull();
  expect(productDisclosure(input.claims[0].statement_masked, [{ ...source, freshness_at_use: "STALE" }])).toBeNull();
  expect(productDisclosure(input.claims[0].statement_masked, [{ ...source, excerpt_masked: "대출금리 우대금리 3% 대출한도 모름" }])).toBeNull();
});
it("독립 검토의 새 반대 근거를 Judge에 넘기고 NONE_FOUND는 지지로 바꾸지 않는다", () => {
  const findings = reviewFindings(null, { schema_version: "out-v1", results: [
    { claim_ref: "C1", status: "COUNTER_EVIDENCE", evidence_refs: ["E2"], note_masked: "종료 근거" },
    { claim_ref: "C2", status: "NONE_FOUND", evidence_refs: [], note_masked: "없음" },
  ] });
  expect(findings.map(f => f.state)).toEqual(["CONTRADICTED", "UNKNOWN"]);
  expect(selectJudgeEvidence(findings, [source])).toEqual([source]);
});
it("고정 상품 읽기는 이름을 보존하고 독립 검토에는 초기 도구 계획을 주입하지 않는다", () => {
  expect(loanToolPlan(input)).toEqual([{ toolCode: "search_financial_product", input: { query: "햇살론15" } }]);
  expect(loanToolPlan({ ...input, agent_code: "COVE" })).toBeNull();
  expect(loanToolPlan({ ...input, agent_code: "RED_TEAM" })).toBeNull();
  expect(loanToolPlan({ ...input, claims: [{ ...input.claims[0], statement_masked: "햇살론150 금리" }] })).toBeNull();
});
it("종료 사실로 다른 상품·과거 계약을 반박하거나 현재 가입을 지지할 수 없다", () => {
  const ended = { ...source, citable: true, reference_only: false, directness: "DIRECT", locator: { permitted_use: "REFUTE_CURRENT_OFFER" } } as ToolEvidence;
  const pool = new Map([["E2", ended]]);
  for (const statement of ["다른 상품의 금리는 3%", "햇살론15 과거 계약 한도는 2000만원"]) {
    expect(citationProblems(["E2"], "CONTRADICTED", pool, statement).length).toBeGreaterThan(0);
  }
  expect(citationProblems(["E2"], "VERIFIED", pool, input.claims[0].statement_masked).length).toBeGreaterThan(0);
});
it("Domain 책임 밖의 반복 판단을 줄이면서 CoVe의 중요 Claim은 모두 유지한다", () => {
  const mixed = { ...input, claims: [...input.claims, { ...input.claims[0], claim_ref: "C2", claim_type: "CONDUCT", statement_masked: "원격제어 앱을 설치하라" }] };
  expect(domainClaims(mixed).map(c => c.claim_ref)).toEqual(["C1"]);
  expect(domainClaims({ ...mixed, agent_code: "COVE" })).toEqual(mixed.claims);
});
it("가입 후 묶음에 다른 묶음의 Claim 참조가 섞이지 않는다", () => {
  const context = { schema_version: "aftercare-review-v1" as const, answers: { UNDERSTOOD_TERMS: "NO" }, comparison: [
    { claim_ref: "C1", before: "설명", contract: "계약", result: "DIFFERENT_TEXT" },
    { claim_ref: "C4", before: "다른 설명", contract: "다른 계약", result: "DIFFERENT_TEXT" },
  ] };
  expect(aftercareBatchContext(context, input.claims)?.comparison.map(c => c.claim_ref)).toEqual(["C1"]);
  expect(context.comparison).toHaveLength(2);
});
