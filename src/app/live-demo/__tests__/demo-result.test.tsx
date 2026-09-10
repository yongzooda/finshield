import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoResultView, groupEvidence, type DemoResult } from "../demo-result";

const evidence = {
  ref: "E1", title: "햇살론15 (1, 기준 202602)", source: "PRODUCT", grade: "A",
  official_id: "data.go.kr:15094787:햇살론15:202602:1", url: null, published_at: null,
  fetched_at: "2026-09-10T15:06:00Z", content_hash: "a".repeat(64), freshness: "FRESH",
  directness: "DIRECT", reference_only: false, excerpt: "대출금리 15.9%",
};

const v2: DemoResult = {
  seed_version: "v1", partial: false, is_precomputed: false,
  overall_result: "MATERIAL_RISK_FOUND",
  axes: [
    { axis: "AUTHENTICITY", result_code: "CONTRADICTED", summary_masked: "상품과 기관 확인", limitation_codes: [] },
    { axis: "TRANSACTION_SALES_RISK", result_code: "UNCERTAIN", summary_masked: "권유 방식 확인", limitation_codes: ["PRE_TRANSACTION_SCOPE"] },
    { axis: "SUITABILITY", result_code: "NEED_MORE_INFORMATION", summary_masked: "적합성 판단 안 함", limitation_codes: ["PROFILE_SKIPPED"] },
  ],
  guide: { channels: [{ action_no: 1, display_value: "1397" }] },
  agents: [{ agent_code: "PRODUCT_INSTITUTION", status: "SUCCEEDED", reason_code: null }],
  judge_reason_code: null,
  claims: [
    { claim_ref: "D1", statement_masked: "연 3.2% 고정금리다.", state: "CONTRADICTED", reason_code: "COVE_CONFIRMED",
      cove_status: "CONFIRMED", red_team_status: "UNRESOLVED", rationale_masked: "공식 금리는 연 15.9%다.",
      evidence_refs: ["E1"], relations: { E1: "CONTRADICT" } },
    { claim_ref: "D2", statement_masked: "진흥원이 보낸 안내다.", state: "UNKNOWN", reason_code: "COVE_INCONCLUSIVE",
      cove_status: "UNRESOLVED", red_team_status: "UNRESOLVED", rationale_masked: "독립 자료 확인이 충분하지 않다.",
      evidence_refs: [], relations: {} },
  ],
  evidence: [evidence],
};

describe("공개 Demo 결과 화면 (S-001·RES-005)", () => {
  it("항목별 결과보다 지금 할 일과 공식 확인 창구, 종합 결과를 먼저 보여 준다", () => {
    const html = renderToStaticMarkup(<DemoResultView result={v2} />);
    const actionAt = html.indexOf("지금 하실 일");
    expect(actionAt).toBeGreaterThan(-1);
    expect(html).toContain("송금하거나 가입하기 전에 멈추세요");
    expect(html).toContain("공식 확인 창구: 1397");
    expect(html).toContain("종합 결과");
    expect(html).toContain("중대한 위험 신호");
    expect(actionAt).toBeLessThan(html.indexOf("세 가지 확인 결과"));
    expect(html.indexOf("세 가지 확인 결과")).toBeLessThan(html.indexOf("항목별 확인 결과"));
  });

  it("세 축과 독립 재확인 상태를 회원 결과와 같은 표시로 남긴다", () => {
    const html = renderToStaticMarkup(<DemoResultView result={v2} />);
    for (const label of ["상품·기관 정보", "거래·권유 위험", "불일치 항목 있음", "금융 프로필을 남기지 않음", "판단 과정과 검토 상태"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("근거 1건 보기");
    expect(html).toContain("인용한 근거가 없습니다");
    expect(html).not.toMatch(/COVE_|AGENT_|MATERIAL_RISK_FOUND/);
  });

  it("사라지지 않는 체험 기록을 스스로 지워진다고 말하지 않는다", () => {
    const html = renderToStaticMarkup(<DemoResultView result={v2} />);
    expect(html).not.toMatch(/스스로 지워|Session|Case/);
    expect(html).toContain("개인정보가 남지 않습니다");
  });

  it("부분 실행이면 결과 위에 검토가 제한된 범위를 알린다", () => {
    const html = renderToStaticMarkup(<DemoResultView result={{
      ...v2, partial: true,
      agents: [{ agent_code: "RED_TEAM", status: "PARTIAL", reason_code: "TOOL_LOOKUP_FAILED" }],
    }} />);
    expect(html).toContain("일부 검토 미완료");
    expect(html).toContain("반대 근거 찾기");
  });

  it("이전 형식 결과는 종합 결과와 세 축 칸 없이 항목별 결과만 그린다", () => {
    const { overall_result, axes, guide, ...v1 } = v2;
    expect([overall_result, axes, guide].every(Boolean)).toBe(true);
    const html = renderToStaticMarkup(<DemoResultView result={v1} />);
    expect(html).not.toContain("종합 결과");
    expect(html).not.toContain("세 가지 확인 결과");
    expect(html).toContain("항목별 확인 결과");
  });
});

describe("상한에 걸린 방문자에게 보이는 지난 실행 결과", () => {
  it("지금 실행한 결과처럼 보이지 않게 실행 시각과 함께 표시한다", () => {
    const html = renderToStaticMarkup(<DemoResultView result={{ ...v2, mode: "RECENT_LIVE", computed_at: "2026-09-10T22:56:00Z" }} />);
    expect(html).toContain("지난 실제 실행 결과");
    expect(html).toContain("9월 11일 07:56 에 실제로 실행한 결과입니다");
    expect(html).toContain("지금 다시 실행한 결과가 아니며");
    expect(html).not.toContain(">실제 실행 결과<");
  });
});

describe("같은 공식 자료를 여러 단계가 인용할 때", () => {
  const same = (ref: string) => ({ ...evidence, ref });
  const notice = { ...evidence, ref: "E3", title: "햇살론15 공식 보증 종료 고지", official_id: "kinfa:hessalLoan", content_hash: "b".repeat(64) };
  const claim = {
    ...v2.claims[0], evidence_refs: ["E1", "E6", "E10", "E3"],
    relations: { E1: "CONTEXT", E6: "CONTRADICT", E10: "SUPPORT", E3: "CONTRADICT" },
  };

  it("원문 하나로 묶고 가장 강한 관계를 남긴다", () => {
    const grouped = groupEvidence(claim, [same("E1"), same("E6"), same("E10"), notice]);
    expect(grouped.map((entry) => [entry.item.ref, entry.relation])).toEqual([["E1", "CONTRADICT"], ["E3", "CONTRADICT"]]);
  });

  it("묶은 개수로 근거 수를 적는다", () => {
    const html = renderToStaticMarkup(<DemoResultView result={{ ...v2, claims: [claim], evidence: [same("E1"), same("E6"), same("E10"), notice] }} />);
    expect(html).toContain("근거 2건 보기");
  });
});
