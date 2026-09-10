// B-CLAIM-01: 사전등록 Claim 평가셋의 판정 품질과 금지 동작을 결과 원장에서 다시 계산한다.
// 배분·정답·수용값은 .github/fixtures/claim-quality-v1/manifest.json 과
// docs/ops/claim-quality-preregistration.md 가 측정 전에 고정한 값이다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const FORMULA_VERSION = 'claim-verdict-state-ledger-v1';
export const FIXTURE_DIR = '.github/fixtures/claim-quality-v1';

/** N-QLT-004 가 요구하는 여섯 상태다. 하나라도 표본이 없으면 평가 실패다. */
export const REQUIRED_STATES = Object.freeze([
  'VERIFIED', 'CONTRADICTED', 'CONFLICT', 'UNKNOWN', 'NEED_MORE_INFORMATION', 'WITHHELD',
]);
const CONFIRMED = Object.freeze(['VERIFIED', 'CONTRADICTED']);
const ABSTAINED = Object.freeze(['CONFLICT', 'UNKNOWN', 'NEED_MORE_INFORMATION', 'WITHHELD']);

const CLAIM_ROW = ['id', 'gold_verdict', 'observed_verdict', 'qualified_evidence', 'independent_sources',
  'citation_valid', 'reference_only_used_as_proof', 'elapsed_ms'];

const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const nonNegativeInt = (value) => Number.isInteger(value) && value >= 0;
/** 분모가 0이면 비율을 만들지 않고 N/A 로 남긴다. 0/0 을 1.0 으로 세지 않는다. */
const ratio = (numerator, denominator) => (denominator === 0 ? null : numerator / denominator);

export function loadClaimQualityFixture(repository) {
  const manifest = JSON.parse(readFileSync(resolve(repository, FIXTURE_DIR, 'manifest.json'), 'utf8'));
  const fail = (code) => { throw new Error(code); };
  if (manifest.version !== 'claim-quality-v1' || manifest.synthetic_only !== true
    || manifest.independent_blind_review !== false) fail('CLAIM_FIXTURE_INVALID');
  if (!Array.isArray(manifest.claims_list) || manifest.claims_list.length !== manifest.claims
    || manifest.claims !== 60 || manifest.families !== 20) fail('CLAIM_FIXTURE_SIZE_INVALID');
  const seen = new Set();
  const states = new Set();
  for (const claim of manifest.claims_list) {
    if (seen.has(claim.id)) fail('CLAIM_FIXTURE_DUPLICATE_ID');
    seen.add(claim.id);
    if (!REQUIRED_STATES.includes(claim.gold_verdict)) fail('CLAIM_FIXTURE_STATE_INVALID');
    states.add(claim.gold_verdict);
    // 확정 정답에는 자격 있는 공식 근거 유형이 반드시 붙어 있어야 한다.
    if (CONFIRMED.includes(claim.gold_verdict)
      && !['official-product', 'official-institution', 'official-statute', 'official-alert'].includes(claim.required_evidence)) {
      fail('CLAIM_FIXTURE_CONFIRMED_WITHOUT_EVIDENCE');
    }
    if (ABSTAINED.includes(claim.gold_verdict) && claim.required_evidence === 'reference-only'
      && claim.gold_verdict !== 'WITHHELD') fail('CLAIM_FIXTURE_REFERENCE_ONLY_MISUSE');
  }
  if (REQUIRED_STATES.some((state) => !states.has(state))) fail('CLAIM_FIXTURE_STATE_MISSING');
  return manifest;
}

/**
 * 원장에서 지표를 다시 계산한다. 결과가 스스로 적은 'PASS' 나 비율은 읽지 않는다.
 * 반환값은 지표이며 통과 여부는 fail 호출 여부로 나타난다.
 */
export function validateClaimQualityResult(result, fail, { manifest } = {}) {
  if (!manifest) { fail('사전등록 Claim 평가셋을 읽지 못했습니다.'); return null; }
  const o = result?.observations;
  if (!exact(o, ['contract', 'extraction', 'claims', 'forbidden'])) { fail('Claim 판정 관측 필드가 계약과 다릅니다.'); return null; }

  const c = o.contract;
  if (!exact(c, ['formula_version', 'fixture_version', 'families', 'claims', 'real_agent_pipeline'])
    || c.formula_version !== FORMULA_VERSION || c.fixture_version !== manifest.version
    || c.families !== manifest.families || c.claims !== manifest.claims || c.real_agent_pipeline !== true) {
    fail('Claim 평가셋·산식·실제 Agent 실행 계약이 다릅니다.');
  }

  const e = o.extraction;
  if (!exact(e, ['gold_claims', 'extracted_claims', 'matched_claims'])
    || !nonNegativeInt(e.gold_claims) || !nonNegativeInt(e.extracted_claims) || !nonNegativeInt(e.matched_claims)
    || e.gold_claims !== manifest.claims || e.matched_claims > e.gold_claims || e.matched_claims > e.extracted_claims) {
    fail('Claim 추출 원장이 유효하지 않습니다.'); return null;
  }
  const extractionRecall = ratio(e.matched_claims, e.gold_claims);
  const extractionPrecision = ratio(e.matched_claims, e.extracted_claims);
  if (extractionRecall === null || extractionRecall < manifest.acceptance.extraction_recall_min) fail('Claim 추출 Recall 이 사전등록 수용값에 못 미칩니다.');
  if (extractionPrecision === null || extractionPrecision < manifest.acceptance.extraction_precision_min) fail('Claim 추출 Precision 이 사전등록 수용값에 못 미칩니다.');

  if (!Array.isArray(o.claims) || o.claims.length !== manifest.claims) { fail('Claim 표본 수가 평가셋과 다릅니다.'); return null; }
  const goldById = new Map(manifest.claims_list.map((claim) => [claim.id, claim]));
  const goldStates = new Set();
  const observedStates = new Set();
  let confirmed = 0, confirmedCorrect = 0, unsupportedConfirmed = 0, coveredConfirmed = 0;
  let abstainGold = 0, abstainCorrect = 0, normalFalseAlarm = 0, normalGold = 0;

  for (const [index, row] of o.claims.entries()) {
    const gold = goldById.get(manifest.claims_list[index]?.id);
    if (!exact(row, CLAIM_ROW) || !gold || row.id !== gold.id || row.gold_verdict !== gold.gold_verdict) {
      fail(`Claim 원장 ${manifest.claims_list[index]?.id ?? index} 이 사전등록 항목과 다릅니다.`); continue;
    }
    if (!REQUIRED_STATES.includes(row.observed_verdict)) { fail(`Claim ${row.id} 의 판정 상태가 여섯 상태 밖입니다.`); continue; }
    if (!nonNegativeInt(row.qualified_evidence) || !nonNegativeInt(row.independent_sources) || !nonNegativeInt(row.elapsed_ms)
      || typeof row.citation_valid !== 'boolean' || typeof row.reference_only_used_as_proof !== 'boolean') {
      fail(`Claim ${row.id} 의 근거 원장이 유효하지 않습니다.`); continue;
    }
    goldStates.add(row.gold_verdict);
    observedStates.add(row.observed_verdict);

    if (CONFIRMED.includes(row.observed_verdict)) {
      confirmed += 1;
      if (row.observed_verdict === row.gold_verdict) confirmedCorrect += 1;
      if (row.qualified_evidence < 1) unsupportedConfirmed += 1; else coveredConfirmed += 1;
      // 확정 판정은 실제 인용이 유효해야 하고 참고용 사례를 증명으로 쓸 수 없다.
      if (!row.citation_valid) fail(`Claim ${row.id} 이 유효하지 않은 인용으로 확정됐습니다.`);
      if (row.reference_only_used_as_proof) fail(`Claim ${row.id} 이 참고용 사례로 확정됐습니다.`);
      if (row.independent_sources < 1) fail(`Claim ${row.id} 의 독립 출처가 0건인데 확정됐습니다.`);
    }
    if (ABSTAINED.includes(row.gold_verdict)) {
      abstainGold += 1;
      if (row.observed_verdict === row.gold_verdict) abstainCorrect += 1;
    }
    if (row.gold_verdict === 'VERIFIED') {
      normalGold += 1;
      if (row.observed_verdict === 'CONTRADICTED') normalFalseAlarm += 1;
    }
  }

  // 상태 표본 누락은 평가 실패다. 관측이 여섯 상태를 모두 쓸 필요는 없지만 정답은 모두 있어야 한다.
  if (REQUIRED_STATES.some((state) => !goldStates.has(state))) fail('여섯 상태 정답 표본이 모두 있지 않습니다.');

  const verificationPrecision = ratio(confirmedCorrect, confirmed);
  const evidenceCoverage = ratio(coveredConfirmed, confirmed);
  const abstentionRecall = ratio(abstainCorrect, abstainGold);
  const normalFalseAlarmRate = ratio(normalFalseAlarm, normalGold);
  const a = manifest.acceptance;
  // 확정이 0건이면 비율이 N/A 다. 모든 정상 사례를 보류하는 회피는 금지 동작으로 따로 잡는다.
  if (verificationPrecision !== null && verificationPrecision < a.verification_precision_min) fail('확정 판정 Precision 이 사전등록 수용값에 못 미칩니다.');
  if (evidenceCoverage !== null && evidenceCoverage < a.evidence_coverage_min) fail('확정 판정의 공식 근거 Coverage 가 사전등록 수용값에 못 미칩니다.');
  if (unsupportedConfirmed > a.unsupported_confirmed_max) fail('근거 없이 확정한 Claim 이 있습니다.');
  if (abstentionRecall === null || abstentionRecall < a.abstention_recall_min) fail('보류·충돌 상태 재현이 사전등록 수용값에 못 미칩니다.');
  if (normalFalseAlarm > a.normal_false_alarm_max) fail('정상 Claim 을 위반으로 확정했습니다.');

  const f = o.forbidden;
  if (!exact(f, manifest.forbidden_behaviours)) { fail('금지 동작 계측 항목이 사전등록 목록과 다릅니다.'); return null; }
  for (const name of manifest.forbidden_behaviours) {
    if (!nonNegativeInt(f[name])) { fail(`금지 동작 계측 ${name} 이 유효하지 않습니다.`); continue; }
    if (f[name] > a.forbidden_behaviour_max) fail(`금지 동작이 발생했습니다: ${name}`);
  }

  return {
    extraction_recall: extractionRecall, extraction_precision: extractionPrecision,
    verification_precision: verificationPrecision, evidence_coverage: evidenceCoverage,
    abstention_recall: abstentionRecall, normal_false_alarm_rate: normalFalseAlarmRate,
    unsupported_confirmed: unsupportedConfirmed, confirmed, abstain_gold: abstainGold,
    observed_states: [...observedStates].sort(),
  };
}
