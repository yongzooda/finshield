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
// 증거 harness(.github/scripts/run-supabase-evidence.mjs)는 같은 수집 함수를
// 로컬 기준 DB 와 운영 DB 양쪽에 적용해 digest 를 비교한다.
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

// Worker 가 읽어서는 안 되는 회원 본문 표. 거부 코드 42501 을 확인한다.
export const MEMBER_ONLY_TABLES = Object.freeze([
  "public.profiles", "public.financial_profiles", "public.financial_profile_versions",
  "public.financial_cases", "public.case_inputs", "public.case_input_pages", "public.case_input_findings",
  "public.case_events", "public.claims", "public.claim_revisions", "public.processing_consents",
  "private.input_objects", "private.ocr_artifacts",
]);

export const constraintDigest = (definitions) =>
  createHash("sha256").update([...definitions].sort().join("\n")).digest("hex");

export const loadDsn = (root) => {
  const env = readFileSync(resolve(root, ".env.local"), "utf8");
  const match = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m);
  if (!match) throw new Error(".env.local 에 DATABASE_URL 이 없다");
  return match[1];
};

// 제약·인덱스·RLS 를 카탈로그에서 읽어 digest 로 만든다. 로컬 기준 DB 와
// 운영 DB 에 같은 질의를 쓴다. 정렬은 서버가 아니라 여기서 한다. 서버 ORDER BY
// 는 locale 을 타서 같은 집합도 digest 가 달라진다. pg_get_indexdef 는
// search_path 에 있는 이름을 생략하므로 고정한다.
export const collectSchemaDigests = async (sql) => {
  const constraints = await sql`
    select c.relnamespace::regnamespace::text || '.' || c.relname || ' '
           || con.conname || ' ' || pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
     where c.relkind = 'r'
       and c.relnamespace::regnamespace::text = any(${TRACKED_SCHEMAS})`;
  const tables = await sql`
    select c.relnamespace::regnamespace::text || '.' || c.relname as name,
           c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
     where c.relkind = 'r'
       and c.relnamespace::regnamespace::text = any(${TRACKED_SCHEMAS})`;
  const indexes = await sql.begin(async (tx) => {
    await tx.unsafe("set local search_path = pg_catalog");
    return tx`
      select indexdef
        from pg_indexes
       where schemaname = any(${TRACKED_SCHEMAS})`;
  });
  // 함수 본문까지 본다. 표를 바꾸지 않는 Migration(예: 0018 의 Keyword 수정)이
  // 운영에 빠져 있어도 표·제약·인덱스 digest 는 같기 때문이다.
  const routines = await sql.begin(async (tx) => {
    await tx.unsafe("set local search_path = pg_catalog");
    return tx`
      select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
             || md5(pg_get_functiondef(p.oid)) as definition
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = any(${TRACKED_SCHEMAS})
         and p.prokind in ('f', 'p')`;
  });
  // 정책의 실제 USING/WITH CHECK와 permissive 구분도 비교한다. RLS enable만으로는 누락을 찾지 못한다.
  const policies = await sql.begin(async (tx) => {
    await tx.unsafe("set local search_path = pg_catalog");
    return tx`
      select n.nspname || '.' || c.relname || ' ' || p.polname || ' '
             || p.polcmd::text || ' ' || p.polpermissive::text || ' '
             || array_to_string(array(select case when r=0 then 'PUBLIC' else pg_get_userbyid(r)::text end
                                      from unnest(p.polroles) r order by 1), ',') || ' '
             || coalesce(pg_get_expr(p.polqual,p.polrelid),'') || ' '
             || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') as definition
        from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname = any(${TRACKED_SCHEMAS}) or (n.nspname='storage' and c.relname='objects')`;
  });
  const views = await sql.begin(async (tx) => {
    await tx.unsafe("set local search_path = pg_catalog");
    return tx`
      select n.nspname || '.' || c.relname || ' ' || pg_get_viewdef(c.oid, false)
             || ' ' || coalesce(array_to_string(array(select unnest(c.reloptions) order by 1), ','),'') as definition
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname = any(${TRACKED_SCHEMAS}) and c.relkind='v'`;
  });
  const names = tables.map((r) => r.name).sort();
  return {
    tracked_schemas: [...TRACKED_SCHEMAS],
    views: views.length,
    view_digest: constraintDigest(views.map((v) => v.definition)),
    policies: policies.length,
    policy_digest: constraintDigest(policies.map((p) => p.definition)),
    routines: routines.length,
    routine_digest: constraintDigest(routines.map((r) => r.definition)),
    tables: names.length,
    tables_digest: constraintDigest(names),
    constraints: constraints.length,
    constraint_digest: constraintDigest(constraints.map((r) => r.definition)),
    indexes: indexes.length,
    index_digest: constraintDigest(indexes.map((r) => r.indexdef)),
    rls_total: tables.length,
    rls_enforced: tables.filter((r) => r.enabled && r.forced).length,
    rls_missing: tables.filter((r) => !(r.enabled && r.forced)).map((r) => r.name).sort(),
  };
};

// 운영 프로젝트에서 최소 권한·Storage·확장·역할을 관측한다. 값만 모으고
// 판정은 evaluateRemoteObservations 가 한다. DSN 은 결과에 넣지 않는다.
export const collectRemoteObservations = async (dsn) => {
  const sql = postgres(dsn, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 20 });
  try {
    const url = new URL(dsn.replace(/^postgres(ql)?:/, "http:"));
    const schema = await collectSchemaDigests(sql);
    const leaked = await sql`
      select c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and array_to_string(c.relacl, ',') like '%anon=%'`;
    const exposed = await sql`
      select n.nspname || ':' || r.rolname as grant
        from pg_namespace n cross join lateral aclexplode(n.nspacl) a
        join pg_roles r on r.oid = a.grantee
       where n.nspname in ('private', 'kb', 'demo')
         and r.rolname in ('anon', 'authenticated')`;
    const workerDenied = [];
    const workerAllowed = [];
    for (const table of MEMBER_ONLY_TABLES) {
      try {
        await sql.unsafe(`select 1 from ${table} limit 1`);
        workerAllowed.push(table);
      } catch (error) {
        if (error.code === "42501") workerDenied.push(table);
        else workerAllowed.push(`${table}:${error.code ?? "unknown"}`);
      }
    }
    const buckets = await sql`select * from private.storage_preflight()`;
    const storagePolicies = await sql`
      select policyname, cmd, roles::text[] as roles
        from pg_policies where schemaname = 'storage' and tablename = 'objects'`;
    const extensions = await sql`
      select extname, extversion, extnamespace::regnamespace::text as schema
        from pg_extension where extname in ('vector', 'pgcrypto', 'pg_trgm')`;
    const roles = await sql`
      select rolname, rolbypassrls, rolcanlogin, rolsuper
        from pg_roles where rolname in ('finshield_worker', 'postgres', 'app_runtime', 'batch_loader')`;
    const role = (name) => roles.find((r) => r.rolname === name);
    return {
      host_role: url.username.split(".")[0],
      pooler_port: Number(url.port),
      schema,
      anon_leaks: leaked.map((r) => r.relname).sort(),
      exposed_grants: exposed.map((r) => r.grant).sort(),
      worker_denied_tables: workerDenied.sort(),
      worker_allowed_tables: workerAllowed.sort(),
      storage: {
        buckets: buckets.map((b) => ({ id: b.bucket_id, is_public: b.is_public, file_size_limit: b.file_size_limit === null ? null : Number(b.file_size_limit) }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        member_policies: storagePolicies
          .filter((p) => p.roles.some((r) => r === "anon" || r === "authenticated"))
          .map((p) => ({ name: p.policyname, cmd: p.cmd, roles: [...p.roles].sort() }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
      extensions: Object.fromEntries(extensions.map((e) => [e.extname, { version: e.extversion, schema: e.schema }])),
      roles: {
        worker_bypassrls: role("finshield_worker")?.rolbypassrls ?? null,
        worker_login: role("finshield_worker")?.rolcanlogin ?? null,
        postgres_bypassrls: Boolean(role("postgres")?.rolbypassrls || role("postgres")?.rolsuper),
        legacy_roles: roles.filter((r) => ["app_runtime", "batch_loader"].includes(r.rolname)).map((r) => r.rolname).sort(),
      },
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
};

// 관측값을 판정한다. 실패 이유를 문장으로 돌려주고 비어 있으면 합격이다.
export const evaluateRemoteObservations = (remote) => {
  const failures = [];
  if (remote.pooler_port !== 6543) failures.push(`pooler 포트가 6543 이 아니다: ${remote.pooler_port}`);
  if (remote.host_role !== "finshield_worker") failures.push(`접속 역할이 finshield_worker 가 아니다: ${remote.host_role}`);
  for (const name of remote.schema.rls_missing) failures.push(`RLS 미적용: ${name}`);
  for (const name of remote.anon_leaks) failures.push(`anon 권한 잔존: ${name}`);
  for (const grant of remote.exposed_grants) failures.push(`private/kb/demo 노출: ${grant}`);
  for (const table of MEMBER_ONLY_TABLES) {
    if (!remote.worker_denied_tables.includes(table)) failures.push(`finshield_worker 가 ${table} 를 읽었다`);
  }
  for (const b of remote.storage.buckets) if (b.is_public) failures.push(`Bucket 이 public 이다: ${b.id}`);
  if (!remote.storage.buckets.some((b) => b.id === "finshield-quarantine" && b.file_size_limit === 10485760)) {
    failures.push("finshield-quarantine Bucket 이 없거나 10 MiB 상한이 아니다");
  }
  if (!remote.storage.buckets.some((b) => b.id === "finshield-kb")) failures.push("finshield-kb Bucket 이 없다");
  if (remote.storage.buckets.some((b) => b.id === "finshield-exports")) failures.push("P0 에 finshield-exports Bucket 이 있다");
  for (const p of remote.storage.member_policies) {
    if (!(p.name === "finshield_quarantine__insert_open_slot" && p.cmd === "INSERT" && !p.roles.includes("anon"))) {
      failures.push(`회원에게 열린 storage.objects 정책: ${p.name} (${p.cmd})`);
    }
  }
  if (!remote.storage.member_policies.some((p) => p.name === "finshield_quarantine__insert_open_slot")) {
    failures.push("본인 slot INSERT 정책이 없다");
  }
  if (!remote.roles.postgres_bypassrls) failures.push("postgres 역할이 storage.objects 부재 확인에 필요한 bypassrls 가 없다");
  if (remote.roles.worker_bypassrls !== false) failures.push("finshield_worker 가 RLS 를 우회한다");
  if (remote.roles.worker_login !== true) failures.push("finshield_worker 가 로그인 역할이 아니다");
  if (remote.roles.legacy_roles.length > 0) failures.push(`PreCase 로그인 역할이 남아 있다: ${remote.roles.legacy_roles.join(", ")}`);
  for (const ext of ["vector", "pgcrypto", "pg_trgm"]) {
    if (remote.extensions[ext]?.schema !== "extensions") failures.push(`확장 ${ext} 이 extensions 스키마에 없다`);
  }
  return failures;
};

const run = async () => {
  const root = resolve(import.meta.dirname, "../..");
  const remote = await collectRemoteObservations(loadDsn(root));
  console.log(`접속: 역할 ${remote.host_role}, 포트 ${remote.pooler_port}`);
  console.log(`테이블 ${remote.schema.tables}개, 제약 ${remote.schema.constraints}건, digest ${remote.schema.constraint_digest.slice(0, 16)}`);
  console.log(`인덱스 ${remote.schema.indexes}개, digest ${remote.schema.index_digest.slice(0, 16)}`);
  console.log(`RLS enable+force 적용 테이블 ${remote.schema.rls_enforced}/${remote.schema.rls_total}`);
  console.log(`anon 권한 잔존 테이블 ${remote.anon_leaks.length}건, private·kb·demo 노출 ${remote.exposed_grants.length}건`);
  console.log(`finshield_worker 회원 테이블 거부 ${remote.worker_denied_tables.length}/${MEMBER_ONLY_TABLES.length}`);
  console.log(`Storage Bucket ${remote.storage.buckets.length}개, 회원 objects 정책 ${remote.storage.member_policies.length}건, postgres bypassrls ${remote.roles.postgres_bypassrls}`);
  console.log(`확장 ${Object.entries(remote.extensions).map(([k, v]) => `${k}@${v.version}(${v.schema})`).join(", ")}`);
  const failures = evaluateRemoteObservations(remote);
  if (failures.length > 0) {
    console.error("\n실패:");
    for (const line of failures) console.error(`  - ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n모든 Preflight 항목을 통과했습니다.");
};

if (import.meta.filename === process.argv[1]) await run();
