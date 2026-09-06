// ============================================================
// B-CONSENT-01 관측 생성기.
//
// 시나리오마다 동의 상태를 만들고 원본 전송 경로를 부른다. 외부 OCR 은 받은 것을
// 전부 기록하는 가짜 client 다. 동의가 GRANTED 가 아닌 시나리오에서 그 client 가
// 한 번이라도 호출되면 미달이다.
//
// 모델 경로는 마스킹된 문장만 받는다. 마스킹이 잔존을 의심하면 아무것도 보내지 않는다.
// ============================================================
import { BLOCK_REASONS, EVENT_BLOCKED, EVENT_SENT, maskedIntake, sendRawToExternalOcr } from "./consent-gate.mjs";

export const FORMULA_VERSION = "consent-isolation-raw-transfer-v1";
export const RAW_MARKER = "RAW-BYTES-DO-NOT-SEND";
export const NOTICE_VERSION = "notice-v1";

const hexTail = (seed) => String(seed).replace(/[^0-9a-f]/gi, "").toLowerCase().padStart(12, "0").slice(-12);
export const idsFor = (seed) => Object.freeze({
  owner: "3f2e3d4c-0000-4000-8000-000000000c01",
  profile: "3f2e3d4c-0000-4000-8000-000000000c02",
  version: "3f2e3d4c-0000-4000-8000-000000000c03",
  kase: `4f2e3d4c-0000-4000-8000-${hexTail(seed)}`,
});

// 시나리오마다 입력 하나와 동의 상태 하나를 만든다.
// supersedeAgeSeconds 가 음수면 나중 시각, 양수면 앞선 시각이다. 앞선 시각은
// 시계 오차나 backfill 로 생길 수 있는 이상 상태이고 그때도 막아야 한다.
export const SCENARIOS = Object.freeze([
  { key: "absent", decision: null, link: false, deleteRaw: false, expect: "ABSENT" },
  { key: "denied", decision: "DENIED", link: true, deleteRaw: false, expect: "DENIED" },
  { key: "revoked_after_granted", decision: "GRANTED", supersede: "REVOKED", supersedeAgeSeconds: -60, link: true, deleteRaw: false, expect: "REVOKED" },
  { key: "denied_after_granted", decision: "GRANTED", supersede: "DENIED", supersedeAgeSeconds: -60, link: true, deleteRaw: false, expect: "DENIED" },
  { key: "superseded_out_of_order", decision: "GRANTED", supersede: "DENIED", supersedeAgeSeconds: 60, link: true, deleteRaw: false, expect: "SUPERSEDED" },
  { key: "wrong_input", decision: "GRANTED", link: false, deleteRaw: false, expect: "WRONG_INPUT" },
  { key: "raw_deleted", decision: "GRANTED", link: true, deleteRaw: true, expect: "RAW_DELETED" },
  { key: "granted", decision: "GRANTED", link: true, deleteRaw: false, expect: null },
]);

const lit = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);

export const fixtureSql = (ids) => `
begin;
insert into auth.users (id) values ('${ids.owner}') on conflict (id) do nothing;
insert into public.financial_profiles
  (id, owner_id, schema_version, income_band, debt_burden_band, emergency_fund_band,
   purpose_code, horizon_code, liquidity_need, loss_tolerance, completeness)
values ('${ids.profile}', '${ids.owner}', 'v1', 'BAND_2', 'LOW', 'BAND_1',
        'LOAN_REFINANCE', 'SHORT', 'MEDIUM', 'LOW', 'COMPLETE')
on conflict (id) do nothing;
insert into public.financial_profile_versions
  (id, owner_id, profile_id, version_no, schema_version, snapshot, completeness, content_hash, created_reason)
values ('${ids.version}', '${ids.owner}', '${ids.profile}', 1, 'v1', '{"schema_version":"v1"}'::jsonb,
        'COMPLETE', repeat('a', 64), 'CASE_CREATED')
on conflict (id) do nothing;
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('${ids.kase}', '${ids.owner}', 'LOAN', '동의 격리 Case', '${ids.version}')
on conflict (id) do nothing;
commit;`;

// 입력·객체·동의를 시나리오마다 만든다. 동의는 입력 행이 가리킬 때만 유효하다.
export const scenarioSql = (ids, scenario, inputId, objectId, consentId, supersedeId) => {
  const out = ["begin;"];
  out.push(`insert into public.case_inputs
  (id, owner_id, case_id, input_type, input_stage, input_outcome, pii_scan_status, raw_delete_status,
   raw_expires_at, declared_mime, page_count, size_bytes)
 values (${lit(inputId)}, ${lit(ids.owner)}, ${lit(ids.kase)}, 'IMAGE', 'QUARANTINED', 'ACTIVE', 'PENDING', 'PENDING',
         now() + interval '24 hours', 'image/png', 1, 1024);`);
  out.push(`insert into private.input_objects
  (id, owner_id, case_id, case_input_id, input_type, bucket_id, object_path, safe_extension,
   encryption_state, slot_state, uploaded_at, expires_at)
 values (${lit(objectId)}, ${lit(ids.owner)}, ${lit(ids.kase)}, ${lit(inputId)}, 'IMAGE', 'finshield-quarantine',
         ${lit(`${ids.owner}/${ids.kase}/${inputId}/${objectId}.png`)}, 'png', 'VERIFIED', 'UPLOADED', now(),
         now() + interval '24 hours');`);
  if (scenario.decision) {
    out.push(`insert into public.processing_consents
  (id, owner_id, case_id, case_input_id, consent_type, notice_version, provider_code, data_categories, decision)
 values (${lit(consentId)}, ${lit(ids.owner)}, ${lit(ids.kase)}, ${lit(inputId)}, 'EXTERNAL_OCR_RAW_TRANSFER',
         ${lit(NOTICE_VERSION)}, 'clova', array['IMAGE_RAW']::text[], ${lit(scenario.decision)});`);
    if (scenario.supersede) {
      const age = scenario.supersedeAgeSeconds ?? -60;
      out.push(`insert into public.processing_consents
  (id, owner_id, case_id, case_input_id, consent_type, notice_version, provider_code, data_categories, decision,
   supersedes_consent_id, created_at)
 values (${lit(supersedeId)}, ${lit(ids.owner)}, ${lit(ids.kase)}, ${lit(inputId)}, 'EXTERNAL_OCR_RAW_TRANSFER',
         ${lit(NOTICE_VERSION)}, 'clova', array['IMAGE_RAW']::text[], ${lit(scenario.supersede)}, ${lit(consentId)},
         now() - make_interval(secs => ${age}));`);
    }
    if (scenario.link) {
      out.push(`update public.case_inputs set external_ocr_consent_id = ${lit(consentId)} where id = ${lit(inputId)};`);
    }
  }
  if (scenario.deleteRaw) {
    out.push(`update private.input_objects set access_blocked_at = now(), deleted_at = now(), slot_state = 'CLOSED', uploaded_at = null where id = ${lit(objectId)};`);
  }
  out.push("commit;");
  return out.join("\n");
};

// 받은 것을 전부 기록하는 가짜 외부 OCR. 실제 Provider 를 부르지 않는다.
export const createRecordingOcrClient = () => {
  const received = [];
  return {
    received,
    async send({ inputId, bytes }) {
      received.push({ inputId, bytes: String(bytes) });
      return "외부 OCR 이 돌려준 문장";
    },
  };
};

export const runConsentSpike = async ({ sql, ids, uuid, gate, piiCases, cleanCases, progress = () => {} }) => {
  const ocrClient = createRecordingOcrClient();
  const results = [];
  for (const scenario of SCENARIOS) {
    const inputId = uuid();
    const objectId = uuid();
    const consentId = uuid();
    const supersedeId = uuid();
    await sql.unsafe(scenarioSql(ids, scenario, inputId, objectId, consentId, supersedeId));
    const correlationId = uuid();
    const before = ocrClient.received.length;
    const outcome = await sendRawToExternalOcr({
      sql, ownerId: ids.owner, caseId: ids.kase, inputId,
      bytes: `${RAW_MARKER}:${inputId}`, correlationId, ocrClient,
    });
    const rows = await sql`
      select event_code, status_code, error_code from private.audit_events
       where correlation_id = ${correlationId}::uuid order by created_at`;
    results.push({
      scenario: scenario.key,
      expected_block: scenario.expect,
      sent: outcome.sent === true,
      reason: outcome.reason ?? null,
      transmissions: ocrClient.received.length - before,
      audit_events: rows.map((r) => `${r.event_code}:${r.status_code}:${r.error_code ?? "-"}`),
    });
    progress(scenario.key);
  }

  // 모델 경로. 마스킹을 통과한 문장만 나가고 잔존이 의심되면 아무것도 나가지 않는다.
  const modelSent = [];
  let passedWithSecret = 0;
  let blockedByResidual = 0;
  for (const fixture of piiCases) {
    const out = maskedIntake({ text: fixture.text, gate });
    if (!out.sent) { blockedByResidual += 1; continue; }
    modelSent.push(out.masked);
    if (out.masked.includes(fixture.secret)) passedWithSecret += 1;
  }
  let cleanBlocked = 0;
  for (const text of cleanCases) {
    if (!maskedIntake({ text, gate }).sent) cleanBlocked += 1;
  }
  progress("mask");

  const denied = results.filter((r) => r.expected_block !== null);
  const granted = results.filter((r) => r.expected_block === null);
  return {
    contract: {
      formula_version: FORMULA_VERSION,
      consent_type: "EXTERNAL_OCR_RAW_TRANSFER",
      scenarios: SCENARIOS.map((s) => s.key),
      block_reasons: [...BLOCK_REASONS],
      sent_event: EVENT_SENT,
      blocked_event: EVENT_BLOCKED,
      pii_fixtures: piiCases.length,
      clean_fixtures: cleanCases.length,
    },
    scenarios: results,
    transfer: {
      denied_scenarios: denied.length,
      denied_transmissions: denied.reduce((sum, r) => sum + r.transmissions, 0),
      granted_scenarios: granted.length,
      granted_transmissions: granted.reduce((sum, r) => sum + r.transmissions, 0),
      total_received: ocrClient.received.length,
      raw_marker_leaks: ocrClient.received.filter((r) => !r.bytes.startsWith(RAW_MARKER)).length,
      audit_rows_missing: results.filter((r) => r.audit_events.length !== 1).length,
      wrong_audit_event: results.filter((r) => {
        const expected = r.expected_block === null ? `${EVENT_SENT}:OK:-` : `${EVENT_BLOCKED}:BLOCKED:${r.expected_block}`;
        return r.audit_events[0] !== expected;
      }).length,
    },
    mask: {
      pii_fixtures: piiCases.length,
      sent_to_model: modelSent.length,
      blocked_by_residual: blockedByResidual,
      passed_with_secret: passedWithSecret,
      clean_fixtures: cleanCases.length,
      clean_blocked: cleanBlocked,
    },
  };
};
