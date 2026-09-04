-- ============================================================
-- FinShield 0002 — public 스키마 함수 기본 권한 회수
--
-- 정본: docs/03-database-spec.md 9.1 기본 정책 2번
--       "anon, authenticated, PUBLIC 의 기본 Table·Sequence·Function 권한을
--        먼저 회수한다"
--
-- 0001 은 함수 기본 권한을 PUBLIC 의사 역할에서만 회수했다. anon 과
-- authenticated 가 빠져 있어 적용 후 조회하면 다음이 남는다.
--
--   public [f] {postgres=X/postgres, anon=X/postgres,
--               authenticated=X/postgres, service_role=X/postgres}
--
-- 이 상태에서 public 스키마에 함수를 만들면 비로그인 anon 과 로그인
-- authenticated 에게 EXECUTE 가 자동으로 붙는다. 아직 함수가 없어 실제
-- 노출은 없지만, 제한 RPC 를 추가하기 전에 닫아야 한다.
--
-- 0001 은 이미 적용됐으므로 편집하지 않고 새 Migration 으로 고친다.
--
-- service_role 은 회수 대상이 아니다. 명세 9.1 2번이 지정한 대상은 anon,
-- authenticated, PUBLIC 이고 service_role 은 통제된 관리 경로로 남는다.
--
-- 이 선언은 postgres 가 만드는 객체에만 적용된다. Migration 을 다른 역할로
-- 실행하면 그 역할에 대해 같은 회수를 다시 해야 한다.
--
-- 멱등하다. 이미 회수된 상태에서 다시 실행해도 안전하다.
-- ============================================================

alter default privileges in schema public  revoke all on functions from anon, authenticated;
alter default privileges in schema private revoke all on functions from anon, authenticated;
alter default privileges in schema kb      revoke all on functions from anon, authenticated;
alter default privileges in schema demo    revoke all on functions from anon, authenticated;
