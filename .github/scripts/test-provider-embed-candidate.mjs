// ============================================================
// B-EMBED-01 재정의 평가 계약의 오프라인 시험
//
// Provider 를 호출하지 않는다. v3 fixture 가 사전등록 계약을 지키는지와,
// 조작된 fixture·순위를 채점기가 실제로 거부하는지를 확인한다.
//
// 통과 로그만 세지 않는다. 거부되어야 할 입력이 통과하면 실패시킨다.
// ============================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_POOL_K, COVERAGE_TAGS, FIXTURE_PATH, FORMULA_VERSION,
  expandCandidateFixtures, loadCandidateFixtures, scoreCandidatePools,
} from "./provider-embed-candidate-evaluation.mjs";
import { FIXTURE_PATH as V2_FIXTURE_PATH } from "./provider-embed-evaluation.mjs";
import { runCandidateSpike } from "./provider-embed-candidate-spike.mjs";
import { validateEmbedEvidenceResult } from "./provider-embed-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const clone = (value) => JSON.parse(JSON.stringify(value));
const raw = JSON.parse(readFileSync(resolve(root, FIXTURE_PATH), "utf8"));
const rejects = (mutate, pattern) => {
  const broken = clone(raw);
  mutate(broken);
  assert.throws(() => expandCandidateFixtures(broken), pattern);
};

// ---- 1. 사전등록 계약 ----
const fixtures = loadCandidateFixtures(root);
const gate = fixtures.queries.filter((query) => query.split === "gate");
const development = fixtures.queries.filter((query) => query.split === "development");

assert.equal(FORMULA_VERSION, "candidate-pool-unit-recall-v3");
assert.equal(CANDIDATE_POOL_K, 20);
assert.equal(fixtures.documents.length, 168);
assert.equal(gate.length, 100);
assert.equal(development.length, 20);
assert.equal(gate.filter((query) => query.risk_critical).length, 30);
assert.equal(gate.filter((query) => query.relevant_unit_ids.length === 1).length, 20);
assert.equal(gate.filter((query) => query.relevant_unit_ids.length === 5).length, 80);
assert.ok(new Set(gate.flatMap((query) => query.hard_negative_unit_ids)).size >= 30);
for (const tag of COVERAGE_TAGS) assert.ok(gate.some((query) => query.coverage.includes(tag)), tag);

// 후보 풀은 corpus 보다 충분히 작아야 한다. 그렇지 않으면 Recall 이 자동으로
// 1.00 이 되어 합격식이 아무것도 검증하지 못한다.
assert.ok(CANDIDATE_POOL_K * 4 <= fixtures.documents.length);

// 개발 split 가족과 gate 가족이 겹치지 않는다.
const devFamilies = new Set(development.map((query) => query.family));
assert.ok(gate.every((query) => !devFamilies.has(query.family)));

// v2 와 시나리오 가족·문장이 겹치지 않는다. 노출된 셋을 재사용하지 않는다는
// 재정의 계획의 약속을 코드로 확인한다.
const v2 = JSON.parse(readFileSync(resolve(root, V2_FIXTURE_PATH), "utf8"));
const v2Families = new Set(v2.cases.map((item) => item.id));
assert.ok(raw.cases.every((item) => !v2Families.has(item.id)), "v2 가족 재사용");
const v2Texts = new Set(v2.cases.flatMap((item) => [
  ...item.documents.map((doc) => doc.text.normalize("NFKC")),
  ...item.queries.map((query) => query.text.normalize("NFKC")),
]));
const v3Texts = raw.cases.flatMap((item) => [
  ...item.documents.map((doc) => doc.text.normalize("NFKC")),
  ...item.queries.map((query) => query.text.normalize("NFKC")),
]);
assert.ok(v3Texts.every((value) => !v2Texts.has(value)), "v2 문장 재사용");

// ---- 2. fixture 변형 거부 ----
rejects((f) => { f.schema_version = 2; }, /preregistration schema/);
rejects((f) => { f.fixture_set = "finshield-korean-finance-embed-v2"; }, /preregistration schema/);
rejects((f) => { f.status = "measured"; }, /preregistration schema/);
rejects((f) => { f.cases.pop(); }, /preregistration schema/);
rejects((f) => { f.cases[0].documents.pop(); }, /scenario schema/);
rejects((f) => { f.cases[0].queries.pop(); }, /scenario schema/);
rejects((f) => { f.cases[1].id = f.cases[0].id; }, /family overlap/);
rejects((f) => { f.cases[0].coverage = ["not_a_tag"]; }, /scenario schema/);
rejects((f) => { f.cases[0].documents[1].text = f.cases[0].documents[0].text; }, /duplicate text/);
rejects((f) => { f.cases[0].documents[0].source_family = "synthetic-other"; }, /invalid document/);
rejects((f) => { f.cases[0].documents[0].evidence_unit = "other-1"; }, /invalid document/);

// 위험 가족의 critical 을 비우면 분모가 사라진다. 위험 질문을 조용히 빼는
// 가장 쉬운 방법이므로 반드시 거부해야 한다.
rejects((f) => {
  const risky = f.cases.find((item) => item.risk_critical);
  risky.queries[0].critical_units = [];
}, /critical subset violation/);

// 관련 unit 을 hard negative 로도 표시하면 채점이 무의미해진다.
rejects((f) => {
  const item = f.cases[0];
  item.queries[0].hard_negative_units = [item.queries[0].relevant_units[0], "u7"];
}, /qrel contradiction/);

// hard negative 를 지우면 어려운 오답이 사라져 합격이 쉬워진다.
rejects((f) => { f.cases[0].queries[0].hard_negative_units = ["u6"]; }, /qrel contradiction/);

// 표본 수를 줄이는 변형.
rejects((f) => {
  const gateCase = f.cases.find((item) => item.split === "gate");
  gateCase.split = "development";
}, /gate sample counts/);
rejects((f) => {
  const risky = f.cases.find((item) => item.risk_critical);
  risky.risk_critical = false;
  for (const query of risky.queries) query.critical_units = [];
}, /gate sample counts/);

// focused/multi 구성 변형.
rejects((f) => {
  const gateCase = f.cases.find((item) => item.split === "gate");
  gateCase.queries[4].relevant_units = ["u1", "u2", "u3", "u4", "u5"];
}, /focused\/multi-facet split/);

// 합성 데이터 경계.
rejects((f) => { f.cases[0].documents[0].text = "문의는 test.user@example.com 으로 보낸다."; },
  /synthetic data boundary/);
rejects((f) => { f.cases[0].documents[0].text = "주민등록번호 900101-1234567 을 제출한다."; },
  /synthetic data boundary/);

// ---- 3. 채점기 ----
const docs = fixtures.documents;
const unitToDoc = new Map(docs.map((doc) => [doc.unit_id, doc]));
const poolFor = (query, extra = []) => {
  const units = [...query.relevant_unit_ids, ...extra].slice(0, CANDIDATE_POOL_K);
  return units.map((unitId, index) => ({
    document_id: unitToDoc.get(unitId).id, unit_id: unitId, score: 0.9 - index * 0.01,
  }));
};
const fillerUnits = docs.filter((doc) => doc.split === "development").map((doc) => doc.unit_id);
const fillers = fillerUnits.slice(0, 7);
// 관련 unit 과 겹치지 않는 서로 다른 unit 으로 정확히 K+1 개를 채운다.
const oversizedPool = (query) => {
  const units = [...query.relevant_unit_ids];
  for (const unitId of fillerUnits) {
    if (units.length > CANDIDATE_POOL_K) break;
    if (!units.includes(unitId)) units.push(unitId);
  }
  return units.map((unitId, index) => ({
    document_id: unitToDoc.get(unitId).id, unit_id: unitId, score: 0.9 - index * 0.001,
  }));
};

// 모든 관련 unit 을 담은 완전 회수.
const perfect = scoreCandidatePools({
  queries: gate, documents: docs,
  rows: gate.map((query) => ({ query_id: query.id, ranking: poolFor(query) })),
});
assert.equal(perfect.quality.recall_at_pool, 1);
assert.equal(perfect.quality.risk_core_recall_at_pool, 1);
assert.equal(perfect.quality.queries_fully_covered, 100);
assert.equal(perfect.quality.pool_k, 20);
assert.ok(perfect.quality.worst_minimum_k <= 5);

// 한 질문에서 관련 unit 하나를 빼면 Recall 이 1.00 아래로 내려간다.
const dropped = scoreCandidatePools({
  queries: gate, documents: docs,
  rows: gate.map((query, index) => ({
    query_id: query.id,
    ranking: index === 0 ? poolFor(query).slice(1) : poolFor(query),
  })),
});
assert.ok(dropped.quality.recall_at_pool < 1);
assert.equal(dropped.quality.queries_fully_covered, 99);
assert.equal(dropped.quality.worst_minimum_k, null);

// 풀 크기를 넘기면 거부한다. 풀을 늘려 Recall 을 올리는 우회를 막는다.
assert.throws(() => scoreCandidatePools({
  queries: gate, documents: docs,
  rows: gate.map((query) => ({ query_id: query.id, ranking: oversizedPool(query) })),
}), /oversized candidate pool/);

// 같은 unit 을 반복해 적중을 부풀리는 시도.
assert.throws(() => scoreCandidatePools({
  queries: gate, documents: docs,
  rows: gate.map((query) => {
    const pool = poolFor(query);
    return { query_id: query.id, ranking: [...pool, { ...pool[0], score: 0.5 }] };
  }),
}), /duplicate unit/);

// 점수 내림차순이 아닌 순위.
assert.throws(() => scoreCandidatePools({
  queries: gate, documents: docs,
  rows: gate.map((query) => {
    const pool = poolFor(query);
    return { query_id: query.id, ranking: [{ ...pool[0], score: 0.1 }, { ...pool[1], score: 0.9 }] };
  }),
}), /invalid score order/);

// document 와 unit 의 연결이 어긋난 순위.
assert.throws(() => scoreCandidatePools({
  queries: gate, documents: docs,
  rows: gate.map((query) => {
    const pool = poolFor(query);
    return { query_id: query.id, ranking: [{ ...pool[0], unit_id: fillers[0] }] };
  }),
}), /unknown\/duplicate unit/);

// 질문을 빠뜨린 결과.
assert.throws(() => scoreCandidatePools({
  queries: gate, documents: docs,
  rows: gate.slice(1).map((query) => ({ query_id: query.id, ranking: poolFor(query) })),
}), /complete unique query rows/);

// 위험 분모가 없는 질문 집합.
assert.throws(() => scoreCandidatePools({
  queries: gate.filter((query) => !query.risk_critical), documents: docs,
  rows: gate.filter((query) => !query.risk_critical)
    .map((query) => ({ query_id: query.id, ranking: poolFor(query) })),
}), /risk denominator/);

// hard negative 가 풀에 들어오는 것 자체는 실패가 아니다. 1차 후보 생성은
// 회수가 목적이고 대상 판별은 Rerank 단계의 책임이다. 다만 관측값으로 남는다.
const withNegatives = scoreCandidatePools({
  queries: gate, documents: docs,
  rows: gate.map((query) => ({
    query_id: query.id,
    ranking: poolFor(query, query.hard_negative_unit_ids),
  })),
});
assert.equal(withNegatives.quality.recall_at_pool, 1);
assert.ok(withNegatives.counts.every((row) => row.hard_negative_hits === 2));

// slice 는 focused/multi, 가족, coverage 를 모두 나눠 보여준다.
const sliceNames = new Set(perfect.slices.map((slice) => slice.slice));
assert.ok(sliceNames.has("focused") && sliceNames.has("multi_facet"));
assert.ok(COVERAGE_TAGS.every((tag) => sliceNames.has(`coverage:${tag}`)));
assert.equal(perfect.slices.filter((slice) => slice.slice.startsWith("family:")).length, 20);

console.log("B-EMBED-01 재정의 평가 계약 시험을 통과했습니다.");

// ---- 4. harness 와 정책 (Live 호출 없음) ----
// 결정적 가짜 벡터로 Provider 를 대신한다. 관련 unit 은 질의와 가깝게, hard
// negative 는 그 다음, 나머지는 멀게 배치해 후보 풀 동작만 검사한다.
const DIMENSION = 1024;
const unitAxis = new Map([...new Set(docs.map((doc) => doc.unit_id))].map((unitId, index) => [unitId, index]));
const unitVector = (unitId) => {
  const vector = new Array(DIMENSION).fill(0.001);
  vector[unitAxis.get(unitId) % DIMENSION] = 1;
  return vector;
};
const queryVector = (query) => {
  const vector = new Array(DIMENSION).fill(0.001);
  for (const unitId of query.relevant_unit_ids) vector[unitAxis.get(unitId) % DIMENSION] = 1;
  for (const unitId of query.hard_negative_unit_ids) vector[unitAxis.get(unitId) % DIMENSION] = 0.6;
  return vector;
};
const vectorFor = new Map([
  ...docs.map((doc) => [doc.text, unitVector(doc.unit_id)]),
  ...gate.map((query) => [query.text, queryVector(query)]),
]);

let requests = 0;
let virtualClock = 0;
const pacer = { async wait() { virtualClock += 1100; requests += 0; } };
const fakeFetch = async (url, options) => {
  requests += 1;
  assert.equal(url, "https://api.cohere.com/v2/embed");
  assert.match(options.headers.Authorization, /^Bearer sk-test-not-real/);
  const request = JSON.parse(options.body);
  assert.equal(request.model, "embed-v4.0");
  assert.equal(request.output_dimension, DIMENSION);
  return new Response(JSON.stringify({
    id: `synthetic-request-${requests}`,
    embeddings: { float: request.texts.map((text) => vectorFor.get(text)) },
    meta: { billed_units: { input_tokens: request.texts.length * 10 } },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const spike = await runCandidateSpike({ root, apiKey: "sk-test-not-real-key", fetchImpl: fakeFetch, pacer });
assert.equal(requests, 102);
assert.equal(spike.observations.contract.pool_k, CANDIDATE_POOL_K);
assert.equal(spike.observations.quality.recall_at_pool, 1);
assert.equal(spike.observations.quality.risk_core_recall_at_pool, 1);
assert.equal(spike.observations.quality.queries_fully_covered, 100);
assert.equal(spike.observations.dataset.fixture_set, "finshield-korean-finance-embed-v3");
assert.equal(spike.observations.usage.provider_requests, 102);
assert.equal(spike.observations.usage.embedded_inputs, 268);

const result = {
  observations: spike.observations,
  environment: {
    node_version: "v24.4.1", region: "github-hosted", fixture_set_hash: fixtures.fixtureSetHash,
    pricing_snapshot_date: "2026-09-04", pricing_source: "https://cohere.com/pricing",
    transport: "native-fetch", provider_request_ids_hash: spike.providerRequestIdsHash,
    api_version: "v2", official_text_input_limit_per_minute: 2000, request_interval_ms: 1100,
  },
};
const errorsFor = (candidate) => {
  const errors = [];
  validateEmbedEvidenceResult(candidate, (message) => errors.push(message));
  return errors;
};
assert.deepEqual(errorsFor(result), []);

for (const mutate of [
  (r) => { r.observations.quality.recall_at_pool = 0.99; },
  (r) => { r.observations.quality.risk_core_recall_at_pool = 0.99; },
  (r) => { r.observations.quality.queries_fully_covered = 99; },
  (r) => { r.observations.quality.worst_minimum_k = CANDIDATE_POOL_K + 1; },
  (r) => { r.observations.contract.pool_k = 50; },
  (r) => { r.observations.retrieval.rows.pop(); },
  (r) => { r.observations.retrieval.rows[1] = r.observations.retrieval.rows[0]; },
  (r) => { r.observations.retrieval.rows[0].ranking[0].document_id = "unknown"; },
  (r) => { r.observations.retrieval.rows[0].ranking[1] = r.observations.retrieval.rows[0].ranking[0]; },
  (r) => { r.observations.retrieval.rows[0].ranking[0].score = Number.NaN; },
  (r) => { r.observations.retrieval.rows[0].ranking[0].prompt = "must reject extra data"; },
  (r) => { r.observations.retrieval.counts[0].relevant_hits = 999; },
  (r) => { r.observations.retrieval.slices[0].recall_at_pool = 0; },
  (r) => { r.observations.samples.queries[0].billed_input_tokens += 1; },
  (r) => { r.observations.samples.queries[1].query_id = r.observations.samples.queries[0].query_id; },
  (r) => { r.observations.samples.documents[0].input_count += 1; },
  (r) => { r.observations.latency.query_p95_ms = 1501; },
  (r) => { r.observations.contract.dimension = 768; },
  (r) => { r.observations.usage.calculated_cost_usd += 1; },
  (r) => { r.environment.fixture_set_hash = "0".repeat(64); },
  (r) => { r.observations.dataset.split = "development"; },
  (r) => { r.observations.dataset.fixture_set = "finshield-korean-finance-embed-v2"; },
]) {
  const broken = structuredClone(result);
  mutate(broken);
  assert.ok(errorsFor(broken).length > 0, "정책이 변형을 통과시켰습니다");
}

// 원장을 올바르게 다시 계산해도 합격선을 못 넘으면 실패해야 한다. 집계값이나
// ID 정렬 순서를 실제 회수 대신 믿지 않는다.
const missing = structuredClone(result);
missing.observations.retrieval.rows = gate.map((query) => ({
  query_id: query.id,
  ranking: docs.filter((doc) => !query.relevant_unit_ids.includes(doc.unit_id))
    .slice(0, CANDIDATE_POOL_K)
    .map((doc, index) => ({ document_id: doc.id, unit_id: doc.unit_id, score: 0.9 - index * 0.01 })),
}));
const recomputed = scoreCandidatePools({
  queries: gate, documents: docs, rows: missing.observations.retrieval.rows,
});
missing.observations.quality = recomputed.quality;
missing.observations.retrieval.counts = recomputed.counts;
missing.observations.retrieval.slices = recomputed.slices;
assert.ok(errorsFor(missing).some((message) => message.includes("후보 풀")));

// harness 오류 경로. 실패한 표본을 재시도하지 않는다.
const noWait = { wait: async () => {} };
await assert.rejects(runCandidateSpike({ root, apiKey: "", fetchImpl: fakeFetch, pacer: noWait }),
  /COHERE_API_KEY/);
let limited = 0;
await assert.rejects(runCandidateSpike({
  root, apiKey: "sk-test-not-real-key", pacer: noWait,
  fetchImpl: async () => { limited += 1; return new Response("secret untrusted body", { status: 429, headers: { "retry-after": "60" } }); },
}), (error) => error.status === 429 && error.retryAfterSeconds === 60);
assert.equal(limited, 1);
await assert.rejects(runCandidateSpike({
  root, apiKey: "sk-test-not-real-key", pacer: noWait,
  fetchImpl: async () => new Response(JSON.stringify({
    id: "synthetic-id", embeddings: { float: [[1, 0]] }, meta: { billed_units: { input_tokens: 1 } },
  }), { status: 200, headers: { "content-type": "application/json" } }),
}), /dimension/);

console.log("B-EMBED-01 재정의 harness·정책 시험을 통과했습니다.");
