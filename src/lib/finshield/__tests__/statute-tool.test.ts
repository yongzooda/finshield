import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

afterEach(() => vi.useRealTimers());

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
  expect(lawSearch).toHaveBeenCalledWith("law", { query: "금융상품 판매 설명의무", display: 5, type: "JSON" }, expect.anything());
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

  const result = await lookupStatute({ query: "금융소비자보호법 제95조의2" });

  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ articleNo: "제95조의2", officialId: "law.go.kr:123:제95조의2" });
});

it("법령명 없이 조문 번호만 주어지면 외부 검색을 하지 않는다", async () => {
  const result = await lookupStatute({ query: "제19조" });
  expect(result).toMatchObject({ items: [], candidateCount: 0, reasonCode: "LAW_NAME_REQUIRED" });
  expect(lawSearch).not.toHaveBeenCalled();
});

it("조문 번호와 본문을 모두 확정하지 못하면 제목만으로 인용 근거를 만들지 않는다", async () => {
  lawService.mockResolvedValue({ 법령: { 조문: { 조문단위: [{ 조문번호: "1", 조문내용: "" }] } } });

  const result = await lookupStatute({ query: "설명의무" });

  expect(result.items).toEqual([]);
  expect(result.reasonCode).toBe("NO_MATCH");
  expect(result.candidateCount).toBe(1);
});

it("한국 시행일 자정 전후 Snapshot을 구분하고 원문 지문은 보존한다", async () => {
  vi.useFakeTimers();
  lawSearch.mockResolvedValue({ LawSearch: { law: [
    { 법령명한글: "전기통신금융사기 피해 방지 및 피해자산 환급에 관한 특별법", 법령ID: "011359", 시행일자: "20260908" },
  ] } });
  lawService.mockResolvedValue({ 법령: { 조문: { 조문단위: [
    { 조문번호: "2", 조문내용: "제2조(정의) 합성 조문 본문" },
  ] } } });
  vi.setSystemTime(new Date("2026-09-07T14:59:59Z"));
  const before = (await lookupStatute({ query: "특별법 제2조" })).items[0];
  vi.setSystemTime(new Date("2026-09-07T15:00:00Z"));
  const after = (await lookupStatute({ query: "특별법 제2조" })).items[0];
  expect(before).toMatchObject({ sourceVersion: "2026-09-08:pending", isCitable: false, freshness: "UNKNOWN" });
  expect(after).toMatchObject({ sourceVersion: "2026-09-08:effective", isCitable: true, freshness: "FRESH" });
  expect(after.contentHash).toBe(before.contentHash);
  expect(after.fingerprint).toBe(before.fingerprint);
  expect(after.locator).toMatchObject({ official_source_version: "2026-09-08", assessment_timezone: "Asia/Seoul" });
});

it("요청한 조문이 없으면 목적 조문으로 대체하지 않는다", async () => {
  lawService.mockResolvedValue({ 법령: { 조문: { 조문단위: [{ 조문번호: "1", 조문내용: "제1조 목적" }] } } });
  expect((await lookupStatute({ query: "금융소비자 보호에 관한 법률 제19조" })).items).toEqual([]);
});
it("정확한 법률을 우선하고 항·호·목의 조건을 누락하지 않는다", async () => {
  lawSearch.mockResolvedValue({ LawSearch: { law: [
    { 법령명한글: "금융소비자 보호에 관한 법률 시행령", 법령ID: "456", 시행일자: "20260101" },
    { 법령명한글: "금융소비자 보호에 관한 법률", 법령ID: "123", 시행일자: "20260101" },
  ] } });
  lawService.mockResolvedValue({ 법령: { 조문: { 조문단위: [{ 조문번호: "19", 조문내용: "제19조 설명의무", 항: [
    { 항내용: "① 다음 사항을 설명한다", 호: [{ 호내용: "1. 비용", 목: [{ 목내용: "가. 중도상환" }] }] },
  ] }] } } });
  const result = await lookupStatute({ query: "금융소비자 보호에 관한 법률 제19조" });
  expect(result.items).toHaveLength(1); expect(result.items[0].excerptMasked).toContain("가. 중도상환");
  expect(result.items[0].officialId).toBe("law.go.kr:123:제19조");
});
