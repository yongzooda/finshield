/**
 * 절차 안내 섹션 (R-07 ② · SR-204 확장).
 *
 * 잡으려는 것 셋:
 *   · **권리 주장이 근거 조문 없이 나가는 것** — 자료 열람 요구권은 조문
 *     카드와 한 몸이어야 한다 (절대 규칙 1의 이 화면 판)
 *   · 절차 흐름 단계가 조용히 빠지는 것
 *   · **신청서 작성 대행·권유·전망 표현이 스며드는 것** (SR-X02·변호사법 109조,
 *     기획서 9.5 ③ 「신청을 말리는 표현 금지」의 반대편도 함께)
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProcedureGuide } from "../procedure";
import { PROCEDURE_STEPS, PROCEDURE_STATUTES } from "@/lib/procedure";
import type { LookupStatuteResult } from "@/lib/tools/lookup_statute";

const statute = (articleNo: string, articleTitle: string): LookupStatuteResult => ({
  lawName: "금융소비자 보호에 관한 법률",
  articleNo,
  articleTitle,
  articleText: `제${articleNo}(${articleTitle}) 조문 원문이 여기 온다.`,
  effectiveDate: "2021-03-25",
  source: "API",
  checkedAt: "2026-08-31",
  transferredTo: null,
  isFallback: false,
  flagged: 0,
});

describe("절차 안내 (R-07 ②)", () => {
  it("절차 흐름 5단계가 전부 나온다", () => {
    const html = renderToStaticMarkup(<ProcedureGuide statutes={[]} />);
    expect(PROCEDURE_STEPS.length).toBe(5);
    for (const s of PROCEDURE_STEPS) expect(html).toContain(s.title);
  });

  it("근거 조문이 없으면 자료 열람 요구권 문단을 싣지 않는다", () => {
    const html = renderToStaticMarkup(<ProcedureGuide statutes={[]} />);
    // 권리를 주장하는 문단은 조문과 함께만 나온다 — 도구 반환값에 종속
    expect(html).not.toContain("자료를 구하는 방법");
    expect(html).not.toContain("열람하거나 사본을 달라고");
  });

  it("어떤 단계 문장도 없는 절을 가리키지 않는다 — 조회 실패 시 빈 곳을 가리키게 된다", () => {
    for (const s of PROCEDURE_STEPS) {
      expect(s.body, `${s.title}: 다른 절을 가리킨다`).not.toMatch(/아래 「[^」]*」/);
    }
  });

  it("조문이 오면 절차 근거와 자료 열람 문단이 함께 나온다", () => {
    const html = renderToStaticMarkup(
      <ProcedureGuide
        statutes={[
          statute("제36조", "분쟁의 조정"),
          statute("제39조", "조정의 효력"),
          statute("제28조", "자료의 기록 및 유지·관리 등"),
        ]}
      />,
    );
    expect(html).toContain("절차의 근거 조문");
    expect(html).toContain("분쟁의 조정");
    expect(html).toContain("조정의 효력");
    expect(html).toContain("자료를 구하는 방법");
    expect(html).toContain("자료의 기록 및 유지");
  });

  it("자료 열람 조문만 와도 권리 문단이 선다 — 절차 조문 조회 실패와 독립이다", () => {
    const html = renderToStaticMarkup(
      <ProcedureGuide statutes={[statute("제28조", "자료의 기록 및 유지·관리 등")]} />,
    );
    expect(html).toContain("자료를 구하는 방법");
    expect(html).not.toContain("절차의 근거 조문");
  });

  it("신청서 작성·권유·전망 표현이 없다 (SR-X02 · 기획서 9.5)", () => {
    const html = renderToStaticMarkup(
      <ProcedureGuide statutes={[statute("제28조", "자료의 기록 및 유지·관리 등")]} />,
    );
    const text = html.replace(/<[^>]+>/g, "");
    for (const banned of [
      "작성해 드립니다", "대신 작성", "신청서를 만들어", "초안을 만들어",
      "신청하시기 바랍니다", "신청을 권", "승소", "인용될 가능성", "배상받을 수 있",
    ]) {
      expect(text, `금지 표현: ${banned}`).not.toContain(banned);
    }
  });

  it("조회 대상 조문 목록이 금소법 3종이다 — 늘리려면 화면 명세부터 고친다", () => {
    expect(PROCEDURE_STATUTES.map((a) => a.articleNo)).toEqual(["제36조", "제39조", "제28조"]);
    expect(PROCEDURE_STATUTES.every((a) => a.lawName === "금융소비자 보호에 관한 법률")).toBe(true);
  });
});
