// ============================================================
// B-RETRIEVAL-01 종단 파이프라인.
//
// 단계 계약은 사전등록 4.1 을 따른다.
//   Metadata Filter → Keyword(Postgres tsvector) → Vector(Exact KNN) : DB 함수가 한다.
//   Rerank : 아래 결정적 점수로 이 모듈이 한다.
// 측정 단위는 사전등록 8.2 에 따라 Case 다. Case 하나가 top 5 하나를 낸다.
//
// 점수는 측정 전에 고정한다. 가중치·환산식을 결과를 본 뒤 바꾸지 않는다.
// ============================================================
export const CANDIDATE_POOL_K = 20;
export const TOP_K = 5;
export const RERANK_WEIGHTS = Object.freeze({ relevance: 0.60, authority: 0.25, freshness: 0.15 });
export const RELEVANCE_WEIGHTS = Object.freeze({ vector: 0.70, keyword: 0.30 });
export const AUTHORITY_SCORE = Object.freeze({ A: 1.0, B: 0.6, C: 0.3 });

const clamp01 = (value) => Math.min(1, Math.max(0, value));
// cosine 거리는 0..2 다. 1 - 거리 를 0..1 로 자른다.
export const vectorScore = (distance) => (typeof distance === "number" ? clamp01(1 - distance) : 0);
// ts_rank 는 절대값에 의미가 없다. 같은 질의 안에서 최대값으로 나눈다.
export const keywordScore = (rank, maxRank) => (typeof rank === "number" && maxRank > 0 ? clamp01(rank / maxRank) : 0);
// Filter 가 이미 기준일 밖을 제외했으므로 후보는 모두 현재 유효하다. 종료일이 있다는 사실은
// 낡음의 근거가 아니다. 같은 후보 집합 안에서 더 최근에 효력이 생긴 자료를 더 높게 본다.
// 첫 측정(run 34027686263)의 freshness slice 가 가장 낮았고, 종료일만 보고 절반으로 깎던
// 규칙이 현재 유효한 자료를 부당하게 눌렀다.
export const freshnessScore = (effectiveFrom, { oldest, newest }) => {
  if (!effectiveFrom || !oldest || !newest || oldest === newest) return 1;
  const span = Date.parse(newest) - Date.parse(oldest);
  if (!Number.isFinite(span) || span <= 0) return 1;
  const age = Date.parse(effectiveFrom) - Date.parse(oldest);
  return Number.isFinite(age) ? clamp01(age / span) : 1;
};

export const candidateScore = ({ relevance, authorityLevel, effectiveFrom, effectiveRange }) => (
  (RERANK_WEIGHTS.relevance * clamp01(relevance))
  + (RERANK_WEIGHTS.authority * (AUTHORITY_SCORE[authorityLevel] ?? 0))
  + (RERANK_WEIGHTS.freshness * freshnessScore(effectiveFrom, effectiveRange ?? {}))
);

// 한 Claim 의 후보를 DB 에서 받는다. Filter 는 기관과 기준일만 건다 (평가셋 filter_policy).
export const searchClaim = async ({ sql, manifestId, claim, embedding }) => {
  const rows = await sql`
    select * from private.search_public_knowledge(
      ${manifestId}::uuid, ${claim.text}::text, ${`[${embedding.join(",")}]`}::extensions.vector,
      ${[claim.target_institution_code]}::text[], null::text[], null::text[], null::text,
      ${claim.as_of_date}::date, ${CANDIDATE_POOL_K}::integer)`;
  return rows;
};

// Filter 가 통과시킨 문서 목록. 정답이 Filter 에서 빠졌는지 확인하는 데 쓴다.
export const filteredUnits = async ({ sql, releaseId, claim }) => {
  const rows = await sql`
    select d.document_key as unit
      from kb.knowledge_documents d
     where d.kb_release_id = ${releaseId}::uuid
       and d.institution_codes && ${[claim.target_institution_code]}::text[]
       and (d.valid_from is null or d.valid_from <= ${claim.as_of_date}::date)
       and (d.valid_to is null or d.valid_to >= ${claim.as_of_date}::date)`;
  return rows.map((r) => r.unit);
};

// Case 하나의 최종 top 5. Claim 5개 결과의 합집합에 Rerank 를 건다.
export const rerankCase = ({ claimResults, provenance }) => {
  const best = new Map(); // chunk_id → 후보
  for (const { claim, rows } of claimResults) {
    const maxRank = rows.reduce((max, row) => Math.max(max, typeof row.keyword_rank === "number" ? row.keyword_rank : 0), 0);
    for (const row of rows) {
      const meta = provenance.get(row.source_snapshot_id);
      const relevance = (RELEVANCE_WEIGHTS.vector * vectorScore(row.vector_distance))
        + (RELEVANCE_WEIGHTS.keyword * keywordScore(row.keyword_rank, maxRank));
      const existing = best.get(row.chunk_id);
      const candidate = {
        chunk_id: row.chunk_id,
        unit: meta.unit,
        fingerprint: meta.fingerprint,
        authority_level: meta.authority_level,
        valid_to: row.valid_to ?? null,
        effective_from: meta.effective_from,
        matched_by: row.matched_by,
        relevance,
        claims: [claim.key],
      };
      if (!existing) { best.set(row.chunk_id, candidate); continue; }
      existing.claims.push(claim.key);
      if (relevance > existing.relevance) { existing.relevance = relevance; existing.matched_by = row.matched_by; }
    }
  }

  // 같은 출처 지문은 하나로 계산한다 (사전등록 4.1). 점수가 높은 쪽만 남긴다.
  const effectiveDates = [...best.values()].map((c) => c.effective_from).filter(Boolean).sort();
  const effectiveRange = { oldest: effectiveDates[0] ?? null, newest: effectiveDates.at(-1) ?? null };
  const byFingerprint = new Map();
  for (const candidate of best.values()) {
    candidate.score = candidateScore({
      relevance: candidate.relevance, authorityLevel: candidate.authority_level,
      effectiveFrom: candidate.effective_from, effectiveRange,
    });
    const kept = byFingerprint.get(candidate.fingerprint);
    if (!kept || candidate.score > kept.score) byFingerprint.set(candidate.fingerprint, candidate);
  }
  const collapsed = best.size - byFingerprint.size;

  const ordered = [...byFingerprint.values()].sort((left, right) => (
    right.score - left.score
    || (AUTHORITY_SCORE[right.authority_level] ?? 0) - (AUTHORITY_SCORE[left.authority_level] ?? 0)
    || String(right.effective_from ?? "").localeCompare(String(left.effective_from ?? ""))
    || String(left.unit).localeCompare(String(right.unit))
  ));
  return { top: ordered.slice(0, TOP_K), poolSize: best.size, deduped: byFingerprint.size, collapsed, ordered, effectiveRange };
};

// Case 단위 지표. 관련 unit 은 그 Case 의 Claim 들이 가리키는 unit 합집합이다.
export const caseMetrics = ({ relevantUnits, criticalUnits, top }) => {
  const found = top.filter((c) => relevantUnits.has(c.unit)).length;
  const criticalFound = [...criticalUnits].filter((u) => top.some((c) => c.unit === u)).length;
  return {
    recall_at_5: relevantUnits.size === 0 ? null : found / relevantUnits.size,
    precision_at_5: found / TOP_K,
    critical_recall_at_5: criticalUnits.size === 0 ? null : criticalFound / criticalUnits.size,
    found,
    critical_found: criticalFound,
  };
};

export const percentile = (values, fraction) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
};

export const macroAverage = (values) => {
  const usable = values.filter((v) => typeof v === "number");
  return usable.length === 0 ? null : usable.reduce((sum, v) => sum + v, 0) / usable.length;
};
