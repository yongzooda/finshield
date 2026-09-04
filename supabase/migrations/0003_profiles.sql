-- ============================================================
-- FinShield 0003 — 계정·금융 프로필 (명세 6.1)
--
-- 정본: docs/03-database-spec.md
--       4.1 고정 Enum, 5.1 키·소유권·시간, 5.2 문자열·JSON·해시,
--       5.3 삭제와 FK, 5.4 이름 규칙, 6.1 계정·금융 프로필,
--       9.1 RLS 기본 정책, 9.2 객체별 권한
--
-- 이 Migration 이 만드는 것은 auth.users 만 참조하는 뿌리 테이블이다.
-- 이후 Case·Run·Evidence 계열이 전부 여기에 의존한다.
--
-- 서버·Worker 의 테이블 권한은 여기서 부여하지 않는다. 명세 9.2 가 Profile
-- Snapshot 을 서버 함수 경로로 규정하므로 해당 RPC 를 만드는 Migration 에서
-- 함께 부여한다. 지금 광범위한 정책을 먼저 열어 두지 않는다.
--
-- 재실행 안전성: Enum·Table 은 존재하면 건너뛰고 Trigger·Policy 는 다시
-- 만든다. 다만 create table if not exists 는 이미 있는 테이블의 컬럼·제약을
-- 고치지 않는다. 형태가 다른 테이블이 있으면 조용히 넘어가므로, 적용 후
-- 반드시 운영 문서의 검증 쿼리로 실제 구조를 확인한다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum (명세 4.1)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role' and typnamespace = 'public'::regnamespace) then
    create type public.app_role as enum ('MEMBER', 'OPERATOR');
  end if;
  if not exists (select 1 from pg_type where typname = 'explanation_mode' and typnamespace = 'public'::regnamespace) then
    create type public.explanation_mode as enum ('STANDARD', 'BEGINNER', 'EASY');
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. 공용 Trigger 함수
--    private 에 두어 Data API 표면에 노출하지 않는다. Trigger 실행에는
--    호출자의 EXECUTE 권한이 필요하지 않으므로 authenticated 에 권한을
--    주지 않아도 동작한다.
-- ------------------------------------------------------------
create or replace function private.set_updated_at() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.reject_update() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '불변 행은 UPDATE 할 수 없습니다: %.%', tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- ------------------------------------------------------------
-- 3. public.profiles (명세 6.1)
--    이메일·비밀번호·Provider Token 컬럼을 만들지 않는다.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id                     uuid not null,
  app_role               public.app_role         not null default 'MEMBER',
  explanation_mode       public.explanation_mode not null default 'STANDARD',
  locale                 text not null default 'ko-KR',
  timezone               text not null default 'Asia/Seoul',
  terms_version          text,
  privacy_notice_version text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint pk_profiles primary key (id),
  constraint fk_profiles__auth_users foreign key (id) references auth.users (id) on delete cascade,
  constraint ck_profiles__locale   check (octet_length(locale)   between 2 and 16),
  constraint ck_profiles__timezone check (octet_length(timezone) between 1 and 64),
  constraint ck_profiles__terms_version
    check (terms_version is null or octet_length(terms_version) <= 64),
  constraint ck_profiles__privacy_notice_version
    check (privacy_notice_version is null or octet_length(privacy_notice_version) <= 64)
);

comment on table public.profiles is 'Auth 사용자와 1:1 회원 설정 (명세 6.1). 이메일·비밀번호·Token 을 저장하지 않는다';
comment on column public.profiles.app_role is '클라이언트 변경 금지. 제한된 서버 관리 함수만 갱신한다';

-- ------------------------------------------------------------
-- 4. public.financial_profiles (명세 6.1)
--    정확한 금액 대신 버전별 범주 Code 만 저장한다.
--    주민번호·계좌번호·정확한 자산·비밀번호 컬럼을 만들지 않는다.
-- ------------------------------------------------------------
create table if not exists public.financial_profiles (
  id                  uuid not null default gen_random_uuid(),
  owner_id            uuid not null,
  schema_version      text not null,
  income_band         text not null,
  debt_burden_band    text not null,
  emergency_fund_band text not null,
  purpose_code        text not null,
  horizon_code        text not null,
  liquidity_need      text not null,
  loss_tolerance      text not null,
  completeness        text not null,
  revision_no         integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint pk_financial_profiles primary key (id),
  constraint fk_financial_profiles__profiles
    foreign key (owner_id) references public.profiles (id) on delete cascade,
  constraint uq_financial_profiles__owner_id unique (owner_id),
  constraint uq_financial_profiles__id_owner_id unique (id, owner_id),
  constraint ck_financial_profiles__revision_no check (revision_no > 0),
  constraint ck_financial_profiles__debt_burden_band
    check (debt_burden_band in ('UNSPECIFIED', 'NONE', 'LOW', 'MEDIUM', 'HIGH')),
  constraint ck_financial_profiles__liquidity_need
    check (liquidity_need in ('UNSPECIFIED', 'LOW', 'MEDIUM', 'HIGH')),
  constraint ck_financial_profiles__loss_tolerance
    check (loss_tolerance in ('UNSPECIFIED', 'LOW', 'MEDIUM', 'HIGH')),
  constraint ck_financial_profiles__completeness
    check (completeness in ('SKIPPED', 'PARTIAL', 'COMPLETE')),
  constraint ck_financial_profiles__code_lengths check (
    octet_length(schema_version)      between 1 and 32
    and octet_length(income_band)         between 1 and 64
    and octet_length(emergency_fund_band) between 1 and 64
    and octet_length(purpose_code)        between 1 and 64
    and octet_length(horizon_code)        between 1 and 64
  )
);

comment on table public.financial_profiles is '사용자당 하나인 금융 프로필 편집본 (명세 6.1). 범주 Code 만 저장한다';

-- ------------------------------------------------------------
-- 5. public.financial_profile_versions (명세 6.1)
--    불변 Snapshot. 건너뛰기도 명시적 SKIPPED Snapshot 으로 남긴다.
-- ------------------------------------------------------------
create table if not exists public.financial_profile_versions (
  id             uuid not null default gen_random_uuid(),
  owner_id       uuid not null,
  profile_id     uuid not null,
  version_no     integer not null,
  schema_version text not null,
  snapshot       jsonb not null,
  completeness   text not null,
  content_hash   text not null,
  created_reason text not null,
  created_at     timestamptz not null default now(),
  constraint pk_financial_profile_versions primary key (id),
  constraint uq_financial_profile_versions__owner_profile_version
    unique (owner_id, profile_id, version_no),
  constraint uq_financial_profile_versions__id_owner_id unique (id, owner_id),
  constraint fk_financial_profile_versions__financial_profiles
    foreign key (profile_id, owner_id)
    references public.financial_profiles (id, owner_id) on delete cascade,
  constraint ck_financial_profile_versions__version_no check (version_no > 0),
  constraint ck_financial_profile_versions__snapshot check (jsonb_typeof(snapshot) = 'object'),
  constraint ck_financial_profile_versions__content_hash check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_financial_profile_versions__completeness
    check (completeness in ('SKIPPED', 'PARTIAL', 'COMPLETE')),
  constraint ck_financial_profile_versions__created_reason
    check (created_reason in ('CASE_CREATED', 'RUN_STARTED', 'PROFILE_UPDATED')),
  constraint ck_financial_profile_versions__schema_version
    check (octet_length(schema_version) between 1 and 32)
);

comment on table public.financial_profile_versions is '불변 금융 프로필 Snapshot (명세 6.1). UPDATE 하지 않는다';

-- ------------------------------------------------------------
-- 6. Trigger
-- ------------------------------------------------------------
drop trigger if exists trg_profiles__set_updated_at on public.profiles;
create trigger trg_profiles__set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

drop trigger if exists trg_financial_profiles__set_updated_at on public.financial_profiles;
create trigger trg_financial_profiles__set_updated_at
  before update on public.financial_profiles
  for each row execute function private.set_updated_at();

drop trigger if exists trg_financial_profile_versions__reject_update on public.financial_profile_versions;
create trigger trg_financial_profile_versions__reject_update
  before update on public.financial_profile_versions
  for each row execute function private.reject_update();

-- ------------------------------------------------------------
-- 7. Auth 사용자 생성 시 Profile 자동 생성 (명세 9.2 서버 Auth trigger)
--    SECURITY DEFINER 가 필요한 경우이므로 고정 search_path 를 두고
--    PUBLIC EXECUTE 를 회수한다 (명세 2.2).
-- ------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists trg_auth_users__handle_new_user on auth.users;
create trigger trg_auth_users__handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 8. RLS (명세 9.1)
--    FORCE 로 테이블 소유자에게도 정책을 적용한다. bypassrls 를 가진
--    postgres·service_role 은 여전히 우회하므로 서버 코드가 Owner 조건을
--    직접 걸어야 한다 (명세 9.1 6번).
-- ------------------------------------------------------------
alter table public.profiles                   enable row level security;
alter table public.profiles                   force  row level security;
alter table public.financial_profiles         enable row level security;
alter table public.financial_profiles         force  row level security;
alter table public.financial_profile_versions enable row level security;
alter table public.financial_profile_versions force  row level security;

drop policy if exists profiles__select_own on public.profiles;
create policy profiles__select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles__update_own on public.profiles;
create policy profiles__update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists financial_profiles__select_own on public.financial_profiles;
create policy financial_profiles__select_own on public.financial_profiles
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists financial_profiles__insert_own on public.financial_profiles;
create policy financial_profiles__insert_own on public.financial_profiles
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists financial_profiles__update_own on public.financial_profiles;
create policy financial_profiles__update_own on public.financial_profiles
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists financial_profiles__delete_own on public.financial_profiles;
create policy financial_profiles__delete_own on public.financial_profiles
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists financial_profile_versions__select_own on public.financial_profile_versions;
create policy financial_profile_versions__select_own on public.financial_profile_versions
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- ------------------------------------------------------------
-- 9. Grant (명세 9.2)
--    profiles 의 UPDATE 는 컬럼 단위로 제한한다. app_role 은 제외해
--    사용자가 스스로 운영자 권한을 부여할 수 없게 한다.
--    financial_profile_versions 는 사용자 SELECT 만 허용하고 INSERT 는
--    서버 Snapshot 함수 Migration 에서 부여한다.
-- ------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (explanation_mode, locale, timezone, terms_version, privacy_notice_version)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.financial_profiles to authenticated;

grant select on public.financial_profile_versions to authenticated;

-- anon 은 어떤 회원 테이블에도 접근하지 않는다.
revoke all on public.profiles                   from anon;
revoke all on public.financial_profiles         from anon;
revoke all on public.financial_profile_versions from anon;
