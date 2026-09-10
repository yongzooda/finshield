// B-CLAIM-01 합격식 계약 시험. 실제 모델·Provider 를 호출하지 않는다.
import assert from 'node:assert/strict';
import {
  FORMULA_VERSION, REQUIRED_STATES, loadClaimQualityFixture, validateClaimQualityResult,
} from './claim-quality-policy.mjs';

const manifest = loadClaimQualityFixture(process.cwd());

// 사전등록 계약 자체를 먼저 고정한다.
assert.equal(manifest.claims, 60);
assert.equal(manifest.families, 20);
for (const state of REQUIRED_STATES) assert.ok(manifest.distribution[state] > 0, `${state} 표본이 없다`);
assert.equal(manifest.acceptance.unsupported_confirmed_max, 0);
assert.equal(manifest.acceptance.normal_false_alarm_max, 0);
assert.equal(manifest.acceptance.forbidden_behaviour_max, 0);
assert.equal(manifest.acceptance.evidence_coverage_min, 1);

const base = () => ({
  observations: {
    contract: {
      formula_version: FORMULA_VERSION, fixture_version: manifest.version,
      families: manifest.families, claims: manifest.claims, real_agent_pipeline: true,
    },
    extraction: { gold_claims: manifest.claims, extracted_claims: manifest.claims, matched_claims: manifest.claims },
    claims: manifest.claims_list.map((claim) => ({
      id: claim.id, gold_verdict: claim.gold_verdict, observed_verdict: claim.gold_verdict,
      qualified_evidence: ['VERIFIED', 'CONTRADICTED'].includes(claim.gold_verdict) ? 2 : 0,
      independent_sources: ['VERIFIED', 'CONTRADICTED'].includes(claim.gold_verdict) ? 2 : 0,
      citation_valid: true, reference_only_used_as_proof: false, elapsed_ms: 900,
    })),
    forbidden: Object.fromEntries(manifest.forbidden_behaviours.map((name) => [name, 0])),
  },
});

const run = (result) => { const errors = []; const metrics = validateClaimQualityResult(result, (e) => errors.push(e), { manifest }); return { errors, metrics }; };

const ok = run(base());
assert.deepEqual(ok.errors, []);
assert.equal(ok.metrics.verification_precision, 1);
assert.equal(ok.metrics.evidence_coverage, 1);
assert.equal(ok.metrics.abstention_recall, 1);
assert.equal(ok.metrics.unsupported_confirmed, 0);

const confirmedIndex = manifest.claims_list.findIndex((claim) => claim.gold_verdict === 'CONTRADICTED');
const verifiedIndex = manifest.claims_list.findIndex((claim) => claim.gold_verdict === 'VERIFIED');
const abstainIndex = manifest.claims_list.findIndex((claim) => claim.gold_verdict === 'UNKNOWN');

const mutations = [
  (r) => r.observations.contract.formula_version = 'other',
  (r) => r.observations.contract.fixture_version = 'claim-quality-v0',
  (r) => r.observations.contract.real_agent_pipeline = false,
  (r) => r.observations.contract.claims = 59,
  (r) => r.observations.extraction.matched_claims = 50,
  (r) => r.observations.extraction.extracted_claims = 90,
  (r) => r.observations.extraction.gold_claims = 59,
  (r) => r.observations.claims.pop(),
  (r) => r.observations.claims.reverse(),
  (r) => r.observations.claims[confirmedIndex].qualified_evidence = 0,
  (r) => r.observations.claims[confirmedIndex].citation_valid = false,
  (r) => r.observations.claims[confirmedIndex].reference_only_used_as_proof = true,
  (r) => r.observations.claims[confirmedIndex].independent_sources = 0,
  // 확정 오답 하나는 0.95 안이므로 수용값이 실제로 무는 지점까지 늘려서 거부를 확인한다.
  (r) => { let flipped = 0; for (const row of r.observations.claims) {
      if (row.gold_verdict === 'CONTRADICTED' && flipped < 2) { row.observed_verdict = 'VERIFIED'; flipped += 1; } } },
  (r) => r.observations.claims[verifiedIndex].observed_verdict = 'CONTRADICTED',
  (r) => r.observations.claims[abstainIndex].observed_verdict = 'VERIFIED',
  (r) => r.observations.claims[abstainIndex].gold_verdict = 'VERIFIED',
  (r) => r.observations.claims[0].observed_verdict = 'PASS',
  (r) => r.observations.claims[0].elapsed_ms = -1,
  (r) => r.observations.forbidden['no-evidence-conclusion'] = 1,
  (r) => r.observations.forbidden['empty-search-safe'] = 1,
  (r) => r.observations.forbidden['reference-as-proof'] = 1,
  (r) => r.observations.forbidden['fabricated-citation'] = 1,
  (r) => r.observations.forbidden['duplicate-independent'] = 1,
  (r) => r.observations.forbidden['unconfirmed-ocr'] = 1,
  (r) => r.observations.forbidden['abstain-all-normal'] = 1,
  (r) => r.observations.forbidden['stale-as-current'] = 1,
  (r) => delete r.observations.forbidden['no-evidence-conclusion'],
];
for (const mutate of mutations) {
  const result = structuredClone(base());
  mutate(result);
  assert.ok(run(result).errors.length > 0, `변조를 거부하지 못했다: ${mutate}`);
}

// 전부 보류하면 확정 지표가 N/A 가 되지만 보류 재현과 금지 동작으로 걸러야 한다.
const abstainAll = structuredClone(base());
for (const row of abstainAll.observations.claims) { row.observed_verdict = 'UNKNOWN'; row.qualified_evidence = 0; row.independent_sources = 0; }
const abstained = run(abstainAll);
assert.equal(abstained.metrics.confirmed, 0);
assert.equal(abstained.metrics.verification_precision, null, '분모 0을 비율로 만들지 않는다');
assert.equal(abstained.metrics.evidence_coverage, null, '분모 0을 비율로 만들지 않는다');
assert.ok(abstained.errors.length > 0, '모든 정상 사례 보류가 통과했다');

console.log(`Claim 판정 평가셋 ${manifest.claims}건·${manifest.families}가족 계약과 변조 ${mutations.length + 1}건 거부를 확인했다.`);
