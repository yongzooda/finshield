const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const finiteNonNegative = (value) => Number.isFinite(value) && value >= 0;

export const validateEmbedEvidenceResult = (result, fail) => {
  if (!exactKeys(result?.observations, ["contract", "dataset", "quality", "latency", "usage", "provider"])) {
    fail("B-EMBED-01 observations 필드가 고정 schema와 다릅니다.");
    return;
  }

  const { contract, dataset, quality, latency, usage, provider } = result.observations;
  if (!exactKeys(contract, ["model_id", "dimension", "metric", "document_input_type", "query_input_type", "embedding_type", "knn"])
    || contract.model_id !== "embed-v4.0" || contract.dimension !== 1024 || contract.metric !== "cosine"
    || contract.document_input_type !== "search_document" || contract.query_input_type !== "search_query"
    || contract.embedding_type !== "float" || contract.knn !== "exact") {
    fail("B-EMBED-01 model·input type·dimension·cosine Exact KNN 계약이 고정 기준과 다릅니다.");
  }
  if (!exactKeys(dataset, ["topics", "documents", "queries", "hard_negative_documents", "hard_negative_queries", "risk_queries"])
    || dataset.topics !== 20 || dataset.documents !== 140 || dataset.queries !== 100
    || dataset.hard_negative_documents !== 40 || dataset.hard_negative_queries !== 40 || dataset.risk_queries !== 30) {
    fail("B-EMBED-01 합성 한국어 Query·hard negative·위험 Query 표본 수가 부족합니다.");
  }
  if (!exactKeys(quality, ["top_k", "recall_at_5", "risk_core_recall_at_5", "precision_at_5"])
    || quality.top_k !== 5 || !finiteNonNegative(quality.recall_at_5) || quality.recall_at_5 < 0.9 || quality.recall_at_5 > 1
    || quality.risk_core_recall_at_5 !== 1
    || !finiteNonNegative(quality.precision_at_5) || quality.precision_at_5 < 0.8 || quality.precision_at_5 > 1) {
    fail("B-EMBED-01 Recall@5·위험 핵심 Recall@5·Precision@5 합격선을 충족하지 못했습니다.");
  }
  if (!exactKeys(latency, ["query_samples", "query_p50_ms", "query_p95_ms", "exact_knn_samples", "exact_knn_p95_ms"])
    || latency.query_samples !== 100
    || !finiteNonNegative(latency.query_p50_ms) || !finiteNonNegative(latency.query_p95_ms)
    || latency.query_p95_ms > 1500 || latency.query_p50_ms > latency.query_p95_ms
    || latency.exact_knn_samples !== latency.query_samples || !finiteNonNegative(latency.exact_knn_p95_ms)) {
    fail("B-EMBED-01 Query Provider P95 1.5초 및 Exact KNN latency 표본 계약을 충족하지 못했습니다.");
  }
  const expectedCost = Number(((usage?.billed_input_tokens ?? -1) * 0.12 / 1_000_000).toFixed(9));
  if (!exactKeys(usage, ["provider_requests", "embedded_inputs", "billed_input_tokens", "price_per_million_usd", "calculated_cost_usd"])
    || !Number.isInteger(usage.provider_requests) || usage.provider_requests !== 102
    || usage.embedded_inputs !== dataset.documents + dataset.queries
    || !Number.isInteger(usage.billed_input_tokens) || usage.billed_input_tokens <= 0
    || usage.price_per_million_usd !== 0.12 || usage.calculated_cost_usd !== expectedCost) {
    fail("B-EMBED-01 실제 billed token·요청 수·고정 가격 스냅샷 비용 계산이 일치하지 않습니다.");
  }
  if (!exactKeys(provider, ["http_status", "request_ids_present", "unique_request_ids", "rate_limit_headers_observed"])
    || provider.http_status !== 200 || provider.request_ids_present !== usage.provider_requests
    || provider.unique_request_ids !== usage.provider_requests
    || typeof provider.rate_limit_headers_observed !== "boolean") {
    fail("B-EMBED-01 HTTP·요청 ID 중복 방지 Provider 관측값이 합격 기준과 다릅니다.");
  }
  if (!exactKeys(result?.environment, [
    "node_version", "region", "fixture_set_hash", "pricing_snapshot_date", "pricing_source",
    "transport", "provider_request_ids_hash", "api_version", "official_text_input_limit_per_minute", "request_interval_ms",
  ])
    || !/^v24\./.test(result.environment.node_version ?? "")
    || !/^[a-z0-9-]{2,32}$/.test(result.environment.region ?? "")
    || !/^[0-9a-f]{64}$/.test(result.environment.fixture_set_hash ?? "")
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
