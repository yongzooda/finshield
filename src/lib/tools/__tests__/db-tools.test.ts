/**
 * DB 도구 3종 실측 검증 (F-503·504·505).
 *
 * 모킹하지 않고 실제 DB를 친다. 이 도구들의 계약은 "적재된 데이터를 정확히
 * 읽는다"이므로, 가짜 데이터로 통과하는 테스트는 계약을 검증하지 못한다.
 * DATABASE_URL이 없으면 전체 skip.
 */

import { describe, expect, it } from "vitest";

import { dbReady as ready } from "@/test/live";

/**
 * 코퍼스 크기를 여기 박아두지 않는다 — 2026.08.30 회수 적재(+28)가 225를
 * 253으로 바꾸며 하드코딩 단언 세 개가 깨졌다. 확인할 계약은 «도구가
 * 인용 가능 모집단(DECISION·의결번호 보유)을 정확히 읽는다»이므로,
 * 기대값을 같은 DB에서 독립 질의로 뽑아 대조한다.
 */
async function decisionCount(withDecisionNo: boolean): Promise<number> {
  const { sql } = await import("@/lib/db");
  const rows = withDecisionNo
    ? await sql<[{ n: number }]>`
        select count(*)::int as n from cases
        where source_type = 'DECISION' and decision_no is not null`
    : await sql<[{ n: number }]>`
        select count(*)::int as n from cases where source_type = 'DECISION'`;
  return rows[0].n;
}

describe.skipIf(!ready)("F-503 search_case", () => {
  it("인용 가능 사례만 반환한다 (Q-2) — 의결번호가 반드시 있다", async () => {
    const { searchCase } = await import("../search_case");
    const r = await searchCase({ limit: 10 });
    expect(r.cases.length).toBeGreaterThan(0);
    for (const c of r.cases) {
      expect(c.decisionNo).toBeTruthy();
      expect(c.verdict === "UPHELD" || c.verdict === "REJECTED").toBe(true);
    }
    // citable_cases(DECISION·의결번호 보유)가 상한이다 — 전체 코퍼스가 아니다
    expect(r.matchedTotal).toBe(await decisionCount(true));
  });

  it("구조 필터가 실제로 좁힌다", async () => {
    const { searchCase } = await import("../search_case");
    const all = await searchCase({ limit: 1 });
    const ins = await searchCase({ sector: "INSURANCE", limit: 1 });
    expect(ins.matchedTotal).toBeGreaterThan(0);
    expect(ins.matchedTotal).toBeLessThan(all.matchedTotal);
    expect(ins.appliedFilters).toContain("업권=INSURANCE");
  });

  it("미지정 슬롯은 필터를 걸지 않는다 (F-503 UNKNOWN 처리)", async () => {
    const { searchCase } = await import("../search_case");
    const r = await searchCase({});
    expect(r.appliedFilters).toEqual([]);
    expect(r.matchedTotal).toBe(await decisionCount(true));
  });

  it("쟁점 필터가 동작한다", async () => {
    const { searchCase } = await import("../search_case");
    const r = await searchCase({ issues: ["설명의무"], limit: 3 });
    expect(r.matchedTotal).toBeGreaterThan(0);
    for (const c of r.cases) expect(c.issues).toContain("설명의무");
  });

  it("사실관계 유사도가 순위를 만든다", async () => {
    const { searchCase } = await import("../search_case");
    const r = await searchCase({ factsText: "보험금 지급을 거절당했다", limit: 5 });
    const sims = r.cases.map((c) => c.similarity);
    expect(sims.every((s) => s !== null)).toBe(true);
    expect([...sims].sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual(sims);
  });

  it("인용 표기는 「의결번호(연도)」 — 없는 의결일을 지어내지 않는다", async () => {
    const { searchCase, citation } = await import("../search_case");
    const r = await searchCase({ limit: 1 });
    const c = r.cases[0];
    expect(citation(c)).toBe(c.caseYear ? `${c.decisionNo}(${c.caseYear})` : c.decisionNo);
  });
});

describe.skipIf(!ready)("F-505 analyze_risk_pattern", () => {
  it("사전 집계표를 읽는다 — 기준은 실제 DECISION 수와 정합", async () => {
    const { analyzeRiskPattern } = await import("../analyze_risk_pattern");
    const r = await analyzeRiskPattern({});
    expect(r).not.toBeNull();
    // 집계 기반 표기가 코퍼스 실측과 어긋나면 재집계를 빠뜨린 것이다
    expect(r!.statBasis).toBe(`DECISION_${await decisionCount(false)}`);
    expect(r!.granularity).toBe("OVERALL");
    expect(r!.issues.length).toBeGreaterThan(0);
  });

  it("건수가 내림차순이고 인용+기각이 총 건수를 넘지 않는다", async () => {
    const { analyzeRiskPattern } = await import("../analyze_risk_pattern");
    const r = await analyzeRiskPattern({});
    const ns = r!.issues.map((i) => i.nCases);
    expect([...ns].sort((a, b) => b - a)).toEqual(ns);
    for (const i of r!.issues) {
      expect(i.nUpheld + i.nRejected).toBeLessThanOrEqual(i.nCases);
    }
  });

  it("상품군 지정 시 더 구체적인 집계를 읽는다", async () => {
    const { analyzeRiskPattern } = await import("../analyze_risk_pattern");
    const r = await analyzeRiskPattern({ productCode: "INS_ETC" });
    expect(r!.granularity).toBe("PRODUCT");
    expect(r!.matched.productCode).toBe("INS_ETC");
    expect(r!.fellBack).toBe(false);
  });

  it("집계가 없는 조합은 물러나 읽고 그 사실을 밝힌다", async () => {
    const { analyzeRiskPattern } = await import("../analyze_risk_pattern");
    const r = await analyzeRiskPattern({ productCode: "INS_ETC", channel: "TM", trait: "PRO" });
    expect(r).not.toBeNull();
    if (r!.fellBack) expect(r!.granularity).not.toBe("PRODUCT_CHANNEL_TRAIT");
  });
});

describe.skipIf(!ready)("F-504 check_documents", () => {
  it("쟁점·채널 없이도 공통 자료를 준다", async () => {
    const { checkDocuments } = await import("../check_documents");
    const r = await checkDocuments({});
    expect(r.required.length).toBeGreaterThan(0);
    expect(r.required.every((d) => d.origin === "COMMON")).toBe(true);
    expect(r.channelUnknown).toBe(true);
  });

  it("채널·쟁점이 자료 목록을 늘린다", async () => {
    const { checkDocuments } = await import("../check_documents");
    const r = await checkDocuments({ channel: "TM", issues: ["설명의무"] });
    expect(r.required.some((d) => d.origin === "CHANNEL")).toBe(true);
    expect(r.required.some((d) => d.origin === "ISSUE" && d.issueCode === "설명의무")).toBe(true);
    expect(r.channelUnknown).toBe(false);
  });

  it("보유 항목을 빼서 결여 항목을 낸다", async () => {
    const { checkDocuments } = await import("../check_documents");
    const all = await checkDocuments({ channel: "TM" });
    const some = await checkDocuments({ channel: "TM", possessed: [all.required[0].key] });
    expect(some.missing.length).toBe(all.missing.length - 1);
    expect(some.missing.map((d) => d.key)).not.toContain(all.required[0].key);
  });

  it("관련 약관 조항은 실제 사건에서 온다 — 지어낸 예시가 아니다", async () => {
    const { checkDocuments } = await import("../check_documents");
    const r = await checkDocuments({ issues: ["약관해석"], clauseLimit: 3 });
    expect(r.relatedClauses.length).toBeGreaterThan(0);
    for (const c of r.relatedClauses) {
      expect(c.clauseText.length).toBeGreaterThan(10);
      expect(c.issueCode).toBe("약관해석");
    }
  });

  it("자료 목록은 큐레이션 출처임을 밝힌다 (집계값과 구분)", async () => {
    const { checkDocuments } = await import("../check_documents");
    const r = await checkDocuments({ channel: "BRANCH", issues: ["적합성원칙"] });
    expect(r.required.every((d) => d.source === "CURATED")).toBe(true);
  });
});
