import { fileURLToPath } from "node:url";
import { loadEmbedFixtures, scoreRankings, FORMULA_VERSION } from "./provider-embed-evaluation.mjs";
import { percentile } from "./provider-embed-spike.mjs";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const root = fileURLToPath(new URL("../../", import.meta.url));

export const validateEmbedEvidenceResult = (result, fail) => {
  if (!exactKeys(result?.observations, ["contract", "dataset", "quality", "retrieval", "samples", "latency", "usage", "provider"])) {
    fail("B-EMBED-01 observations 필드가 v2 고정 schema와 다릅니다."); return;
  }
  const { contract, dataset, quality, retrieval, samples, latency, usage, provider } = result.observations;
  const fixtures = loadEmbedFixtures(root);
  const queries = fixtures.queries.filter((q) => q.split === "gate");
  const expectedRequests = Math.ceil(fixtures.documents.length / 96) + queries.length;
  if (!exactKeys(contract, ["model_id", "dimension", "metric", "document_input_type", "query_input_type", "embedding_type", "knn"])
    || contract.model_id !== "embed-v4.0" || contract.dimension !== 1024 || contract.metric !== "cosine"
    || contract.document_input_type !== "search_document" || contract.query_input_type !== "search_query"
    || contract.embedding_type !== "float" || contract.knn !== "exact") {
    fail("B-EMBED-01 model·input type·dimension·cosine Exact KNN 계약이 고정 기준과 다릅니다.");
  }
  if (!exactKeys(dataset, ["formula_version", "fixture_set", "split", "families", "documents", "queries", "hard_negative_documents", "hard_negative_queries", "risk_queries"])
    || dataset.formula_version !== FORMULA_VERSION || dataset.fixture_set !== "finshield-korean-finance-embed-v2"
    || dataset.split !== "gate" || dataset.families !== 20 || dataset.documents !== 168 || dataset.queries !== 100
    || dataset.hard_negative_documents !== 40 || dataset.hard_negative_queries !== 100 || dataset.risk_queries !== 30) {
    fail("B-EMBED-01 v2 평가 split·산식·표본 계약 불일치.");
  }
  try {
    if (!exactKeys(retrieval, ["rows", "counts", "slices"])) throw new Error("schema");
    const recalculated = scoreRankings({ queries, documents: fixtures.documents, rows: retrieval.rows });
    if (!same(quality, recalculated.quality) || !same(retrieval.counts, recalculated.counts)
      || !same(retrieval.slices, recalculated.slices)) throw new Error("recalculation");
    for (const slice of recalculated.slices) {
      if (slice.recall_at_5 < 0.9 || (slice.slice.startsWith("family:") && slice.precision_at_5 < 0.8)) {
        fail(`B-EMBED-01 사전등록 slice 품질 미달: ${slice.slice}`);
      }
    }
  } catch {
    fail("B-EMBED-01 query별 원장·qrels 재계산 불일치 또는 누락/중복/알 수 없는 ID.");
  }
  if (!exactKeys(quality, ["top_k", "recall_at_5", "risk_core_recall_at_5", "precision_at_5"])
    || quality.top_k !== 5 || !nonnegative(quality.recall_at_5) || quality.recall_at_5 < 0.9 || quality.recall_at_5 > 1
    || quality.risk_core_recall_at_5 !== 1
    || !nonnegative(quality.precision_at_5) || quality.precision_at_5 < 0.8 || quality.precision_at_5 > 1) {
    fail("B-EMBED-01 Recall@5·위험 핵심 Recall@5·Precision@5 합격선을 충족하지 못했습니다.");
  }
  let billed = 0;
  try {
    if (!exactKeys(samples, ["queries", "documents"]) || !Array.isArray(samples.queries) || !Array.isArray(samples.documents)
      || samples.queries.length !== queries.length || samples.documents.length !== 2
      || new Set(samples.queries.map((s) => s.query_id)).size !== queries.length) throw new Error("samples");
    for (const sample of samples.queries) {
      if (!exactKeys(sample, ["query_id", "provider_ms", "billed_input_tokens", "knn_ms"])
        || !queries.some((q) => q.id === sample.query_id) || !nonnegative(sample.provider_ms) || !nonnegative(sample.knn_ms)
        || !positiveInteger(sample.billed_input_tokens)) throw new Error("query sample");
      billed += sample.billed_input_tokens;
    }
    samples.documents.forEach((sample, index) => {
      if (!exactKeys(sample, ["input_count", "billed_input_tokens"]) || sample.input_count !== [96, 72][index]
        || !positiveInteger(sample.billed_input_tokens)) throw new Error("document sample");
      billed += sample.billed_input_tokens;
    });
    const providerTimes = samples.queries.map((s) => s.provider_ms), knnTimes = samples.queries.map((s) => s.knn_ms);
    if (!exactKeys(latency, ["query_samples", "query_p50_ms", "query_p95_ms", "exact_knn_samples", "exact_knn_p95_ms"])
      || latency.query_samples !== 100 || latency.exact_knn_samples !== 100
      || latency.query_p50_ms !== percentile(providerTimes, 0.5)
      || latency.query_p95_ms !== percentile(providerTimes, 0.95)
      || latency.exact_knn_p95_ms !== percentile(knnTimes, 0.95)) throw new Error("latency");
  } catch {
    fail("B-EMBED-01 개별 지연·청구 token 원장과 집계값 재계산 불일치.");
  }
  if (!nonnegative(latency?.query_p95_ms) || latency.query_p95_ms > 1500) fail("B-EMBED-01 Query Provider P95 1.5초 초과.");
  if (!exactKeys(usage, ["provider_requests", "embedded_inputs", "billed_input_tokens", "price_per_million_usd", "calculated_cost_usd"])
    || usage.provider_requests !== expectedRequests || usage.embedded_inputs !== 268
    || !positiveInteger(usage.billed_input_tokens) || usage.billed_input_tokens !== billed
    || usage.price_per_million_usd !== 0.12 || usage.calculated_cost_usd !== Number((billed * 0.12 / 1_000_000).toFixed(9))) {
    fail("B-EMBED-01 실제 billed token·요청 수·고정 가격 스냅샷 비용 계산이 일치하지 않습니다.");
  }
  if (!exactKeys(provider, ["http_status", "request_ids_present", "unique_request_ids", "rate_limit_headers_observed"])
    || provider.http_status !== 200 || provider.request_ids_present !== expectedRequests
    || provider.unique_request_ids !== expectedRequests || typeof provider.rate_limit_headers_observed !== "boolean") {
    fail("B-EMBED-01 HTTP·요청 ID 중복 방지 Provider 관측값이 합격 기준과 다릅니다.");
  }
  if (!exactKeys(result?.environment, [
    "node_version", "region", "fixture_set_hash", "pricing_snapshot_date", "pricing_source",
    "transport", "provider_request_ids_hash", "api_version", "official_text_input_limit_per_minute", "request_interval_ms",
  ])
    || !/^v24\./.test(result.environment.node_version ?? "")
    || !/^[a-z0-9-]{2,32}$/.test(result.environment.region ?? "")
    || result.environment.fixture_set_hash !== fixtures.fixtureSetHash
    || result.environment.pricing_snapshot_date !== "2026-09-04" || result.environment.pricing_source !== "https://cohere.com/pricing"
    || result.environment.transport !== "native-fetch" || !/^[0-9a-f]{64}$/.test(result.environment.provider_request_ids_hash ?? "")
    || result.environment.api_version !== "v2" || result.environment.official_text_input_limit_per_minute !== 2000
    || result.environment.request_interval_ms !== 1100) {
    fail("B-EMBED-01 environment·fixture·가격·transport·공식 quota inventory가 승인 기준과 다릅니다.");
  }
};
