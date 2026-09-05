// ============================================================
// B-EMBED-01 평가 계약 — Claim 단위 1차 후보 생성 (v5)
//
// 질의 하나는 Claim 하나다. 사용자가 주장하거나 안내받았다고 말한 사실 한
// 문장이며, 거짓 Claim 의 관련 unit 은 그것을 반박하는 문서다. Case 는 같은
// 입력에서 나온 Claim 5개이고 Case 풀은 Claim 풀의 합집합이다.
//
// 합격식은 Claim 별 후보 풀 20 안의 관련 unit Recall = 1.00 과 Case 합집합
// Recall = 1.00 이다. 1단계에서 빠진 근거는 이후 어떤 단계로도 복구할 수
// 없으므로 부분 회수를 허용하지 않는다.
//
// 이 계약은 v3·v4 문단 단위 측정이 미달한 뒤 ADR 15.1 의 미달 규칙에 따라
// 질의 단위만 바꾼 것이다 (docs/ops/retrieval-blocker-preregistration.md 7절).
// 합격선·후보 풀 크기·Filter 계약은 v4 와 같다.
// ============================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FIXTURE_PATH = ".github/fixtures/provider-embed-v5.json";
export const CANDIDATE_POOL_K = 20;
export const FORMULA_VERSION = "claim-level-filtered-candidate-pool-unit-recall-v5";
export const AUTHORITY_LEVELS = Object.freeze(["A", "B", "C", "D"]);
export const CHANNEL_TYPES = Object.freeze([
  "PRODUCT_TERMS", "LAW", "OFFICIAL_CHANNEL", "SUPERVISORY_GUIDE",
]);
export const TRUTH_VALUES = Object.freeze(["TRUE", "FALSE", "PARTIAL"]);
export const DOCUMENTS_PER_FAMILY = 10;
export const CLAIMS_PER_FAMILY = 5;
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
  requireValue(keys(fixture, ["schema_version", "fixture_set", "status", "scope", "split_policy",
    "filter_policy", "query_policy", "cases"])
    && fixture.schema_version === 5
    && fixture.fixture_set === "finshield-korean-finance-embed-v5"
    && fixture.status === "preregistered" && text(fixture.scope) && text(fixture.split_policy)
    && text(fixture.filter_policy) && text(fixture.query_policy)
    && Array.isArray(fixture.cases) && fixture.cases.length === 24, "v5 preregistration schema");

  const documents = [];
  const queries = [];
  const families = new Set();
  const texts = new Set();
  const units = new Set();

  for (const item of fixture.cases) {
    requireValue(keys(item, ["id", "split", "coverage", "risk_critical", "documents", "claims"])
      && /^[a-z_0-9]{3,32}$/.test(item.id) && !families.has(item.id)
      && ["gate", "development"].includes(item.split)
      && typeof item.risk_critical === "boolean"
      && distinct(item.coverage) && item.coverage.length > 0
      && item.coverage.every((tag) => COVERAGE_TAGS.includes(tag))
      && Array.isArray(item.documents) && item.documents.length === DOCUMENTS_PER_FAMILY
      && Array.isArray(item.claims) && item.claims.length === CLAIMS_PER_FAMILY,
    "scenario schema or family overlap");
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

    const claimKeys = new Set();
    for (const claim of item.claims) {
      requireValue(keys(claim, ["key", "text", "truth", "relevant_units", "critical_units",
        "hard_negative_units", "rationale", "target_institution_code",
        "target_product_code", "as_of_date"])
        && /^c[1-5]$/.test(claim.key) && !claimKeys.has(claim.key)
        && text(claim.text) && text(claim.rationale)
        && TRUTH_VALUES.includes(claim.truth)
        && (claim.target_institution_code === null || CODE.test(claim.target_institution_code))
        && (claim.target_product_code === null || CODE.test(claim.target_product_code))
        && DATE.test(claim.as_of_date)
        && !texts.has(claim.text.normalize("NFKC")), "claim schema or duplicate text");
      claimKeys.add(claim.key);
      texts.add(claim.text.normalize("NFKC"));

      for (const field of ["relevant_units", "critical_units", "hard_negative_units"]) {
        requireValue(distinct(claim[field]) && claim[field].every((key) => byKey.has(key)),
          "unknown or duplicate qrel key");
      }
      requireValue(claim.relevant_units.length > 0
        && claim.hard_negative_units.length >= 2
        && claim.hard_negative_units.every((key) => !claim.relevant_units.includes(key))
        && claim.critical_units.every((key) => claim.relevant_units.includes(key))
        && (claim.critical_units.length > 0) === item.risk_critical,
      "qrel contradiction or critical subset violation");

      // 제약이 있는데 Filter 가 정답을 제외하면 실패다 (사전등록 5.3).
      for (const key of claim.relevant_units) {
        requireValue(passesMetadataFilter(byKey.get(key), claim),
          "metadata filter excludes a relevant unit");
      }

      queries.push({
        id: `q-${hash(`${item.id}/${claim.key}`).slice(0, 16)}`,
        family: item.id, split: item.split, coverage: item.coverage,
        text: claim.text, truth: claim.truth, risk_critical: item.risk_critical,
        target_institution_code: claim.target_institution_code,
        target_product_code: claim.target_product_code,
        as_of_date: claim.as_of_date,
        relevant_unit_ids: claim.relevant_units.map((key) => byKey.get(key).unit_id),
        critical_unit_ids: claim.critical_units.map((key) => byKey.get(key).unit_id),
        hard_negative_unit_ids: claim.hard_negative_units.map((key) => byKey.get(key).unit_id),
      });
    }
  }

  const gate = queries.filter((query) => query.split === "gate");
  requireValue(gate.length === 100 && queries.length === 120
    && new Set(gate.map((query) => query.family)).size === 20
    && gate.filter((query) => query.risk_critical).length === 30
    && new Set(gate.flatMap((query) => query.hard_negative_unit_ids)).size >= 40,
  "gate sample counts");

  // 참·거짓 Claim 각 30 이상. 거짓 Claim 이 올바른 문서를 회수하는지가
  // 이 단계의 핵심 시험이므로 거짓을 빼서 쉽게 만드는 변형을 거부한다.
  requireValue(gate.filter((query) => query.truth === "TRUE").length >= 30
    && gate.filter((query) => query.truth === "FALSE").length >= 30, "truth mix");

  requireValue(documents.length === 24 * DOCUMENTS_PER_FAMILY, "corpus size");

  // Filter 를 통과한 문서가 후보 풀보다 충분히 많아야 한다. 모든 Claim 이
  // 단일 사실 질의라 예외 없이 적용한다.
  for (const query of gate) {
    const kept = documents.filter((document) => passesMetadataFilter(document, query));
    requireValue(kept.length > CANDIDATE_POOL_K, "filtered candidate space must exceed the pool");
  }

  for (const tag of COVERAGE_TAGS) {
    requireValue(gate.some((query) => query.coverage.includes(tag)), "missing required coverage tag");
  }
  requireValue(gate.filter((query) => query.coverage.includes("mixed_name") && /[a-z]/i.test(query.text)).length >= 5
    && gate.filter((query) => query.coverage.includes("numeric") && /\d/.test(query.text)).length >= 20,
  "numeric/mixed-name coverage");

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
      `truth:${query.truth}`,
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

// Case 풀 = 같은 가족 Claim 풀의 합집합. AI-007 이 단계별 후보 수를 Trace 에
// 남기도록 요구하므로 합집합 크기와 합집합 Recall 을 가족 단위로 기록한다.
export const summarizeCaseUnions = (queries, rows) => {
  const byQuery = new Map(rows.map((row) => [row.query_id, row]));
  const families = new Map();
  for (const query of queries) {
    if (!families.has(query.family)) families.set(query.family, { relevant: new Set(), pooled: new Set() });
    const entry = families.get(query.family);
    for (const id of query.relevant_unit_ids) entry.relevant.add(id);
    for (const hit of byQuery.get(query.id).ranking) entry.pooled.add(hit.unit_id);
  }
  return [...families.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([family, entry]) => {
    const hits = [...entry.relevant].filter((id) => entry.pooled.has(id)).length;
    return {
      family,
      union_pool_size: entry.pooled.size,
      relevant_total: entry.relevant.size,
      relevant_hits: hits,
      union_recall: hits / entry.relevant.size,
    };
  });
};

// Evidence unit = 서로 다른 문장·사실이며 독립 출처가 아니다. 복제는 적중을
// 늘리지 못한다.
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
      minimum_k: relevantHits === query.relevant_unit_ids.length ? Math.max(...relevantRanks) : null,
    });
  }

  const risk = counts.filter((row) => row.critical_total > 0);
  requireValue(risk.length > 0, "risk denominator must not be empty");
  const covered = counts.filter((row) => row.minimum_k !== null);
  const unions = summarizeCaseUnions(queries, rows);

  return {
    quality: {
      pool_k: CANDIDATE_POOL_K,
      recall_at_pool: counts.reduce((sum, row) => sum + row.relevant_hits / row.relevant_total, 0) / counts.length,
      risk_core_recall_at_pool: risk.reduce((sum, row) => sum + row.critical_hits / row.critical_total, 0) / risk.length,
      case_union_recall: unions.reduce((sum, row) => sum + row.union_recall, 0) / unions.length,
      queries_fully_covered: covered.length,
      queries_total: counts.length,
      worst_minimum_k: covered.length === counts.length ? Math.max(...covered.map((row) => row.minimum_k)) : null,
    },
    counts,
    slices: summarizeCandidateSlices(queries, counts),
    unions,
  };
};
