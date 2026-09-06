// B-RETRIEVAL-01 계약 시험. 외부 호출 없이 corpus 생성·Rerank·지표·정책을 확인한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimRows, corpusStatements, documentRows, lit, stableUuid, KB_RELEASE_VERSION, MANIFEST_VERSION } from "./retrieval-corpus.mjs";
import {
  AUTHORITY_SCORE, CANDIDATE_POOL_K, RELEVANCE_WEIGHTS, RERANK_WEIGHTS, TOP_K,
  candidateScore, caseMetrics, freshnessScore, keywordScore, macroAverage, percentile, rerankCase, vectorScore,
} from "./retrieval-pipeline.mjs";
import {
  CORPUS_DOCUMENTS, DIMENSION, EMBEDDING_MODEL, FIXTURE_SET, FORMULA_VERSION, GATE_CASES, GATE_CLAIMS,
  RISK_CASES, THRESHOLDS, validateRetrievalEvidenceResult,
} from "./retrieval-evidence-policy.mjs";

let passed = 0;
let rejected = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };
const fixture = JSON.parse(readFileSync(new URL("../fixtures/provider-embed-v5.json", import.meta.url), "utf8"));

// ---------- 1. 평가셋과 측정 단위 ----------
ok(fixture.fixture_set === FIXTURE_SET, "평가셋 이름이 계약과 같아야 한다");
const documents = documentRows(fixture);
const claims = claimRows(fixture);
const gate = claims.filter((c) => c.split === "gate");
ok(documents.length === CORPUS_DOCUMENTS, "corpus 문서가 240건이어야 한다");
ok(gate.length === GATE_CLAIMS, "gate Claim 이 100건이어야 한다");
const gateCases = new Set(gate.map((c) => c.case_id));
ok(gateCases.size === GATE_CASES, "gate 가족이 20개여야 한다");
ok(new Set(gate.filter((c) => c.risk_critical).map((c) => c.case_id)).size === RISK_CASES, "위험 가족이 6개여야 한다");
for (const caseId of gateCases) {
  const rows = gate.filter((c) => c.case_id === caseId);
  ok(rows.length === 5, `가족 ${caseId} 는 Claim 5개여야 한다`);
  ok(new Set(rows.flatMap((r) => r.relevant_units)).size === 5, `가족 ${caseId} 의 관련 unit 합집합이 5개여야 한다`);
}
// Case 단위라야 Precision@5 상한이 1.00 이 된다. 이 사실이 사전등록 8.2 의 근거다.
const perClaimCeiling = macroAverage(gate.map((c) => Math.min(c.relevant_units.length, TOP_K) / TOP_K));
ok(Math.abs(perClaimCeiling - 0.2) < 1e-9, "Claim 단위였다면 Precision@5 상한이 0.200 이어야 한다");
ok(perClaimCeiling < THRESHOLDS.precision_at_5, "그 상한은 합격선보다 낮아 Claim 단위로는 통과할 수 없다");
const relevantUnits = new Set(documents.map((d) => d.evidence_unit));
for (const claim of gate) {
  for (const unit of [...claim.relevant_units, ...claim.critical_units]) {
    ok(relevantUnits.has(unit), `Claim ${claim.key} 의 unit ${unit} 이 corpus 에 있어야 한다`);
  }
}

// ---------- 2. corpus 적재 SQL ----------
const embeddings = new Map(documents.map((d) => [d.evidence_unit, Array.from({ length: DIMENSION }, (_, i) => ((i % 7) - 3) / 10)]));
const built = corpusStatements({ fixture, documents, embeddings, embeddingModel: EMBEDDING_MODEL, embeddingVersion: "1", dimension: DIMENSION });
const sql = built.statements.join("\n");
ok(built.statements[0] === "begin;" && built.statements.at(-1) === "commit;", "적재는 한 트랜잭션이어야 한다");
ok(built.releaseId === stableUuid("release", KB_RELEASE_VERSION), "Release id 는 결정적이어야 한다");
ok(built.manifestId === stableUuid("manifest", MANIFEST_VERSION), "Manifest id 는 결정적이어야 한다");
for (const table of ["kb.source_snapshots", "kb.knowledge_documents", "kb.knowledge_chunks", "kb.knowledge_embeddings", "private.execution_manifests", "private.policy_versions"]) {
  ok(sql.includes(`insert into ${table}`), `${table} 적재 문장이 있어야 한다`);
}
ok((sql.match(/insert into kb\.knowledge_chunks/g) ?? []).length === CORPUS_DOCUMENTS, "Chunk 문장이 문서 수만큼이어야 한다");
ok(!/'\s*;\s*drop/i.test(sql), "적재 문장에 주입이 없어야 한다");
ok(lit("a'b") === "'a''b'" && lit(null) === "null", "작은따옴표가 escape 되고 null 이 구분돼야 한다");
ok(corpusStatements({ fixture: { ...fixture, fixture_set: "he'llo" }, documents, embeddings, embeddingModel: EMBEDDING_MODEL, embeddingVersion: "1", dimension: DIMENSION })
  .statements.join("\n").includes("he''llo"), "평가셋 이름의 작은따옴표도 escape 되어야 한다");
assert.throws(() => corpusStatements({ fixture, documents, embeddings: new Map(), embeddingModel: EMBEDDING_MODEL, embeddingVersion: "1", dimension: DIMENSION }), /missing embedding/);
passed += 1;
const second = corpusStatements({ fixture, documents, embeddings, embeddingModel: EMBEDDING_MODEL, embeddingVersion: "1", dimension: DIMENSION });
ok(second.statements.join("\n").length === sql.length, "같은 입력은 같은 SQL 을 만들어야 한다");

// ---------- 3. Rerank 와 지표 ----------
ok(Math.abs(RERANK_WEIGHTS.relevance + RERANK_WEIGHTS.authority + RERANK_WEIGHTS.freshness - 1) < 1e-9, "Rerank 가중치 합이 1 이어야 한다");
ok(Math.abs(RELEVANCE_WEIGHTS.vector + RELEVANCE_WEIGHTS.keyword - 1) < 1e-9, "Relevance 가중치 합이 1 이어야 한다");
ok(vectorScore(0) === 1 && vectorScore(2) === 0 && vectorScore(null) === 0, "Vector 점수가 0..1 로 잘려야 한다");
ok(keywordScore(0.5, 1) === 0.5 && keywordScore(null, 1) === 0 && keywordScore(1, 0) === 0, "Keyword 점수가 질의 안에서 정규화돼야 한다");
{
  const range = { oldest: "2024-01-01", newest: "2026-01-01" };
  ok(freshnessScore("2026-01-01", range) === 1 && freshnessScore("2024-01-01", range) === 0, "같은 후보 집합에서 최근 자료가 더 높아야 한다");
  ok(Math.abs(freshnessScore("2025-01-01", range) - 0.5) < 0.01, "중간 시점은 중간 점수여야 한다");
  ok(freshnessScore("2025-01-01", {}) === 1 && freshnessScore(null, range) === 1, "범위나 날짜가 없으면 깎지 않아야 한다");
  // 종료일 유무는 더 이상 점수에 들어가지 않는다. Filter 가 기준일 밖을 이미 제외한다.
  ok(candidateScore({ relevance: 1, authorityLevel: "A", effectiveFrom: "2026-01-01", effectiveRange: range }) === 1, "최고 점수가 1 이어야 한다");
  ok(candidateScore({ relevance: 1, authorityLevel: "A", effectiveFrom: "2026-01-01", effectiveRange: range })
     > candidateScore({ relevance: 1, authorityLevel: "C", effectiveFrom: "2026-01-01", effectiveRange: range }), "권위가 낮으면 점수가 낮아야 한다");
}

const makeRows = (units, provenance, { distance = 0.1, rank = 0.5 } = {}) => units.map((unit) => {
  const snapshot = `snap-${unit}`;
  provenance.set(snapshot, { unit, fingerprint: `fp-${unit}`, authority_level: "A", effective_from: "2026-01-01" });
  return { chunk_id: `chunk-${unit}`, source_snapshot_id: snapshot, vector_distance: distance, keyword_rank: rank, matched_by: "KEYWORD_AND_VECTOR", valid_to: null };
});
{
  const provenance = new Map();
  const claimResults = [
    { claim: { key: "c1" }, rows: makeRows(["u1", "u2", "n1"], provenance, { distance: 0.1 }) },
    { claim: { key: "c2" }, rows: makeRows(["u3", "u4", "u5"], provenance, { distance: 0.2 }) },
  ];
  const { top, poolSize, collapsed } = rerankCase({ claimResults, provenance });
  ok(poolSize === 6 && collapsed === 0, "합집합 크기와 중복 제거 수가 맞아야 한다");
  ok(top.length === TOP_K, "top 은 5건이어야 한다");
  // Claim 마다 한 자리를 먼저 준다. 두 Claim 이 있으면 각 Claim 의 최고 후보가 반드시 들어간다.
  for (const key of ["c1", "c2"]) {
    const forClaim = claimResults.find((entry) => entry.claim.key === key).rows.map((r) => provenance.get(r.source_snapshot_id).unit);
    ok(top.some((c) => forClaim.includes(c.unit)), `Claim ${key} 의 근거가 top 에 있어야 한다`);
  }
  ok(top[0].unit === "u1" || top[0].unit === "u2" || top[0].unit === "n1", "거리 가까운 쪽이 위로 와야 한다");
  const metrics = caseMetrics({ relevantUnits: new Set(["u1", "u2", "u3", "u4", "u5"]), criticalUnits: new Set(["u1"]), top });
  ok(metrics.precision_at_5 === metrics.recall_at_5, "관련 unit 5개면 Recall 과 Precision 이 같아야 한다");
  ok(metrics.critical_recall_at_5 === 1, "핵심 unit 이 top 안에 있어야 한다");
}
{
  // 같은 지문 두 건은 하나로 계산한다.
  const provenance = new Map();
  const rows = makeRows(["u1", "u1copy"], provenance);
  provenance.get("snap-u1copy").fingerprint = "fp-u1";
  const { poolSize, deduped, collapsed } = rerankCase({ claimResults: [{ claim: { key: "c1" }, rows }], provenance });
  ok(poolSize === 2 && deduped === 1 && collapsed === 1, "같은 지문은 하나로 접혀야 한다");
}
{
  // Claim 이 5개면 각 Claim 의 최고 후보가 한 자리씩 차지하고 전체 점수 상위가 그 자리를 밀어내지 못한다.
  const provenance = new Map();
  // own{i} 는 그 Claim 에서 가장 가깝고, loud 는 모든 Claim 에서 두 번째다.
  // 전체 점수만 보면 loud 가 다섯 번 나와 상위를 차지하지만 자리 배분이 그것을 막는다.
  const claimResults = ["c1", "c2", "c3", "c4", "c5"].map((key, index) => ({
    claim: { key },
    rows: makeRows([`own${index}`, "loud"], provenance, { distance: 0.05, rank: 0.4 }),
  }));
  for (const entry of claimResults) {
    const loud = entry.rows.find((r) => provenance.get(r.source_snapshot_id).unit === "loud");
    loud.vector_distance = 0.2;
  }
  const { top } = rerankCase({ claimResults, provenance });
  ok(top.length === TOP_K, "Claim 5개면 top 이 5건이어야 한다");
  for (let index = 0; index < 5; index += 1) {
    ok(top.some((c) => c.unit === `own${index}`), `Claim ${index + 1} 의 고유 근거가 밀려나지 않아야 한다`);
  }
}
ok(percentile([10, 20, 30, 40, 50], 0.95) === 50 && percentile([], 0.95) === null, "백분위 계산이 맞아야 한다");

// ---------- 4. 정책 ----------
const caseRow = (id, { risk = false, found = 5, coverage = ["product"] } = {}) => ({
  case_id: id, risk_critical: risk, coverage, claims: 5, pool_size: 30, deduped_size: 30, collapsed_fingerprints: 0,
  top_units: ["a", "b", "c", "d", "e"], relevant_units: ["r1", "r2", "r3", "r4", "r5"],
  critical_units: risk ? ["r1", "r2", "r3", "r4", "r5"] : [],
  recall_at_5: found / 5, precision_at_5: found / 5, critical_recall_at_5: risk ? 1 : null, filter_excluded_answers: 0,
});
const cases = Array.from({ length: GATE_CASES }, (_, i) => caseRow(`case-${String(i).padStart(2, "0")}`, { risk: i < RISK_CASES }));
const ledger = Array.from({ length: GATE_CLAIMS }, (_, i) => ({
  claim_key: `case-${String(Math.floor(i / 5)).padStart(2, "0")}:c${(i % 5) + 1}`,
  case_id: `case-${String(Math.floor(i / 5)).padStart(2, "0")}`,
  filtered: 40, keyword: 8, vector: 20, merged: 22, relevant_in_pool: 1, provider_ms: 320, db_ms: 3,
}));
const observations = {
  contract: {
    formula_version: FORMULA_VERSION, fixture_set: FIXTURE_SET, measurement_unit: "case",
    embedding_model: EMBEDDING_MODEL, dimension: DIMENSION, candidate_pool_k: CANDIDATE_POOL_K, top_k: TOP_K,
    rerank_weights: { ...RERANK_WEIGHTS }, relevance_weights: { ...RELEVANCE_WEIGHTS }, authority_score: { ...AUTHORITY_SCORE },
    kb_release_version: KB_RELEASE_VERSION, manifest_version: MANIFEST_VERSION, thresholds: { ...THRESHOLDS },
  },
  corpus: { documents: CORPUS_DOCUMENTS, gate_cases: GATE_CASES, gate_claims: GATE_CLAIMS, risk_cases: RISK_CASES, development_cases: 4, distinct_fingerprints: CORPUS_DOCUMENTS },
  cases,
  totals: {
    recall_at_5: 1, precision_at_5: 1, critical_recall_at_5: 1, slice_recall_at_5: { product: 1 },
    query_p95_ms: 400, query_p50_ms: 300, db_p95_ms: 4, filter_excluded_answers: 0, duplicate_fingerprint_inflation: 0, collapsed_fingerprints: 0,
  },
  ledger,
};
const baseline = {
  schema_version: 3, blocker_id: "B-RETRIEVAL-01", requirements_blob_sha: "a".repeat(40), adr_decision_sha256: "b".repeat(64),
  code_under_test_sha: "c".repeat(40), workflow_head_sha: "c".repeat(40), scope_sha256: "d".repeat(64),
  run: { id: 1, attempt: 1 }, observations, environment: {}, redactions_applied: true,
};
const check = (result) => { const errors = []; validateRetrievalEvidenceResult(result, (m) => errors.push(m)); return errors; };
assert.deepEqual(check(baseline), [], "기준 결과는 정책을 통과해야 한다");
passed += 1;

const clone = () => JSON.parse(JSON.stringify(baseline));
const mustReject = (name, mutate) => {
  const result = clone();
  mutate(result);
  assert.ok(check(result).length > 0, `정책이 '${name}' 를 거부해야 한다`);
  rejected += 1;
};
mustReject("산식 변경", (r) => { r.observations.contract.formula_version = "other"; });
mustReject("평가셋 교체", (r) => { r.observations.contract.fixture_set = "other"; });
mustReject("측정 단위를 Claim 으로", (r) => { r.observations.contract.measurement_unit = "claim"; });
mustReject("후보 풀 확대", (r) => { r.observations.contract.candidate_pool_k = 50; });
mustReject("top 확대", (r) => { r.observations.contract.top_k = 10; });
mustReject("Rerank 가중치 변경", (r) => { r.observations.contract.rerank_weights.relevance = 0.9; });
mustReject("Relevance 가중치 변경", (r) => { r.observations.contract.relevance_weights.vector = 1; });
mustReject("Authority 점수 변경", (r) => { r.observations.contract.authority_score.C = 1; });
mustReject("합격선 완화", (r) => { r.observations.contract.thresholds.precision_at_5 = 0.2; });
mustReject("corpus 축소", (r) => { r.observations.corpus.documents = 100; });
mustReject("gate 가족 축소", (r) => { r.observations.corpus.gate_cases = 10; });
mustReject("Case 기록 누락", (r) => { r.observations.cases.pop(); });
mustReject("Recall 미달", (r) => { r.observations.totals.recall_at_5 = 0.85; });
mustReject("Precision 미달", (r) => { r.observations.totals.precision_at_5 = 0.7; });
mustReject("위험 핵심 미달", (r) => { r.observations.totals.critical_recall_at_5 = 0.9; r.observations.cases[0].critical_recall_at_5 = 0.8; });
mustReject("가족별 Precision 미달", (r) => { r.observations.cases[7].precision_at_5 = 0.6; });
mustReject("slice Recall 미달", (r) => { r.observations.cases.forEach((c) => { c.recall_at_5 = 0.8; }); r.observations.totals.slice_recall_at_5.product = 0.8; });
mustReject("slice 값이 기록과 불일치", (r) => { r.observations.totals.slice_recall_at_5.product = 0.95; });
mustReject("P95 초과", (r) => { r.observations.totals.query_p95_ms = 1600; });
mustReject("Provider 지연이 없는 원장", (r) => { r.observations.ledger[0].provider_ms = null; });
mustReject("DB 지연을 Provider 지연으로 표시", (r) => { delete r.observations.totals.db_p95_ms; });
mustReject("Filter 가 정답 제외", (r) => { r.observations.totals.filter_excluded_answers = 1; r.observations.cases[0].filter_excluded_answers = 1; });
mustReject("중복 출처가 근거를 늘림", (r) => { r.observations.totals.duplicate_fingerprint_inflation = 1; });
mustReject("top 에 같은 unit 중복", (r) => { r.observations.cases[0].top_units = ["a", "a", "c", "d", "e"]; });
mustReject("top 이 5건 미만", (r) => { r.observations.cases[0].top_units = ["a", "b", "c"]; });
mustReject("원장 누락", (r) => { r.observations.ledger.pop(); });
mustReject("원장에 단계 후보 없음", (r) => { r.observations.ledger[0].keyword = 0; r.observations.ledger[0].vector = 0; });
mustReject("Filter 통과 수가 후보보다 작음", (r) => { r.observations.ledger[0].filtered = 1; });
mustReject("observations 키 추가", (r) => { r.observations.extra = 1; });

console.log(`B-RETRIEVAL-01 계약 시험 통과: 합격 ${passed}건, 정책 거부 ${rejected}건, corpus ${documents.length}건, gate ${gateCases.size}가족.`);
