// ============================================================
// B-EMBED-01 재정의 harness — 1차 후보 생성
//
// v3 평가셋의 gate split 을 Cohere embed-v4.0 으로 임베딩하고 후보 풀 20 을
// 만든다. 대상·시점 판별은 이 단계의 책임이 아니다. 필요한 근거가 풀 안에
// 빠짐없이 들어오는지만 본다.
//
// Provider 계약 계층은 v2 harness 와 같은 구현을 재사용한다. 응답 검증을 두
// 곳에 두면 한쪽만 느슨해질 수 있다.
// ============================================================
import { createHash } from "node:crypto";
import {
  CANDIDATE_POOL_K, FORMULA_VERSION, loadCandidateFixtures, passesMetadataFilter,
  scoreCandidatePools,
} from "./provider-embed-candidate-evaluation.mjs";
import {
  createEmbedPacer, cosineSimilarity, percentile, requestEmbeddings, MODEL_ID, DIMENSION,
} from "./provider-embed-spike.mjs";

export { FIXTURE_PATH, loadCandidateFixtures } from "./provider-embed-candidate-evaluation.mjs";

export const FIXTURE_SET = "finshield-korean-finance-embed-v5";
export const DOCUMENT_BATCH_SIZE = 96;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// 후보 풀은 unit 단위로 만든다. 같은 unit 의 복제 문서가 풀 자리를 두 번
// 차지하지 못하게 한다.
export const exactKnnPool = (queryVector, documents, poolK = CANDIDATE_POOL_K) => {
  if (!Number.isInteger(poolK) || poolK < 1) throw new Error("Candidate pool size must be positive.");
  const scored = documents.map((document) => ({
    id: document.id,
    unit_id: document.unit_id ?? document.id,
    score: cosineSimilarity(queryVector, document.vector),
  })).sort((left, right) => right.score - left.score
    || left.unit_id.localeCompare(right.unit_id)
    || left.id.localeCompare(right.id));
  const seen = new Set();
  return scored.filter((hit) => {
    if (seen.has(hit.unit_id)) return false;
    seen.add(hit.unit_id);
    return true;
  }).slice(0, poolK);
};

// AI-007 은 단계별 후보 수를 Trace 에 남기도록 요구한다. Filter 통과 문서 수를
// query 별로 기록해 후보 공간이 실제로 좁혀졌는지 감사할 수 있게 한다.
export const evaluateCandidateGeneration = ({ queries, documentVectors, queryVectors }) => {
  if (queries.length !== queryVectors.length) throw new Error("Query fixtures and vectors must align.");
  const knnLatencies = [];
  const filterRows = [];
  const rows = queries.map((query, index) => {
    const startedAt = performance.now();
    const filtered = documentVectors.filter((document) => passesMetadataFilter(document, query));
    if (filtered.length === 0) throw new Error("Metadata filter produced an empty candidate space.");
    const ranking = exactKnnPool(queryVectors[index], filtered)
      .map(({ id, unit_id, score }) => ({ document_id: id, unit_id, score }));
    knnLatencies.push(Math.round((performance.now() - startedAt) * 1000) / 1000);
    filterRows.push({ query_id: query.id, filtered_candidates: filtered.length });
    return { query_id: query.id, ranking };
  });
  return {
    ...scoreCandidatePools({ queries, documents: documentVectors, rows }),
    rows,
    filterRows,
    knnLatencies,
    exactKnnP95Ms: percentile(knnLatencies, 0.95),
  };
};

export const runCandidateSpike = async ({
  root, apiKey, fetchImpl = globalThis.fetch, progress = () => {}, pacer = createEmbedPacer(),
}) => {
  if (typeof apiKey !== "string" || apiKey.length < 12) {
    throw new Error("COHERE_API_KEY is not configured for the spike environment.");
  }
  const fixtures = loadCandidateFixtures(root);
  const { documents, fixtureSetHash } = fixtures;
  const queries = fixtures.queries.filter((query) => query.split === "gate");

  const requestIds = [];
  const documentVectors = [];
  const queryVectors = [];
  const queryLatencies = [];
  const querySamples = [];
  const documentBatches = [];
  let billedInputTokens = 0;
  let rateLimitHeadersObserved = false;

  for (let offset = 0; offset < documents.length; offset += DOCUMENT_BATCH_SIZE) {
    const batch = documents.slice(offset, offset + DOCUMENT_BATCH_SIZE);
    const response = await requestEmbeddings({
      fetchImpl, apiKey, texts: batch.map((item) => item.text), inputType: "search_document", pacer,
    });
    response.vectors.forEach((vector, index) => documentVectors.push({
      ...batch[index], vector, text: undefined,
    }));
    documentBatches.push({ input_count: batch.length, billed_input_tokens: response.billedInputTokens });
    requestIds.push(response.requestId);
    billedInputTokens += response.billedInputTokens;
    rateLimitHeadersObserved ||= response.rateLimitHeadersObserved;
  }

  for (const [index, query] of queries.entries()) {
    const response = await requestEmbeddings({
      fetchImpl, apiKey, texts: [query.text], inputType: "search_query", pacer,
    });
    queryVectors.push(response.vectors[0]);
    queryLatencies.push(response.latencyMs);
    querySamples.push({
      query_id: query.id, provider_ms: response.latencyMs, billed_input_tokens: response.billedInputTokens,
    });
    requestIds.push(response.requestId);
    billedInputTokens += response.billedInputTokens;
    rateLimitHeadersObserved ||= response.rateLimitHeadersObserved;
    progress(index + 1, queries.length);
  }

  if (new Set(requestIds).size !== requestIds.length) {
    throw new Error("Provider request IDs are missing or duplicated.");
  }

  const evaluation = evaluateCandidateGeneration({ queries, documentVectors, queryVectors });
  const providerRequests = documentBatches.length + queries.length;

  return {
    fixtureSetHash,
    providerRequestIdsHash: sha256([...requestIds].sort().join("\n")),
    observations: {
      contract: {
        model_id: MODEL_ID,
        dimension: DIMENSION,
        metric: "cosine",
        document_input_type: "search_document",
        query_input_type: "search_query",
        embedding_type: "float",
        knn: "exact",
        pool_k: CANDIDATE_POOL_K,
      },
      dataset: {
        formula_version: FORMULA_VERSION,
        fixture_set: FIXTURE_SET,
        split: "gate",
        families: new Set(queries.map((query) => query.family)).size,
        documents: documents.length,
        queries: queries.length,
        hard_negative_documents: new Set(queries.flatMap((query) => query.hard_negative_unit_ids)).size,
        hard_negative_queries: queries.filter((query) => query.hard_negative_unit_ids.length > 0).length,
        risk_queries: queries.filter((query) => query.risk_critical).length,
        true_claims: queries.filter((query) => query.truth === "TRUE").length,
        false_claims: queries.filter((query) => query.truth === "FALSE").length,
      },
      quality: evaluation.quality,
      retrieval: {
        rows: evaluation.rows, counts: evaluation.counts,
        slices: evaluation.slices, filter_rows: evaluation.filterRows,
        case_unions: evaluation.unions,
      },
      samples: { queries: querySamples, documents: documentBatches },
      latency: {
        query_samples: queryLatencies.length,
        query_p50_ms: percentile(queryLatencies, 0.5),
        query_p95_ms: percentile(queryLatencies, 0.95),
        exact_knn_samples: evaluation.knnLatencies.length,
        exact_knn_p95_ms: evaluation.exactKnnP95Ms,
      },
      usage: {
        provider_requests: providerRequests,
        embedded_inputs: documents.length + queries.length,
        billed_input_tokens: billedInputTokens,
        price_per_million_usd: 0.12,
        calculated_cost_usd: Number((billedInputTokens * 0.12 / 1_000_000).toFixed(9)),
      },
      provider: {
        http_status: 200,
        request_ids_present: requestIds.length,
        unique_request_ids: new Set(requestIds).size,
        rate_limit_headers_observed: rateLimitHeadersObserved,
      },
    },
  };
};
