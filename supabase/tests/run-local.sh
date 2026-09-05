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

# Migration 은 멱등하게 drop ... if exists 를 쓴다. 빈 DB 에서는 그때마다
# "does not exist, skipping" NOTICE 가 쏟아져 진짜 경고를 가린다. 적용
# 단계에서만 NOTICE 를 숨기고 시험 단계에서는 그대로 둔다. 시험은 NOTICE
# 로 통과 여부를 보고하기 때문이다.
psql_apply() {
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' \
    "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q
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
psql_apply < "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
echo "  ✓ 00_supabase_stub.sql"
# Migration 적용도 실패를 삼키지 않는다. 시험 단계와 같은 이유다.
for file in "$ROOT"/supabase/migrations/*.sql; do
  status=0
  output="$(psql_apply < "$file" 2>&1)" || status=$?
  if [ "$status" -ne 0 ]; then
    echo "  ✗ $(basename "$file") 적용 실패"
    printf '%s\n' "$output" | grep -vE "^ *$" | tail -8
    exit 1
  fi
  echo "  ✓ $(basename "$file")"
done

echo "== 불변식 시험 =="
# 시험 출력은 NOTICE 로 보고한다. ERROR 는 그대로 드러내고 실패 시 즉시 멈춘다.
# 파이프 뒤의 grep 이 psql 의 종료 코드를 가리지 않도록 상태를 따로 검사한다.
for file in "$ROOT"/supabase/tests/[0-9][1-9]_*.sql; do
  # set -e 아래에서 실패한 명령 치환은 스크립트를 조용히 끝낸다. || 로 상태를 잡는다.
  status=0
  output="$(psql_run < "$file" 2>&1)" || status=$?
  printf '%s\n' "$output" | grep -E "NOTICE:|ERROR:|^[0-9]+\. |통과했습니다" | sed 's/^NOTICE: //'
  if [ "$status" -ne 0 ]; then
    echo "✗ 시험 실패: $(basename "$file")"
    printf '%s\n' "$output" | grep -vE "NOTICE:|^ *$|^\(1 row\)|^-+$|expect_(ok|fail)" | tail -6
    exit 1
  fi
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
