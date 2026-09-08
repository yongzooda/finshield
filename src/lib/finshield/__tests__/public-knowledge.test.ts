import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { knowledgeItem, rankKnowledge, checkDocuments, searchDisputeCase, getSourceSnapshot } from "../tools/public-knowledge";
import type { ToolCallContext } from "../tools/runtime";
const row = { id: "snapshot-1", chunk_id: "chunk-1", source_type: "DISPUTE", authority_level: "A" as const, publisher_name: "합성 공식 기관", source_title: "합성 대출 분쟁",
  canonical_url: "https://example.invalid/source", official_id: "fixture-1", source_version: "1", content_hash: "a".repeat(64), source_fingerprint: "b".repeat(64),
  published_at: "2020-01-01", effective_from: "2020-01-01", effective_to: null, license_code: "SYNTHETIC", is_complete: true, is_citable: true,
  freshness_status: "FRESH" as const, retrieved_at: "2026-09-07T00:00:00Z", fresh_until: "2026-09-08T00:00:00Z",
  chunk_text: "합성 대출 수수료 설명 분쟁", source_locator: { kind: "paragraph", paragraph: 2 }, document_type: "DISPUTE",
  valid_from: "2020-01-01", valid_to: null, keyword_rank: 1, vector_distance: .1 };
const sql = Object.assign(vi.fn(), { unsafe: (value: string) => value });
const ctx = { sql, manifest: { kbReleaseId: "synthetic-release" } } as unknown as ToolCallContext;
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-07T03:00:00Z")); });
afterEach(() => vi.useRealTimers());
it("분쟁은 참고용이며 재조회가 원문 수집 시각을 갱신하지 않는다", () => {
  const result = knowledgeItem(row, "SYNTHETIC"); expect(result.referenceOnly).toBe(true); expect(result.isCitable).toBe(false);
  expect(Date.parse(result.retrievedAt!)).toBe(Date.parse(row.retrieved_at)); expect(result.locator.paragraph).toBe(2);
});
it("종료·미래 적용·만료 수집 상태를 현재 유효 근거로 바꾸지 않는다", () => {
  expect(knowledgeItem({ ...row, document_type: "TERMS", valid_to: "2026-08-01" }, "SYNTHETIC").isCitable).toBe(false);
  expect(knowledgeItem({ ...row, document_type: "TERMS", effective_from: "2027-01-01" }, "SYNTHETIC").isCitable).toBe(false);
  expect(knowledgeItem({ ...row, fresh_until: "2026-09-06T00:00:00Z" }, "SYNTHETIC").freshness).toBe("STALE");
});
it("동일 원문의 다른 Chunk와 재게시본을 독립 근거로 중복 계산하지 않는다", () => {
  expect(rankKnowledge([row, { ...row, chunk_id: "chunk-2", id: "repost" }])).toHaveLength(1);
});
it("Fast relevance를 권위·적용 시점과 합성해 최종 순서를 정한다", () => {
  const relevant = { ...row, chunk_id: "chunk-relevant", id: "snapshot-relevant",
    source_fingerprint: "c".repeat(64), authority_level: "C" as const, effective_from: "2026-01-01" };
  expect(rankKnowledge([row, relevant], [.1, .95])[0].chunk_id).toBe("chunk-relevant");
});
it("자료 준비 안내를 실제 소유 문서나 법적 판단으로 표현하지 않는다", async () => {
  sql.mockResolvedValueOnce([{ documents: 0 }]).mockResolvedValueOnce([]);
  const result = await checkDocuments({ query: "대출 수수료" }, ctx);
  expect(result.items).toEqual([]); expect(result.observations?.possession_status).toBe("NOT_ASSESSED");
  expect(result.observations?.legal_violation_determined).toBe(false);
});
it("과대 질의·추가 필드는 DB 조회 전에 거부한다", async () => {
  expect((await searchDisputeCase({ query: "대출", injected: true }, ctx)).errorCode).toBe("TOOL_INPUT_INVALID");
  expect((await getSourceSnapshot({ query: "a".repeat(2001) }, ctx)).errorCode).toBe("TOOL_INPUT_INVALID"); expect(sql).not.toHaveBeenCalled();
});
