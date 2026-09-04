-- ============================================================
-- FinShield 0001 — Migration 기준선
--
-- 정본: docs/03-database-spec.md (2.1 Schema, 2.2 Extension, 9.1 기본 정책,
--       14.1 PreCase 자산 전환, 14.2 현재 Migration 위험)
--       docs/adr/001-p0-provider-stack.md 7절 Supabase 경계
--
-- 이 파일은 전용 FinShield Supabase 프로젝트에만 적용한다. PreCase 기준선
-- Migration은 supabase/precase-baseline/ 으로 옮겼고 적용하지 않는다.
--
-- 업무 테이블은 여기 없다. 대시보드에서 손으로 만든 확장·Schema를 코드로
-- 고정하고, 노출 경계와 기본 권한 회수, 서버 Worker 역할만 선언한다.
-- 테이블·RLS·Storage 정책은 이후 Migration이 D-ID 단위로 추가한다.
--
-- 비밀번호를 이 파일에 넣지 않는다 (명세 14.1). 로그인 권한 부여는
-- docs/ops/supabase-project.md 의 운영 절차로 분리한다.
--
-- 멱등하게 작성했다. 이미 적용한 프로젝트에 다시 실행해도 안전하다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extension (명세 2.2)
--    Supabase 관례에 따라 extensions schema에 둔다. 이미 있으면 무시한다.
-- ------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists vector   with schema extensions;

-- ------------------------------------------------------------
-- 2. Schema (명세 2.1)
--    public 은 회원 Case 표면, private 은 서버 전용, kb 는 공용 지식,
--    demo 는 비식별 Seed 다.
-- ------------------------------------------------------------
create schema if not exists private;
create schema if not exists kb;
create schema if not exists demo;

comment on schema private is 'FinShield 서버 전용. Data API 노출 금지 (명세 2.1)';
comment on schema kb      is 'FinShield 공용 Knowledge Base. 직접 노출 금지, 조회는 제한 RPC (명세 2.1)';
comment on schema demo    is 'FinShield 비식별 Demo Seed. 직접 노출 금지 (명세 2.1)';

-- ------------------------------------------------------------
-- 3. 노출 경계 (명세 2.1)
--    private·kb·demo 는 Supabase Exposed Schema 목록에 넣지 않고
--    anon·authenticated 에 USAGE 를 주지 않는다.
-- ------------------------------------------------------------
revoke all on schema private from public, anon, authenticated;
revoke all on schema kb      from public, anon, authenticated;
revoke all on schema demo    from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. 기본 권한 회수 (명세 9.1 2번)
--    앞으로 만들 객체가 조용히 anon·authenticated·PUBLIC 에 열리지 않게 한다.
--    테이블별 최소 Grant 는 각 테이블 Migration 에서 명시적으로 부여한다.
-- ------------------------------------------------------------
alter default privileges in schema public  revoke all on tables    from anon, authenticated;
alter default privileges in schema public  revoke all on sequences from anon, authenticated;
alter default privileges in schema public  revoke all on functions from public;

alter default privileges in schema private revoke all on tables    from anon, authenticated;
alter default privileges in schema private revoke all on sequences from anon, authenticated;
alter default privileges in schema private revoke all on functions from public;

alter default privileges in schema kb      revoke all on tables    from anon, authenticated;
alter default privileges in schema kb      revoke all on sequences from anon, authenticated;
alter default privileges in schema kb      revoke all on functions from public;

alter default privileges in schema demo    revoke all on tables    from anon, authenticated;
alter default privileges in schema demo    revoke all on sequences from anon, authenticated;
alter default privileges in schema demo    revoke all on functions from public;

-- ------------------------------------------------------------
-- 5. 서버 Worker 역할 (ADR 7절)
--    NOBYPASSRLS 최소 권한. Background 작업과 서버 경로가 사용한다.
--    사용자 CRUD 는 이 역할이 아니라 사용자 JWT 와 authenticated·RLS 로 처리한다.
--    LOGIN 과 비밀번호는 이 파일에서 부여하지 않는다 (명세 14.1).
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'finshield_worker') then
    create role finshield_worker nologin nobypassrls;
  end if;
end
$$;

comment on role finshield_worker is 'FinShield 서버·Background 최소 권한 역할. RLS 우회 금지 (ADR 7절)';

grant usage on schema public, private, kb, demo to finshield_worker;

-- ------------------------------------------------------------
-- 6. PreCase 로그인 역할 폐기 (명세 14.1, 14.2)
--    app_runtime·batch_loader 는 FinShield 목표 모델에서 폐기 대상이다.
--    drop owned by 가 남은 Grant 를 함께 회수한다. 두 역할은 객체를 소유하지 않는다.
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_runtime') then
    execute 'drop owned by app_runtime';
    execute 'drop role app_runtime';
  end if;
  if exists (select 1 from pg_roles where rolname = 'batch_loader') then
    execute 'drop owned by batch_loader';
    execute 'drop role batch_loader';
  end if;
end
$$;
