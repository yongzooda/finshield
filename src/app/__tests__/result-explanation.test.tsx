import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AxisLimitations, ClaimBadges, ReviewNotice } from "../result-explanation";
import { axisResultOf, partialExplanation, CLAIM_STATE_LABEL } from "../fs-labels";
import { claimViewOf, CLAIM_STATE_VIEW } from "../fs-shell";

const reportedReasons = Object.freeze([
  "CITATION_INVALID", "CITATION_INVALID", "CITATION_INVALID", "CITATION_INVALID",
  "AGENT_FRAUD_CHANNEL_PARTIAL", "AGENT_PRODUCT_INSTITUTION_PARTIAL", "AGENT_RED_TEAM_PARTIAL", "AGENT_SALES_CONDUCT_PARTIAL",
]);

describe("회원 결과의 표시 계약 (RES-001·RES-008·PASS-002)", () => {
  it("보고된 중복 인용 실패는 한 번 설명하고 네 검토 범위는 모두 남긴다", () => {
    const html = renderToStaticMarkup(<ReviewNotice status="PARTIAL" reasons={reportedReasons} />);
    expect(html.match(/일부 근거가 해당 판단을 뒷받침하는지 확인하지 못했습니다/g)).toHaveLength(1);
    for (const label of ["상품·기관 확인", "사칭·접근 경로 확인", "설명·권유 방식 확인", "반대 근거 찾기"]) expect(html).toContain(label);
    expect(html).toContain("일부 검토 미완료");
    expect(html).not.toMatch(/AGENT_|CITATION_INVALID|근거 없이 확정하려/);
    expect(reportedReasons).toHaveLength(8);
  });

  it("등록되지 않은 이유도 코드나 임의의 성공 표현 대신 확인 불가로 표시한다", () => {
    const explanation = partialExplanation(["UNRECOGNIZED_INTERNAL_FAILURE", "OTHER_PRIVATE_CODE"]);
    expect(explanation.causes).toEqual(["일부 검토 결과를 받지 못했습니다."]);
    expect(renderToStaticMarkup(<ReviewNotice status="PARTIAL" reasons={["UNRECOGNIZED_INTERNAL_FAILURE"]} />)).not.toContain("UNRECOGNIZED");
  });

  it("정상 완료에는 경고를 만들지 않고 대기·실패·취소를 부분 완료와 구분한다", () => {
    expect(renderToStaticMarkup(<ReviewNotice status="COMPLETED" />)).toBe("");
    expect(renderToStaticMarkup(<ReviewNotice status="RUNNING" />)).toContain("검토 진행 중");
    for (const status of ["FAILED", "CANCELLED"]) {
      const html = renderToStaticMarkup(<ReviewNotice status={status} reasons={["MODEL_CALL_FAILED"]} />);
      expect(html).not.toContain("일부 검토 미완료");
      expect(html).not.toContain("완료된 검토 결과");
    }
  });

  it("위험 행동 경고가 근거 부족·추가 정보·보류 상태를 확정으로 바꾸지 않는다", () => {
    for (const status of ["UNKNOWN", "NEED_MORE_INFORMATION", "WITHHELD"]) {
      const html = renderToStaticMarkup(<ClaimBadges status={status} reason="HIGH_RISK_ADVANCE_PAYMENT" />);
      expect(html).toContain("위험한 행동 요구");
      expect(html).toContain(CLAIM_STATE_VIEW[status].label);
      expect(html).not.toContain("공식 예방 지침과 불일치");
    }
    const contra = renderToStaticMarkup(<ClaimBadges status="CONTRADICTED" reason="HIGH_RISK_REMOTE_CONTROL" />);
    expect(contra).toContain("공식 예방 지침과 불일치");
    expect(contra).not.toContain("사실과 다름");
  });

  it("여섯 Claim 상태의 뜻을 구분하고 재검증 비교 라벨도 일치시킨다", () => {
    expect(new Set(Object.values(CLAIM_STATE_VIEW).map(view => view.label)).size).toBe(6);
    for (const [code, view] of Object.entries(CLAIM_STATE_VIEW)) expect(CLAIM_STATE_LABEL[code]).toBe(view.label);
    expect(claimViewOf("NEW_INTERNAL_STATE").label).toBe("판단 상태 확인 필요");
  });

  it("전체 사실을 거짓으로 표시하지 않고 적합성 미평가와 구분한다", () => {
    expect(axisResultOf("CONTRADICTED", "AUTHENTICITY").label).toBe("불일치 항목 있음");
    expect(axisResultOf("UNCERTAIN", "SUITABILITY").label).toBe("적합성 판단 보류");
  });

  it("사진의 다섯 적합성 한계가 한국어 설명으로 빠짐없이 보인다", () => {
    const codes = ["CURRENT_PRODUCT_CONDITIONS_UNVERIFIED", "REPAYMENT_AMOUNT_MISSING", "ELIGIBILITY_NOT_ASSESSED", "EARLY_REPAYMENT_TERMS_MISSING", "NOT_CREDIT_APPROVAL"];
    const html = renderToStaticMarkup(<AxisLimitations codes={codes} />);
    for (const code of codes) expect(html).not.toContain(code);
    for (const term of ["현재 유효한 상품 조건", "월 상환액", "가입 요건", "조기 상환", "대출 승인 여부"]) expect(html).toContain(term);
    expect(html.match(/<li>/g)).toHaveLength(5);
  });
});
