import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIMENSION, MODEL_ID, buildEmbedRequest, cosineSimilarity, createEmbedPacer,
  embeddingCostUsd, loadEmbedFixtures, percentile, retryAfterSeconds,
} from "./provider-embed-spike.mjs";

// Development-split diagnostic probe. It measures full rank positions to decide
// whether a wider candidate pool plus AI-007 filter/rerank could recover the
// misses observed in the gate run. It is never adoption evidence: no PASS
// verdict is produced and the gate holdout queries are never embedded.
export const CLASSIFICATION = "development-probe-not-adoption-evidence";
export const RECALL_K = Object.freeze([1, 2, 3, 5, 7, 10, 20, 50]);
const ENDPOINT = "https://api.cohere.com/v2/embed";
const SPLIT = "development";

const requireValue = (condition, message) => { if (!condition) throw new Error(`Development probe: ${message}`); };

// Same ordering and unit de-duplication as the gate Exact KNN, without the top-k cut.
export const rankUnits = (queryVector, documents) => {
  const scored = documents.map((document) => ({
    id: document.id, unit_id: document.unit_id ?? document.id,
    score: cosineSimilarity(queryVector, document.vector),
  })).sort((left, right) => right.score - left.score
    || left.unit_id.localeCompare(right.unit_id) || left.id.localeCompare(right.id));
  const seen = new Set();
  return scored.filter((hit) => {
    if (seen.has(hit.unit_id)) return false;
    seen.add(hit.unit_id); return true;
  });
};

export const summarizeProbe = ({ queries, documents, rows }) => {
  requireValue(Array.isArray(rows) && rows.length === queries.length, "row count mismatch");
  const unitCount = new Set(documents.map((d) => d.unit_id ?? d.id)).size;
  const byQuery = new Map(rows.map((row) => [row.query_id, row]));
  requireValue(byQuery.size === rows.length, "duplicate probe rows");
  const perQuery = queries.map((query) => {
    requireValue(query.split === SPLIT, "gate query must never be scored by the probe");
    const row = byQuery.get(query.id);
    requireValue(row && Array.isArray(row.ranking) && row.ranking.length === unitCount, "incomplete ranking");
    const rankOf = new Map(row.ranking.map((hit, index) => [hit.unit_id, index + 1]));
    requireValue(query.relevant_unit_ids.length > 0
      && query.relevant_unit_ids.every((id) => rankOf.has(id))
      && query.hard_negative_unit_ids.every((id) => rankOf.has(id)), "unknown relevant or hard negative unit");
    const relevantRanks = query.relevant_unit_ids.map((id) => rankOf.get(id)).sort((a, b) => a - b);
    const hardNegativeRanks = query.hard_negative_unit_ids.map((id) => rankOf.get(id)).sort((a, b) => a - b);
    const worstRelevantRank = relevantRanks[relevantRanks.length - 1];
    return {
      query_id: query.id, family: query.family, relevant_total: query.relevant_unit_ids.length,
      critical_total: query.critical_unit_ids.length,
      relevant_ranks: relevantRanks, hard_negative_ranks: hardNegativeRanks,
      // Smallest candidate pool that already contains every relevant unit.
      min_k_for_full_recall: worstRelevantRank,
      hard_negatives_above_worst_relevant: hardNegativeRanks.filter((rank) => rank < worstRelevantRank).length,
      critical_ranks: query.critical_unit_ids.map((id) => rankOf.get(id)).sort((a, b) => a - b),
    };
  });
  const recallCurve = RECALL_K.map((k) => ({
    k,
    recall: perQuery.reduce((sum, q) => sum + q.relevant_ranks.filter((rank) => rank <= k).length / q.relevant_total, 0) / perQuery.length,
    queries_fully_recalled: perQuery.filter((q) => q.min_k_for_full_recall <= k).length,
  }));
  return {
    formula: "development-probe-full-rank-v1",
    queries: perQuery.length, units: unitCount,
    recall_curve: recallCurve,
    min_k_for_full_recall: {
      max: Math.max(...perQuery.map((q) => q.min_k_for_full_recall)),
      median: percentile(perQuery.map((q) => q.min_k_for_full_recall), 0.5),
      p95: percentile(perQuery.map((q) => q.min_k_for_full_recall), 0.95),
    },
    per_query: perQuery,
  };
};

const parseEmbedResponse = async (response, expectedCount) => {
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw Object.assign(new Error("Provider embed request did not return JSON HTTP 200."), {
      status: response.status, retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    });
  }
  const body = await response.json();
  const vectors = body?.embeddings?.float;
  const billedInputTokens = body?.meta?.billed_units?.input_tokens;
  requireValue(Array.isArray(vectors) && vectors.length === expectedCount
    && vectors.every((vector) => Array.isArray(vector) && vector.length === DIMENSION
      && vector.every((value) => Number.isFinite(value)) && vector.some((value) => value !== 0))
    && Number.isInteger(billedInputTokens) && billedInputTokens > 0, "response vector or billed-unit contract");
  return { vectors, billedInputTokens };
};

const requestEmbeddings = async ({ fetchImpl, apiKey, texts, inputType, pacer }) => {
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
  return { ...parsed, latencyMs: Math.round(performance.now() - startedAt) };
};

export const runDevelopmentProbe = async ({ root, apiKey, fetchImpl = globalThis.fetch, pacer = createEmbedPacer(), progress = () => {} }) => {
  requireValue(typeof apiKey === "string" && apiKey.length >= 12, "COHERE_API_KEY is not configured");
  const fixtures = loadEmbedFixtures(root);
  const queries = fixtures.queries.filter((query) => query.split === SPLIT);
  requireValue(queries.length === 20 && new Set(queries.map((q) => q.family)).size === 4
    && fixtures.queries.length === 120, "development split must be 4 families and 20 queries");
  requireValue(!queries.some((query) => query.split !== SPLIT), "gate query leaked into probe scoring");

  const documentVectors = [];
  let billedInputTokens = 0;
  for (let offset = 0; offset < fixtures.documents.length; offset += 96) {
    const batch = fixtures.documents.slice(offset, offset + 96);
    const response = await requestEmbeddings({ fetchImpl, apiKey, texts: batch.map((item) => item.text), inputType: "search_document", pacer });
    billedInputTokens += response.billedInputTokens;
    batch.forEach((item, index) => documentVectors.push({ ...item, vector: response.vectors[index] }));
  }
  const rows = [], latencies = [];
  for (const [index, query] of queries.entries()) {
    const response = await requestEmbeddings({ fetchImpl, apiKey, texts: [query.text], inputType: "search_query", pacer });
    billedInputTokens += response.billedInputTokens;
    latencies.push(response.latencyMs);
    rows.push({ query_id: query.id, ranking: rankUnits(response.vectors[0], documentVectors).map((hit) => ({ unit_id: hit.unit_id, score: hit.score })) });
    progress(index + 1, queries.length);
  }
  return {
    classification: CLASSIFICATION,
    contract: { model_id: MODEL_ID, dimension: DIMENSION, metric: "cosine", knn: "exact", retries: 0 },
    dataset: { fixture_set_hash: fixtures.fixtureSetHash, split: SPLIT, documents: fixtures.documents.length, queries: queries.length },
    summary: summarizeProbe({ queries, documents: documentVectors, rows }),
    latency: { samples: latencies.length, p50_ms: percentile(latencies, 0.5), p95_ms: percentile(latencies, 0.95) },
    usage: { billed_input_tokens: billedInputTokens, converted_cost_usd: embeddingCostUsd(billedInputTokens) },
  };
};

const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runDevelopmentProbe({
      root: process.env.TRUSTED_REPOSITORY ?? process.cwd(),
      apiKey: process.env.COHERE_API_KEY,
      progress: (done, total) => console.log(`development probe queries: ${done}/${total}`),
    });
    const curve = result.summary.recall_curve.map((point) => `k=${point.k} recall=${point.recall.toFixed(4)} full=${point.queries_fully_recalled}/${result.summary.queries}`);
    console.log(`development probe recall curve: ${curve.join(" | ")}`);
    console.log(`development probe minimum pool for full recall: max=${result.summary.min_k_for_full_recall.max} median=${result.summary.min_k_for_full_recall.median} p95=${result.summary.min_k_for_full_recall.p95}`);
    // The full record goes to the log as well, so a failed upload cannot lose it.
    console.log(JSON.stringify(result, null, 2));
    if (process.env.PROBE_OUTPUT_PATH) {
      mkdirSync(dirname(process.env.PROBE_OUTPUT_PATH), { recursive: true });
      writeFileSync(process.env.PROBE_OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
    }
    await exitWithFlushedLogs(0);
  } catch (error) {
    console.error(`development probe failed: ${error instanceof Error ? error.message : "unknown"}`);
    await exitWithFlushedLogs(1);
  }
}
