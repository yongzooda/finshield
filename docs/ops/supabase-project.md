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

2026-09-06 `0017` 까지 적용한 뒤 확인한 결과는 81개 테이블 제약 738건 digest `0a6f7ea03b8dce7f`, 인덱스 253개 digest `fc40f010983fac01` 이며 기준 DB 와 일치했다. 2026-09-05 `0005` 까지 적용한 뒤 확인한 결과는 13개 테이블 제약 157건, digest `96f78b68dbbfc063` 으로 로컬 기준과 완전히 일치했다. `0006` 까지는 17개 테이블 제약 185건 `627fd0ead651cfa8`, `0007` 까지는 27개 테이블 제약 261건 `610f0532a4886f03` 으로 각각 로컬 기준과 일치했다. 인덱스 85개 정의도 집합으로는 동일했으나 서버 `ORDER BY` 가 locale 을 타서 digest 가 달랐고, 그 뒤로는 클라이언트에서 정렬해 잰다. RLS 는 13개 테이블 모두 enable+force 이고, `anon` 권한 잔존과 `private`·`kb`·`demo` 노출은 0건이며, `finshield_worker` 는 회원 테이블 세 곳 모두에서 `42501` 로 거부됐다.

추적 범위는 손으로 나열하지 않고 `public`·`private`·`kb`·`demo` 네 스키마의 모든 일반 테이블로 잡는다. `0005` 적용 직후 목록이 낡아 세 테이블을 빼고 재는 일이 실제로 있었다.

## 증거 harness

`B-SUPABASE-01` 증거는 `.github/workflows/supabase-evidence.yml` 이 main 에서 만든다. 격리 기준 Postgres 에 같은 Migration·시험을 적용하고 `verify-remote.mjs` 의 수집 함수로 운영 DB 를 관측해 표·제약·인덱스 digest 를 비교한다. 계약과 합격선은 `docs/ops/supabase-evidence.md` 에 있다. `supabase/tests/14_cross_owner_matrix.sql` 이 카탈로그 기반 교차 소유·익명·Worker 거부 행렬을 만든다.

## 주의할 점

- `finshield_worker` 는 0001 에서 `public`·`private`·`kb`·`demo` 의 USAGE 만 받았다. `extensions` 가 빠져 있어 운영 프로젝트에서 Worker 의 pgvector 연산자 접근이 `permission denied for schema extensions` 로 막혔다. 로컬 시험은 그 질의를 `postgres` 로만 돌려 놓쳤다. `0008` 이 USAGE 를 주고, `04_kb_invariants.sql` 이 Worker 역할로 Exact KNN 을 실행해 재발을 막는다.
- `pgvector` 연산자(`<=>` 등)는 `extensions` 스키마에 있다. Supabase 가 만든 역할은 `search_path` 에 `extensions` 가 들어 있지만 `finshield_worker` 와 로컬 Stub 역할은 그렇지 않다. 서버 함수와 RPC 는 `operator(extensions.<=>)` 처럼 완전 수식하고 `search_path` 에 기대지 않는다. `04_kb_invariants.sql` 이 이 규칙을 시험한다.

- `0013` 은 `storage.buckets` 에 행을 넣고 `storage.objects` 에 정책을 만든다. Supabase SQL Editor 의 `postgres` 역할로 적용해야 하며 `storage.objects` 의 소유자가 아니므로 `alter table storage.objects` 는 실행하지 않는다. 정책 생성이 `must be owner` 로 거부되면 적용 결과를 그대로 기록하고 Dashboard 의 Storage Policy 화면으로 같은 조건을 만든다.
- Cleanup 성공·Purge·Sweeper 는 `storage.objects` 부재를 다시 조회한다. 이 조회는 RLS 우회가 가능한 역할(`postgres` 의 `bypassrls`)로 실행돼야 의미가 있어 함수가 `assert_can_see_storage_objects()` 로 먼저 확인하고, 아니면 성공을 기록하지 않고 실패한다. `verify-remote.mjs` 가 같은 사실을 조회한다.

## 현재 미해결

- `B-SUPABASE-01`은 통과했다. Migration `0001`~`0017`을 2026-09-06 운영 프로젝트에 모두 적용했고, main run `34023678131`의 증거를 채택 PR #118 로 채택했다. 기준 DB 시험 01~14 는 429건이며 운영 DB 와 표·제약·인덱스 digest 세 값이 같다.
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
| `0006_execution_registry.sql` | 적용 완료 | 명세 6.8 정책·Agent·Tool·Allowlist Registry 4개 표, `tool_transport` Enum, Worker 읽기 정책 |
| `0007_source_knowledge_base.sql` | 적용 완료 | 명세 6.5·6.8 Source Snapshot·조회 사건·KB Release·문서·Chunk·`vector(1024)` Embedding·공식 채널 10개 표, `authority_level`·`freshness_status` Enum |
| `0008_worker_extensions_usage.sql` | 적용 완료 | `finshield_worker` 에 `extensions` 스키마 USAGE. 0007 검증에서 Worker 의 pgvector 연산자 접근이 거부되는 것을 발견해 Forward-fix |
| `0009_runs_and_manifests.sql` | 적용 완료 | 명세 6.8·6.4·6.3 실행 Manifest 와 구성 Join·Event, `verification_runs`, `verification_run_claims`, `financial_cases.latest_successful_run_id` FK 보완. Run 상태 전이 함수는 예산·Outbox 뒤 |
| `0010_agent_tool_evidence.sql` | 적용 완료 | 명세 6.4·6.5 Agent·Tool 실행 Trace, Retrieval 단계, Case Source, Evidence, 최종 Claim, Claim·Evidence 관계 9개 표. Manifest·Allowlist·Provenance·Evidence Policy Trigger |
| `0011_results_and_passports.sql` | 적용 완료 | 명세 6.4·6.5 축 결과·행동 가이드·채널 Join·Evidence Passport 4개 표, `financial_cases.latest_passport_id` FK 보완. 원시 URL·전화번호·Manifest 불일치·유효기간 밖 채널을 Trigger 로 차단 |
| `0012_jobs_notifications_aftercare.sql` | 적용 완료 | 명세 6.6·6.7 재검증 Job·Runtime·Event·Passport Diff·알림·알림 설정·가입 후 점검·답변·Checklist 9개 표, `verification_runs.revalidation_job_id` FK 보완. 종결 Job 의 Diff·Run·Passport 정합성은 Deferred Trigger, 가입 확인 없는 점검 시작과 NO_CHANGE 위험 알림은 Trigger 로 차단. Job Claim·최종화 함수는 Outbox 뒤 |
| `0013_storage_cleanup_outbox.sql` | 적용 완료 | 명세 10·12·13·6.9 Private Bucket 두 개, `storage.objects` 본인 slot INSERT 정책, `input_objects` 경로 구성·slot 강제, Cleanup Job·Outbox·Idempotency·삭제 요청·Ledger·Case Embedding 6개 표, Cleanup enqueue·claim·finish·Sweeper·Signed URL 확인·Case 삭제 요청·Purge 함수. 성공 기록은 `storage.objects` 부재를 다시 조회한 뒤에만 남긴다 |
| `0014_budget_rate_audit.sql` | 적용 완료 | 명세 6.9·6.11 예산 상한·Counter·예약·Rate·감사·Source Cache·Circuit 8개 표, reserve·settle·release·reconcile, Rate 소비, Provider 1 TPS 직렬화·Circuit Breaker, Cache 갱신·조회, 감사 기록, 90일·24시간·13개월 Retention 함수. 상한 설정이 없는 범위는 예약을 거부한다 |
| `0015_case_run_functions.sql` | 적용 완료 | 명세 4.2~4.4·7.2·9.3·11.2 의 Case 생성·전이, 입력 단계 전진, Run 생성·시작·실패, 재검증 enqueue·claim·heartbeat·fail·cancel, 공용 KB·Case Vector 검색 함수. 최종화 함수는 다음 Migration |
| `0016_finalization.sql` | 적용 완료 | 명세 7.3 검증 최종화(`finalize_verification_run`)와 6.6 재검증 최종화(`finalize_revalidation`), 요구사항 2.2 종합 결과 Matrix 순수 함수. 근거 정책 Deferred Trigger 를 함수 끝에서 즉시 검사로 끌어당긴다 |
| `0017_demo_evaluation_views.sql` | 적용 완료 | 명세 6.10 Demo 8개 표(Seed·Session·Run·Agent·Tool·Source·결과), 6.8 평가셋·평가 Run·지표·Tool 상태 4개 표, 9.3 회원 안전 View 4개와 신뢰센터·Tool 상태 View. Demo Session 은 Capability Hash 만 저장하고 Live Session 에 사전계산 결과를 넣을 수 없다 |
