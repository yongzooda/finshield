#!/usr/bin/env bash
# ============================================================
# Migration·불변식 로컬 검증
#
# 격리된 PostgreSQL 컨테이너에 Supabase Stub 과 모든 Migration 을
# 순서대로 적용하고 제약·RLS 시험을 실행한다. 운영 프로젝트에는
# 접속하지 않는다.
#
# 사용: supabase/tests/run-local.sh
# ============================================================
set -euo pipefail

CONTAINER="${FINSHIELD_TEST_CONTAINER:-fs-pg}"
IMAGE="${FINSHIELD_TEST_IMAGE:-pgvector/pgvector:pg17}"
DB="${FINSHIELD_TEST_DB:-finshield_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

psql_run() {
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q
}

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "컨테이너 $CONTAINER 를 새로 만든다 ($IMAGE)"
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=local "$IMAGE" >/dev/null
fi
docker start "$CONTAINER" >/dev/null 2>&1 || true

for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done

docker exec "$CONTAINER" psql -U postgres -c "drop database if exists $DB" >/dev/null
docker exec "$CONTAINER" psql -U postgres -c "create database $DB" >/dev/null

echo "== Migration 적용 =="
psql_run < "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
echo "  ✓ 00_supabase_stub.sql"
for file in "$ROOT"/supabase/migrations/*.sql; do
  psql_run < "$file" >/dev/null
  echo "  ✓ $(basename "$file")"
done

echo "== 불변식 시험 =="
for file in "$ROOT"/supabase/tests/[0-9][1-9]_*.sql; do
  psql_run < "$file" 2>&1 | grep -E "NOTICE:|^[0-9]+\. |통과했습니다" | sed 's/^NOTICE: //'
done

echo "== 통계 =="
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc "
select 'RLS 미적용 public 테이블: ' || coalesce(string_agg(relname, ', '), '없음')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
select 'FORCE RLS 미적용 public 테이블: ' || coalesce(string_agg(relname, ', '), '없음')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity;
select 'anon 권한이 남은 public 테이블: ' || coalesce(string_agg(relname, ', '), '없음')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and array_to_string(c.relacl, ',') like '%anon=%';
"
