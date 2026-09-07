// 개발 전용: 기존 Case 자리 배분·출처 중복 제거를 유지하고 relevance만 Fast로 대체한다.
import { AUTHORITY_SCORE, candidateScore, TOP_K } from "./retrieval-pipeline.mjs";
export const rerankFastCase = ({ claimResults, provenance }) => {
  const best = new Map(); // chunk_id → 후보
  for (const { claim, rows } of claimResults) {
    for (const row of rows) {
      const meta = provenance.get(row.source_snapshot_id);
      const relevance = row.fast_score;
      if (!Number.isFinite(relevance) || relevance < 0 || relevance > 1) throw new Error("FAST_SCORE_INVALID");
      const existing = best.get(row.chunk_id);
      const candidate = {
        claim_relevance: { [claim.key]: relevance },
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
      existing.claim_relevance[claim.key] = Math.max(existing.claim_relevance[claim.key] ?? 0, relevance);
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
  // Case 의 근거 묶음은 Claim 을 모두 대표해야 한다. 전체 점수 상위 5개만 뽑으면 어떤 Claim 의
  // 근거가 하나도 들어가지 않을 수 있고, 그것은 Claim 마다 근거를 요구하는 제품 계약과 어긋난다.
  // 먼저 Claim 마다 그 Claim 에서 가장 높은 후보에 한 자리를 주고, 남는 자리를 전체 점수로 채운다.
  const claimKeys = claimResults.map((entry) => entry.claim.key);
  const chosen = [];
  const taken = new Set();
  for (const key of claimKeys) {
    const forClaim = ordered
      .filter((c) => !taken.has(c.unit) && typeof c.claim_relevance?.[key] === "number")
      .sort((left, right) => (right.claim_relevance[key] - left.claim_relevance[key]) || (right.score - left.score)
        || String(left.unit).localeCompare(String(right.unit)));
    if (forClaim.length > 0 && chosen.length < TOP_K) { chosen.push(forClaim[0]); taken.add(forClaim[0].unit); }
  }
  for (const candidate of ordered) {
    if (chosen.length >= TOP_K) break;
    if (!taken.has(candidate.unit)) { chosen.push(candidate); taken.add(candidate.unit); }
  }
  const top = chosen.sort((left, right) => right.score - left.score
    || String(left.unit).localeCompare(String(right.unit))).slice(0, TOP_K);
  return { top, poolSize: best.size, deduped: byFingerprint.size, collapsed, ordered, effectiveRange };
};

