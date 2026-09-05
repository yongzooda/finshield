import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FIXTURE_PATH = ".github/fixtures/provider-embed-v2.json";
export const FORMULA_VERSION = "query-macro-unit-recall-v2";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const requireValue = (condition, message) => { if (!condition) throw new Error(`Embedding evaluation: ${message}`); };
const distinct = (values) => Array.isArray(values) && new Set(values).size === values.length;
const text = (value) => typeof value === "string" && value.length >= 4 && value.length <= 2000;

export const expandEmbedFixtures = (fixture) => {
  requireValue(keys(fixture, ["schema_version", "fixture_set", "status", "scope", "split_policy", "cases"])
    && fixture.schema_version === 2 && fixture.fixture_set === "finshield-korean-finance-embed-v2"
    && fixture.status === "preregistered" && text(fixture.scope) && text(fixture.split_policy)
    && Array.isArray(fixture.cases) && fixture.cases.length === 24, "v2 preregistration schema");
  const documents = [], queries = [], families = new Set(), texts = new Set(), units = new Set();
  for (const item of fixture.cases) {
    requireValue(keys(item, ["id", "split", "coverage", "risk_critical", "documents", "queries"])
      && /^[a-z_0-9]{3,32}$/.test(item.id) && !families.has(item.id)
      && ["gate", "development"].includes(item.split) && typeof item.risk_critical === "boolean"
      && distinct(item.coverage) && item.coverage.length > 0
      && item.coverage.every((tag) => ["product", "numeric", "institution", "mixed_name", "freshness", "fees", "negation", "risk"].includes(tag))
      && Array.isArray(item.documents) && item.documents.length === 7
      && Array.isArray(item.queries) && item.queries.length === 5, "scenario schema/split overlap");
    families.add(item.id);
    const byKey = new Map();
    for (const doc of item.documents) {
      requireValue(keys(doc, ["key", "facet", "text", "source_family", "evidence_unit"])
        && /^u[1-7]$/.test(doc.key) && !byKey.has(doc.key) && text(doc.text)
        && typeof doc.facet === "string" && doc.facet.length > 0 && doc.facet.length <= 80
        && doc.source_family === `synthetic-${item.id}` && doc.evidence_unit === `${item.id}-${doc.key.slice(1)}`
        && !texts.has(doc.text.normalize("NFKC")) && !units.has(doc.evidence_unit), "duplicate text/unit or invalid document");
      texts.add(doc.text.normalize("NFKC")); units.add(doc.evidence_unit);
      const document = { id: `d-${hash(doc.text).slice(0, 16)}`, unit_id: `u-${hash(doc.evidence_unit).slice(0, 16)}`,
        source_family: doc.source_family, family: item.id, split: item.split, text: doc.text };
      byKey.set(doc.key, document); documents.push(document);
    }
    const queryKeys = new Set();
    for (const query of item.queries) {
      requireValue(keys(query, ["key", "text", "relevant_units", "critical_units", "hard_negative_units", "rationale"])
        && /^q[1-5]$/.test(query.key) && !queryKeys.has(query.key) && text(query.text) && text(query.rationale)
        && !texts.has(query.text.normalize("NFKC")), "query schema/duplicate");
      queryKeys.add(query.key); texts.add(query.text.normalize("NFKC"));
      for (const field of ["relevant_units", "critical_units", "hard_negative_units"]) {
        requireValue(distinct(query[field]) && query[field].every((key) => byKey.has(key)), "unknown/duplicate qrel");
      }
      requireValue(query.relevant_units.length > 0 && query.hard_negative_units.length >= 2
        && query.hard_negative_units.every((key) => !query.relevant_units.includes(key))
        && query.critical_units.every((key) => query.relevant_units.includes(key))
        && (query.critical_units.length > 0) === item.risk_critical, "qrel contradiction/critical subset");
      queries.push({ id: `q-${hash(`${item.id}/${query.key}`).slice(0, 16)}`, family: item.id, split: item.split,
        coverage: item.coverage, text: query.text, risk_critical: item.risk_critical,
        relevant_unit_ids: query.relevant_units.map((key) => byKey.get(key).unit_id),
        critical_unit_ids: query.critical_units.map((key) => byKey.get(key).unit_id),
        hard_negative_unit_ids: query.hard_negative_units.map((key) => byKey.get(key).unit_id) });
    }
  }
  const gate = queries.filter((q) => q.split === "gate");
  requireValue(gate.length === 100 && queries.length === 120
    && new Set(gate.map((q) => q.family)).size === 20 && gate.filter((q) => q.risk_critical).length === 30
    && new Set(gate.flatMap((q) => q.hard_negative_unit_ids)).size >= 30, "gate sample counts");
  for (const tag of ["product", "numeric", "institution", "mixed_name", "freshness", "fees", "negation", "risk"]) {
    requireValue(gate.some((q) => q.coverage.includes(tag)), "missing required coverage");
  }
  requireValue(gate.filter((q) => q.relevant_unit_ids.length === 1).length === 20
    && gate.filter((q) => q.relevant_unit_ids.length === 5).length === 80
    && gate.filter((q) => q.coverage.includes("mixed_name") && /[a-z]/i.test(q.text)).length >= 5
    && gate.filter((q) => q.coverage.includes("numeric") && /\d/.test(q.text)).length >= 20,
  "focused/multi-facet and numeric/mixed-name coverage");
  requireValue(distinct(documents.map((d) => d.id)) && distinct(queries.map((q) => q.id)), "hash ID collision");
  const serialized = JSON.stringify(fixture);
  requireValue(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serialized)
    && !/\b\d{6}[- ]?[1-4]\d{6}\b/.test(serialized), "synthetic data boundary");
  return { documents, queries };
};

export const loadEmbedFixtures = (root) => {
  const bytes = readFileSync(resolve(root, FIXTURE_PATH));
  return { ...expandEmbedFixtures(JSON.parse(bytes)), fixtureSetHash: hash(bytes) };
};

// Repository-controlled exposure guard, not an external attestation. A previous
// dispatch consumes this byte-identical holdout even if it failed before scoring.
// fixturePath 기본값은 v2 다. 재정의된 blocker 는 v3 경로를 넘겨 같은 감시
// 논리를 재사용한다. 감시 대상 파일이 하나뿐이라는 전제를 깨지 않는다.
export const assertUnmeasuredGate = async ({ repository, runId, attempt, fixtureBlob, readJson, fixturePath = FIXTURE_PATH }) => {
  requireValue(repository === "yongzooda/finshield" && Number.isSafeInteger(runId) && runId > 0
    && attempt === 1 && /^[0-9a-f]{40}$/.test(fixtureBlob)
    && /^\.github\/fixtures\/provider-embed-v[0-9]+\.json$/.test(fixturePath), "holdout context or rerun");
  let checked = 0, total;
  const seenRuns = new Set();
  for (let page = 1; page <= 10; page++) {
    const history = await readJson(`/repos/${repository}/actions/workflows/provider-embed-evidence.yml/runs?branch=main&event=workflow_dispatch&per_page=100&page=${page}`);
    requireValue(Array.isArray(history?.workflow_runs) && Number.isSafeInteger(history.total_count)
      && history.total_count >= 0 && history.total_count <= 1000, "incomplete holdout history");
    total ??= history.total_count;
    requireValue(history.total_count === total
      && history.workflow_runs.length === Math.min(100, total - (page - 1) * 100), "truncated or changing holdout history");
    for (const run of history.workflow_runs) {
      requireValue(Number.isSafeInteger(run.id) && run.id > 0 && !seenRuns.has(run.id)
        && /^[0-9a-f]{40}$/.test(run.head_sha), "invalid holdout history row");
      seenRuns.add(run.id);
      if (run.id >= runId) continue;
      const previous = await readJson(`/repos/${repository}/contents/${fixturePath}?ref=${run.head_sha}`, true);
      if (previous === null) continue; // Explicit HTTP 404: pre-v2 commits have no v2 fixture.
      requireValue(/^[0-9a-f]{40}$/.test(previous?.sha ?? ""), "invalid previous fixture provenance");
      requireValue(previous.sha !== fixtureBlob, "holdout already dispatched; new reviewed unmeasured set required");
      checked++;
    }
    if (page * 100 >= history.total_count) return checked;
  }
  throw new Error("Embedding evaluation: holdout history limit");
};

export const summarizeQualitySlices = (queries, counts) => {
  const groups = new Map();
  queries.forEach((query, index) => {
    const names = [query.relevant_unit_ids.length === 1 ? "focused" : "multi_facet",
      `family:${query.family ?? "test"}`, ...(query.coverage ?? []).map((tag) => `coverage:${tag}`)];
    for (const name of names) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(counts[index]);
    }
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([slice, rows]) => {
    const risk = rows.filter((r) => r.critical_total > 0);
    return { slice, queries: rows.length,
      recall_at_5: rows.reduce((sum, r) => sum + r.relevant_hits / r.relevant_total, 0) / rows.length,
      precision_at_5: rows.reduce((sum, r) => sum + r.relevant_hits, 0) / (5 * rows.length),
      risk_core_recall_at_5: risk.length ? risk.reduce((sum, r) => sum + r.critical_hits / r.critical_total, 0) / risk.length : null };
  });
};

// Evidence unit = distinct passage/fact, NOT an independent source. Multiple
// passages from one contract keep the same source_family. Copies cannot add hits.
export const scoreRankings = ({ queries, documents, rows }) => {
  requireValue(Array.isArray(queries) && queries.length > 0 && distinct(queries.map((q) => q.id))
    && Array.isArray(rows) && rows.length === queries.length && distinct(rows.map((r) => r.query_id)), "complete unique query rows");
  const docs = new Map(documents.map((doc) => [doc.id, doc]));
  requireValue(docs.size === documents.length, "duplicate document IDs");
  const byQuery = new Map(rows.map((row) => [row.query_id, row]));
  const counts = [];
  for (const query of queries) {
    const row = byQuery.get(query.id);
    requireValue(keys(row, ["query_id", "ranking"]) && Array.isArray(row.ranking) && row.ranking.length <= 5,
      "missing query or invalid ranking schema");
    requireValue(distinct(query.relevant_unit_ids) && query.relevant_unit_ids.length > 0
      && distinct(query.critical_unit_ids) && query.critical_unit_ids.every((id) => query.relevant_unit_ids.includes(id))
      && query.risk_critical === (query.critical_unit_ids.length > 0), "invalid relevance/critical denominator");
    let previous = Infinity;
    const seen = new Set();
    for (const hit of row.ranking) {
      requireValue(keys(hit, ["document_id", "unit_id", "score"]) && docs.get(hit.document_id)?.unit_id === hit.unit_id
        && Number.isFinite(hit.score) && hit.score >= -1.000000001 && hit.score <= 1.000000001
        && hit.score <= previous && !seen.has(hit.unit_id), "unknown/duplicate unit or invalid score/order");
      seen.add(hit.unit_id); previous = hit.score;
    }
    counts.push({ query_id: query.id, relevant_hits: query.relevant_unit_ids.filter((id) => seen.has(id)).length,
      relevant_total: query.relevant_unit_ids.length, critical_hits: query.critical_unit_ids.filter((id) => seen.has(id)).length,
      critical_total: query.critical_unit_ids.length, returned: row.ranking.length });
  }
  const risk = counts.filter((row) => row.critical_total > 0);
  requireValue(risk.length > 0, "risk denominator must not be empty");
  return { quality: { top_k: 5, recall_at_5: counts.reduce((sum, row) => sum + row.relevant_hits / row.relevant_total, 0) / counts.length,
    risk_core_recall_at_5: risk.reduce((sum, row) => sum + row.critical_hits / row.critical_total, 0) / risk.length,
    precision_at_5: counts.reduce((sum, row) => sum + row.relevant_hits, 0) / (5 * counts.length) }, counts,
    slices: summarizeQualitySlices(queries, counts) };
};
