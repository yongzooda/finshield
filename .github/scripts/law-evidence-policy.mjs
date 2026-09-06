// ============================================================
// B-LAW-01 사전 고정 합격선.
//
// ADR 14.2 해제 조건: OC·등록 도메인 Referer·Preview/Production 403/429/5xx·D+1.
// 통과 근거는 sanitized response ledger 와 snapshot hash 다.
//
// 등록 도메인으로는 Preview 와 Production 양쪽에서 실제로 통해야 한다.
// 등록하지 않은 도메인으로는 통하면 안 된다. 통한다면 ADR 5.2 의 전제가 틀린
// 것이므로 조용히 통과시키지 않고 여기서 막는다.
// ============================================================
import {
  FORMULA_VERSION, OUTCOMES, PROBE_PATH, RECORD_FIELDS, SCENARIOS, SNAPSHOT_REPEATS, TARGETS,
} from "./law-spike.mjs";

export { FORMULA_VERSION };

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

const ROW_KEYS = [
  "target", "scenario", "attempt", "probe_status", "record_well_formed", "referer_kind",
  "referer_present", "status", "outcome", "result_code", "content_type", "bytes",
  "body_sha256", "ms", "reported_env", "deployment_id_matches",
];

const TOTAL_KEYS = [
  "records", "malformed_records", "deployment_id_mismatches", "registered_ok", "absent_ok",
  "deployment_url_ok", "unregistered_ok", "snapshot_ok", "change_d1_ok", "change_d3_ok", "auth_rejected",
  "rate_limited", "server_errors", "http_errors", "timeouts", "distinct_snapshot_hashes",
  "snapshot_hash_stable", "max_ms",
];

const EXPECTED_RECORDS = TARGETS.length * SCENARIOS.length + (SNAPSHOT_REPEATS - 1);

export const validateLawEvidenceResult = (result, fail) => {
  const o = result?.observations;
  if (!exactKeys(o, ["contract", "records", "totals"])) {
    fail("observations 는 contract·records·totals 만 가져야 합니다.");
    return;
  }

  const c = o.contract;
  if (!exactKeys(c, ["formula_version", "probe_path", "targets", "scenarios", "snapshot_repeats",
    "record_fields", "outcomes", "measured_inside_deployment", "probe_auth"])
    || c.formula_version !== FORMULA_VERSION || c.probe_path !== PROBE_PATH
    || JSON.stringify(c.targets) !== JSON.stringify([...TARGETS])
    || JSON.stringify(c.scenarios) !== JSON.stringify([...SCENARIOS])
    || c.snapshot_repeats !== SNAPSHOT_REPEATS
    || JSON.stringify(c.record_fields) !== JSON.stringify([...RECORD_FIELDS])
    || JSON.stringify(c.outcomes) !== JSON.stringify([...OUTCOMES])) {
    fail("contract 의 산식·대상·시나리오가 현재 코드와 다릅니다.");
  }
  if (c.measured_inside_deployment !== true) fail("배포 안에서 부르지 않은 결과는 채택할 수 없습니다.");
  if (c.probe_auth !== "oc-derived-hourly-token") fail("Probe 인증 방식 선언이 계약과 다릅니다.");

  const rows = Array.isArray(o.records) ? o.records : [];
  if (rows.length !== EXPECTED_RECORDS) fail("관측 기록 수가 계약과 다릅니다.");
  for (const row of rows) {
    if (!exactKeys(row, ROW_KEYS)) { fail("관측 기록이 계약과 다릅니다."); continue; }
    if (!TARGETS.includes(row.target)) fail(`대상 '${row.target}' 이 계약에 없습니다.`);
    if (!SCENARIOS.includes(row.scenario)) fail(`시나리오 '${row.scenario}' 가 계약에 없습니다.`);
    if (!row.record_well_formed) fail(`시나리오 '${row.scenario}' 의 기록 형식이 어긋납니다.`);
    if (!OUTCOMES.includes(row.outcome)) fail(`시나리오 '${row.scenario}' 의 판정값이 계약에 없습니다.`);
    if (!row.deployment_id_matches) fail("배포가 보고한 deployment ID 가 Vercel API 의 값과 다릅니다.");
    // 본문 해시가 없으면 Snapshot 을 남긴 것이 아니다.
    if (row.outcome === "ok" && !/^[0-9a-f]{64}$/.test(row.body_sha256 ?? "")) {
      fail(`시나리오 '${row.scenario}' 의 본문 해시가 없습니다.`);
    }
  }

  const t = o.totals;
  if (!exactKeys(t, TOTAL_KEYS)) { fail("totals 필드가 계약과 다릅니다."); return; }
  if (t.records !== EXPECTED_RECORDS) fail("기록 총수가 계약과 다릅니다.");
  if (t.malformed_records !== 0) fail("형식이 어긋난 기록이 있습니다.");
  if (t.deployment_id_mismatches !== 0) fail("deployment ID 가 어긋난 기록이 있습니다.");
  // 제품 경로가 실제로 통해야 한다. 막기만 하는 결과는 통과가 아니다.
  if (t.registered_ok !== TARGETS.length) fail("등록 도메인으로 Preview·Production 양쪽에서 통하지는 않았습니다.");
  if (t.snapshot_ok < SNAPSHOT_REPEATS) fail("고정 질의가 통하지 않았습니다.");
  if (!t.snapshot_hash_stable || t.distinct_snapshot_hashes !== 1) {
    fail("같은 실행 안에서 고정 질의의 본문 해시가 흔들렸습니다.");
  }
  // 등록하지 않은 도메인이 통하면 ADR 5.2 의 전제가 틀린 것이다.
  if (t.unregistered_ok !== 0) fail("등록하지 않은 도메인으로도 통했습니다. ADR 5.2 의 전제를 다시 봐야 합니다.");
  // 일자별 조문 개정 조회는 어제와 사흘 전 모두 답해야 원장이 D+1 을 말할 수 있다.
  if (t.change_d1_ok !== TARGETS.length) fail("어제 자 변경 조문 조회가 양쪽에서 통하지는 않았습니다.");
  if (t.change_d3_ok !== TARGETS.length) fail("사흘 전 변경 조문 조회가 양쪽에서 통하지는 않았습니다.");
  if (t.timeouts !== 0) fail("시간 초과가 있었습니다.");
  if (t.server_errors !== 0) fail("서버 오류가 있었습니다.");
};
