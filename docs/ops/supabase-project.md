# FinShield Supabase 프로젝트 운영

## 프로젝트 사실

DB 명세 7절이 `project_ref`·host·bucket·expected migration version을 secret 값 없이 배포 preflight inventory에 고정하도록 요구한다.

| 항목 | 값 |
|---|---|
| Project ref | `exarejrwvjochjdminzo` |
| Region | `ap-northeast-2` (Northeast Asia, Seoul) |
| Plan | Free |
| Runtime 연결 | Supavisor transaction pooler, port `6543` |
| Migration 연결 | direct connection. 앱 Runtime 에 노출하지 않는다 |
| Private Bucket | `finshield-quarantine`, `finshield-kb` |
| PostgreSQL | 17.6 |

이 프로젝트는 PreCase Production 과 물리적으로 분리된 FinShield 전용이다. 비밀번호와 연결 문자열 전체는 이 문서에 적지 않는다.

## Migration 적용

`supabase/migrations/`가 FinShield Forward-only 기준선이다. `supabase/precase-baseline/`의 PreCase Migration 은 이 프로젝트에 적용하지 않는다.

1. Supabase 대시보드 SQL Editor 를 연다.
2. 적용할 Migration 파일 내용을 그대로 붙여넣고 실행한다.
3. 아래 검증 쿼리로 결과를 확인한다.
4. 적용한 파일과 시각을 이 문서의 이력에 남긴다.

`0001_finshield_baseline.sql`은 멱등하다. 이미 적용한 프로젝트에 다시 실행해도 안전하다.

붙여넣기 전에 로컬에서 먼저 돌린다. `supabase/tests/run-local.sh`가 격리된 PostgreSQL 컨테이너에 Supabase Stub 과 모든 Migration 을 순서대로 적용하고 제약·RLS 시험까지 실행한다. 운영 프로젝트에 접속하지 않는다. Docker 만 있으면 된다.

```bash
supabase/tests/run-local.sh
```

SQL Editor 는 여러 문장을 하나의 트랜잭션으로 실행한다. 중간에 실패하면 전체가 되돌아가므로 부분 적용 상태가 남지 않는다. 실패하면 오류를 고친 뒤 처음부터 다시 실행한다.

## 0001 적용 뒤 반드시 할 일

`0001`은 `app_runtime` 로그인 역할을 폐기하고 `finshield_worker`를 `NOLOGIN`으로 만든다. 비밀번호를 Migration 에 넣지 않기 때문이다 (명세 14.1). 따라서 적용 직후에는 사용할 수 있는 Runtime 연결이 없다.

SQL Editor 에서 아래를 한 번 실행해 로그인 권한을 부여한다. 비밀번호는 새로 만들고 비밀번호 관리자에 보관한다.

```sql
alter role finshield_worker with login password '여기에_새_비밀번호';
```

그다음 연결 문자열의 사용자 이름을 바꾼다. Supavisor 는 `롤이름.프로젝트ref` 형식을 쓴다.

| 위치 | 사용자 이름 |
|---|---|
| 이전 | `app_runtime.exarejrwvjochjdminzo` |
| 이후 | `finshield_worker.exarejrwvjochjdminzo` |

`.env.local`의 `DATABASE_URL`과 Vercel 환경변수를 모두 갱신한다. `BATCH_DATABASE_URL`은 비워 둔다.

## 하지 않는 것

- `supabase/precase-baseline/`의 Migration 을 이 프로젝트에 적용하지 않는다.
- `postgres`·`service_role` 을 앱 Runtime 연결에 쓰지 않는다. 두 역할은 RLS 를 우회한다.
- 사용자 CRUD 를 pooler 연결로 처리하지 않는다. 사용자 JWT 와 `authenticated`·RLS 를 쓴다.
- 비밀번호를 Migration, 문서, 이슈, PR, 채팅에 남기지 않는다.
- `private`·`kb`·`demo` 를 Supabase Exposed Schema 목록에 넣지 않는다.

## 검증 쿼리

SQL Editor 에서 실행한다. 기대값과 다르면 그 항목을 고치기 전까지 다음 단계로 넘어가지 않는다.

```sql
select
  (select count(*) from pg_extension
     where extname in ('pgcrypto','pg_trgm','vector'))            as extensions,   -- 3
  (select count(*) from pg_namespace
     where nspname in ('private','kb','demo'))                    as schemas,      -- 3
  (select count(*) from pg_roles where rolname = 'finshield_worker') as worker,    -- 1
  (select rolbypassrls from pg_roles where rolname = 'finshield_worker') as worker_bypassrls, -- false
  (select count(*) from pg_roles
     where rolname in ('app_runtime','batch_loader'))             as retired_roles, -- 0
  (select count(*) from storage.buckets where public)             as public_buckets; -- 0
```

노출 경계는 별도로 확인한다. 세 값 모두 `false` 여야 한다.

```sql
select
  has_schema_privilege('anon',          'private', 'USAGE') as anon_private,
  has_schema_privilege('authenticated', 'kb',      'USAGE') as auth_kb,
  has_schema_privilege('authenticated', 'demo',    'USAGE') as auth_demo;
```

기본 권한도 확인한다. `anon` 과 `authenticated` 가 어떤 객체 종류에도 남아 있으면 안 된다. `r` 은 테이블, `S` 는 시퀀스, `f` 는 함수다.

```sql
select defaclnamespace::regnamespace::text as schema, defaclobjtype as kind, defaclacl::text as acl
from pg_default_acl
where defaclnamespace::regnamespace::text in ('public','private','kb','demo')
order by 1, 2;
```

`0001` 적용 직후 조회에서 `public [f]` 에 `anon=X/postgres` 와 `authenticated=X/postgres` 가 남아 있었다. `0002` 가 이를 회수한다.

### 닫지 못한 기본 권한

`0002` 적용 뒤에도 부여자가 `supabase_admin` 인 항목 세 개가 남는다.

```
public [S] {... anon=rwU/supabase_admin, authenticated=rwU/supabase_admin ...}
public [f] {... anon=X/supabase_admin,   authenticated=X/supabase_admin ...}
public [r] {... anon=arwdDxtm/supabase_admin, authenticated=arwdDxtm/supabase_admin ...}
```

이 설정은 `supabase_admin` 이 만드는 객체에만 적용된다. Migration 은 `postgres` 로 실행하므로 우리가 만드는 객체에는 영향이 없다. `postgres` 는 `supabase_admin` 의 멤버가 아니어서 이 항목을 바꿀 수 없고, Supabase 플랫폼 기본값이므로 통제 밖이다.

확인 시점에 `supabase_admin` 이 `public` 에 소유한 테이블·뷰·함수는 0건이었다. 실제 노출은 없지만 기본 권한을 완전히 닫았다고 표현하지 않는다. 대신 `public` 의 모든 객체 소유자가 `postgres` 인지 주기적으로 확인한다.

```sql
select n.nspname, c.relname, r.rolname as owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_roles r on r.oid = c.relowner
where n.nspname in ('public','private','kb','demo')
  and c.relkind in ('r','v','m','S')
  and r.rolname <> 'postgres';
```

결과가 0행이어야 한다.

### `0003` 적용 후 확인

```sql
select
  (select count(*)::int from pg_tables
     where schemaname = 'public'
       and tablename in ('profiles','financial_profiles','financial_profile_versions'))   as tables,        -- 3
  (select count(*)::int from pg_tables
     where schemaname = 'public' and rowsecurity
       and tablename in ('profiles','financial_profiles','financial_profile_versions'))   as rls_enabled,   -- 3
  (select count(*)::int from pg_class
     where relnamespace = 'public'::regnamespace and relrowsecurity and relforcerowsecurity
       and relname in ('profiles','financial_profiles','financial_profile_versions'))     as rls_forced,    -- 3
  (select count(*)::int from pg_policies where schemaname = 'public')                     as policies,      -- 7
  (select count(*)::int from pg_type
     where typnamespace = 'public'::regnamespace
       and typname in ('app_role','explanation_mode'))                                    as enums,         -- 2
  (select count(*)::int from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public')                                  as anon_grants;   -- 0
```

`app_role` 컬럼이 사용자 UPDATE 대상에서 빠졌는지 따로 확인한다. 결과에 `app_role` 이 없어야 한다.

```sql
select column_name
from information_schema.column_privileges
where grantee = 'authenticated' and table_name = 'profiles' and privilege_type = 'UPDATE'
order by column_name;
```

### `0004` 적용 후 확인

적용 뒤에는 사람이 표를 눈으로 대조하지 않고 digest 로 비교한다.

```bash
node supabase/tests/verify-remote.mjs
```

이 스크립트는 `.env.local` 의 `DATABASE_URL`(`finshield_worker`)로 접속해 pooler 포트, 제약 정의 digest, RLS enable+force, `anon` 권한 잔존, `private`·`kb`·`demo` 노출, 회원 테이블 접근 거부를 확인한다. DSN 과 비밀번호는 출력하지 않는다.

로컬 기준 digest 는 `supabase/tests/run-local.sh` 를 돌린 뒤 같은 질의로 얻는다. 두 값이 다르면 대시보드에서 손으로 바꾼 객체가 있거나 Migration 이 부분 적용된 것이다.

2026-09-05 `0005` 까지 적용한 뒤 확인한 결과는 13개 테이블 제약 157건, digest `96f78b68dbbfc063` 으로 로컬 기준과 완전히 일치했다. RLS 는 13개 테이블 모두 enable+force 이고, `anon` 권한 잔존과 `private`·`kb`·`demo` 노출은 0건이며, `finshield_worker` 는 회원 테이블 세 곳 모두에서 `42501` 로 거부됐다.

추적 범위는 손으로 나열하지 않고 `public`·`private`·`kb`·`demo` 네 스키마의 모든 일반 테이블로 잡는다. `0005` 적용 직후 목록이 낡아 세 테이블을 빼고 재는 일이 실제로 있었다.

## 현재 미해결

- `B-SUPABASE-01`은 통과하지 않았다. 남은 업무 테이블은 명세 6.3~6.10 이고, Storage 정책과 main 실행 증거 harness 가 아직 없다. 제약·RLS positive/negative 시험은 `supabase/tests/`에 있고 로컬에서 111건이 통과한다. 운영 프로젝트는 `verify-remote.mjs` Preflight 만 통과한 상태다. 증거로 채택하려면 같은 시험을 실제 프로젝트 DSN 으로 main 에서 실행해야 한다.
- 저장소 Runtime 과 화면은 아직 PreCase 기준선이라 PreCase 코퍼스 테이블을 조회한다. `insight` 5개와 `verification` 화면이 빌드 시 사전 렌더되면서 `relation "cases" does not exist` 로 배포 전체를 실패시켰다. 여섯 화면의 사전 렌더를 끄고 요청 시점 렌더로 바꿔 빌드를 통과시켰다.
- 이 화면들은 FinShield 전용 DB 에서 요청 시점에 실패한다. 데이터를 지어내지 않고 실패를 감추지 않기 위한 선택이며, FinShield 화면으로 재구현할 때 선언과 함께 제거한다.
- 그동안 Vercel Production 은 환경변수 변경 이전 배포를 계속 서비스한다. 그 배포는 이전 DB 연결을 유지한다.

## 적용 이력

| Migration | 적용 | 비고 |
|---|---|---|
| `0001_finshield_baseline.sql` | 적용 완료 | 첫 실행은 `drop owned by` 권한 부족으로 전체 롤백됐고, 수정 후 재실행해 적용했다 |
| `0002_revoke_default_function_grants.sql` | 적용 완료 | `0001`이 빠뜨린 함수 기본 권한을 회수했다 |
| `0003_profiles.sql` | 적용 완료 | 명세 6.1 계정·금융 프로필 3개 테이블과 RLS |
| `0004_financial_cases.sql` | 적용 완료 | 명세 6.2 FinancialCase·입력 7개 테이블, Enum 9종, RLS |
| `0005_claims_and_consents.sql` | 적용 완료 | 명세 6.3 Claim·revision·처리 동의, `0004`의 직접 DELETE 구멍 Forward-fix |
| `0006_execution_registry.sql` | 미적용 | 명세 6.8 정책·Agent·Tool·Allowlist Registry 4개 표, `tool_transport` Enum, Worker 읽기 정책 |
