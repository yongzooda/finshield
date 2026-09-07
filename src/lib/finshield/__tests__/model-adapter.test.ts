/** 모델에 넘기는 것은 인용에 필요한 만큼이다 */

import { describe, expect, it } from "vitest";
import { evidenceBrief } from "../agents/model-adapter";
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
