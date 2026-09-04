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

## 현재 미해결

- `B-SUPABASE-01`은 통과하지 않았다. 업무 테이블·RLS positive/negative 시험·Storage 정책이 아직 없다.
- 저장소 Runtime 과 화면은 아직 PreCase 기준선이라 PreCase 코퍼스 테이블을 조회한다. `insight` 5개와 `verification` 화면이 빌드 시 사전 렌더되면서 `relation "cases" does not exist` 로 배포 전체를 실패시켰다. 여섯 화면의 사전 렌더를 끄고 요청 시점 렌더로 바꿔 빌드를 통과시켰다.
- 이 화면들은 FinShield 전용 DB 에서 요청 시점에 실패한다. 데이터를 지어내지 않고 실패를 감추지 않기 위한 선택이며, FinShield 화면으로 재구현할 때 선언과 함께 제거한다.
- 그동안 Vercel Production 은 환경변수 변경 이전 배포를 계속 서비스한다. 그 배포는 이전 DB 연결을 유지한다.

## 적용 이력

| Migration | 적용 시각 | 비고 |
|---|---|---|
| `0001_finshield_baseline.sql` | 미적용 | 적용 후 이 표를 갱신한다 |
