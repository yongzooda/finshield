import "server-only";
import { createHash } from "node:crypto";
import { gateForModel } from "@/lib/agents/pii";
import type { ToolCallContext } from "./tools/runtime";

const EMBED = "embed-v4.0";
const FAST = "rerank-v4.0-fast";
const PRICING = "cohere-text-usd-20260907";
const MAX_RESPONSE = 1024 * 1024;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export class RetrievalProviderError extends Error { constructor(readonly code: string) { super(code); } }

async function jsonBounded(response: Response) {
  if (!response.body || !response.headers.get("content-type")?.includes("application/json")) throw new RetrievalProviderError("RETRIEVAL_RESPONSE_INVALID");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > MAX_RESPONSE) throw new RetrievalProviderError("RETRIEVAL_RESPONSE_TOO_LARGE"); chunks.push(value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** E-010·N-OPS-003: 모든 Cohere 호출은 전체/Provider별 비용 예약 뒤 단 한 번 전송한다. */
async function callCohere(model: typeof EMBED | typeof FAST, payload: Record<string, unknown>, estimate: number, ctx: ToolCallContext) {
  const key = process.env.COHERE_API_KEY;
  if (!key) throw new RetrievalProviderError("RETRIEVAL_PROVIDER_NOT_CONFIGURED");
  ctx.signal?.throwIfAborted();
  const sql = ctx.sql;
  const [reservation] = ctx.aftercareJobId
    ? await sql`select private.reserve_precase_usage(${ctx.ownerId}::uuid,${ctx.caseId}::uuid,${ctx.aftercareJobId}::uuid,'cohere',${model},${PRICING},${estimate}::bigint) as id`
    : await sql`select private.reserve_finshield_retrieval_usage(${ctx.ownerId}::uuid,${ctx.caseId}::uuid,${ctx.runId}::uuid,${model},${PRICING},${estimate}::bigint) as id`;
  let sent = false, settled = false; const started = Date.now();
  try {
    ctx.signal?.throwIfAborted();
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
    sent = true;
    const response = await fetch(`https://api.cohere.com/v2/${model === EMBED ? "embed" : "rerank"}`, {
      method: "POST", redirect: "error", signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!response.ok) {
      // 명확한 거절만 해제하고 timeout·5xx·불명확한 응답은 예약을 보존한다.
      if ([400, 401, 403, 404, 413, 422, 429, 498].includes(response.status)) {
        await sql`select private.release_usage_budget(${reservation.id}::uuid,'PROVIDER_NOT_BILLED')`; settled = true;
      }
      throw new RetrievalProviderError(response.status === 429 ? "RETRIEVAL_RATE_LIMITED" : "RETRIEVAL_PROVIDER_REJECTED");
    }
    const body = await jsonBounded(response);
    const units = model === EMBED ? body?.meta?.billed_units?.input_tokens : body?.meta?.billed_units?.search_units;
    const id = body?.id ?? response.headers.get("x-request-id");
    if (!Number.isSafeInteger(units) || units < 0 || typeof id !== "string" || !id) throw new RetrievalProviderError("RETRIEVAL_USAGE_UNKNOWN");
    const cost = Math.ceil(units * (model === EMBED ? .12 : 2000));
    await sql`select id from private.settle_usage_budget(${reservation.id}::uuid,${cost}::bigint,
      ${JSON.stringify({ input_tokens: model === EMBED ? units : 0, output_tokens: 0, elapsed_ms: Date.now() - started, status_category: "OK", retry_count: 0, provider_request_ref: sha(id) })}::text::jsonb)`;
    settled = true;
    return body;
  } catch (error) {
    if (!settled) {
      if (!sent) await sql`select private.release_usage_budget(${reservation.id}::uuid,'REQUEST_NOT_SENT')`;
      else await sql`select private.flag_usage_reconciliation(${reservation.id}::uuid,'PROVIDER_RESULT_UNKNOWN')`;
    }
    if (error instanceof RetrievalProviderError) throw error;
    throw new RetrievalProviderError(ctx.signal?.aborted ? "RETRIEVAL_CANCELLED" : "RETRIEVAL_PROVIDER_UNCONFIRMED");
  }
}
function maskedQuery(query: string) {
  if (!query || Buffer.byteLength(query) > 8192) throw new RetrievalProviderError("RETRIEVAL_INPUT_INVALID");
  const gate = gateForModel(query);
  if (!gate.ok) throw new RetrievalProviderError("RETRIEVAL_PII_BLOCKED");
  return gate.masked.text;
}
export async function embedQuery(query: string, ctx: ToolCallContext): Promise<number[]> {
  const text = maskedQuery(query);
  const body = await callCohere(EMBED, { model: EMBED, texts: [text], input_type: "search_query", embedding_types: ["float"], output_dimension: 1024, truncate: "NONE" }, Math.max(1, Math.ceil((Buffer.byteLength(text) + 128) * .12)), ctx);
  const vector = body?.embeddings?.float?.[0];
  if (!Array.isArray(vector) || body.embeddings.float.length !== 1 || vector.length !== 1024 || vector.some(v => typeof v !== "number" || !Number.isFinite(v)) || vector.every(v => v === 0)) throw new RetrievalProviderError("RETRIEVAL_VECTOR_INVALID");
  return vector;
}

/** 승인된 Fast 개발 후보에만 사용한다. 제품 기본 Rerank를 조용히 바꾸지 않는다. */
export async function rerankFast(query: string, documents: string[], ctx: ToolCallContext): Promise<number[]> {
  if (process.env.VERCEL_ENV === "production" || process.env.FINSHIELD_RERANK_FAST_DEVELOPMENT !== "1" || !process.env.FINSHIELD_PROBE_OWNER_ID || ctx.ownerId !== process.env.FINSHIELD_PROBE_OWNER_ID) throw new RetrievalProviderError("RERANK_DEVELOPMENT_ONLY");
  if (Buffer.byteLength(query) > 512 || documents.length < 1 || documents.length > 40 || documents.some(d => !d || Buffer.byteLength(d) > 3000)) throw new RetrievalProviderError("RERANK_INPUT_INVALID");
  const texts = documents.map(maskedQuery);
  const queryText = maskedQuery(query);
  // Keyword 20 + Vector 20 합집합을 보존하고 마스킹 뒤에도 청구 단위 경계를 검사한다.
  if (Buffer.byteLength(queryText) > 512 || texts.some(text => Buffer.byteLength(text) > 3000 || Buffer.byteLength(text) + Buffer.byteLength(queryText) > 4092)) throw new RetrievalProviderError("RERANK_INPUT_INVALID");
  const body = await callCohere(FAST, { model: FAST, query: queryText, documents: texts, top_n: texts.length, max_tokens_per_doc: 4096 }, 2000, ctx);
  if (!Array.isArray(body.results) || body.results.length !== texts.length) throw new RetrievalProviderError("RERANK_RESULT_INVALID");
  const scores = Array<number>(texts.length); const seen = new Set<number>();
  for (const row of body.results) {
    if (!Number.isSafeInteger(row.index) || row.index < 0 || row.index >= texts.length || seen.has(row.index) || typeof row.relevance_score !== "number" || !Number.isFinite(row.relevance_score) || row.relevance_score < 0 || row.relevance_score > 1) throw new RetrievalProviderError("RERANK_RESULT_INVALID");
    seen.add(row.index); scores[row.index] = row.relevance_score;
  }
  return scores;
}
