-- ============================================================
-- 로컬 검증용 Supabase 최소 Stub
--
-- Supabase 관리형 프로젝트가 미리 제공하는 역할·Schema·함수만 흉내낸다.
-- Migration 을 사용자 프로젝트에 붙여넣기 전에 순수 PostgreSQL 컨테이너
-- 에서 문법과 제약을 검증하기 위한 것이다.
--
-- 운영 프로젝트에는 절대 적용하지 않는다. Supabase 가 이미 같은 이름의
-- 역할과 Schema 를 관리하고 있고, 여기 정의는 그보다 훨씬 단순하다.
-- ============================================================

do $$
declare
  role_name text;
begin
  foreach role_name in array array[
    'anon', 'authenticated', 'service_role',
    'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin',
    'authenticator', 'dashboard_user'
  ] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin noinherit', role_name);
    end if;
  end loop;
end
$$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase Auth 가 관리하는 사용자 표. 컬럼은 실제 프로젝트에서 조회한
-- 구조를 따르되 Migration 이 참조하는 것만 남긴다. id 외에는 모두
-- nullable 이라 시험 사용자를 id 하나로 만들 수 있다.
create table if not exists auth.users (
  id                 uuid primary key,
  aud                varchar,
  role               varchar,
  email              varchar,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  created_at         timestamptz,
  updated_at         timestamptz,
  is_sso_user        boolean not null default false,
  is_anonymous       boolean not null default false,
  deleted_at         timestamptz
);

-- Supabase 의 auth.uid() 와 같은 계약이다. 요청 JWT claim 의 sub 를
-- uuid 로 돌려주고, claim 이 없으면 null 이다.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
