// ============================================================
// B-DELETE-01 사전 고정 합격선.
//
// ADR 14.2 해제 조건: 확인·중단·Case 삭제·기발급 URL·24시간 cleanup.
// ADR 15.1 물리 삭제 행: 확인·취소·Case 삭제 각 10 + 24시간 경계 10 에서
// object·임시 OCR·case vector·기발급 URL 접근 잔존 0건.
//
// 막기만 하는 결과는 통과가 아니다. 지우기 전에 발급 URL 이 실제로 본문을
// 돌려줬어야 하고, 경계 이전 대상은 그대로 남아 있어야 한다.
// ============================================================
import {
  BUCKET, DELETED_CASES, FAMILIES, FORMULA_VERSION, MAX_DELETE_SECONDS,
  SIGNED_URL_TTL_SECONDS, TOTAL_CASES,
} from "./delete-spike.mjs";

export { FORMULA_VERSION };

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

const CASE_KEYS = [
  "label", "family", "issued_url_elapsed_seconds",
  "issued_url_before_status", "issued_url_before_bytes",
  "issued_url_after_status", "issued_url_after_bytes", "issued_url_served_after",
  "authenticated_read_after_status", "authenticated_read_served_after",
  "object_rows", "ocr_object_rows", "live_input_objects", "live_ocr_artifacts",
  "live_embeddings", "live_cases", "raw_delete_status", "delete_seconds",
];

const TOTAL_KEYS = [
  "cases_total", "deleted_cases", "retained_cases",
  "residual_objects", "residual_ocr_objects", "residual_input_metadata",
  "residual_ocr_metadata", "residual_case_embeddings",
  "issued_url_served_after_delete", "authenticated_reads_after_delete",
  "issued_url_expired_before_check", "issued_url_served_before_delete",
  "max_delete_seconds", "boundary_early_enqueued", "boundary_early_objects_present",
  "boundary_due_deleted", "purged_cases", "cleanup_jobs_finished", "storage_deletes",
  "teardown_jobs_finished", "leftover_objects_after_teardown",
];

const RETAINED_CASES = FAMILIES.filter((f) => f.expect === "retained").reduce((n, f) => n + f.cases, 0);
const BOUNDARY_DUE = FAMILIES.find((f) => f.key === "ttl_boundary_due").cases;
const CASE_DELETED = FAMILIES.find((f) => f.key === "case_deleted").cases;

export const validateDeleteEvidenceResult = (result, fail) => {
  const o = result?.observations;
  if (!exactKeys(o, ["contract", "sweep", "cases", "totals"])) {
    fail("observations 는 contract·sweep·cases·totals 만 가져야 합니다.");
    return;
  }

  const c = o.contract;
  if (!exactKeys(c, ["formula_version", "bucket", "families", "total_cases", "max_delete_seconds",
    "signed_url_ttl_seconds", "uses_secret_key_for", "absence_verified_by"])
    || c.formula_version !== FORMULA_VERSION || c.bucket !== BUCKET
    || c.total_cases !== TOTAL_CASES || c.max_delete_seconds !== MAX_DELETE_SECONDS
    || c.signed_url_ttl_seconds !== SIGNED_URL_TTL_SECONDS
    || JSON.stringify(c.families) !== JSON.stringify(
      FAMILIES.map((f) => ({ key: f.key, reason: f.reason, cases: f.cases, expect: f.expect })))) {
    fail("contract 의 산식·Bucket·family 구성이 현재 코드와 다릅니다.");
  }
  // 서버 키는 삭제와 OCR 임시물 쓰기에만 쓴다. 부재 판정에는 쓰지 않는다.
  if (c.uses_secret_key_for !== "delete-and-ocr-write") fail("서버 키의 사용 범위 선언이 계약과 다릅니다.");
  if (JSON.stringify(c.absence_verified_by) !== JSON.stringify(["issued-signed-url", "member-jwt-read"])) {
    fail("부재 판정 경로 선언이 계약과 다릅니다. 특권 키로 판정한 결과는 채택할 수 없습니다.");
  }

  const rows = Array.isArray(o.cases) ? o.cases : [];
  if (rows.length !== TOTAL_CASES) fail("Case 기록 수가 계약과 다릅니다.");
  for (const family of FAMILIES) {
    const seen = rows.filter((row) => row.family === family.key).length;
    if (seen !== family.cases) fail(`family '${family.key}' 의 Case 수가 계약과 다릅니다.`);
  }
  for (const row of rows) {
    if (!exactKeys(row, CASE_KEYS)) { fail(`Case '${row?.label ?? "?"}' 기록이 계약과 다릅니다.`); continue; }
    const family = FAMILIES.find((f) => f.key === row.family);
    if (!family) { fail(`Case '${row.label}' 의 family 가 계약에 없습니다.`); continue; }
    // 지우기 전에 발급 URL 이 본문을 돌려줬어야 뒤의 부재가 의미를 가진다.
    if (!(row.issued_url_before_status >= 200 && row.issued_url_before_status < 300 && row.issued_url_before_bytes > 0)) {
      fail(`Case '${row.label}' 는 삭제 전에 발급 URL 로 본문을 받지 못했습니다.`);
    }
    if (family.expect !== "deleted") continue;
    if (row.object_rows !== 0 || row.ocr_object_rows !== 0) fail(`Case '${row.label}' 의 Storage 객체가 남았습니다.`);
    if (row.live_input_objects !== 0 || row.live_ocr_artifacts !== 0 || row.live_embeddings !== 0) {
      fail(`Case '${row.label}' 의 원본·임시물·vector 메타데이터가 남았습니다.`);
    }
    if (row.issued_url_served_after) fail(`Case '${row.label}' 의 기발급 URL 이 삭제 뒤에도 본문을 줬습니다.`);
    if (row.authenticated_read_served_after) fail(`Case '${row.label}' 를 회원 JWT 로 삭제 뒤에도 읽었습니다.`);
    if (row.issued_url_elapsed_seconds >= SIGNED_URL_TTL_SECONDS) {
      fail(`Case '${row.label}' 의 발급 URL 은 확인 시점에 이미 만료라 부재를 증명하지 못합니다.`);
    }
    if (row.delete_seconds !== null && row.delete_seconds > MAX_DELETE_SECONDS) {
      fail(`Case '${row.label}' 의 삭제가 24시간을 넘겼습니다.`);
    }
  }

  const t = o.totals;
  if (!exactKeys(t, TOTAL_KEYS)) { fail("totals 필드가 계약과 다릅니다."); return; }
  if (t.cases_total !== TOTAL_CASES) fail("Case 총수가 계약과 다릅니다.");
  if (t.deleted_cases !== DELETED_CASES) fail("삭제 대상 Case 수가 계약과 다릅니다.");
  if (t.retained_cases !== RETAINED_CASES) fail("보존 대상 Case 수가 계약과 다릅니다.");
  if (t.residual_objects !== 0) fail("삭제 뒤 Storage 원본 객체가 남았습니다.");
  if (t.residual_ocr_objects !== 0) fail("삭제 뒤 OCR 임시 객체가 남았습니다.");
  if (t.residual_input_metadata !== 0) fail("삭제 뒤 원본 메타데이터가 남았습니다.");
  if (t.residual_ocr_metadata !== 0) fail("삭제 뒤 OCR 임시물 메타데이터가 남았습니다.");
  if (t.residual_case_embeddings !== 0) fail("삭제 뒤 Case vector 가 남았습니다.");
  if (t.issued_url_served_after_delete !== 0) fail("기발급 열람 URL 이 삭제 뒤에도 통했습니다.");
  if (t.authenticated_reads_after_delete !== 0) fail("회원 JWT 읽기가 삭제 뒤에도 통했습니다.");
  if (t.issued_url_expired_before_check !== 0) fail("만료로 설명되는 발급 URL 관측이 섞였습니다.");
  if (t.issued_url_served_before_delete !== DELETED_CASES) fail("삭제 전 발급 URL 이 모든 Case 에서 통하지는 않았습니다.");
  if (!Number.isFinite(t.max_delete_seconds) || t.max_delete_seconds > MAX_DELETE_SECONDS) {
    fail("삭제까지 걸린 최대 시간이 24시간을 넘었습니다.");
  }
  // 경계 이전 대상을 미리 집어가면 규칙이 시간이 아니라 우연으로 도는 것이다.
  if (t.boundary_early_enqueued !== 0) fail("만료 이전 대상이 청소 대기열에 들어갔습니다.");
  if (t.boundary_early_objects_present !== RETAINED_CASES) fail("만료 이전 대상이 그대로 남아 있지 않았습니다.");
  if (t.boundary_due_deleted !== BOUNDARY_DUE) fail("만료를 지난 대상이 모두 지워지지는 않았습니다.");
  if (t.purged_cases !== CASE_DELETED) fail("Case 삭제 요청이 모두 Purge 되지는 않았습니다.");
  if (t.cleanup_jobs_finished < DELETED_CASES) fail("완료한 Cleanup 작업 수가 삭제 Case 수보다 적습니다.");
  if (t.leftover_objects_after_teardown !== 0) fail("시험이 운영 Bucket 에 객체를 남겼습니다.");

  const sweep = Array.isArray(o.sweep) ? o.sweep : [];
  if (sweep.length === 0) fail("만료 청소 기록이 없습니다.");
};
