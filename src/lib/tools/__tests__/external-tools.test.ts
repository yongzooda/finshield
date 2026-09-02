/**
 * 외부 도구 2종 실측 검증 (F-501·502).
 *
 * 법제처 API를 실제로 친다. 이 도구들의 계약이 "외부 API의 알려진 결함을
 * 우회한다"이므로, 모킹하면 정작 검증해야 할 것을 검증하지 못한다.
 * 네트워크가 없으면 skip.
 */

import { describe, expect, it } from "vitest";

import { lawReady as ready } from "@/test/live";

/**
 * 법제처 **본문** 엔드포인트가 살아 있는지 먼저 본다.
 *
 * 2026.08.17 실측: 목록 조회(`lawSearch.do`)는 정상인데 본문 조회
 * (`lawService.do`)만 `{}`를 돌려주는 상태가 발생했다. 그러면 우리 코드는
 * 설계대로 캐시 폴백으로 내려가는데(EP-1), `source === "API"`를 단정한
 * 검사들이 깨진다 — **우리 회귀가 아니라 외부 장애다.**
 *
 * 실패로 보고하면 원인을 오해하게 되고, 조용히 넘기면 진짜 회귀를 놓친다.
 * 그래서 **건너뛰되 이유를 크게 남긴다.**
 */
async function lawBodyAlive(): Promise<boolean> {
  try {
    const { lawSearch, lawService, asArray } = await import("../law_client");
    const list = (await lawSearch("law", { query: "상법", display: 100 })) as {
      LawSearch?: { law?: { 법령명한글?: string; 법령일련번호?: string }[] };
    };
    const target = asArray(list.LawSearch?.law).find((l) => l.법령명한글?.trim() === "상법");
    if (!target?.법령일련번호) return false;
    const body = (await lawService("law", { MST: target.법령일련번호 })) as Record<string, unknown>;
    return Object.keys(body ?? {}).length > 0;
  } catch {
    return false;
  }
}

describe.skipIf(!ready)("F-501 lookup_statute — 조문 종속 분기", () => {
  it("시점 무관 법령은 기준일과 무관하게 현행을 준다", async ({ skip }) => {
    if (!(await lawBodyAlive())) {
      console.warn("\n⚠️ 법제처 본문 API가 빈 응답을 준다 — 외부 장애. 이 검사는 건너뛴다.\n");
      skip();
    }
    const { lookupStatute } = await import("../lookup_statute");
    const r = await lookupStatute({
      lawName: "상법", articleNo: "제651조", basisDate: "2019-05-01",
    });
    expect(r).not.toBeNull();
    expect(r!.source).toBe("API");
    expect(r!.transferredTo).toBeNull();
    expect(r!.articleText).toContain("고지");
  });

  it("법령명이 정확히 일치해야 한다 — 「상법」은 목록 34번째다", async () => {
    // 부분일치 결함: display 기본값으로는 정확 일치가 안 잡힌다
    const { lookupStatute } = await import("../lookup_statute");
    const r = await lookupStatute({
      lawName: "상법", articleNo: "제651조", basisDate: "2020-01-01",
    });
    expect(r!.articleTitle).toBe("고지의무위반으로 인한 계약해지");
  });

  it("이관 조문 + 이관 전 기준일 → 스냅샷(구 조문 원문)", async () => {
    const { lookupStatute } = await import("../lookup_statute");
    const r = await lookupStatute({
      lawName: "자본시장과 금융투자업에 관한 법률",
      articleNo: "제47조", basisDate: "2019-05-01",
    });
    expect(r!.source).toBe("SNAPSHOT");
    expect(r!.articleText).toContain("설명의무");
    expect(r!.transferredTo?.articleNo).toBe("제19조");
    expect(r!.isFallback).toBe(false); // 스냅샷은 이 경로의 정상 응답이다
  });

  it("이관 조문 + 이관 후 기준일 → 현행 API + 이관 안내", async ({ skip }) => {
    if (!(await lawBodyAlive())) {
      console.warn("\n⚠️ 법제처 본문 API가 빈 응답을 준다 — 외부 장애. 이 검사는 건너뛴다.\n");
      skip();
    }
    const { lookupStatute } = await import("../lookup_statute");
    const r = await lookupStatute({
      lawName: "자본시장과 금융투자업에 관한 법률",
      articleNo: "제47조", basisDate: "2023-01-01",
    });
    expect(r!.source).toBe("API");
    // 현행법에는 「삭제」 껍데기만 남는다 — 이관 안내가 없으면 이용자가 길을 잃는다
    expect(r!.articleText).toContain("삭제");
    expect(r!.transferredTo).toEqual({
      lawName: "금융소비자 보호에 관한 법률",
      articleNo: "제19조",
      note: expect.any(String),
    });
  });

  it("보험업법 제95조의2 — 이관된 항만 삭제되고 존치 항은 현행에 살아 있다", async () => {
    // 명세의 「①②항만 이관, 존치 항은 현행 API로 조회」가 항 단위로 확인된다.
    // 현행 본문은 ①② 삭제 <2020.3.24> + ③④ 실제 조문으로 구성된다.
    // 제95조의3처럼 조문 전체가 껍데기인 경우와 구분되어야 한다.
    const { lookupStatute } = await import("../lookup_statute");
    const r = await lookupStatute({
      lawName: "보험업법", articleNo: "제95조의2", basisDate: "2023-01-01",
    });
    expect(r!.articleTitle).toBe("설명의무 등");
    expect(r!.articleText).toContain("① 삭제");
    expect(r!.articleText).toContain("보험금 지급 시까지의 주요 과정"); // ③ 존치 항
  });

  it("제95조의3은 조문 전체가 삭제 껍데기다 — 이관 안내가 없으면 길을 잃는다", async () => {
    const { lookupStatute } = await import("../lookup_statute");
    const r = await lookupStatute({
      lawName: "보험업법", articleNo: "제95조의3", basisDate: "2023-01-01",
    });
    expect(r!.articleText.replace(/\s/g, "")).toMatch(/^제95조의3삭제/);
    expect(r!.transferredTo?.articleNo).toBe("제17조");
  });

  it("조문번호 파싱 — 가지번호를 분리한다", async () => {
    const { parseArticleNo } = await import("../lookup_statute");
    expect(parseArticleNo("제95조의2")).toEqual({ main: 95, branch: 2 });
    expect(parseArticleNo("제651조")).toEqual({ main: 651, branch: 0 });
    expect(parseArticleNo("제 46 조 의 2")).toEqual({ main: 46, branch: 2 });
    expect(parseArticleNo("조문없음")).toBeNull();
  });

  it("출처와 확인 시점을 반드시 반환한다 (F-501 · EC-3)", async () => {
    const { lookupStatute } = await import("../lookup_statute");
    const r = await lookupStatute({
      lawName: "민법", articleNo: "제109조", basisDate: "2015-03-01",
    });
    expect(r!.source).toBeTruthy();
    expect(r!.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("없는 법령은 엉뚱한 조문 대신 실패한다 (EP-3)", async () => {
    const { lookupStatute } = await import("../lookup_statute");
    const r = await lookupStatute({
      lawName: "존재하지않는법률", articleNo: "제1조", basisDate: "2020-01-01",
    });
    expect(r).toBeNull();
  });
});

describe.skipIf(!ready)("F-502 search_precedent — 전량 스캔 정확 대조", () => {
  it("1순위가 아니어도 정확 일치를 찾아낸다", async () => {
    const { searchPrecedent } = await import("../search_precedent");
    const r = await searchPrecedent({ caseNo: "2010다76368" });
    expect(r.citable).toBe(true);
    expect(r.exact?.caseNo).toBe("2010다76368");
    // 이 사건은 목록 마지막에 있다 — 1순위만 봤다면 놓쳤을 것이다
    expect(r.exactRank).toBeGreaterThan(1);
  });

  it("정확 일치가 없으면 인용 불가로 표시한다", async () => {
    const { searchPrecedent } = await import("../search_precedent");
    const r = await searchPrecedent({ caseNo: "9999다99999" });
    expect(r.citable).toBe(false);
    expect(r.exact).toBeNull();
  });

  it("키워드만 있으면 인용 불가다 — 대조할 사건번호가 없다", async () => {
    const { searchPrecedent } = await import("../search_precedent");
    const r = await searchPrecedent({ issueKeyword: "설명의무" });
    expect(r.citable).toBe(false);
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("표기 흔들림을 흡수한다", async () => {
    const { searchPrecedent } = await import("../search_precedent");
    const r = await searchPrecedent({ caseNo: "2010 다 76368" });
    expect(r.citable).toBe(true);
  });
});

/**
 * 조문 제목 추출 (2026.08.17).
 *
 * 법제처 본문 API가 빈 응답(`{}`)을 주기 시작해 캐시 폴백으로 내려갔더니
 * 화면에서 조문 제목이 사라졌다 — `statute_cache`에 제목 컬럼이 없기 때문이다.
 * 제목은 본문 첫머리에 늘 붙어 오므로 거기서 뽑는다. 이 테스트는 외부 API가
 * 죽어 있어도 돌아야 하므로 **순수 함수만** 검사한다.
 */
describe("조문 제목 추출", () => {
  it("본문 첫머리에서 제목을 뽑는다", async () => {
    const { titleFromArticleText } = await import("../lookup_statute");
    expect(titleFromArticleText("제638조의3(보험약관의 교부ㆍ설명 의무)\n① 보험자는")).toBe(
      "보험약관의 교부ㆍ설명 의무",
    );
    expect(titleFromArticleText("제95조의2(설명의무 등) ① 보험회사")).toBe("설명의무 등");
    expect(titleFromArticleText("제109조(착오로 인한 의사표시)\n①의사표시는")).toBe(
      "착오로 인한 의사표시",
    );
  });

  it("제목이 없으면 지어내지 않는다", async () => {
    const { titleFromArticleText } = await import("../lookup_statute");
    expect(titleFromArticleText("① 보험자는 보험계약을 체결할 때에")).toBeNull();
    expect(titleFromArticleText("")).toBeNull();
    // 괄호가 열리기만 하고 닫히지 않은 깨진 입력
    expect(titleFromArticleText("제5조(약관의 해석")).toBeNull();
  });

  it("조문번호 뒤가 아니면 잡지 않는다 — 본문 속 괄호를 제목으로 오인하지 않는다", async () => {
    const { titleFromArticleText } = await import("../lookup_statute");
    expect(titleFromArticleText("보험자는(다만 예외가 있다) 설명하여야 한다")).toBeNull();
  });
});
