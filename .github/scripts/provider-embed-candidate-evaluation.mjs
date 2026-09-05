// ============================================================
// B-EMBED-01 재정의 평가 계약 — 1차 후보 생성
//
// 재정의된 blocker 는 Vector 단계를 후보 생성으로만 평가한다. 대상·시점
// 판별은 Metadata Filter 와 Rerank 의 책임이며 `B-RETRIEVAL-01` 이 종단으로
// 측정한다 (docs/ops/embed-blocker-redefinition-plan.md).
//
// 합격식은 후보 풀 20 안의 관련 unit Recall = 1.00 이다. 1단계에서 빠진
// 근거는 이후 어떤 단계로도 복구할 수 없으므로 부분 회수를 허용하지 않는다.
// 후보 풀 크기는 Rerank 입력 상한에서 유도했고 관측된 순위 분포에 맞추지
// 않았다 (docs/ops/retrieval-blocker-preregistration.md 3.2).
//
// v2 모듈과 fixture 는 수정하지 않는다. 그 결과는 이력으로 보존한다.
// ============================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FIXTURE_PATH = ".github/fixtures/provider-embed-v4.json";
export const CANDIDATE_POOL_K = 20;
export const FORMULA_VERSION = "filtered-candidate-pool-unit-recall-v4";
export const AUTHORITY_LEVELS = Object.freeze(["A", "B", "C", "D"]);
export const CHANNEL_TYPES = Object.freeze([
  "PRODUCT_TERMS", "LAW", "OFFICIAL_CHANNEL", "SUPERVISORY_GUIDE",
]);
export const DOCUMENTS_PER_FAMILY = 10;
export const COVERAGE_TAGS = Object.freeze([
  "product", "numeric", "institution", "mixed_name",
  "freshness", "fees", "negation", "risk",
]);

const hash = (value) => createHash("sha256").update(value).digest("hex");
const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const requireValue = (condition, message) => {
  if (!condition) throw new Error(`Candidate evaluation: ${message}`);
};
const distinct = (values) => Array.isArray(values) && new Set(values).size === values.length;
const text = (value) => typeof value === "string" && value.length >= 4 && value.length <= 2000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z][A-Z0-9_]{2,47}$/;

// Metadata Filter 는 결정적 단계다. 대상 기관이 지정되면 기관이 같아야 하고,
// 대상 상품이 지정되면 상품이 같아야 하며, 기준일이 문서의 유효 구간 안에
// 있어야 한다. 제약이 없는 축은 거르지 않는다 (사전등록 5.3).
export const passesMetadataFilter = (document, query) => {
  if (query.target_institution_code && document.institution_code !== query.target_institution_code) return false;
  if (query.target_product_code && document.product_code !== query.target_product_code) return false;
  if (document.effective_from > query.as_of_date) return false;
  if (document.effective_to !== null && document.effective_to < query.as_of_date) return false;
  return true;
};

export const expandCandidateFixtures = (fixture) => {
  requireValue(keys(fixture, ["schema_version", "fixture_set", "status", "scope", "split_policy", "filter_policy", "cases"])
    && fixture.schema_version === 4
    && fixture.fixture_set === "finshield-korean-finance-embed-v4"
    && fixture.status === "preregistered" && text(fixture.scope) && text(fixture.split_policy)
    && text(fixture.filter_policy)
    && Array.isArray(fixture.cases) && fixture.cases.length === 24, "v4 preregistration schema");

  const documents = [];
  const queries = [];
  const families = new Set();
  const texts = new Set();
  const units = new Set();

  for (const item of fixture.cases) {
    requireValue(keys(item, ["id", "split", "coverage", "risk_critical", "documents", "queries"])
      && /^[a-z_0-9]{3,32}$/.test(item.id) && !families.has(item.id)
      && ["gate", "development"].includes(item.split)
      && typeof item.risk_critical === "boolean"
      && distinct(item.coverage) && item.coverage.length > 0
      && item.coverage.every((tag) => COVERAGE_TAGS.includes(tag))
      && Array.isArray(item.documents) && item.documents.length === DOCUMENTS_PER_FAMILY
      && Array.isArray(item.queries) && item.queries.length === 5, "scenario schema or family overlap");
    families.add(item.id);

    const byKey = new Map();
    for (const doc of item.documents) {
      requireValue(keys(doc, ["key", "facet", "text", "source_family", "evidence_unit",
        "institution_code", "product_code", "effective_from", "effective_to",
        "authority_level", "source_fingerprint", "channel_type"])
        && /^u([1-9]|10)$/.test(doc.key) && !byKey.has(doc.key) && text(doc.text)
        && typeof doc.facet === "string" && doc.facet.length > 0 && doc.facet.length <= 80
        && doc.source_family === `synthetic-${item.id}`
        && doc.evidence_unit === `${item.id}-${doc.key.slice(1)}`
        && CODE.test(doc.institution_code)
        && (doc.product_code === null || CODE.test(doc.product_code))
        && DATE.test(doc.effective_from)
        && (doc.effective_to === null || (DATE.test(doc.effective_to) && doc.effective_to > doc.effective_from))
        && AUTHORITY_LEVELS.includes(doc.authority_level)
        && CHANNEL_TYPES.includes(doc.channel_type)
        && typeof doc.source_fingerprint === "string" && doc.source_fingerprint.length > 0
        && !texts.has(doc.text.normalize("NFKC")) && !units.has(doc.evidence_unit),
      "duplicate text/unit or invalid document");
      texts.add(doc.text.normalize("NFKC"));
      units.add(doc.evidence_unit);
      const document = {
        id: `d-${hash(doc.text).slice(0, 16)}`,
        unit_id: `u-${hash(doc.evidence_unit).slice(0, 16)}`,
        source_family: doc.source_family, family: item.id, split: item.split, text: doc.text,
        institution_code: doc.institution_code, product_code: doc.product_code,
        effective_from: doc.effective_from, effective_to: doc.effective_to,
        authority_level: doc.authority_level, source_fingerprint: doc.source_fingerprint,
        channel_type: doc.channel_type,
      };
      byKey.set(doc.key, document);
      documents.push(document);
    }

    const queryKeys = new Set();
    for (const query of item.queries) {
      requireValue(keys(query, ["key", "text", "relevant_units", "critical_units",
        "hard_negative_units", "rationale", "target_institution_code",
        "target_product_code", "as_of_date"])
        && /^q[1-5]$/.test(query.key) && !queryKeys.has(query.key)
        && text(query.text) && text(query.rationale)
        && (query.target_institution_code === null || CODE.test(query.target_institution_code))
        && (query.target_product_code === null || CODE.test(query.target_product_code))
        && DATE.test(query.as_of_date)
        && !texts.has(query.text.normalize("NFKC")), "query schema or duplicate text");
      queryKeys.add(query.key);
      texts.add(query.text.normalize("NFKC"));

      for (const field of ["relevant_units", "critical_units", "hard_negative_units"]) {
        requireValue(distinct(query[field]) && query[field].every((key) => byKey.has(key)),
          "unknown or duplicate qrel key");
      }
      requireValue(query.relevant_units.length > 0
        && query.hard_negative_units.length >= 2
        && query.hard_negative_units.every((key) => !query.relevant_units.includes(key))
        && query.critical_units.every((key) => query.relevant_units.includes(key))
        && (query.critical_units.length > 0) === item.risk_critical,
      "qrel contradiction or critical subset violation");

      // 제약이 있는데 Filter 가 정답을 제외하면 실패다 (사전등록 5.3).
      for (const key of query.relevant_units) {
        requireValue(passesMetadataFilter(byKey.get(key), query),
          "metadata filter excludes a relevant unit");
      }

      queries.push({
        id: `q-${hash(`${item.id}/${query.key}`).slice(0, 16)}`,
        family: item.id, split: item.split, coverage: item.coverage,
        text: query.text, risk_critical: item.risk_critical,
        target_institution_code: query.target_institution_code,
        target_product_code: query.target_product_code,
        as_of_date: query.as_of_date,
        relevant_unit_ids: query.relevant_units.map((key) => byKey.get(key).unit_id),
        critical_unit_ids: query.critical_units.map((key) => byKey.get(key).unit_id),
        hard_negative_unit_ids: query.hard_negative_units.map((key) => byKey.get(key).unit_id),
      });
    }
  }

  const gate = queries.filter((query) => query.split === "gate");
  requireValue(gate.length === 100 && queries.length === 120
    && new Set(gate.map((query) => query.family)).size === 20
    && gate.filter((query) => query.risk_critical).length === 30
    && new Set(gate.flatMap((query) => query.hard_negative_unit_ids)).size >= 40,
  "gate sample counts");

  requireValue(documents.length === 24 * DOCUMENTS_PER_FAMILY, "corpus size");

  // Filter 를 통과한 문서가 후보 풀보다 충분히 많아야 한다. 그렇지 않으면
  // Recall 이 자동으로 1.00 이 되어 합격식이 아무것도 검증하지 못한다.
  for (const query of gate.filter((item) => item.relevant_unit_ids.length > 1)) {
    const kept = documents.filter((document) => passesMetadataFilter(document, query));
    requireValue(kept.length > CANDIDATE_POOL_K, "filtered candidate space must exceed the pool");
  }

  for (const tag of COVERAGE_TAGS) {
    requireValue(gate.some((query) => query.coverage.includes(tag)), "missing required coverage tag");
  }
  requireValue(gate.filter((query) => query.relevant_unit_ids.length === 1).length === 20
    && gate.filter((query) => query.relevant_unit_ids.length === 5).length === 80
    && gate.filter((query) => query.coverage.includes("mixed_name") && /[a-z]/i.test(query.text)).length >= 5
    && gate.filter((query) => query.coverage.includes("numeric") && /\d/.test(query.text)).length >= 20,
  "focused/multi-facet split or numeric/mixed-name coverage");

  requireValue(distinct(documents.map((doc) => doc.id)) && distinct(queries.map((query) => query.id)),
    "hash ID collision");

  const serialized = JSON.stringify(fixture);
  requireValue(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serialized)
    && !/\b\d{6}[- ]?[1-4]\d{6}\b/.test(serialized), "synthetic data boundary");

  return { documents, queries };
};

export const loadCandidateFixtures = (root) => {
  const bytes = readFileSync(resolve(root, FIXTURE_PATH));
  return { ...expandCandidateFixtures(JSON.parse(bytes)), fixtureSetHash: hash(bytes) };
};

export const summarizeCandidateSlices = (queries, counts) => {
  const groups = new Map();
  queries.forEach((query, index) => {
    const names = [
      query.relevant_unit_ids.length === 1 ? "focused" : "multi_facet",
      `family:${query.family ?? "test"}`,
      ...(query.coverage ?? []).map((tag) => `coverage:${tag}`),
    ];
    for (const name of names) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(counts[index]);
    }
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([slice, rows]) => {
    const risk = rows.filter((row) => row.critical_total > 0);
    const covered = rows.filter((row) => row.minimum_k !== null);
    return {
      slice,
      queries: rows.length,
      recall_at_pool: rows.reduce((sum, row) => sum + row.relevant_hits / row.relevant_total, 0) / rows.length,
      risk_core_recall_at_pool: risk.length
        ? risk.reduce((sum, row) => sum + row.critical_hits / row.critical_total, 0) / risk.length
        : null,
      // 여유 진단용. 합격 판정에는 쓰지 않는다.
      worst_minimum_k: covered.length === rows.length
        ? Math.max(...covered.map((row) => row.minimum_k))
        : null,
    };
  });
};

// Evidence unit = 서로 다른 문장·사실이며 독립 출처가 아니다. 같은 계약의
// 여러 문단은 같은 source_family 를 유지하고 복제는 적중을 늘리지 못한다.
export const scoreCandidatePools = ({ queries, documents, rows }) => {
  requireValue(Array.isArray(queries) && queries.length > 0 && distinct(queries.map((query) => query.id))
    && Array.isArray(rows) && rows.length === queries.length && distinct(rows.map((row) => row.query_id)),
  "complete unique query rows");
  const docs = new Map(documents.map((doc) => [doc.id, doc]));
  requireValue(docs.size === documents.length, "duplicate document IDs");

  const byQuery = new Map(rows.map((row) => [row.query_id, row]));
  const counts = [];
  for (const query of queries) {
    const row = byQuery.get(query.id);
    requireValue(keys(row, ["query_id", "ranking"]) && Array.isArray(row.ranking)
      && row.ranking.length <= CANDIDATE_POOL_K, "missing query or oversized candidate pool");
    requireValue(distinct(query.relevant_unit_ids) && query.relevant_unit_ids.length > 0
      && distinct(query.critical_unit_ids)
      && query.critical_unit_ids.every((id) => query.relevant_unit_ids.includes(id))
      && query.risk_critical === (query.critical_unit_ids.length > 0),
    "invalid relevance or critical denominator");

    let previous = Infinity;
    const seen = new Set();
    const relevantRanks = [];
    row.ranking.forEach((hit, index) => {
      requireValue(keys(hit, ["document_id", "unit_id", "score"])
        && docs.get(hit.document_id)?.unit_id === hit.unit_id
        && Number.isFinite(hit.score) && hit.score >= -1.000000001 && hit.score <= 1.000000001
        && hit.score <= previous && !seen.has(hit.unit_id),
      "unknown/duplicate unit or invalid score order");
      seen.add(hit.unit_id);
      previous = hit.score;
      if (query.relevant_unit_ids.includes(hit.unit_id)) relevantRanks.push(index + 1);
    });

    const relevantHits = query.relevant_unit_ids.filter((id) => seen.has(id)).length;
    counts.push({
      query_id: query.id,
      relevant_hits: relevantHits,
      relevant_total: query.relevant_unit_ids.length,
      critical_hits: query.critical_unit_ids.filter((id) => seen.has(id)).length,
      critical_total: query.critical_unit_ids.length,
      hard_negative_hits: query.hard_negative_unit_ids.filter((id) => seen.has(id)).length,
      returned: row.ranking.length,
      // 모든 관련 unit 을 담는 데 실제로 필요했던 최소 풀 크기. 여유를 보기
      // 위한 진단값이며 합격 판정에 쓰지 않는다. 하나라도 못 담으면 null 이다.
      minimum_k: relevantHits === query.relevant_unit_ids.length ? Math.max(...relevantRanks) : null,
    });
  }

  const risk = counts.filter((row) => row.critical_total > 0);
  requireValue(risk.length > 0, "risk denominator must not be empty");
  const covered = counts.filter((row) => row.minimum_k !== null);

  return {
    quality: {
      pool_k: CANDIDATE_POOL_K,
      recall_at_pool: counts.reduce((sum, row) => sum + row.relevant_hits / row.relevant_total, 0) / counts.length,
      risk_core_recall_at_pool: risk.reduce((sum, row) => sum + row.critical_hits / row.critical_total, 0) / risk.length,
      queries_fully_covered: covered.length,
      queries_total: counts.length,
      worst_minimum_k: covered.length === counts.length ? Math.max(...covered.map((row) => row.minimum_k)) : null,
    },
    counts,
    slices: summarizeCandidateSlices(queries, counts),
  };
};
