// B-SUPABASE-01 raw-metric 합격 정책.
//
// 결과 파일의 PASS 문자열을 믿지 않는다. 관측값에서 다시 판정한다.
//  - 로컬 기준 DB(같은 Migration)와 운영 DB 의 표·제약·인덱스 digest 가 같다.
//  - 로컬 불변식 시험이 모든 파일에서 통과했고 교차 소유·Worker 거부 행렬이
//    ADR 15.1 의 최소 표본(cross-owner/worker 200, closed slot/token reuse 20)을 넘는다.
//  - 운영 프로젝트의 RLS·권한·Storage·확장·역할 관측이 verify-remote 판정을 통과한다.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateRemoteObservations, MEMBER_ONLY_TABLES, TRACKED_SCHEMAS } from "../../supabase/tests/verify-remote.mjs";

export const FORMULA_VERSION = "supabase-migration-digest-rls-matrix-v1";
export const MIN_CROSS_OWNER_DENIALS = 200;
export const MIN_CLOSED_SLOT_REJECTIONS = 20;
export const MIN_BLOCKED_READ_REJECTIONS = 20;
export const MAX_ACCESS_BLOCK_MS = 2000;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const isHex64 = (value) => /^[0-9a-f]{64}$/.test(value ?? "");
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b);

// 기대 목록은 저장소 파일에서 읽는다. 손으로 적은 목록은 Migration 이 늘 때 낡는다.
export const expectedInventory = (root) => {
  const migrations = readdirSync(resolve(root, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const tests = readdirSync(resolve(root, "supabase/tests")).filter((f) => /^\d{2}_.*\.sql$/.test(f) && !f.startsWith("00_")).sort();
  return { migrations, tests };
};

export const validateSupabaseEvidenceResult = (result, fail, root = resolve(import.meta.dirname, "../..")) => {
  if (!exactKeys(result?.observations, ["contract", "local", "remote", "schema_match"])) {
    fail("B-SUPABASE-01 observations 필드가 고정 schema 와 다릅니다.");
    return;
  }
  const { contract, local, remote, schema_match: match } = result.observations;
  const expected = expectedInventory(root);

  if (!exactKeys(contract, ["formula_version", "tracked_schemas", "migration_files", "test_files", "member_only_tables"])
    || contract.formula_version !== FORMULA_VERSION
    || !sameList(contract.tracked_schemas, [...TRACKED_SCHEMAS])
    || !sameList(contract.migration_files, expected.migrations)
    || !sameList(contract.test_files, expected.tests)
    || !sameList(contract.member_only_tables, [...MEMBER_ONLY_TABLES])
    || expected.migrations.length < 17 || expected.tests.length < 14) {
    fail("B-SUPABASE-01 계약(산식·스키마·Migration·시험 파일·회원 본문 표 목록)이 저장소와 다릅니다.");
  }

  if (!exactKeys(local, ["files_passed", "files_failed", "assertions_passed", "assertions_failed", "matrix", "schema"])
    || !sameList(local.files_passed, expected.tests)
    || !sameList(local.files_failed, [])
    || !Number.isInteger(local.assertions_passed) || local.assertions_passed < 400
    || local.assertions_failed !== 0) {
    fail("B-SUPABASE-01 로컬 불변식 시험이 모든 파일에서 통과하지 않았습니다.");
  }
  const matrix = isRecord(local?.matrix) ? local.matrix : {};
  if (!exactKeys(matrix, ["cross_owner_denials", "anon_denials", "worker_denials", "worker_allowed", "worker_denied_tables",
    "unexpected_allows", "inconclusive", "closed_slot_rejections", "blocked_read_rejections", "access_block_ms"])
    || matrix.unexpected_allows !== 0
    || !Number.isInteger(matrix.cross_owner_denials) || matrix.cross_owner_denials < MIN_CROSS_OWNER_DENIALS
    || !Number.isInteger(matrix.anon_denials) || matrix.anon_denials < 60
    || !Array.isArray(matrix.worker_denied_tables)
    || MEMBER_ONLY_TABLES.some((table) => !matrix.worker_denied_tables.includes(table))
    || matrix.closed_slot_rejections < MIN_CLOSED_SLOT_REJECTIONS
    || matrix.blocked_read_rejections < MIN_BLOCKED_READ_REJECTIONS
    || !(Number.isFinite(matrix.access_block_ms) && matrix.access_block_ms >= 0 && matrix.access_block_ms <= MAX_ACCESS_BLOCK_MS)) {
    fail("B-SUPABASE-01 교차 소유·익명·Worker 거부 행렬이 ADR 15.1 최소 표본·0건 조건을 만족하지 않습니다.");
  }

  const schemaKeys = ["tracked_schemas", "routines", "routine_digest", "tables", "tables_digest", "constraints", "constraint_digest",
    "indexes", "index_digest", "rls_total", "rls_enforced", "rls_missing"];
  const validSchema = (schema) => exactKeys(schema, schemaKeys)
    && sameList(schema.tracked_schemas, [...TRACKED_SCHEMAS])
    && Number.isInteger(schema.tables) && schema.tables >= 60
    && isHex64(schema.tables_digest) && isHex64(schema.constraint_digest) && isHex64(schema.index_digest)
    && isHex64(schema.routine_digest) && Number.isInteger(schema.routines) && schema.routines >= 50
    && Number.isInteger(schema.constraints) && schema.constraints > schema.tables
    && Number.isInteger(schema.indexes) && schema.indexes > schema.tables
    && schema.rls_total === schema.tables && schema.rls_enforced === schema.tables
    && sameList(schema.rls_missing, []);
  if (!validSchema(local?.schema)) fail("B-SUPABASE-01 로컬 기준 DB 의 표·제약·인덱스·RLS 관측이 유효하지 않습니다.");
  if (!isRecord(remote) || !validSchema(remote.schema)) {
    fail("B-SUPABASE-01 운영 DB 의 표·제약·인덱스·RLS 관측이 유효하지 않습니다.");
  } else {
    for (const message of evaluateRemoteObservations(remote)) fail(`B-SUPABASE-01 운영 Preflight: ${message}`);
    // 함수 digest 까지 본다. 표를 바꾸지 않는 Migration 이 운영에서 빠진 경우를 잡는다.
    if (!exactKeys(match, ["tables", "constraints", "indexes", "routines"])
      || match.tables !== (local.schema.tables_digest === remote.schema.tables_digest)
      || match.constraints !== (local.schema.constraint_digest === remote.schema.constraint_digest)
      || match.indexes !== (local.schema.index_digest === remote.schema.index_digest)
      || match.routines !== (local.schema.routine_digest === remote.schema.routine_digest)
      || !match.tables || !match.constraints || !match.indexes || !match.routines) {
      fail("B-SUPABASE-01 운영 DB 가 저장소 Migration 으로 만든 기준 DB 와 표·제약·인덱스·함수 digest 가 다릅니다.");
    }
  }
};
