// ============================================================
// B-RETRIEVAL-01 corpus 적재.
//
// v5 평가셋의 문서 240개를 실제 KB 스키마에 넣는다. Keyword 단계가 Postgres
// tsvector 를 쓰도록 Node 근사 구현을 두지 않는다 (사전등록 4.3).
//
// 모든 id 는 이름에서 결정적으로 만든다. 같은 평가셋을 다시 적재하면 같은 id 가 나온다.
// ============================================================
import { createHash } from "node:crypto";

export const CORPUS_SCHEMA_VERSION = 1;
export const KB_RELEASE_VERSION = "v5-retrieval-gate";
export const MANIFEST_VERSION = "v5-retrieval-gate";
export const NORMALIZATION_VERSION = "v5-plain";
export const POLICY_VERSIONS = Object.freeze({
  EVIDENCE: "v5-eval", RESULT_MATRIX: "v5-eval", COVERAGE: "v5-eval", PROFILE: "v5-eval", PII: "v5-eval",
});

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
// 결정적 UUID. sha256 앞 16바이트를 version 5·variant 규칙에 맞춰 다듬는다.
export const stableUuid = (namespace, name) => {
  const bytes = Buffer.from(sha256(`${namespace}:${name}`), "hex").subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const lit = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);
const textArray = (values) => (values.length === 0 ? "'{}'::text[]" : `array[${values.map(lit).join(", ")}]::text[]`);

// v5 문서 하나가 KB 문서·Chunk 하나가 된다. 평가셋의 unit 이 곧 인용 단위다.
export const documentRows = (fixture) => fixture.cases.flatMap((kase) => kase.documents.map((doc) => ({
  case_id: kase.id,
  split: kase.split,
  evidence_unit: doc.evidence_unit,
  snapshot_id: stableUuid("snapshot", doc.evidence_unit),
  document_id: stableUuid("document", doc.evidence_unit),
  chunk_id: stableUuid("chunk", doc.evidence_unit),
  text: doc.text,
  facet: doc.facet,
  institution_code: doc.institution_code,
  product_code: doc.product_code,
  channel_type: doc.channel_type,
  effective_from: doc.effective_from,
  effective_to: doc.effective_to,
  authority_level: doc.authority_level,
  source_fingerprint: doc.source_fingerprint,
  source_family: doc.source_family,
})));

export const claimRows = (fixture) => fixture.cases.flatMap((kase) => kase.claims.map((claim) => ({
  case_id: kase.id,
  split: kase.split,
  risk_critical: kase.risk_critical === true,
  coverage: [...(kase.coverage ?? [])],
  key: `${kase.id}:${claim.key}`,
  text: claim.text,
  truth: claim.truth,
  relevant_units: claim.relevant_units.map((k) => `${kase.id}-${k.replace(/^u/, "")}`),
  critical_units: claim.critical_units.map((k) => `${kase.id}-${k.replace(/^u/, "")}`),
  target_institution_code: claim.target_institution_code,
  target_product_code: claim.target_product_code,
  as_of_date: claim.as_of_date,
})));

// 적재 SQL. 한 트랜잭션에서 만들고, 이미 있으면 다시 만들지 않는다.
export const corpusStatements = ({ fixture, documents, embeddings, embeddingModel, embeddingVersion, dimension }) => {
  const releaseId = stableUuid("release", KB_RELEASE_VERSION);
  const manifestId = stableUuid("manifest", MANIFEST_VERSION);
  const out = ["begin;"];

  for (const [type, version] of Object.entries(POLICY_VERSIONS)) {
    out.push(`insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
 values (${lit(type)}, ${lit(version)}, '{"schema_version":1,"note":"retrieval evaluation only"}'::jsonb, '1', ${lit(sha256(`${type}:${version}`))})
 on conflict (policy_type, version) do nothing;`);
  }

  out.push(`insert into kb.kb_releases (id, version, corpus_scope, embedding_model, embedding_model_version, embedding_dimension,
   distance_metric, document_count, chunk_count, manifest_hash)
 values (${lit(releaseId)}, ${lit(KB_RELEASE_VERSION)},
   ${lit(JSON.stringify({ schema_version: CORPUS_SCHEMA_VERSION, fixture_set: fixture.fixture_set }))}::jsonb,
   ${lit(embeddingModel)}, ${lit(embeddingVersion)}, ${dimension}, 'COSINE',
   ${documents.length}, ${documents.length}, ${lit(sha256(`${KB_RELEASE_VERSION}:${documents.length}`))})
 on conflict (id) do nothing;`);

  for (const doc of documents) {
    const hash = sha256(doc.text);
    out.push(`insert into kb.source_snapshots (id, source_type, authority_level, publisher_name, source_title, official_id,
   retrieved_at, content_hash, source_fingerprint, freshness_status, license_code, is_complete, is_citable, effective_from, effective_to)
 values (${lit(doc.snapshot_id)}, 'PRODUCT', ${lit(doc.authority_level)}::public.authority_level, ${lit(doc.source_family)},
   ${lit(`${doc.facet} (${doc.evidence_unit})`)}, ${lit(doc.evidence_unit)}, now(), ${lit(hash)}, ${lit(sha256(`fingerprint:${doc.source_fingerprint}`))},
   'FRESH'::public.freshness_status, 'SYNTHETIC_EVAL', true, true, ${lit(doc.effective_from)}::date, ${lit(doc.effective_to)}::date)
 on conflict (id) do nothing;`);
    out.push(`insert into kb.knowledge_documents (id, kb_release_id, source_snapshot_id, document_key, document_version, document_type,
   title, publisher, scenario_codes, product_codes, institution_codes, channel_codes, valid_from, valid_to,
   ingested_at, content_hash, normalization_version)
 values (${lit(doc.document_id)}, ${lit(releaseId)}, ${lit(doc.snapshot_id)}, ${lit(doc.evidence_unit)}, '1', 'PRODUCT',
   ${lit(`${doc.facet} (${doc.evidence_unit})`)}, ${lit(doc.source_family)}, ${textArray([doc.case_id])},
   ${textArray(doc.product_code ? [doc.product_code] : [])}, ${textArray([doc.institution_code])}, ${textArray([doc.channel_type])},
   ${lit(doc.effective_from)}::date, ${lit(doc.effective_to)}::date, now(), ${lit(hash)}, ${lit(NORMALIZATION_VERSION)})
 on conflict (id) do nothing;`);
    out.push(`insert into kb.knowledge_chunks (id, kb_release_id, knowledge_document_id, chunk_no, chunk_text, source_locator, metadata, token_count, content_hash)
 values (${lit(doc.chunk_id)}, ${lit(releaseId)}, ${lit(doc.document_id)}, 1, ${lit(doc.text)},
   ${lit(JSON.stringify({ evidence_unit: doc.evidence_unit }))}::jsonb,
   ${lit(JSON.stringify({ schema_version: CORPUS_SCHEMA_VERSION, evidence_unit: doc.evidence_unit, facet: doc.facet }))}::jsonb,
   ${Math.max(1, Math.ceil(doc.text.length / 3))}, ${lit(hash)})
 on conflict (id) do nothing;`);
  }

  for (const doc of documents) {
    const vector = embeddings.get(doc.evidence_unit);
    if (!Array.isArray(vector) || vector.length !== dimension) throw new Error(`missing embedding for ${doc.evidence_unit}`);
    out.push(`insert into kb.knowledge_embeddings (kb_release_id, knowledge_chunk_id, model_id, model_version, dimensions, distance_metric, embedding, content_hash)
 values (${lit(releaseId)}, ${lit(doc.chunk_id)}, ${lit(embeddingModel)}, ${lit(embeddingVersion)}, ${dimension}, 'COSINE',
   '[${vector.join(",")}]'::extensions.vector(${dimension}), ${lit(sha256(vector.join(",")))})
 on conflict (knowledge_chunk_id, model_id, model_version) do nothing;`);
  }

  out.push(`insert into private.execution_manifests (id, manifest_version, scenario, scenario_version, model_bundle,
   prompt_bundle_version, schema_bundle_version, evidence_policy_version, result_matrix_version, coverage_contract_version,
   profile_policy_version, pii_policy_version, kb_release_id, embedding_model, embedding_dimension, config_hash)
 values (${lit(manifestId)}, ${lit(MANIFEST_VERSION)}, 'LOAN'::public.case_scenario, '1',
   '{"schema_version":1,"note":"retrieval evaluation only"}'::jsonb, '1', '1',
   ${lit(POLICY_VERSIONS.EVIDENCE)}, ${lit(POLICY_VERSIONS.RESULT_MATRIX)}, ${lit(POLICY_VERSIONS.COVERAGE)},
   ${lit(POLICY_VERSIONS.PROFILE)}, ${lit(POLICY_VERSIONS.PII)}, ${lit(releaseId)}, ${lit(embeddingModel)}, ${dimension},
   ${lit(sha256(`${MANIFEST_VERSION}:${releaseId}`))})
 on conflict (id) do nothing;`);
  out.push("commit;");
  return { releaseId, manifestId, statements: out };
};
