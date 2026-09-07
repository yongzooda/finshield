/** 규칙 1 의 기계적 강제 — 모델이 지어낸 근거로는 확정할 수 없다 */

import { describe, expect, it } from "vitest";
import {
  citationProblems, domainAgentOutput, independentCount, type ToolEvidence,
} from "../schemas";

const evidence = (ref: string, over: Partial<ToolEvidence> = {}): ToolEvidence => ({
  evidence_ref: ref,
  tool_code: "lookup_statute",
  source_type: "STATUTE",
  authority_grade: "A",
  title: "서민의 금융생활 지원에 관한 법률",
  official_id: "law:001",
  url: null,
  locator: { article: "제2조" },
  published_at: "2026-01-01",
  fetched_at: "2026-09-07T00:00:00Z",
  content_hash: "a".repeat(64),
  excerpt_masked: "마스킹된 조문",
  independence_key: `key-${ref}`,
  reference_only: false,
  citable: true,
  incomplete: false,
  freshness_at_use: "FRESH",
  directness: "DIRECT",
  ...over,
});

const pool = (items: ToolEvidence[]) => new Map(items.map((item) => [item.evidence_ref, item]));

describe("근거 인용 검사", () => {
  it("존재하지 않는 근거를 인용하면 막는다", () => {
    const problems = citationProblems(["E1", "E9"], "VERIFIED", pool([evidence("E1")]));
    expect(problems.some((p) => p.includes("E9"))).toBe(true);
  });

  it("근거 없이 확정 상태를 쓰면 막는다", () => {
    expect(citationProblems([], "VERIFIED", pool([]))).toContain("근거 없이 확정 상태를 썼습니다.");
    expect(citationProblems([], "CONTRADICTED", pool([]))).toContain("근거 없이 확정 상태를 썼습니다.");
  });

  it("참고용 자료만으로는 확정하지 못한다", () => {
    const problems = citationProblems(["E1"], "VERIFIED", pool([evidence("E1", { reference_only: true })]));
    expect(problems).toContain("참고용 자료만으로 확정 상태를 썼습니다.");
  });

  it("근거가 부족해도 UNKNOWN 은 남길 수 있다", () => {
    expect(citationProblems([], "UNKNOWN", pool([]))).toEqual([]);
    expect(citationProblems([], "NEED_MORE_INFORMATION", pool([]))).toEqual([]);
  });

  it("정상 인용은 통과한다", () => {
    expect(citationProblems(["E1"], "VERIFIED", pool([evidence("E1")]))).toEqual([]);
  });
});

describe("독립 근거 세기", () => {
  it("같은 원문에서 나온 근거는 하나로 센다", () => {
    const items = [
      evidence("E1", { independence_key: "same" }),
      evidence("E2", { independence_key: "same" }),
      evidence("E3", { independence_key: "other" }),
    ];
    expect(independentCount(["E1", "E2", "E3"], pool(items))).toBe(2);
  });

  it("없는 근거는 세지 않는다", () => {
    expect(independentCount(["E1", "E9"], pool([evidence("E1")]))).toBe(1);
  });
});

describe("Domain Agent 출력 Schema", () => {
  it("상태값이 여섯 가지 밖이면 거부한다", () => {
    const parsed = domainAgentOutput.safeParse({
      schema_version: "out-v1",
      findings: [{ claim_ref: "C1", state: "LIKELY", relation: "SUPPORT", evidence_refs: [], summary_masked: "x", limits: [] }],
      out_of_scope_claim_refs: [],
    });
    // AI-018: PreCase 의 LIKELY·UNLIKELY 를 최종 상태로 쓰지 않는다.
    expect(parsed.success).toBe(false);
  });

  it("여섯 상태는 받는다", () => {
    const parsed = domainAgentOutput.safeParse({
      schema_version: "out-v1",
      findings: [{ claim_ref: "C1", state: "CONFLICT", relation: "CONTEXT", evidence_refs: ["E1"], summary_masked: "확인함", limits: [] }],
      out_of_scope_claim_refs: ["C2"],
    });
    expect(parsed.success).toBe(true);
  });
});
