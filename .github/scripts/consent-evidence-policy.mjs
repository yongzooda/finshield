// ============================================================
// B-CONSENT-01 사전 고정 합격선.
//
// ADR 14.2 해제 조건: §15.1 동의 거절 전송 0건 + 감사 row.
// 요구사항 SEC-PRI-010 은 동의 거절 시 외부 전송 0회를, SEC-AI-007 은 모델에
// 마스킹된 데이터만 나갈 것을 요구한다.
//
// 거부만 잘하는 게이트는 통과가 아니다. 허용 경로가 실제로 전송했는지도 본다.
// ============================================================
import { BLOCK_REASONS, EVENT_BLOCKED, EVENT_SENT } from "./consent-gate.mjs";
import { FORMULA_VERSION, SCENARIOS } from "./consent-privacy-spike.mjs";

export { FORMULA_VERSION };
export const MIN_PII_FIXTURES = 100;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

export const validateConsentEvidenceResult = (result, fail) => {
  const o = result?.observations;
  if (!exactKeys(o, ["contract", "scenarios", "transfer", "mask"])) {
    fail("observations 는 contract·scenarios·transfer·mask 만 가져야 합니다.");
    return;
  }

  const c = o.contract;
  if (!exactKeys(c, ["formula_version", "consent_type", "scenarios", "block_reasons", "sent_event", "blocked_event",
    "pii_fixtures", "clean_fixtures"])
    || c.formula_version !== FORMULA_VERSION || c.consent_type !== "EXTERNAL_OCR_RAW_TRANSFER"
    || c.sent_event !== EVENT_SENT || c.blocked_event !== EVENT_BLOCKED
    || JSON.stringify(c.scenarios) !== JSON.stringify(SCENARIOS.map((s) => s.key))
    || JSON.stringify([...(c.block_reasons ?? [])].sort()) !== JSON.stringify([...BLOCK_REASONS].sort())) {
    fail("contract 의 산식·동의 유형·시나리오 목록이 현재 코드와 다릅니다.");
  }

  // 시나리오. 기대한 차단 사유와 실제 사유가 하나하나 같아야 한다.
  const rows = Array.isArray(o.scenarios) ? o.scenarios : [];
  if (rows.length !== SCENARIOS.length) fail("시나리오 기록 수가 계약과 다릅니다.");
  for (const scenario of SCENARIOS) {
    const row = rows.find((r) => r.scenario === scenario.key);
    if (!row) { fail(`시나리오 '${scenario.key}' 기록이 없습니다.`); continue; }
    if (!exactKeys(row, ["scenario", "expected_block", "sent", "reason", "transmissions", "audit_events"])) {
      fail(`시나리오 '${scenario.key}' 기록이 계약과 다릅니다.`);
      continue;
    }
    if (row.expected_block !== (scenario.expect ?? null)) fail(`시나리오 '${scenario.key}' 의 기대 사유가 계약과 다릅니다.`);
    if (scenario.expect === null) {
      if (row.sent !== true || row.transmissions !== 1) fail(`동의한 시나리오 '${scenario.key}' 가 전송하지 않았습니다.`);
      if (row.reason !== null) fail(`동의한 시나리오 '${scenario.key}' 에 차단 사유가 남았습니다.`);
    } else {
      if (row.sent !== false || row.transmissions !== 0) fail(`동의하지 않은 시나리오 '${scenario.key}' 가 전송했습니다.`);
      if (row.reason !== scenario.expect) fail(`시나리오 '${scenario.key}' 의 차단 사유가 기대와 다릅니다.`);
      if (!BLOCK_REASONS.includes(row.reason)) fail(`시나리오 '${scenario.key}' 의 차단 사유가 목록에 없습니다.`);
    }
    const expectedEvent = scenario.expect === null ? `${EVENT_SENT}:OK:-` : `${EVENT_BLOCKED}:BLOCKED:${scenario.expect}`;
    if (!Array.isArray(row.audit_events) || row.audit_events.length !== 1 || row.audit_events[0] !== expectedEvent) {
      fail(`시나리오 '${scenario.key}' 의 감사 기록이 하나가 아니거나 내용이 다릅니다.`);
    }
  }

  const t = o.transfer;
  if (!exactKeys(t, ["denied_scenarios", "denied_transmissions", "granted_scenarios", "granted_transmissions",
    "total_received", "raw_marker_leaks", "audit_rows_missing", "wrong_audit_event"])) {
    fail("transfer 필드가 계약과 다릅니다.");
  } else {
    if (t.denied_transmissions !== 0) fail("동의하지 않은 경로에서 외부 전송이 있었습니다.");
    if (t.denied_scenarios !== SCENARIOS.filter((s) => s.expect !== null).length) fail("거절 시나리오 수가 계약과 다릅니다.");
    // 모두 막기만 하는 게이트는 통과가 아니다. 허용 경로가 실제로 전송해야 한다.
    if (t.granted_scenarios < 1 || t.granted_transmissions !== t.granted_scenarios) fail("동의한 경로가 전송하지 않았습니다.");
    if (t.total_received !== t.granted_transmissions) fail("외부가 받은 수가 동의한 전송 수와 다릅니다.");
    if (t.raw_marker_leaks !== 0) fail("외부가 받은 내용이 보내려던 원본과 다릅니다.");
    if (t.audit_rows_missing !== 0) fail("감사 기록이 없는 결정이 있습니다.");
    if (t.wrong_audit_event !== 0) fail("결정과 다른 감사 기록이 있습니다.");
  }

  const m = o.mask;
  if (!exactKeys(m, ["pii_fixtures", "sent_to_model", "blocked_by_residual", "passed_with_secret",
    "clean_fixtures", "clean_blocked"])) {
    fail("mask 필드가 계약과 다릅니다.");
  } else {
    if (m.pii_fixtures < MIN_PII_FIXTURES) fail(`PII fixture 가 ${MIN_PII_FIXTURES}건에 못 미칩니다.`);
    if (m.passed_with_secret !== 0) fail("마스킹을 통과한 문장에 원문 식별자가 남았습니다.");
    if (m.sent_to_model + m.blocked_by_residual !== m.pii_fixtures) fail("모델 전송과 차단의 합이 fixture 수와 다릅니다.");
    if (m.sent_to_model < 1) fail("모델로 나간 문장이 하나도 없습니다.");
    if (m.clean_fixtures < 1) fail("정상 문장 fixture 가 없습니다.");
    if (m.clean_blocked !== 0) fail("정상 문장이 잘못 차단됐습니다.");
  }
};
