import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const MODEL_ID = "embed-v4.0";
export const DIMENSION = 1024;
export const FIXTURE_PATH = ".github/fixtures/provider-embed-v1.json";
export const PRICING_SNAPSHOT_DATE = "2026-09-04";
export const PRICE_PER_MILLION_USD = 0.12;
export const OFFICIAL_TEXT_INPUT_LIMIT_PER_MINUTE = 2000;
export const REQUEST_INTERVAL_MS = 1100;
const ENDPOINT = "https://api.cohere.com/v2/embed";
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const createEmbedPacer = ({ now = () => performance.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) => {
  let nextStart = 0;
  return {
    async wait() {
      while (now() < nextStart) await sleep(nextStart - now());
      nextStart = now() + REQUEST_INTERVAL_MS;
    },
  };
};

export const retryAfterSeconds = (value) => {
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return null;
  const seconds = Number(value);
  return seconds <= 86400 ? seconds : null;
};

export const percentile = (values, fraction) => {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)
    || !Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error("Percentile requires finite non-negative samples and a fraction in (0, 1].");
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
};

export const embeddingCostUsd = (billedInputTokens) => {
  if (!Number.isInteger(billedInputTokens) || billedInputTokens < 0) {
    throw new Error("Embedding billed input tokens must be a non-negative integer.");
  }
  return Number((billedInputTokens * PRICE_PER_MILLION_USD / 1_000_000).toFixed(9));
};

export const cosineSimilarity = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) {
    throw new Error("Cosine vectors must be non-empty arrays of the same dimension.");
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw new Error("Cosine vectors must be finite.");
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) throw new Error("Cosine vectors must be non-zero.");
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

export const exactKnn = (queryVector, documents, topK = 5) => documents
  .map((document) => ({ id: document.id, score: cosineSimilarity(queryVector, document.vector) }))
  .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
  .slice(0, topK);

export const evaluateRetrieval = ({ queries, documentVectors, queryVectors }) => {
  if (queries.length !== queryVectors.length) throw new Error("Query fixtures and vectors must align.");
  let primaryHits = 0;
  let riskCoreHits = 0;
  let relevantHits = 0;
  let riskQueries = 0;
  const knnLatencies = [];
  for (const [index, query] of queries.entries()) {
    const startedAt = performance.now();
    const hits = exactKnn(queryVectors[index], documentVectors, 5);
    knnLatencies.push(Math.round((performance.now() - startedAt) * 1000) / 1000);
    const ids = new Set(hits.map((hit) => hit.id));
    if (ids.has(query.primary_document_id)) primaryHits += 1;
    if (query.risk_critical) {
      riskQueries += 1;
      if (ids.has(query.risk_core_document_id)) riskCoreHits += 1;
    }
    relevantHits += hits.filter((hit) => query.relevant_document_ids.includes(hit.id)).length;
  }
  return {
    quality: {
      top_k: 5,
      recall_at_5: primaryHits / queries.length,
      risk_core_recall_at_5: riskQueries === 0 ? 0 : riskCoreHits / riskQueries,
      precision_at_5: relevantHits / (queries.length * 5),
    },
    exactKnnP95Ms: percentile(knnLatencies, 0.95),
  };
};

export const loadEmbedFixtures = (root) => {
  const bytes = readFileSync(resolve(root, FIXTURE_PATH));
  const fixture = JSON.parse(bytes.toString("utf8"));
  if (!exactKeys(fixture, ["schema_version", "fixture_set", "document_templates", "hard_negative_query_indexes", "topics"])
    || fixture.schema_version !== 1 || fixture.fixture_set !== "finshield-korean-finance-embed-v1"
    || !Array.isArray(fixture.document_templates) || fixture.document_templates.length !== 5
    || JSON.stringify(fixture.hard_negative_query_indexes) !== JSON.stringify([3, 4])
    || !Array.isArray(fixture.topics) || fixture.topics.length !== 20) {
    throw new Error("Embedding fixture set must be the exact 20-topic v1 schema.");
  }
  const topicIds = new Set();
  const documents = [];
  const queries = [];
  for (const topic of fixture.topics) {
    if (!exactKeys(topic, ["id", "label", "risk_critical", "core", "queries", "hard_negatives"])
      || !/^[a-z_]{3,32}$/.test(topic.id ?? "") || topicIds.has(topic.id)
      || typeof topic.label !== "string" || topic.label.length < 2
      || typeof topic.risk_critical !== "boolean"
      || typeof topic.core !== "string" || topic.core.length < 30
      || !Array.isArray(topic.queries) || topic.queries.length !== 5
      || !Array.isArray(topic.hard_negatives) || topic.hard_negatives.length !== 2
      || [...topic.queries, ...topic.hard_negatives].some((text) => typeof text !== "string" || text.length < 10)) {
      throw new Error(`Embedding topic '${topic?.id ?? "unknown"}' violates the synthetic fixture contract.`);
    }
    topicIds.add(topic.id);
    const relevantIds = fixture.document_templates.map((template, index) => {
      const id = `${topic.id}-D${String(index + 1).padStart(2, "0")}`;
      documents.push({ id, topic_id: topic.id, relevant: true, text: template.replace("{label}", topic.label).replace("{core}", topic.core) });
      return id;
    });
    topic.hard_negatives.forEach((text, index) => documents.push({
      id: `${topic.id}-H${String(index + 1).padStart(2, "0")}`,
      topic_id: topic.id,
      relevant: false,
      text,
    }));
    topic.queries.forEach((text, index) => queries.push({
      id: `${topic.id}-Q${String(index + 1).padStart(2, "0")}`,
      topic_id: topic.id,
      text,
      primary_document_id: relevantIds[index],
      relevant_document_ids: relevantIds,
      hard_negative_probe: fixture.hard_negative_query_indexes.includes(index),
      risk_critical: topic.risk_critical,
      risk_core_document_id: topic.risk_critical ? relevantIds[0] : null,
    }));
  }
  const serializedText = JSON.stringify({ documents, queries });
  if (documents.length !== 140 || queries.length !== 100
    || documents.filter((document) => !document.relevant).length !== 40
    || queries.filter((query) => query.hard_negative_probe).length !== 40
    || queries.filter((query) => query.risk_critical).length !== 30
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serializedText)
    || /\b\d{6}[- ]?[1-4]\d{6}\b/.test(serializedText)) {
    throw new Error("Expanded embedding fixture counts or synthetic-data boundary are invalid.");
  }
  return { documents, queries, fixtureSetHash: sha256(bytes) };
};

export const buildEmbedRequest = (texts, inputType) => {
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 96 || texts.some((text) => typeof text !== "string" || text.length === 0)
    || !["search_document", "search_query"].includes(inputType)) {
    throw new Error("Embedding request violates text count or input type contract.");
  }
  return {
    model: MODEL_ID,
    texts,
    input_type: inputType,
    embedding_types: ["float"],
    output_dimension: DIMENSION,
    truncate: "NONE",
  };
};

const parseEmbedResponse = async (response, expectedCount) => {
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw Object.assign(new Error("Provider embed request did not return JSON HTTP 200."), {
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    });
  }
  const body = await response.json();
  const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? body?.id;
  const vectors = body?.embeddings?.float;
  const billedInputTokens = body?.meta?.billed_units?.input_tokens;
  if (typeof requestId !== "string" || requestId.length < 8
    || !Array.isArray(vectors) || vectors.length !== expectedCount
    || vectors.some((vector) => !Array.isArray(vector) || vector.length !== DIMENSION
      || vector.some((value) => !Number.isFinite(value)) || vector.every((value) => value === 0))
    || !Number.isInteger(billedInputTokens) || billedInputTokens <= 0) {
    throw new Error("Provider embed response violates request ID, vector, dimension, or billed-unit contract.");
  }
  return { vectors, billedInputTokens, requestId };
};

const requestEmbeddings = async ({ fetchImpl, apiKey, texts, inputType, pacer }) => {
  // Workload pacing is not Provider response latency; never retry a failed sample.
  await pacer.wait();
  const startedAt = performance.now();
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildEmbedRequest(texts, inputType)),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  const parsed = await parseEmbedResponse(response, texts.length);
  return {
    ...parsed,
    latencyMs: Math.round(performance.now() - startedAt),
    rateLimitHeadersObserved: [...response.headers.keys()].some((name) => name.toLowerCase().includes("ratelimit")),
  };
};

export const runEmbedSpike = async ({ root, apiKey, fetchImpl = globalThis.fetch, progress = () => {}, pacer = createEmbedPacer() }) => {
  if (typeof apiKey !== "string" || apiKey.length < 12) throw new Error("COHERE_API_KEY is not configured for the spike environment.");
  const { documents, queries, fixtureSetHash } = loadEmbedFixtures(root);
  const requestIds = [];
  const documentVectors = [];
  const queryVectors = [];
  const queryLatencies = [];
  let billedInputTokens = 0;
  let rateLimitHeadersObserved = false;

  for (let offset = 0; offset < documents.length; offset += 96) {
    const batch = documents.slice(offset, offset + 96);
    const response = await requestEmbeddings({ fetchImpl, apiKey, texts: batch.map((item) => item.text), inputType: "search_document", pacer });
    response.vectors.forEach((vector, index) => documentVectors.push({ id: batch[index].id, vector }));
    requestIds.push(response.requestId);
    billedInputTokens += response.billedInputTokens;
    rateLimitHeadersObserved ||= response.rateLimitHeadersObserved;
  }
  for (const [index, query] of queries.entries()) {
    const response = await requestEmbeddings({ fetchImpl, apiKey, texts: [query.text], inputType: "search_query", pacer });
    queryVectors.push(response.vectors[0]);
    queryLatencies.push(response.latencyMs);
    requestIds.push(response.requestId);
    billedInputTokens += response.billedInputTokens;
    rateLimitHeadersObserved ||= response.rateLimitHeadersObserved;
    progress(index + 1, queries.length);
  }
  if (new Set(requestIds).size !== requestIds.length) throw new Error("Provider request IDs are missing or duplicated.");
  const evaluation = evaluateRetrieval({ queries, documentVectors, queryVectors });
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
      },
      dataset: {
        topics: 20,
        documents: documents.length,
        queries: queries.length,
        hard_negative_documents: documents.filter((document) => !document.relevant).length,
        hard_negative_queries: queries.filter((query) => query.hard_negative_probe).length,
        risk_queries: queries.filter((query) => query.risk_critical).length,
      },
      quality: evaluation.quality,
      latency: {
        query_samples: queryLatencies.length,
        query_p50_ms: percentile(queryLatencies, 0.5),
        query_p95_ms: percentile(queryLatencies, 0.95),
        exact_knn_samples: queryLatencies.length,
        exact_knn_p95_ms: evaluation.exactKnnP95Ms,
      },
      usage: {
        provider_requests: requestIds.length,
        embedded_inputs: documents.length + queries.length,
        billed_input_tokens: billedInputTokens,
        price_per_million_usd: PRICE_PER_MILLION_USD,
        calculated_cost_usd: embeddingCostUsd(billedInputTokens),
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
