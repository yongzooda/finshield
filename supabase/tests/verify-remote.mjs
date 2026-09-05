// ============================================================
// 운영 Supabase 프로젝트 Preflight
//
// .env.local 의 DATABASE_URL (finshield_worker) 로 접속해 적용된 Schema 가
// 로컬 기준과 같은지, 최소 권한이 실제로 걸려 있는지 확인한다.
//
// 이 역할은 회원 테이블에 권한이 없다. 따라서 pg_catalog 만 읽고,
// 회원 테이블 접근은 "거부되는지" 를 확인하는 데만 쓴다.
// DSN 과 비밀번호를 출력하지 않는다.
//
// 사용: node supabase/tests/verify-remote.mjs
// 로컬 기준 digest 는 supabase/tests/run-local.sh 실행 뒤
//   docker exec fs-pg psql -U postgres -d finshield_test ... 로 얻는다.
// ============================================================
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import postgres from "postgres";

// 추적 대상을 손으로 나열하지 않는다. Migration 이 테이블을 추가할 때마다
// 목록이 낡아 digest 가 조용히 다른 범위를 재게 된다. 실제로 0005 적용 직후
// 그 일이 일어났다. FinShield 가 쓰는 네 스키마의 모든 일반 테이블을 대상으로
// 삼고, 범위 자체를 결과에 함께 남긴다.
export const TRACKED_SCHEMAS = Object.freeze(["public", "private", "kb", "demo"]);

export const constraintDigest = (definitions) =>
  createHash("sha256").update([...definitions].sort().join("\n")).digest("hex");

const loadDsn = (root) => {
  const env = readFileSync(resolve(root, ".env.local"), "utf8");
  const match = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m);
  if (!match) throw new Error(".env.local 에 DATABASE_URL 이 없다");
  return match[1];
};

const run = async () => {
  const root = resolve(import.meta.dirname, "../..");
  const sql = postgres(loadDsn(root), { prepare: false, max: 1, idle_timeout: 5 });
  const failures = [];
  try {
    const url = new URL(loadDsn(root).replace(/^postgres(ql)?:/, "http:"));
    console.log(`접속: ${url.hostname}:${url.port} 역할 ${url.username.split(".")[0]}`);
    if (url.port !== "6543") failures.push(`pooler 포트가 6543 이 아니다: ${url.port}`);

    const constraints = await sql`
      select c.relnamespace::regnamespace::text || '.' || c.relname || ' '
             || con.conname || ' ' || pg_get_constraintdef(con.oid) as definition
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
       where c.relkind = 'r'
         and c.relnamespace::regnamespace::text = any(${TRACKED_SCHEMAS})`;
    const tables = await sql`
      select count(*)::int as total
        from pg_class c
       where c.relkind = 'r'
         and c.relnamespace::regnamespace::text = any(${TRACKED_SCHEMAS})`;
    console.log(`테이블 ${tables[0].total}개, 제약 ${constraints.length}건, digest ${constraintDigest(constraints.map((r) => r.definition)).slice(0, 16)}`);

    // 인덱스 정의도 같은 방식으로 잰다. 정렬은 서버가 아니라 여기서 한다.
    // 서버 ORDER BY 는 locale 을 타서 같은 집합도 digest 가 달라진다.
    // pg_get_indexdef 는 search_path 에 있는 이름을 생략하므로 고정한다.
    const indexes = await sql.begin(async (tx) => {
      await tx.unsafe("set local search_path = pg_catalog");
      return tx`
        select indexdef
          from pg_indexes
         where schemaname = any(${TRACKED_SCHEMAS})`;
    });
    console.log(`인덱스 ${indexes.length}개, digest ${constraintDigest(indexes.map((r) => r.indexdef)).slice(0, 16)}`);

    const rls = await sql`
      select c.relnamespace::regnamespace || '.' || c.relname as name,
             c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c
       where c.relkind = 'r'
         and c.relnamespace::regnamespace::text = any(${TRACKED_SCHEMAS})`;
    for (const row of rls) {
      if (!row.enabled || !row.forced) failures.push(`RLS 미적용: ${row.name}`);
    }
    console.log(`RLS enable+force 적용 테이블 ${rls.filter((r) => r.enabled && r.forced).length}/${rls.length}`);

    const leaked = await sql`
      select c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and array_to_string(c.relacl, ',') like '%anon=%'`;
    for (const row of leaked) failures.push(`anon 권한 잔존: ${row.relname}`);
    console.log(`anon 권한 잔존 테이블 ${leaked.length}건`);

    const exposed = await sql`
      select r.rolname
        from pg_namespace n cross join lateral aclexplode(n.nspacl) a
        join pg_roles r on r.oid = a.grantee
       where n.nspname in ('private', 'kb', 'demo')
         and r.rolname in ('anon', 'authenticated')`;
    for (const row of exposed) failures.push(`private/kb/demo 노출: ${row.rolname}`);
    console.log(`private·kb·demo 노출 역할 ${exposed.length}건`);

    for (const table of ["public.financial_cases", "public.case_inputs", "private.input_objects"]) {
      try {
        await sql.unsafe(`select 1 from ${table} limit 1`);
        failures.push(`finshield_worker 가 ${table} 를 읽었다`);
      } catch (error) {
        if (error.code !== "42501") failures.push(`${table} 거부 코드가 42501 이 아니다: ${error.code}`);
      }
    }
    console.log("finshield_worker 회원 테이블 접근 거부 확인");

    // Storage: Private Bucket 두 개, 회원 정책은 본인 slot INSERT 하나뿐, postgres 는 bypassrls.
    const buckets = await sql`select * from private.storage_preflight()`;
    for (const b of buckets) if (b.is_public) failures.push(`Bucket 이 public 이다: ${b.bucket_id}`);
    if (!buckets.some((b) => b.bucket_id === "finshield-quarantine" && Number(b.file_size_limit) === 10485760)) {
      failures.push("finshield-quarantine Bucket 이 없거나 10 MiB 상한이 아니다");
    }
    if (buckets.some((b) => b.bucket_id === "finshield-exports")) failures.push("P0 에 finshield-exports Bucket 이 있다");
    const storagePolicies = await sql`
      select policyname, cmd, roles::text[] as roles
        from pg_policies where schemaname = 'storage' and tablename = 'objects'`;
    const memberPolicies = storagePolicies.filter((p) => p.roles.some((r) => r === "anon" || r === "authenticated"));
    for (const p of memberPolicies) {
      if (!(p.policyname === "finshield_quarantine__insert_open_slot" && p.cmd === "INSERT" && !p.roles.includes("anon"))) {
        failures.push(`회원에게 열린 storage.objects 정책: ${p.policyname} (${p.cmd})`);
      }
    }
    const bypass = await sql`select rolbypassrls or rolsuper as ok from pg_roles where rolname = 'postgres'`;
    if (!bypass[0]?.ok) failures.push("postgres 역할이 storage.objects 부재 확인에 필요한 bypassrls 가 없다");
    console.log(`Storage Bucket ${buckets.length}개, 회원 objects 정책 ${memberPolicies.length}건, postgres bypassrls ${bypass[0]?.ok}`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (failures.length > 0) {
    console.error("\n실패:");
    for (const line of failures) console.error(`  - ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n모든 Preflight 항목을 통과했습니다.");
};

if (import.meta.filename === process.argv[1]) await run();
