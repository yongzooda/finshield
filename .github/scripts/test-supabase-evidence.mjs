// ============================================================
// B-SUPABASE-01 결과 정책의 오프라인 mutation test
//
// DB 에 접속하지 않는다. 정책이 요구하는 관측값을 갖춘 결과는 통과하고,
// digest 불일치·허용된 교차 접근·표본 미달·운영 Preflight 위반처럼
// 거부되어야 할 결과는 실제로 거부되는지 확인한다.
// ============================================================
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { expectedInventory, FORMULA_VERSION, validateSupabaseEvidenceResult } from "./supabase-evidence-policy.mjs";
import { evaluateRemoteObservations, MEMBER_ONLY_TABLES, TRACKED_SCHEMAS } from "../../supabase/tests/verify-remote.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inventory = expectedInventory(root);
assert.ok(inventory.migrations.length >= 17 && inventory.tests.length >= 14);
assert.ok(inventory.tests.includes("14_cross_owner_matrix.sql"));

const schema = () => ({
  tracked_schemas: [...TRACKED_SCHEMAS], tables: 72, tables_digest: "a".repeat(64),
  constraints: 640, constraint_digest: "b".repeat(64), indexes: 260, index_digest: "c".repeat(64),
  rls_total: 72, rls_enforced: 72, rls_missing: [],
});
const good = () => ({
  observations: {
    contract: {
      formula_version: FORMULA_VERSION, tracked_schemas: [...TRACKED_SCHEMAS],
      migration_files: [...inventory.migrations], test_files: [...inventory.tests], member_only_tables: [...MEMBER_ONLY_TABLES],
    },
    local: {
      files_passed: [...inventory.tests], files_failed: [], assertions_passed: 470, assertions_failed: 0,
      matrix: {
        cross_owner_denials: 240, anon_denials: 72, worker_denials: 20, worker_allowed: 52,
        worker_denied_tables: [...MEMBER_ONLY_TABLES, "private.budget_limits"],
        unexpected_allows: 0, inconclusive: 3, closed_slot_rejections: 20, blocked_read_rejections: 20, access_block_ms: 4.2,
      },
      schema: schema(),
    },
    remote: {
      host_role: "finshield_worker", pooler_port: 6543, schema: schema(),
      anon_leaks: [], exposed_grants: [], worker_denied_tables: [...MEMBER_ONLY_TABLES], worker_allowed_tables: [],
      storage: {
        buckets: [{ id: "finshield-kb", is_public: false, file_size_limit: null }, { id: "finshield-quarantine", is_public: false, file_size_limit: 10485760 }],
        member_policies: [{ name: "finshield_quarantine__insert_open_slot", cmd: "INSERT", roles: ["authenticated"] }],
      },
      extensions: { vector: { version: "0.8.0", schema: "extensions" }, pgcrypto: { version: "1.3", schema: "extensions" }, pg_trgm: { version: "1.6", schema: "extensions" } },
      roles: { worker_bypassrls: false, worker_login: true, postgres_bypassrls: true, legacy_roles: [] },
    },
    schema_match: { tables: true, constraints: true, indexes: true },
  },
});
const errorsOf = (result) => {
  const errors = [];
  validateSupabaseEvidenceResult(result, (message) => errors.push(message), root);
  return errors;
};
assert.deepEqual(errorsOf(good()), []);
assert.deepEqual(evaluateRemoteObservations(good().observations.remote), []);

const rejects = (name, mutate) => {
  const result = good();
  mutate(result.observations);
  assert.ok(errorsOf(result).length > 0, `거부되어야 할 결과가 통과했습니다: ${name}`);
};
rejects("허용된 교차 접근 1건", (o) => { o.local.matrix.unexpected_allows = 1; });
rejects("교차 소유 표본 미달", (o) => { o.local.matrix.cross_owner_denials = 199; });
rejects("익명 거부 표본 미달", (o) => { o.local.matrix.anon_denials = 10; });
rejects("closed slot 표본 미달", (o) => { o.local.matrix.closed_slot_rejections = 19; });
rejects("token 재사용 표본 미달", (o) => { o.local.matrix.blocked_read_rejections = 19; });
rejects("접근 차단 지연 초과", (o) => { o.local.matrix.access_block_ms = 2500; });
rejects("Worker 가 회원 본문 표를 읽음", (o) => { o.local.matrix.worker_denied_tables = o.local.matrix.worker_denied_tables.filter((t) => t !== "public.financial_cases"); });
rejects("시험 파일 실패", (o) => { o.local.files_failed = ["06_evidence_invariants.sql"]; o.local.files_passed = o.local.files_passed.filter((f) => f !== "06_evidence_invariants.sql"); });
rejects("시험 파일 누락", (o) => { o.local.files_passed = o.local.files_passed.slice(1); });
rejects("단언 실패 1건", (o) => { o.local.assertions_failed = 1; });
rejects("단언 수 미달", (o) => { o.local.assertions_passed = 100; });
rejects("제약 digest 불일치", (o) => { o.remote.schema.constraint_digest = "d".repeat(64); o.schema_match.constraints = false; });
rejects("digest 불일치를 일치로 표시", (o) => { o.remote.schema.index_digest = "d".repeat(64); });
rejects("표 digest 불일치", (o) => { o.remote.schema.tables_digest = "d".repeat(64); o.schema_match.tables = false; });
rejects("운영 RLS 미적용 표", (o) => { o.remote.schema.rls_enforced = 71; o.remote.schema.rls_missing = ["public.notifications"]; });
rejects("pooler 포트 5432", (o) => { o.remote.pooler_port = 5432; });
rejects("service_role 접속", (o) => { o.remote.host_role = "postgres"; });
rejects("anon 권한 잔존", (o) => { o.remote.anon_leaks = ["financial_cases"]; });
rejects("private 스키마 노출", (o) => { o.remote.exposed_grants = ["private:authenticated"]; });
rejects("운영 Worker 가 회원 표 읽음", (o) => { o.remote.worker_denied_tables = o.remote.worker_denied_tables.slice(1); });
rejects("public Bucket", (o) => { o.remote.storage.buckets[1].is_public = true; });
rejects("10 MiB 상한 아님", (o) => { o.remote.storage.buckets[1].file_size_limit = 52428800; });
rejects("exports Bucket 존재", (o) => { o.remote.storage.buckets.push({ id: "finshield-exports", is_public: false, file_size_limit: null }); });
rejects("회원 SELECT storage 정책", (o) => { o.remote.storage.member_policies.push({ name: "open_read", cmd: "SELECT", roles: ["authenticated"] }); });
rejects("anon 에 열린 slot 정책", (o) => { o.remote.storage.member_policies[0].roles = ["anon", "authenticated"]; });
rejects("slot INSERT 정책 없음", (o) => { o.remote.storage.member_policies = []; });
rejects("postgres bypassrls 없음", (o) => { o.remote.roles.postgres_bypassrls = false; });
rejects("Worker bypassrls", (o) => { o.remote.roles.worker_bypassrls = true; });
rejects("PreCase 로그인 역할 잔존", (o) => { o.remote.roles.legacy_roles = ["app_runtime"]; });
rejects("vector 확장이 public 스키마", (o) => { o.remote.extensions.vector.schema = "public"; });
rejects("산식 버전 변경", (o) => { o.contract.formula_version = "supabase-v0"; });
rejects("Migration 목록 변경", (o) => { o.contract.migration_files = o.contract.migration_files.slice(0, -1); });
rejects("추적 스키마 축소", (o) => { o.contract.tracked_schemas = ["public"]; o.local.schema.tracked_schemas = ["public"]; o.remote.schema.tracked_schemas = ["public"]; });
rejects("회원 본문 표 목록 변경", (o) => { o.contract.member_only_tables = o.contract.member_only_tables.slice(1); });
rejects("관측 필드 추가", (o) => { o.local.extra = true; });
rejects("observations 누락", (o) => { delete o.remote; });

console.log("B-SUPABASE-01 결과 정책 mutation test 통과: 합격 1건, 거부 36건.");
