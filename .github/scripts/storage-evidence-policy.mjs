// ============================================================
// B-STORAGE-01 사전 고정 합격선.
//
// ADR 14.2 해제 조건: positive/negative test 와 발급 URL·token 재사용 거부.
// ADR 15.1 Storage·RLS 행: 허용되지 않은 read/write 0건, upsert 0건.
// 교차 소유 200건과 즉시 접근 차단 P95 는 B-SUPABASE-01 의 행렬이 이미 쟀다.
// 여기서는 실제 Storage HTTP 경로만 본다.
// ============================================================
import { BUCKET, FORMULA_VERSION, SCENARIOS, SIZE_LIMIT_BYTES } from "./storage-spike.mjs";

export { FORMULA_VERSION };

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

export const validateStorageEvidenceResult = (result, fail) => {
  const o = result?.observations;
  if (!exactKeys(o, ["contract", "scenarios", "totals"])) {
    fail("observations 는 contract·scenarios·totals 만 가져야 합니다.");
    return;
  }

  const c = o.contract;
  if (!exactKeys(c, ["formula_version", "bucket", "size_limit_bytes", "scenarios", "uses_service_role", "slot_path_chosen_by"])
    || c.formula_version !== FORMULA_VERSION || c.bucket !== BUCKET || c.size_limit_bytes !== SIZE_LIMIT_BYTES
    || JSON.stringify(c.scenarios) !== JSON.stringify(SCENARIOS.map((s) => s.key))
    || c.slot_path_chosen_by !== "server") {
    fail("contract 의 산식·Bucket·상한·시나리오가 현재 코드와 다릅니다.");
  }
  // RLS 우회 키로 잰 결과는 제품 경로의 증거가 아니다.
  if (c.uses_service_role !== false) fail("RLS 우회 키를 쓴 결과는 채택할 수 없습니다.");

  const rows = Array.isArray(o.scenarios) ? o.scenarios : [];
  if (rows.length !== SCENARIOS.length) fail("시나리오 기록 수가 계약과 다릅니다.");
  for (const scenario of SCENARIOS) {
    const row = rows.find((r) => r.scenario === scenario.key);
    if (!row) { fail(`시나리오 '${scenario.key}' 기록이 없습니다.`); continue; }
    if (!exactKeys(row, ["scenario", "expect", "kind", "status", "allowed"])) {
      fail(`시나리오 '${scenario.key}' 기록이 계약과 다릅니다.`);
      continue;
    }
    if (row.expect !== scenario.expect || row.kind !== scenario.kind) fail(`시나리오 '${scenario.key}' 의 기대·종류가 계약과 다릅니다.`);
    if (!Number.isInteger(row.status) || row.status < 100 || row.status > 599) fail(`시나리오 '${scenario.key}' 의 상태 코드가 유효하지 않습니다.`);
    const allowed = row.status >= 200 && row.status < 300;
    if (row.allowed !== allowed) fail(`시나리오 '${scenario.key}' 의 허용 표시가 상태 코드와 다릅니다.`);
    if (scenario.expect === "allow" && !allowed) fail(`허용해야 할 시나리오 '${scenario.key}' 가 거부됐습니다.`);
    if (scenario.expect === "deny" && allowed) fail(`거부해야 할 시나리오 '${scenario.key}' 가 통과했습니다.`);
  }

  const t = o.totals;
  if (!exactKeys(t, ["allow_scenarios", "allow_passed", "deny_scenarios", "unauthorized_allows",
    "unauthorized_writes", "unauthorized_reads", "upsert_allows", "resumable_reuse_allows"])) {
    fail("totals 필드가 계약과 다릅니다.");
    return;
  }
  if (t.unauthorized_allows !== 0) fail("허용되지 않은 접근이 통과했습니다.");
  if (t.unauthorized_writes !== 0) fail("허용되지 않은 쓰기가 통과했습니다.");
  if (t.unauthorized_reads !== 0) fail("허용되지 않은 읽기가 통과했습니다.");
  if (t.upsert_allows !== 0) fail("같은 경로 덮어쓰기가 통과했습니다.");
  if (t.resumable_reuse_allows !== 0) fail("닫힌 slot 의 발급 token 으로 업로드가 통과했습니다.");
  // 막기만 하는 결과는 통과가 아니다. 정상 업로드가 실제로 돼야 한다.
  if (t.allow_scenarios < 1 || t.allow_passed !== t.allow_scenarios) fail("정상 업로드 경로가 동작하지 않았습니다.");
  if (t.deny_scenarios !== SCENARIOS.filter((s) => s.expect === "deny").length) fail("거부 시나리오 수가 계약과 다릅니다.");
};
