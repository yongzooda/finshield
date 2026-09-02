/** 도구 3종 실제 출력 육안 확인 — 계약이 아니라 결과물 품질을 본다 */
import { describe, it } from "vitest";

import { dbReady as ready } from "@/test/live";

describe.skipIf(!ready)("도구 출력 스모크", () => {
  it("실제 반환값을 출력한다", async () => {
    const { searchCase, citation } = await import("../search_case");
    const { analyzeRiskPattern } = await import("../analyze_risk_pattern");
    const { checkDocuments } = await import("../check_documents");

    const s = await searchCase({
      sector: "INSURANCE", issues: ["설명의무"],
      factsText: "설명을 제대로 듣지 못하고 가입했다", limit: 3,
    });
    console.log(`\n═══ F-503 매칭 ${s.matchedTotal}건 · ${s.appliedFilters.join(" / ")}`);
    for (const c of s.cases)
      console.log(`  ${citation(c)} [${c.verdict}] 유사도 ${c.similarity?.toFixed(3)} · ${c.factsSummary.slice(0, 46)}…`);

    const r = await analyzeRiskPattern({ productCode: "INS_ETC" });
    console.log(`\n═══ F-505 단위=${r!.granularity} 기준=${r!.statBasis} 물러남=${r!.fellBack}`);
    for (const i of r!.issues.slice(0, 4))
      console.log(`  ${i.issueLabel}: ${i.nCases}건 (인용 ${i.nUpheld} / 기각 ${i.nRejected})`);

    const d = await checkDocuments({
      channel: "TM", issues: ["설명의무"], possessed: ["contract"], clauseLimit: 2,
    });
    console.log(`\n═══ F-504 필요 ${d.required.length}건 · 결여 ${d.missing.length}건`);
    for (const x of d.required) console.log(`  [${x.origin}] ${x.label}${x.possessed ? " ✔보유" : ""}`);
    for (const c of d.relatedClauses)
      console.log(`  조항(${c.fromDecisionNo}): ${c.clauseText.slice(0, 56)}…`);
  });
});
