import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { adrDecisionDigest, computeEvidenceScopeDigest, evidencePolicies, gitBlobSha } from "./provider-evidence.mjs";
import { validateEmbedEvidenceResult } from "./provider-embed-policy.mjs";
import { assertUnmeasuredGate, expandEmbedFixtures, scoreRankings } from "./provider-embed-evaluation.mjs";
import { buildEmbedRequest, cosineSimilarity, createEmbedPacer, embeddingCostUsd, evaluateRetrieval,
  exactKnn, FIXTURE_PATH, loadEmbedFixtures, percentile, retryAfterSeconds, runEmbedSpike } from "./provider-embed-spike.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = loadEmbedFixtures(root), gate = fixtures.queries.filter((q) => q.split === "gate");
assert.equal(fixtures.documents.length, 168); assert.equal(gate.length, 100);
assert.equal(fixtures.queries.filter((q) => q.split === "development").length, 20);
assert.equal(new Set(gate.flatMap((q) => q.hard_negative_unit_ids)).size, 40);
assert.equal(gate.filter((q) => q.risk_critical).length, 30);
assert.equal(gate.filter((q) => q.relevant_unit_ids.length === 1).length, 20);
const devFamilies = new Set(fixtures.queries.filter((q) => q.split === "development").map((q) => q.family));
assert.ok(gate.every((q) => !devFamilies.has(q.family)));
const fixture = JSON.parse(readFileSync(resolve(root, FIXTURE_PATH)));
const audit = { repository: "yongzooda/finshield", runId: 20, attempt: 1, fixtureBlob: "a".repeat(40),
  readJson: async (path) => path.includes("/runs?") ? { total_count: 1, workflow_runs: [{ id: 10, head_sha: "b".repeat(40) }] } : null };
assert.equal(await assertUnmeasuredGate(audit), 0);
await assert.rejects(assertUnmeasuredGate({ ...audit, attempt: 2 }), /rerun/);
await assert.rejects(assertUnmeasuredGate({ ...audit, readJson: async (path) => path.includes("/runs?")
  ? { total_count: 1, workflow_runs: [{ id: 10, head_sha: "b".repeat(40) }] } : { sha: "a".repeat(40) } }), /already dispatched/);
await assert.rejects(assertUnmeasuredGate({ ...audit, readJson: async () => { throw new Error("forbidden"); } }), /forbidden/);
await assert.rejects(assertUnmeasuredGate({ ...audit, readJson: async () => ({ total_count: 101, workflow_runs: [] }) }), /truncated/);
await assert.rejects(assertUnmeasuredGate({ ...audit, readJson: async () => ({ total_count: 1001, workflow_runs: [] }) }), /incomplete/);
for (const mutate of [
  (f) => f.cases[0].queries[0].relevant_units.push("u6"),
  (f) => f.cases[0].queries[0].relevant_units.push("u1"),
  (f) => f.cases[0].queries[0].relevant_units = [],
  (f) => f.cases[0].queries[0].relevant_units = ["unknown"],
  (f) => f.cases[14].queries[0].critical_units = ["u6"],
  (f) => f.cases[0].split = "development",
  (f) => f.cases[0].documents[1].text = f.cases[0].documents[0].text,
  (f) => f.cases[0].documents[1].evidence_unit = f.cases[0].documents[0].evidence_unit,
  (f) => f.cases[0].queries[4].relevant_units = ["u1", "u2", "u3", "u4", "u5"],
  (f) => f.cases[0].queries[0].text = "contact secret@example.com",
]) {
  const altered = structuredClone(fixture); mutate(altered); assert.throws(() => expandEmbedFixtures(altered), /Embedding evaluation/);
}
// The formerly mislabelled direct counter-evidence is now relevant. This is an
// authored semantic regression, not a claim that the schema can judge relevance.
for (const [family, phrase] of [["impersonation_v2", "발신번호"], ["broker", "승인 뒤"], ["channel", "광고"]]) {
  const doc = fixtures.documents.find((d) => d.family === family && d.text.includes(phrase));
  assert.ok(doc);
  for (const query of gate.filter((q) => q.family === family && q.relevant_unit_ids.length > 1)) {
    assert.ok(query.relevant_unit_ids.includes(doc.unit_id));
    assert.ok(!query.hard_negative_unit_ids.includes(doc.unit_id));
  }
}
assert.equal(retryAfterSeconds("60"), 60); assert.equal(retryAfterSeconds("Bearer secret-value"), null);
assert.equal(retryAfterSeconds("999999"), null);
assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5); assert.throws(() => percentile([], 0.95));
assert.equal(embeddingCostUsd(1000), 0.00012); assert.throws(() => embeddingCostUsd(-1));
assert.equal(cosineSimilarity([1, 0], [4, 0]), 1);
for (const vector of [[0, 0], [NaN, 0], [Infinity, 1], [1]]) assert.throws(() => cosineSimilarity(vector, [1, 0]));
assert.deepEqual(buildEmbedRequest(["합성 질의"], "search_query"), {
  model: "embed-v4.0", texts: ["합성 질의"], input_type: "search_query", embedding_types: ["float"], output_dimension: 1024, truncate: "NONE",
});

// Independently computed ratios, not the implementation's own aggregate oracle.
const query = { id: "query", relevant_unit_ids: ["a", "b", "c", "d", "e"], critical_unit_ids: ["a", "b"], risk_critical: true };
const docs = ["a", "b", "c", "d", "e", "x", "y", "z", "w"].map((id) => ({ id, unit_id: id }));
const row = (ids) => [{ query_id: "query", ranking: ids.map((id, index) => ({ document_id: id, unit_id: id, score: 1 - index / 10 })) }];
assert.deepEqual(scoreRankings({ queries: [query], documents: docs, rows: row(["a", "x", "y", "z", "w"]) }).quality,
  { top_k: 5, recall_at_5: 0.2, risk_core_recall_at_5: 0.5, precision_at_5: 0.2 });
assert.deepEqual(scoreRankings({ queries: [query], documents: docs, rows: row(["b", "c", "d", "e", "x"]) }).quality,
  { top_k: 5, recall_at_5: 0.8, risk_core_recall_at_5: 0.5, precision_at_5: 0.8 });
assert.equal(scoreRankings({ queries: [query], documents: docs, rows: row([]) }).quality.recall_at_5, 0);
assert.throws(() => scoreRankings({ queries: [], documents: docs, rows: [] }));
assert.throws(() => scoreRankings({ queries: [query], documents: docs, rows: [] }));
assert.throws(() => scoreRankings({ queries: [query], documents: docs, rows: row(["a", "a"]) }));
assert.throws(() => scoreRankings({ queries: [query], documents: docs, rows: row(["unknown"]) }));
let seed = 17;
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (let trial = 0; trial < 200; trial++) {
  const relevant = docs.slice(0, 1 + Math.floor(random() * 7)).map((d) => d.id);
  const ranked = [...docs].map((d) => ({ ...d, order: random() })).sort((a, b) => a.order - b.order).slice(0, 5).map((d) => d.id);
  const q = { ...query, relevant_unit_ids: relevant, critical_unit_ids: relevant.slice(0, 2) };
  const actual = scoreRankings({ queries: [q], documents: docs, rows: row(ranked) }).quality;
  let hits = 0, critical = 0;
  for (const id of ranked) { if (relevant.includes(id)) hits++; if (q.critical_unit_ids.includes(id)) critical++; }
  assert.equal(actual.recall_at_5, hits / relevant.length);
  assert.equal(actual.precision_at_5, hits / 5);
  assert.equal(actual.risk_core_recall_at_5, critical / q.critical_unit_ids.length);
}
const vectorDocs = docs.map((d, i) => ({ ...d, vector: [9 - i, i + 1] }));
const copied = [...vectorDocs, { ...vectorDocs[0], id: "copy-of-a" }];
assert.deepEqual(exactKnn([1, 0], copied).map((x) => x.unit_id), exactKnn([1, 0], vectorDocs).map((x) => x.unit_id));
assert.deepEqual(exactKnn([1, 0], vectorDocs.map((d, i) => ({ ...d, id: String(100 - i) }))).map((x) => x.unit_id),
  exactKnn([1, 0], vectorDocs).map((x) => x.unit_id));
assert.equal(evaluateRetrieval({ queries: [query], documentVectors: vectorDocs, queryVectors: [[1, 0]] }).quality.recall_at_5, 1);

// Explicit oracle transport mock: qrel-conditioned vectors test measurement
// plumbing only. Bad retrieval is tested separately; mock success is not quality.
const vectors = new Map();
gate.forEach((q, i) => { const v = Array(1024).fill(0); v[i] = 1; vectors.set(q.text, v); });
fixtures.documents.forEach((d, i) => {
  const v = Array(1024).fill(0);
  gate.forEach((q, j) => { if (q.relevant_unit_ids.includes(d.unit_id)) v[j] = 1; });
  v[gate.length + i] = 1; vectors.set(d.text, v);
});
let requests = 0, virtualNow = 0, waits = 0;
const pacer = createEmbedPacer({ now: () => virtualNow, sleep: async (ms) => { virtualNow += ms; waits++; } });
const fakeFetch = async (_url, options) => {
  requests++; assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
  assert.match(options.headers.Authorization, /^Bearer sk-test-not-real/);
  const request = JSON.parse(options.body); assert.equal(request.model, "embed-v4.0");
  return new Response(JSON.stringify({ id: `synthetic-request-${requests}`,
    embeddings: { float: request.texts.map((t) => vectors.get(t)) }, meta: { billed_units: { input_tokens: request.texts.length * 10 } } }),
  { status: 200, headers: { "content-type": "application/json" } });
};
const spike = await runEmbedSpike({ root, apiKey: "sk-test-not-real-key", fetchImpl: fakeFetch, pacer });
assert.equal(requests, 102); assert.equal(waits, 101); assert.equal(virtualNow, 111100);
assert.deepEqual(spike.observations.quality, { top_k: 5, recall_at_5: 1, risk_core_recall_at_5: 1, precision_at_5: 0.84 });
assert.equal(spike.observations.retrieval.counts.reduce((sum, r) => sum + r.relevant_hits, 0), 420);
const result = { observations: spike.observations, environment: {
  node_version: "v24.4.1", region: "github-hosted", fixture_set_hash: fixtures.fixtureSetHash,
  pricing_snapshot_date: "2026-09-04", pricing_source: "https://cohere.com/pricing",
  transport: "native-fetch", provider_request_ids_hash: spike.providerRequestIdsHash,
  api_version: "v2", official_text_input_limit_per_minute: 2000, request_interval_ms: 1100,
} };
const errorsFor = (r) => { const errors = []; validateEmbedEvidenceResult(r, (e) => errors.push(e)); return errors; };
assert.deepEqual(errorsFor(result), []);
for (const mutate of [
  (r) => r.observations.quality.recall_at_5 = 0.89,
  (r) => r.observations.quality.risk_core_recall_at_5 = 0.99,
  (r) => r.observations.quality.precision_at_5 = 0.79,
  (r) => r.observations.retrieval.rows.pop(),
  (r) => r.observations.retrieval.rows[1] = r.observations.retrieval.rows[0],
  (r) => r.observations.retrieval.rows[0].ranking[0].document_id = "unknown",
  (r) => r.observations.retrieval.rows[0].ranking[1] = r.observations.retrieval.rows[0].ranking[0],
  (r) => r.observations.retrieval.rows[0].ranking[0].score = NaN,
  (r) => r.observations.retrieval.rows[0].ranking[0].prompt = "must reject extra data",
  (r) => r.observations.retrieval.counts[0].relevant_hits = 999,
  (r) => r.observations.retrieval.slices[0].recall_at_5 = 0,
  (r) => r.observations.samples.queries[0].billed_input_tokens++,
  (r) => r.observations.samples.queries[1].query_id = r.observations.samples.queries[0].query_id,
  (r) => r.observations.samples.documents[0].input_count++,
  (r) => r.observations.latency.query_p95_ms = 1501,
  (r) => r.observations.contract.dimension = 768,
  (r) => r.observations.usage.calculated_cost_usd++,
  (r) => r.environment.fixture_set_hash = "0".repeat(64),
  (r) => r.observations.dataset.split = "development",
]) {
  const bad = structuredClone(result); mutate(bad); assert.ok(errorsFor(bad).length > 0);
}
// Correctly recomputed bad rankings still fail thresholds: never trust a success
// aggregate or an ID's alphabetical order in place of actual retrieval.
const bad = structuredClone(result);
bad.observations.retrieval.rows = gate.map((q) => ({ query_id: q.id, ranking: fixtures.documents.filter((d) => !q.relevant_unit_ids.includes(d.unit_id))
  .slice(0, 5).map((d) => ({ document_id: d.id, unit_id: d.unit_id, score: 1 })) }));
const recomputed = scoreRankings({ queries: gate, documents: fixtures.documents, rows: bad.observations.retrieval.rows });
bad.observations.quality = recomputed.quality; bad.observations.retrieval.counts = recomputed.counts;
bad.observations.retrieval.slices = recomputed.slices;
assert.ok(errorsFor(bad).some((e) => e.includes("Recall@5")));
const noWait = { wait: async () => {} };
await assert.rejects(runEmbedSpike({ root, apiKey: "", fetchImpl: fakeFetch, pacer: noWait }), /COHERE_API_KEY/);
let limited = 0;
await assert.rejects(runEmbedSpike({ root, apiKey: "sk-test-not-real-key", pacer: noWait, fetchImpl: async () => {
  limited++; return new Response("secret untrusted body", { status: 429, headers: { "retry-after": "60" } });
} }), (e) => e.status === 429 && e.retryAfterSeconds === 60);
assert.equal(limited, 1);
await assert.rejects(runEmbedSpike({ root, apiKey: "sk-test-not-real-key", pacer: noWait, fetchImpl: async () =>
  new Response(JSON.stringify({ id: "synthetic-id", embeddings: { float: [[1, 0]] }, meta: { billed_units: { input_tokens: 1 } } }),
    { status: 200, headers: { "content-type": "application/json" } }) }), /dimension/);

// Commit-bound runner validation in a disposable repository, never overwrite a
// user's evidence-output/result.json or depend on uncommitted parent scope.
const temporary = realpathSync(mkdtempSync(resolve(tmpdir(), "finshield-embed-test-")));
try {
  const policy = evidencePolicies["B-EMBED-01"];
  for (const path of [...policy.scopePaths, "docs/02-integrated-requirements.md", "docs/adr/001-p0-provider-stack.md"]) {
    mkdirSync(dirname(resolve(temporary, path)), { recursive: true }); copyFileSync(resolve(root, path), resolve(temporary, path));
  }
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: temporary, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git("init", "-q"); git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  const revision = git("rev-parse", "HEAD");
  const runnerResult = { schema_version: 3, blocker_id: "B-EMBED-01",
    requirements_blob_sha: gitBlobSha(readFileSync(resolve(temporary, "docs/02-integrated-requirements.md"))),
    adr_decision_sha256: adrDecisionDigest(readFileSync(resolve(temporary, "docs/adr/001-p0-provider-stack.md"), "utf8")),
    code_under_test_sha: revision, workflow_head_sha: revision,
    scope_sha256: computeEvidenceScopeDigest(temporary, policy, (e) => assert.fail(e)),
    run: { id: 777, attempt: 1 }, ...result, redactions_applied: true };
  mkdirSync(resolve(temporary, "evidence-output"));
  const output = resolve(temporary, "evidence-output/result.json");
  writeFileSync(output, JSON.stringify(runnerResult));
  assert.ok(readFileSync(output).byteLength < 512 * 1024);
  const env = { ...process.env, BLOCKER_ID: "B-EMBED-01", CODE_UNDER_TEST_SHA: revision, WORKFLOW_HEAD_SHA: revision,
    TRUSTED_REPOSITORY: temporary, GITHUB_RUN_ID: "777", GITHUB_RUN_ATTEMPT: "1" };
  const validate = () => spawnSync(process.execPath, [resolve(root, ".github/scripts/run-provider-embed-evidence.mjs"), "--validate"],
    { cwd: temporary, env, encoding: "utf8" });
  let run = validate(); assert.equal(run.status, 0, run.stdout + run.stderr);
  runnerResult.observations.quality.precision_at_5 = 1; writeFileSync(output, JSON.stringify(runnerResult));
  run = validate(); assert.notEqual(run.status, 0);
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log("Embedding v2 tests passed: 100 gate / 20 development queries; 200 metric oracle trials; qrel, rank, trace, split, billing and provenance mutations. No Live calls.");
