// B-RETRIEVAL-01의 Cohere Fast 호출 계약. 재시도하지 않고 과금 단위를 보존한다.
export const RERANK_MODEL = "rerank-v4.0-fast";
export const PRICE_PER_1000_SEARCH_UNITS_USD = 2;
export const MAX_DOCUMENTS = 40;
export const MAX_QUERY_BYTES = 8192;
export const MAX_DOCUMENT_BYTES = 32768;
export const MAX_TOKENS_PER_DOCUMENT = 4096;
export const REQUEST_INTERVAL_MS = 1100;
const ENDPOINT = "https://api.cohere.com/v2/rerank";

export const createRerankPacer = ({ now = () => performance.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) => {
  let nextStart = 0;
  return { async wait() { while (now() < nextStart) await sleep(nextStart - now()); nextStart = now() + REQUEST_INTERVAL_MS; } };
};

export const rerankCostUsd = (searchUnits) => {
  if (!Number.isSafeInteger(searchUnits) || searchUnits < 0) throw new Error("Rerank search units must be a non-negative integer.");
  return Number((searchUnits * PRICE_PER_1000_SEARCH_UNITS_USD / 1000).toFixed(9));
};

export const buildRerankRequest = (query, documents) => {
  if (typeof query !== "string" || query.length === 0 || Buffer.byteLength(query) > MAX_QUERY_BYTES
    || !Array.isArray(documents) || documents.length < 1 || documents.length > MAX_DOCUMENTS
    || documents.some((text) => typeof text !== "string" || text.length === 0 || Buffer.byteLength(text) > MAX_DOCUMENT_BYTES)) {
    throw new Error("Rerank request violates the preregistered input boundary.");
  }
  return { model: RERANK_MODEL, query, documents, top_n: documents.length, max_tokens_per_doc: MAX_TOKENS_PER_DOCUMENT };
};

export const parseRerankResponse = async (response, expectedCount) => {
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw Object.assign(new Error("Provider rerank request did not return JSON HTTP 200."), { status: response.status });
  }
  const body = await response.json();
  const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? body?.id;
  const searchUnits = body?.meta?.billed_units?.search_units;
  if (typeof requestId !== "string" || requestId.length < 8 || !Number.isSafeInteger(searchUnits) || searchUnits <= 0
    || !Array.isArray(body?.results) || body.results.length !== expectedCount) {
    throw new Error("Provider rerank response violates request ID, result count, or billed-unit contract.");
  }
  const scores = Array(expectedCount);
  const seen = new Set();
  for (const row of body.results) {
    if (!Number.isSafeInteger(row?.index) || row.index < 0 || row.index >= expectedCount || seen.has(row.index)
      || typeof row.relevance_score !== "number" || !Number.isFinite(row.relevance_score)
      || row.relevance_score < 0 || row.relevance_score > 1) {
      throw new Error("Provider rerank response contains an invalid or duplicate result.");
    }
    seen.add(row.index);
    scores[row.index] = row.relevance_score;
  }
  return { scores, searchUnits, requestId };
};

export const requestRerankFast = async ({ fetchImpl, apiKey, query, documents, pacer }) => {
  const payload = buildRerankRequest(query, documents);
  await pacer?.wait();
  const startedAt = performance.now();
  const response = await fetchImpl(ENDPOINT, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const parsed = await parseRerankResponse(response, documents.length);
  return { ...parsed, latencyMs: Math.round(performance.now() - startedAt),
    rateLimitHeadersObserved: [...response.headers.keys()].some((name) => name.toLowerCase().includes("ratelimit")) };
};
