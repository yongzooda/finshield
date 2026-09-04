import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createEmbedPacer, loadEmbedFixtures } from "./provider-embed-spike.mjs";
import { CLASSIFICATION, RECALL_K, rankUnits, runDevelopmentProbe, summarizeProbe } from "./provider-embed-development-probe.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
let checks = 0;
const assert = (condition, message) => { checks++; if (!condition) { console.error(`FAIL: ${message}`); process.exit(1); } };
const rejects = async (run, message) => {
  try { await run(); } catch { checks++; return; }
  console.error(`FAIL: ${message}`); process.exit(1);
};

// 1. rankUnits: full ordering, unit de-duplication, deterministic tie-break.
{
  const documents = [
    { id: "d1", unit_id: "u-b", vector: [1, 0] },
    { id: "d2", unit_id: "u-a", vector: [1, 0] },
    { id: "d3", unit_id: "u-b", vector: [1, 0] },
    { id: "d4", unit_id: "u-c", vector: [0, 1] },
  ];
  const ranked = rankUnits([1, 0], documents);
  assert(ranked.length === 3, "rankUnits must de-duplicate by unit and keep every distinct unit");
  assert(ranked[0].unit_id === "u-a" && ranked[1].unit_id === "u-b", "equal scores must tie-break by unit id");
  assert(ranked[2].unit_id === "u-c" && ranked[2].score < ranked[1].score, "lower cosine must rank last");
}

// 2. summarizeProbe recall curve and minimum pool size against a hand oracle.
{
  const documents = Array.from({ length: 8 }, (_, index) => ({ id: `d${index}`, unit_id: `u${index}` }));
  const queries = [{
    id: "q1", family: "dev", split: "development",
    relevant_unit_ids: ["u0", "u6"], critical_unit_ids: ["u6"], hard_negative_unit_ids: ["u1"],
  }];
  const rows = [{ query_id: "q1", ranking: documents.map((doc, index) => ({ unit_id: doc.unit_id, score: 1 - index / 10 })) }];
  const summary = summarizeProbe({ queries, documents, rows });
  const query = summary.per_query[0];
  assert(query.relevant_ranks.join() === "1,7", "relevant ranks must be 1-based positions in the full ranking");
  assert(query.min_k_for_full_recall === 7, "minimum pool size must equal the worst relevant rank");
  assert(query.hard_negatives_above_worst_relevant === 1, "hard negatives above the worst relevant unit must be counted");
  assert(query.critical_ranks.join() === "7", "critical ranks must be reported separately");
  const at5 = summary.recall_curve.find((point) => point.k === 5);
  const at7 = summary.recall_curve.find((point) => point.k === 7);
  assert(at5.recall === 0.5 && at5.queries_fully_recalled === 0, "recall at 5 must count only the first relevant unit");
  assert(at7.recall === 1 && at7.queries_fully_recalled === 1, "recall at 7 must recover both relevant units");
  assert(summary.recall_curve.map((point) => point.k).join() === RECALL_K.join(), "recall curve must use the fixed k list");
  assert(summary.formula === "development-probe-full-rank-v1", "summary must carry its formula version");
}

// 3. Scoring contract failures are fail-closed.
{
  const documents = [{ id: "d0", unit_id: "u0" }, { id: "d1", unit_id: "u1" }];
  const ranking = documents.map((doc, index) => ({ unit_id: doc.unit_id, score: 1 - index / 10 }));
  const base = { id: "q1", family: "dev", split: "development", relevant_unit_ids: ["u0"], critical_unit_ids: [], hard_negative_unit_ids: [] };
  const mutations = [
    ["gate query scored", { queries: [{ ...base, split: "gate" }], documents, rows: [{ query_id: "q1", ranking }] }],
    ["row count mismatch", { queries: [base], documents, rows: [] }],
    ["duplicate rows", { queries: [base, { ...base, id: "q2" }], documents, rows: [{ query_id: "q1", ranking }, { query_id: "q1", ranking }] }],
    ["truncated ranking", { queries: [base], documents, rows: [{ query_id: "q1", ranking: ranking.slice(0, 1) }] }],
    ["unknown relevant unit", { queries: [{ ...base, relevant_unit_ids: ["u9"] }], documents, rows: [{ query_id: "q1", ranking }] }],
    ["empty relevance set", { queries: [{ ...base, relevant_unit_ids: [] }], documents, rows: [{ query_id: "q1", ranking }] }],
  ];
  for (const [name, input] of mutations) {
    let failed = false;
    try { summarizeProbe(input); } catch { failed = true; }
    assert(failed, `summarizeProbe must reject ${name}`);
  }
}

// 4. Live path against a deterministic fake provider.
const vectorFor = (text) => {
  const seed = createHash("sha256").update(text).digest();
  return Array.from({ length: 1024 }, (_, index) => (seed[index % seed.length] - 128) / 128 + (index === 0 ? 0.5 : 0));
};
const fakeProvider = ({ status = 200, dimension = 1024, billed = 7, zero = false, json = true } = {}) => {
  const sent = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    return {
      status,
      headers: new Headers({ "content-type": json ? "application/json" : "text/plain" }),
      json: async () => ({
        embeddings: { float: body.texts.map((text) => zero ? new Array(dimension).fill(0) : vectorFor(text).slice(0, dimension)) },
        meta: { billed_units: { input_tokens: billed } },
      }),
    };
  };
  return { fetchImpl, sent };
};
// Virtual clock: the pacer must advance, and no test may spend real wall time waiting.
const fastPacer = () => {
  let clock = 0;
  return createEmbedPacer({ now: () => clock, sleep: async (ms) => { clock += Math.max(ms, 1); } });
};

{
  const { fetchImpl, sent } = fakeProvider();
  const result = await runDevelopmentProbe({ root, apiKey: "test-key-0123456789", fetchImpl, pacer: fastPacer() });
  const fixtures = loadEmbedFixtures(root);
  const gateTexts = new Set(fixtures.queries.filter((q) => q.split === "gate").map((q) => q.text));
  const queryTexts = sent.filter((body) => body.input_type === "search_query").flatMap((body) => body.texts);
  assert(sent.length === Math.ceil(fixtures.documents.length / 96) + 20, "probe must embed every document batch and exactly 20 development queries");
  assert(queryTexts.length === 20 && !queryTexts.some((text) => gateTexts.has(text)), "gate holdout queries must never reach the provider");
  assert(sent.every((body) => body.model === "embed-v4.0" && body.output_dimension === 1024 && body.embedding_types.join() === "float"),
    "probe must keep the fixed embedding contract");
  assert(result.classification === CLASSIFICATION && !JSON.stringify(result).includes("PASS"), "probe output must never claim adoption evidence");
  assert(result.summary.queries === 20 && result.summary.units === 168, "probe must score 20 queries over the full 168 unit corpus");
  assert(result.summary.per_query.every((q) => q.relevant_ranks.length === q.relevant_total
    && q.min_k_for_full_recall >= 1 && q.min_k_for_full_recall <= 168), "per query ranks must stay inside the corpus");
  assert(result.usage.billed_input_tokens === sent.length * 7 && result.usage.converted_cost_usd > 0, "billed tokens must be summed from real responses");
  assert(result.latency.samples === 20 && result.latency.p95_ms >= 0, "probe must record per query latency samples");
  const curve = result.summary.recall_curve;
  assert(curve.every((point, index) => index === 0 || point.recall >= curve[index - 1].recall), "recall curve must be monotonic in k");
}

// 5. Provider contract violations fail without retry.
{
  for (const [name, options] of [
    ["non-200 status", { status: 429 }],
    ["non-JSON content type", { json: false }],
    ["wrong dimension", { dimension: 512 }],
    ["zero vector", { zero: true }],
    ["missing billed units", { billed: 0 }],
  ]) {
    const { fetchImpl, sent } = fakeProvider(options);
    await rejects(() => runDevelopmentProbe({ root, apiKey: "test-key-0123456789", fetchImpl, pacer: fastPacer() }),
      `probe must fail closed on ${name}`);
    assert(sent.length === 1, `probe must not retry after ${name}`);
  }
  await rejects(() => runDevelopmentProbe({ root, apiKey: "short", fetchImpl: fakeProvider().fetchImpl, pacer: fastPacer() }),
    "probe must reject a missing or malformed API key");
}

console.log(`Development probe contract tests passed: ${checks} assertions, 20 development queries, 168 unit corpus. No Live calls.`);
