// ============================================================
// B-RETRIEVAL-01 사전 고정 합격선. 결과 파일을 다시 검사한다.
//
// ADR 15.1 종단 Retrieval 행의 값을 그대로 쓴다. 낮추지 않는다.
// 측정 단위는 사전등록 8.2 가 정한 Case 다. gate 20 Case 가 분모다.
// ============================================================
import {
  AUTHORITY_SCORE, CANDIDATE_POOL_K, RELEVANCE_WEIGHTS, RERANK_WEIGHTS, TOP_K,
} from "./retrieval-pipeline.mjs";
import { KB_RELEASE_VERSION, MANIFEST_VERSION } from "./retrieval-corpus.mjs";

export const FORMULA_VERSION = "retrieval-case-top5-filter-keyword-vector-rerank-v1";
export const FIXTURE_SET = "finshield-korean-finance-embed-v5";
export const EMBEDDING_MODEL = "embed-v4.0";
export const DIMENSION = 1024;
export const GATE_CASES = 20;
export const GATE_CLAIMS = 100;
export const CORPUS_DOCUMENTS = 240;
export const RISK_CASES = 6;

export const THRESHOLDS = Object.freeze({
  recall_at_5: 0.90,
  critical_recall_at_5: 1.0,
  precision_at_5: 0.80,
  slice_recall_at_5: 0.90,
  family_precision_at_5: 0.80,
  query_p95_ms: 1500,
  filter_excluded_answers: 0,
  duplicate_fingerprint_inflation: 0,
});

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const atLeast = (value, bound) => typeof value === "number" && Number.isFinite(value) && value >= bound - 1e-9;

export const validateRetrievalEvidenceResult = (result, fail) => {
  const o = result?.observations;
  if (!exactKeys(o, ["contract", "corpus", "cases", "totals", "ledger"])) {
    fail("observations 는 contract·corpus·cases·totals·ledger 만 가져야 합니다.");
    return;
  }

  // 1. 계약: 산식·단계 상수·Rerank 가중치를 코드와 대조한다.
  const c = o.contract;
  if (!exactKeys(c, ["formula_version", "fixture_set", "measurement_unit", "embedding_model", "dimension",
    "candidate_pool_k", "top_k", "rerank_weights", "relevance_weights", "authority_score",
    "kb_release_version", "manifest_version", "thresholds"])
    || c.formula_version !== FORMULA_VERSION || c.fixture_set !== FIXTURE_SET
    || c.measurement_unit !== "case" || c.embedding_model !== EMBEDDING_MODEL || c.dimension !== DIMENSION
    || c.candidate_pool_k !== CANDIDATE_POOL_K || c.top_k !== TOP_K
    || c.kb_release_version !== KB_RELEASE_VERSION || c.manifest_version !== MANIFEST_VERSION) {
    fail("contract 의 산식·평가셋·측정 단위·단계 상수가 현재 코드와 다릅니다.");
  }
  for (const [key, value] of Object.entries(RERANK_WEIGHTS)) {
    if (c.rerank_weights?.[key] !== value) fail(`Rerank 가중치 ${key} 가 고정값과 다릅니다.`);
  }
  for (const [key, value] of Object.entries(RELEVANCE_WEIGHTS)) {
    if (c.relevance_weights?.[key] !== value) fail(`Relevance 가중치 ${key} 가 고정값과 다릅니다.`);
  }
  for (const [key, value] of Object.entries(AUTHORITY_SCORE)) {
    if (c.authority_score?.[key] !== value) fail(`Authority 점수 ${key} 가 고정값과 다릅니다.`);
  }
  for (const [key, value] of Object.entries(THRESHOLDS)) {
    if (c.thresholds?.[key] !== value) fail(`합격선 ${key} 가 사전등록 값과 다릅니다.`);
  }

  // 2. corpus: 평가셋 규모가 사전등록 7.5 와 같아야 한다.
  const corpus = o.corpus;
  if (!exactKeys(corpus, ["documents", "gate_cases", "gate_claims", "risk_cases", "development_cases", "distinct_fingerprints"])
    || corpus.documents !== CORPUS_DOCUMENTS || corpus.gate_cases !== GATE_CASES
    || corpus.gate_claims !== GATE_CLAIMS || corpus.risk_cases !== RISK_CASES) {
    fail("corpus 규모가 사전등록 표본과 다릅니다.");
  }

  // 3. Case 별 기록. 모든 gate Case 가 있어야 하고 가족별 Precision 을 각각 본다.
  const cases = Array.isArray(o.cases) ? o.cases : [];
  if (cases.length !== GATE_CASES) fail("gate Case 기록 수가 20 이 아닙니다.");
  const sliceTotals = new Map();
  for (const row of cases) {
    if (!exactKeys(row, ["case_id", "risk_critical", "coverage", "claims", "pool_size", "deduped_size",
      "collapsed_fingerprints", "top_units", "relevant_units", "critical_units",
      "recall_at_5", "precision_at_5", "critical_recall_at_5", "filter_excluded_answers"])) {
      fail(`Case '${row?.case_id ?? "이름 없음"}' 기록이 계약과 다릅니다.`);
      continue;
    }
    if (row.claims !== 5 || row.relevant_units.length !== 5) fail(`Case '${row.case_id}' 의 Claim·관련 unit 구성이 5개가 아닙니다.`);
    if (row.top_units.length !== TOP_K) fail(`Case '${row.case_id}' 의 top 5 가 5건이 아닙니다.`);
    if (new Set(row.top_units).size !== row.top_units.length) fail(`Case '${row.case_id}' 의 top 5 에 같은 unit 이 두 번 있습니다.`);
    if (row.pool_size < TOP_K) fail(`Case '${row.case_id}' 의 후보 풀이 top 5 보다 작습니다.`);
    if (row.filter_excluded_answers !== 0) fail(`Case '${row.case_id}' 에서 Filter 가 정답을 제외했습니다.`);
    if (!atLeast(row.precision_at_5, THRESHOLDS.family_precision_at_5)) {
      fail(`가족 '${row.case_id}' 의 Precision@5 가 ${THRESHOLDS.family_precision_at_5} 에 못 미칩니다.`);
    }
    if (row.risk_critical && !atLeast(row.critical_recall_at_5, THRESHOLDS.critical_recall_at_5)) {
      fail(`위험 가족 '${row.case_id}' 의 핵심 unit Recall@5 가 1.00 이 아닙니다.`);
    }
    for (const slice of row.coverage ?? []) {
      const bucket = sliceTotals.get(slice) ?? { sum: 0, count: 0 };
      bucket.sum += row.recall_at_5;
      bucket.count += 1;
      sliceTotals.set(slice, bucket);
    }
  }
  if (cases.length > 0 && new Set(cases.map((r) => r.case_id)).size !== cases.length) fail("Case 기록에 중복이 있습니다.");
  if (cases.filter((r) => r.risk_critical).length !== RISK_CASES) fail("위험 가족 수가 6 이 아닙니다.");

  // 4. 합계. slice 는 결과가 아니라 기록에서 다시 계산해 대조한다.
  const t = o.totals;
  if (!exactKeys(t, ["recall_at_5", "precision_at_5", "critical_recall_at_5", "slice_recall_at_5",
    "query_p95_ms", "query_p50_ms", "db_p95_ms", "filter_excluded_answers", "duplicate_fingerprint_inflation", "collapsed_fingerprints"])) {
    fail("합계가 계약과 다릅니다.");
    return;
  }
  if (!atLeast(t.recall_at_5, THRESHOLDS.recall_at_5)) fail(`Recall@5 가 ${THRESHOLDS.recall_at_5} 에 못 미칩니다.`);
  if (!atLeast(t.precision_at_5, THRESHOLDS.precision_at_5)) fail(`Precision@5 가 ${THRESHOLDS.precision_at_5} 에 못 미칩니다.`);
  if (!atLeast(t.critical_recall_at_5, THRESHOLDS.critical_recall_at_5)) fail("위험 핵심 unit Recall@5 가 1.00 이 아닙니다.");
  if (!(typeof t.query_p95_ms === "number") || t.query_p95_ms > THRESHOLDS.query_p95_ms) fail(`질의 P95 가 ${THRESHOLDS.query_p95_ms}ms 를 넘습니다.`);
  if (t.filter_excluded_answers !== THRESHOLDS.filter_excluded_answers) fail("Filter 가 정답을 제외한 건이 있습니다.");
  if (t.duplicate_fingerprint_inflation !== THRESHOLDS.duplicate_fingerprint_inflation) fail("중복 출처가 독립 근거 수를 늘렸습니다.");
  for (const [slice, value] of Object.entries(t.slice_recall_at_5 ?? {})) {
    const bucket = sliceTotals.get(slice);
    if (!bucket || Math.abs((bucket.sum / bucket.count) - value) > 1e-6) fail(`slice '${slice}' 의 Recall 이 Case 기록과 맞지 않습니다.`);
    if (!atLeast(value, THRESHOLDS.slice_recall_at_5)) fail(`slice '${slice}' 의 Recall@5 가 ${THRESHOLDS.slice_recall_at_5} 에 못 미칩니다.`);
  }
  if (sliceTotals.size !== Object.keys(t.slice_recall_at_5 ?? {}).length) fail("slice 목록이 Case 기록과 다릅니다.");

  // 5. 원장. 단계별 후보 수가 Claim 마다 남아야 한다 (AI-007).
  const ledger = Array.isArray(o.ledger) ? o.ledger : [];
  if (ledger.length !== GATE_CLAIMS) fail("단계 원장이 gate Claim 100건에 대해 남아 있지 않습니다.");
  for (const row of ledger) {
    if (!exactKeys(row, ["claim_key", "case_id", "filtered", "keyword", "vector", "merged", "relevant_in_pool", "provider_ms", "db_ms"])) {
      fail(`원장 '${row?.claim_key ?? "이름 없음"}' 이 계약과 다릅니다.`);
      continue;
    }
    if (row.filtered < row.merged) fail(`원장 '${row.claim_key}' 의 Filter 통과 수가 후보 수보다 작습니다.`);
    if (row.merged > CANDIDATE_POOL_K * 2) fail(`원장 '${row.claim_key}' 의 후보 수가 상한을 넘습니다.`);
    if (row.keyword === 0 && row.vector === 0) fail(`원장 '${row.claim_key}' 에 어느 단계의 후보도 없습니다.`);
    if (!Number.isFinite(row.provider_ms) || row.provider_ms <= 0) fail(`원장 '${row.claim_key}' 에 Provider 질의 지연이 없습니다.`);
  }
};
