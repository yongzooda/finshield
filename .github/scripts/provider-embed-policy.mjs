// ============================================================
// B-EMBED-01 raw-metric 합격식 — 1차 후보 생성 (재정의판)
//
// artifact 안의 PASS 문자열을 믿지 않는다. 원장으로 지표를 다시 계산하고
// 사전등록한 수용식으로 판정한다.
//
// 수용식은 후보 풀 20 안의 관련 unit Recall = 1.00 이다. 1단계에서 빠진
// 근거는 이후 어떤 단계로도 복구할 수 없으므로 부분 회수를 허용하지 않는다.
// 위험 핵심 unit 도 같은 기준을 적용한다.
//
// 대상·시점 판별 정확도는 여기서 재지 않는다. 그것은 Metadata Filter 와
// Rerank 의 책임이고 `B-RETRIEVAL-01` 이 종단으로 측정한다.
// ============================================================
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_POOL_K, FORMULA_VERSION, loadCandidateFixtures, passesMetadataFilter,
  scoreCandidatePools,
} from "./provider-embed-candidate-evaluation.mjs";
import { DOCUMENT_BATCH_SIZE, FIXTURE_SET } from "./provider-embed-candidate-spike.mjs";
import { percentile } from "./provider-embed-spike.mjs";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const root = fileURLToPath(new URL("../../", import.meta.url));

export const QUERY_P95_LIMIT_MS = 1500;

export const validateEmbedEvidenceResult = (result, fail) => {
  if (!exactKeys(result?.observations,
    ["contract", "dataset", "quality", "retrieval", "samples", "latency", "usage", "provider"])) {
    fail("B-EMBED-01 observations 필드가 v3 고정 schema와 다릅니다.");
    return;
  }
  const { contract, dataset, quality, retrieval, samples, latency, usage, provider } = result.observations;
  const fixtures = loadCandidateFixtures(root);
  const queries = fixtures.queries.filter((query) => query.split === "gate");
  const documentBatches = Math.ceil(fixtures.documents.length / DOCUMENT_BATCH_SIZE);
  const expectedRequests = documentBatches + queries.length;

  if (!exactKeys(contract, ["model_id", "dimension", "metric", "document_input_type",
    "query_input_type", "embedding_type", "knn", "pool_k"])
    || contract.model_id !== "embed-v4.0" || contract.dimension !== 1024 || contract.metric !== "cosine"
    || contract.document_input_type !== "search_document" || contract.query_input_type !== "search_query"
    || contract.embedding_type !== "float" || contract.knn !== "exact"
    || contract.pool_k !== CANDIDATE_POOL_K) {
    fail("B-EMBED-01 model·input type·dimension·cosine Exact KNN·후보 풀 계약이 고정 기준과 다릅니다.");
  }

  if (!exactKeys(dataset, ["formula_version", "fixture_set", "split", "families", "documents",
    "queries", "hard_negative_documents", "hard_negative_queries", "risk_queries"])
    || dataset.formula_version !== FORMULA_VERSION || dataset.fixture_set !== FIXTURE_SET
    || dataset.split !== "gate" || dataset.families !== 20 || dataset.documents !== 240
    || dataset.queries !== 100 || dataset.hard_negative_documents !== 100
    || dataset.hard_negative_queries !== 100 || dataset.risk_queries !== 30) {
    fail("B-EMBED-01 v4 평가 split·산식·표본 계약 불일치.");
  }

  try {
    if (!exactKeys(retrieval, ["rows", "counts", "slices", "filter_rows"])) throw new Error("schema");
    const recalculated = scoreCandidatePools({
      queries, documents: fixtures.documents, rows: retrieval.rows,
    });
    if (!same(quality, recalculated.quality) || !same(retrieval.counts, recalculated.counts)
      || !same(retrieval.slices, recalculated.slices)) throw new Error("recalculation");
    // Filter 단계를 실제로 거쳤는지 다시 계산한다. 후보가 Filter 를 통과하지
    // 않은 문서에서 나왔다면 측정한 구성이 사전등록한 구성이 아니다.
    const expectedFilter = queries.map((query) => ({
      query_id: query.id,
      filtered_candidates: fixtures.documents.filter((document) =>
        passesMetadataFilter(document, query)).length,
    }));
    if (!same(retrieval.filter_rows, expectedFilter)) throw new Error("filter recalculation");
    const unitToDocument = new Map(fixtures.documents.map((document) => [document.unit_id, document]));
    for (const row of retrieval.rows) {
      const query = queries.find((item) => item.id === row.query_id);
      for (const hit of row.ranking) {
        if (!passesMetadataFilter(unitToDocument.get(hit.unit_id), query)) {
          throw new Error("unfiltered candidate");
        }
      }
    }
    // 전체 평균이 1.00 이어도 slice 를 따로 확인한다. 나중에 산식이 바뀌어
    // 평균만 보게 되는 회귀를 막는다.
    for (const slice of recalculated.slices) {
      if (slice.recall_at_pool !== 1) {
        fail(`B-EMBED-01 후보 풀 회수 미달 slice: ${slice.slice}`);
      }
      if (slice.risk_core_recall_at_pool !== null && slice.risk_core_recall_at_pool !== 1) {
        fail(`B-EMBED-01 위험 핵심 회수 미달 slice: ${slice.slice}`);
      }
    }
  } catch {
    fail("B-EMBED-01 query별 원장·qrels 재계산 불일치 또는 누락/중복/알 수 없는 ID.");
  }

  if (!exactKeys(quality, ["pool_k", "recall_at_pool", "risk_core_recall_at_pool",
    "queries_fully_covered", "queries_total", "worst_minimum_k"])
    || quality.pool_k !== CANDIDATE_POOL_K
    || quality.recall_at_pool !== 1 || quality.risk_core_recall_at_pool !== 1
    || quality.queries_total !== queries.length
    || quality.queries_fully_covered !== queries.length
    || !positiveInteger(quality.worst_minimum_k) || quality.worst_minimum_k > CANDIDATE_POOL_K) {
    fail("B-EMBED-01 후보 풀 20 관련 unit Recall 1.00·위험 핵심 Recall 1.00 합격선을 충족하지 못했습니다.");
  }

  let billed = 0;
  try {
    if (!exactKeys(samples, ["queries", "documents"])
      || !Array.isArray(samples.queries) || !Array.isArray(samples.documents)
      || samples.queries.length !== queries.length || samples.documents.length !== documentBatches
      || new Set(samples.queries.map((sample) => sample.query_id)).size !== queries.length) {
      throw new Error("samples");
    }
    for (const sample of samples.queries) {
      if (!exactKeys(sample, ["query_id", "provider_ms", "billed_input_tokens"])
        || !queries.some((query) => query.id === sample.query_id)
        || !nonnegative(sample.provider_ms)
        || !positiveInteger(sample.billed_input_tokens)) throw new Error("query sample");
      billed += sample.billed_input_tokens;
    }
    const expectedBatchSizes = Array.from({ length: documentBatches }, (_, index) =>
      Math.min(DOCUMENT_BATCH_SIZE, fixtures.documents.length - index * DOCUMENT_BATCH_SIZE));
    samples.documents.forEach((sample, index) => {
      if (!exactKeys(sample, ["input_count", "billed_input_tokens"])
        || sample.input_count !== expectedBatchSizes[index]
        || !positiveInteger(sample.billed_input_tokens)) throw new Error("document sample");
      billed += sample.billed_input_tokens;
    });
    const providerTimes = samples.queries.map((sample) => sample.provider_ms);
    if (!exactKeys(latency, ["query_samples", "query_p50_ms", "query_p95_ms",
      "exact_knn_samples", "exact_knn_p95_ms"])
      || latency.query_samples !== queries.length || latency.exact_knn_samples !== queries.length
      || latency.query_p50_ms !== percentile(providerTimes, 0.5)
      || latency.query_p95_ms !== percentile(providerTimes, 0.95)
      || !nonnegative(latency.exact_knn_p95_ms)) throw new Error("latency");
  } catch {
    fail("B-EMBED-01 개별 지연·청구 token 원장과 집계값 재계산 불일치.");
  }

  if (!nonnegative(latency?.query_p95_ms) || latency.query_p95_ms > QUERY_P95_LIMIT_MS) {
    fail("B-EMBED-01 Query Provider P95 1.5초 초과.");
  }

  if (!exactKeys(usage, ["provider_requests", "embedded_inputs", "billed_input_tokens",
    "price_per_million_usd", "calculated_cost_usd"])
    || usage.provider_requests !== expectedRequests
    || usage.embedded_inputs !== fixtures.documents.length + queries.length
    || !positiveInteger(usage.billed_input_tokens) || usage.billed_input_tokens !== billed
    || usage.price_per_million_usd !== 0.12
    || usage.calculated_cost_usd !== Number((billed * 0.12 / 1_000_000).toFixed(9))) {
    fail("B-EMBED-01 실제 billed token·요청 수·고정 가격 스냅샷 비용 계산이 일치하지 않습니다.");
  }

  if (!exactKeys(provider, ["http_status", "request_ids_present", "unique_request_ids",
    "rate_limit_headers_observed"])
    || provider.http_status !== 200 || provider.request_ids_present !== expectedRequests
    || provider.unique_request_ids !== expectedRequests
    || typeof provider.rate_limit_headers_observed !== "boolean") {
    fail("B-EMBED-01 HTTP·요청 ID 중복 방지 Provider 관측값이 합격 기준과 다릅니다.");
  }

  if (!exactKeys(result?.environment, [
    "node_version", "region", "fixture_set_hash", "pricing_snapshot_date", "pricing_source",
    "transport", "provider_request_ids_hash", "api_version",
    "official_text_input_limit_per_minute", "request_interval_ms",
  ])
    || !/^v24\./.test(result.environment.node_version ?? "")
    || !/^[a-z0-9-]{2,32}$/.test(result.environment.region ?? "")
    || result.environment.fixture_set_hash !== fixtures.fixtureSetHash
    || result.environment.pricing_snapshot_date !== "2026-09-04"
    || result.environment.pricing_source !== "https://cohere.com/pricing"
    || result.environment.transport !== "native-fetch"
    || !/^[0-9a-f]{64}$/.test(result.environment.provider_request_ids_hash ?? "")
    || result.environment.api_version !== "v2"
    || result.environment.official_text_input_limit_per_minute !== 2000
    || result.environment.request_interval_ms !== 1100) {
    fail("B-EMBED-01 environment·fixture·가격·transport·공식 quota inventory가 승인 기준과 다릅니다.");
  }
};
