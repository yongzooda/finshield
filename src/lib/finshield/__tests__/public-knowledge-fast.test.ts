import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../retrieval-provider", async importOriginal => {
  const actual = await importOriginal<typeof import("../retrieval-provider")>();
  return { ...actual, embedQuery: vi.fn(), rerankKnowledge: vi.fn() };
});

import { embedQuery, rerankKnowledge, RetrievalProviderError } from "../retrieval-provider";
import { searchDisputeCase } from "../tools/public-knowledge";
import type { ToolCallContext } from "../tools/runtime";

const row = {
  id: "snapshot-1", chunk_id: "chunk-1", source_type: "DISPUTE", authority_level: "A",
  publisher_name: "합성 공식 기관", source_title: "합성 대출 분쟁", canonical_url: "https://example.invalid/source",
  official_id: "fixture-1", source_version: "1", content_hash: "a".repeat(64), source_fingerprint: "b".repeat(64),
  published_at: "2026-01-01", effective_from: "2026-01-01", effective_to: null, license_code: "SYNTHETIC",
  is_complete: true, is_citable: true, freshness_status: "FRESH", retrieved_at: "2026-09-08T00:00:00Z",
  fresh_until: "2026-09-09T00:00:00Z", chunk_text: "합성 대출 분쟁 절차", source_locator: { paragraph: 1 },
  document_type: "DISPUTE", valid_from: "2026-01-01", valid_to: null, keyword_rank: 1, vector_distance: .1,
};

const cancellable = <T,>(value: T) => Object.assign(Promise.resolve(value), { cancel: vi.fn() });
const context = () => {
  const sql = Object.assign(vi.fn()
    .mockReturnValueOnce(cancellable([{ documents: 1, embedding_model: "embed-v4.0", embedding_dimension: 1024,
      embedding_model_version: "cohere-2026" }]))
    .mockReturnValueOnce(cancellable([row])), { unsafe: (value: string) => value });
  return { sql, manifest: { kbReleaseId: "00000000-0000-4000-8000-000000000001" },
    ownerId: "00000000-0000-4000-8000-000000000002", caseId: "00000000-0000-4000-8000-000000000003",
    runId: "00000000-0000-4000-8000-000000000004" } as unknown as ToolCallContext;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(embedQuery).mockResolvedValue(Array(1024).fill(.1));
});

it("Fast가 성공하면 제품 단계와 선택 이유를 원장 값으로 돌려준다", async () => {
  vi.mocked(rerankKnowledge).mockResolvedValue([.9]);
  const result = await searchDisputeCase({ query: "대출 분쟁" }, context());
  expect(result.errorCode).toBeNull();
  expect(result.observations).toMatchObject({
    retrieval: "METADATA_KEYWORD_VECTOR_FAST_RERANK", vector_status: "AVAILABLE", rerank_status: "AVAILABLE",
  });
  expect(result.items[0].selectionReasonCode).toBe("PUBLIC_KB_FAST_RERANK_MATCH");
});

it("Fast 응답이 불명확하면 결정적 후보를 보존하되 정상 검색으로 표시하지 않는다", async () => {
  vi.mocked(rerankKnowledge).mockRejectedValue(new RetrievalProviderError("RETRIEVAL_PROVIDER_UNCONFIRMED"));
  const result = await searchDisputeCase({ query: "대출 분쟁" }, context());
  expect(result.items).toHaveLength(1);
  expect(result.errorCode).toBe("RETRIEVAL_DEGRADED");
  expect(result.reasonCode).toBe("RETRIEVAL_PROVIDER_UNCONFIRMED");
  expect(result.observations?.rerank_status).toBe("RETRIEVAL_PROVIDER_UNCONFIRMED");
});
