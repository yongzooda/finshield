import { beforeEach, expect, it, vi } from "vitest";

const { lawSearch, lawService } = vi.hoisted(() => ({
  lawSearch: vi.fn(),
  lawService: vi.fn(),
}));

vi.mock("@/lib/tools/law_client", () => ({
  asArray: <T,>(value: T | T[] | null | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value],
  lawSearch,
  lawService,
}));

import { lookupStatute } from "../tools/statute";

beforeEach(() => {
  vi.clearAllMocks();
  lawSearch.mockResolvedValue({
    LawSearch: { law: [{ 법령명한글: "금융소비자 보호에 관한 법률", 법령ID: "123", 시행일자: "20260101" }] },
  });
});

it("검색어와 맞는 실제 조문 번호와 본문을 LAW 근거에 함께 고정한다", async () => {
  lawService.mockResolvedValue({ 법령: { 조문: { 조문단위: [
    { 조문번호: "1", 조문내용: "제1조(목적) 이 법은 금융소비자를 보호한다." },
    { 조문번호: "19", 조문내용: "제19조(설명의무)", 항: [{ 항내용: "금융상품판매업자는 중요한 사항을 설명하여야 한다." }] },
  ] } } });

  const result = await lookupStatute({ query: "금융상품 판매 설명의무 제19조" });

  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    sourceType: "LAW",
    lawName: "금융소비자 보호에 관한 법률",
    articleNo: "제19조",
    officialId: "law.go.kr:123:제19조",
    isComplete: true,
    isCitable: true,
    directness: "DIRECT",
    locator: { kind: "statute", law_id: "123", article_no: "제19조", effective_from: "2026-01-01" },
  });
  expect(result.items[0].excerptMasked).toContain("중요한 사항을 설명");
});

it("가지번호를 정확히 보존하고 번호 없는 본문은 LAW Snapshot 후보에서 제외한다", async () => {
  lawService.mockResolvedValueOnce({ 법령: { 조문: { 조문단위: [
    { 조문번호: "95", 조문가지번호: "2", 조문내용: "제95조의2(설명의무) 설명 내용을 확인한다." },
  ] } } }).mockResolvedValueOnce({ 법령: { 조문: { 조문단위: [
    { 조문내용: "조문 번호를 확인할 수 없는 본문" },
  ] } } });
  lawSearch.mockResolvedValueOnce({ LawSearch: { law: [
    { 법령명한글: "첫 번째 법", 법령ID: "123", 시행일자: "20260101" },
    { 법령명한글: "두 번째 법", 법령ID: "456", 시행일자: "20260101" },
  ] } });

  const result = await lookupStatute({ query: "제95조의2 설명의무" });

  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ articleNo: "제95조의2", officialId: "law.go.kr:123:제95조의2" });
});

it("조문 번호와 본문을 모두 확정하지 못하면 제목만으로 인용 근거를 만들지 않는다", async () => {
  lawService.mockResolvedValue({ 법령: { 조문: { 조문단위: [{ 조문번호: "1", 조문내용: "" }] } } });

  const result = await lookupStatute({ query: "설명의무" });

  expect(result.items).toEqual([]);
  expect(result.reasonCode).toBe("NO_MATCH");
  expect(result.candidateCount).toBe(1);
});
