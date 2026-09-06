// B-CONSENT-01 계약 시험. 외부 호출 없이 게이트·fixture SQL·정책을 확인한다.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BLOCK_REASONS, EVENT_BLOCKED, EVENT_SENT, maskedIntake, sendRawToExternalOcr } from "./consent-gate.mjs";
import { FORMULA_VERSION, RAW_MARKER, SCENARIOS, createRecordingOcrClient, fixtureSql, idsFor, scenarioSql } from "./consent-privacy-spike.mjs";
import { MIN_PII_FIXTURES, validateConsentEvidenceResult } from "./consent-evidence-policy.mjs";

let passed = 0;
let rejected = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };

// ---------- 1. 시나리오 구성 ----------
ok(SCENARIOS.length >= 7, "시나리오가 일곱 개 이상이어야 한다");
ok(SCENARIOS.filter((s) => s.expect === null).length === 1, "허용 시나리오가 정확히 하나여야 한다");
ok(SCENARIOS.filter((s) => s.expect !== null).length >= 6, "거절 시나리오가 여섯 개 이상이어야 한다");
for (const scenario of SCENARIOS) {
  if (scenario.expect !== null) ok(BLOCK_REASONS.includes(scenario.expect), `${scenario.key} 의 사유가 목록에 있어야 한다`);
}
ok(new Set(SCENARIOS.map((s) => s.key)).size === SCENARIOS.length, "시나리오 키가 겹치지 않아야 한다");
ok(SCENARIOS.some((s) => s.expect === "SUPERSEDED"), "대체 이상 상태 시나리오가 있어야 한다");
ok(SCENARIOS.some((s) => s.expect === "RAW_DELETED"), "원본 삭제 뒤 차단 시나리오가 있어야 한다");

// ---------- 2. fixture SQL ----------
const ids = idsFor("abc123");
const base = fixtureSql(ids);
ok(base.trim().startsWith("begin;") && base.trim().endsWith("commit;"), "기본 fixture 는 한 트랜잭션이어야 한다");
for (const table of ["auth.users", "public.financial_profiles", "public.financial_profile_versions", "public.financial_cases"]) {
  ok(base.includes(`insert into ${table}`), `${table} fixture 가 있어야 한다`);
}
const [inputId, objectId, consentId, supersedeId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
for (const scenario of SCENARIOS) {
  const sql = scenarioSql(ids, scenario, inputId, objectId, consentId, supersedeId);
  ok(sql.includes("insert into public.case_inputs"), `${scenario.key} 에 입력 fixture 가 있어야 한다`);
  ok(sql.includes("insert into private.input_objects"), `${scenario.key} 에 객체 fixture 가 있어야 한다`);
  ok(sql.includes(consentId) === Boolean(scenario.decision), `${scenario.key} 의 동의 유무가 계약과 같아야 한다`);
  ok(sql.includes("deleted_at = now()") === Boolean(scenario.deleteRaw), `${scenario.key} 의 원본 삭제 여부가 계약과 같아야 한다`);
  ok(sql.includes("external_ocr_consent_id") === Boolean(scenario.link && scenario.decision), `${scenario.key} 의 연결 여부가 계약과 같아야 한다`);
}

// ---------- 3. 게이트 동작 ----------
// 가짜 sql: 게이트가 부르는 질의를 순서대로 돌려준다.
const fakeSql = (plan) => {
  let index = 0;
  const tag = () => plan[index++];
  const fn = () => Promise.resolve(tag());
  fn.unsafe = () => Promise.resolve([]);
  return fn;
};
{
  const client = createRecordingOcrClient();
  const sql = fakeSql([[{ alive: 0 }], []]); // 원본 없음 → 차단, 감사 삽입
  const out = await sendRawToExternalOcr({ sql, ownerId: ids.owner, caseId: ids.kase, inputId, bytes: RAW_MARKER, correlationId: randomUUID(), ocrClient: client });
  ok(out.sent === false && out.reason === "RAW_DELETED", "원본이 없으면 차단해야 한다");
  ok(client.received.length === 0, "차단이면 외부가 아무것도 받지 않아야 한다");
}
{
  const client = createRecordingOcrClient();
  const sql = fakeSql([[{ alive: 1 }], [{ id: consentId, decision: "DENIED", superseded: false }], []]);
  const out = await sendRawToExternalOcr({ sql, ownerId: ids.owner, caseId: ids.kase, inputId, bytes: RAW_MARKER, correlationId: randomUUID(), ocrClient: client });
  ok(out.sent === false && out.reason === "DENIED", "거절이면 차단해야 한다");
  ok(client.received.length === 0, "거절이면 외부가 아무것도 받지 않아야 한다");
}
{
  const client = createRecordingOcrClient();
  const sql = fakeSql([[{ alive: 1 }], [{ id: consentId, decision: "GRANTED", superseded: true }], []]);
  const out = await sendRawToExternalOcr({ sql, ownerId: ids.owner, caseId: ids.kase, inputId, bytes: RAW_MARKER, correlationId: randomUUID(), ocrClient: client });
  ok(out.sent === false && out.reason === "SUPERSEDED", "대체된 동의는 차단해야 한다");
}
{
  const client = createRecordingOcrClient();
  const sql = fakeSql([[{ alive: 1 }], [{ id: consentId, decision: "GRANTED", superseded: false }], [{ ok: 0 }], []]);
  const out = await sendRawToExternalOcr({ sql, ownerId: ids.owner, caseId: ids.kase, inputId, bytes: RAW_MARKER, correlationId: randomUUID(), ocrClient: client });
  ok(out.sent === false && out.reason === "WRONG_INPUT", "입력이 그 동의를 가리키지 않으면 차단해야 한다");
  ok(client.received.length === 0, "연결이 없으면 외부가 아무것도 받지 않아야 한다");
}
{
  const client = createRecordingOcrClient();
  const sql = fakeSql([[{ alive: 1 }], [{ id: consentId, decision: "GRANTED", superseded: false }], [{ ok: 1 }], []]);
  const out = await sendRawToExternalOcr({ sql, ownerId: ids.owner, caseId: ids.kase, inputId, bytes: RAW_MARKER, correlationId: randomUUID(), ocrClient: client });
  ok(out.sent === true, "유효한 동의는 전송해야 한다");
  ok(client.received.length === 1 && client.received[0].bytes === RAW_MARKER, "보낸 내용이 그대로 전달돼야 한다");
}
{
  const blocked = maskedIntake({ text: "x", gate: () => ({ ok: false, masked: { text: "x" }, ask: "" }) });
  ok(blocked.sent === false && blocked.masked === null, "잔존이 의심되면 모델로 아무것도 보내지 않아야 한다");
  const sent = maskedIntake({ text: "x", gate: () => ({ ok: true, masked: { text: "[가림]" } }) });
  ok(sent.sent === true && sent.masked === "[가림]", "통과하면 마스킹된 문장만 나가야 한다");
}

// ---------- 4. 정책 ----------
const good = () => ({
  schema_version: 3, blocker_id: "B-CONSENT-01", requirements_blob_sha: "a".repeat(40), adr_decision_sha256: "b".repeat(64),
  code_under_test_sha: "c".repeat(40), workflow_head_sha: "c".repeat(40), scope_sha256: "d".repeat(64),
  run: { id: 1, attempt: 1 }, environment: {}, redactions_applied: true,
  observations: {
    contract: {
      formula_version: FORMULA_VERSION, consent_type: "EXTERNAL_OCR_RAW_TRANSFER",
      scenarios: SCENARIOS.map((s) => s.key), block_reasons: [...BLOCK_REASONS],
      sent_event: EVENT_SENT, blocked_event: EVENT_BLOCKED, pii_fixtures: 132, clean_fixtures: 25,
    },
    scenarios: SCENARIOS.map((s) => ({
      scenario: s.key, expected_block: s.expect ?? null, sent: s.expect === null,
      reason: s.expect ?? null, transmissions: s.expect === null ? 1 : 0,
      audit_events: [s.expect === null ? `${EVENT_SENT}:OK:-` : `${EVENT_BLOCKED}:BLOCKED:${s.expect}`],
    })),
    transfer: {
      denied_scenarios: SCENARIOS.filter((s) => s.expect !== null).length, denied_transmissions: 0,
      granted_scenarios: 1, granted_transmissions: 1, total_received: 1,
      raw_marker_leaks: 0, audit_rows_missing: 0, wrong_audit_event: 0,
    },
    mask: { pii_fixtures: 132, sent_to_model: 117, blocked_by_residual: 15, passed_with_secret: 0, clean_fixtures: 25, clean_blocked: 0 },
  },
});
const check = (result) => { const errors = []; validateConsentEvidenceResult(result, (m) => errors.push(m)); return errors; };
assert.deepEqual(check(good()), [], "기준 결과는 정책을 통과해야 한다");
passed += 1;
ok(MIN_PII_FIXTURES >= 100, "PII fixture 최소 기준이 100 이상이어야 한다");

const rejects = (name, mutate) => {
  const result = good();
  mutate(result.observations);
  assert.ok(check(result).length > 0, `정책이 '${name}' 를 거부해야 한다`);
  rejected += 1;
};
rejects("산식 변경", (o) => { o.contract.formula_version = "other"; });
rejects("동의 유형 변경", (o) => { o.contract.consent_type = "OTHER"; });
rejects("시나리오 목록 변경", (o) => { o.contract.scenarios = ["granted"]; });
rejects("차단 사유 목록 변경", (o) => { o.contract.block_reasons = ["DENIED"]; });
rejects("거절인데 전송", (o) => { const r = o.scenarios.find((x) => x.expected_block === "DENIED"); r.sent = true; r.transmissions = 1; });
rejects("거절 전송 합계", (o) => { o.transfer.denied_transmissions = 1; });
rejects("허용인데 전송 없음", (o) => { const r = o.scenarios.find((x) => x.expected_block === null); r.sent = false; r.transmissions = 0; });
rejects("허용 전송 합계 0", (o) => { o.transfer.granted_transmissions = 0; });
rejects("모두 차단하는 게이트", (o) => { o.transfer.granted_scenarios = 0; o.transfer.granted_transmissions = 0; o.transfer.total_received = 0; });
rejects("감사 기록 없음", (o) => { o.scenarios[0].audit_events = []; });
rejects("감사 기록 두 줄", (o) => { o.scenarios[0].audit_events = [`${EVENT_BLOCKED}:BLOCKED:ABSENT`, "X"]; });
rejects("결정과 다른 감사", (o) => { o.scenarios[0].audit_events = [`${EVENT_SENT}:OK:-`]; });
rejects("감사 합계 조작", (o) => { o.transfer.audit_rows_missing = 1; });
rejects("전달 내용 변조", (o) => { o.transfer.raw_marker_leaks = 1; });
rejects("차단 사유 불일치", (o) => { o.scenarios.find((x) => x.expected_block === "ABSENT").reason = "DENIED"; });
rejects("시나리오 누락", (o) => { o.scenarios.pop(); });
rejects("PII fixture 부족", (o) => { o.mask.pii_fixtures = 50; o.contract.pii_fixtures = 50; o.mask.sent_to_model = 35; });
rejects("마스킹 뒤 원문 잔존", (o) => { o.mask.passed_with_secret = 1; });
rejects("정상 문장 오차단", (o) => { o.mask.clean_blocked = 1; });
rejects("모델 전송 0건", (o) => { o.mask.sent_to_model = 0; o.mask.blocked_by_residual = 132; });
rejects("합계 불일치", (o) => { o.mask.blocked_by_residual = 1; });
rejects("observations 키 추가", (o) => { o.extra = 1; });

console.log(`B-CONSENT-01 계약 시험 통과: 합격 ${passed}건, 정책 거부 ${rejected}건.`);
