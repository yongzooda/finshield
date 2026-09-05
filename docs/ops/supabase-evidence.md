# B-SUPABASE-01 Migration·RLS 증거 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-SUPABASE-01`
- 현재 상태: `NOT-EVALUATED`
- 이 문서는 검토된 harness의 실행 계약이다. workflow 성공만으로 `PASS`가 되지 않는다.
- 운영 프로젝트에는 `finshield_worker`로만 접속한다. 이 역할은 회원 본문 표를 읽을 수 없으므로 운영 DB에서는 카탈로그·권한·Storage 설정만 관측한다.
- 불변식 시험과 교차 소유·Worker 거부 행렬은 같은 Migration으로 만든 격리 기준 Postgres(pgvector)에서 실행한다. 운영 DB의 표·제약·인덱스 digest가 기준 DB와 같다는 사실이 두 결과를 잇는다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 기준 DB | GitHub Actions service container `pgvector/pgvector:pg17`, `supabase/tests/00_supabase_stub.sql` 뒤 `supabase/migrations/*.sql` 전부를 순서대로 적용 |
| 시험 | `supabase/tests/[0-9][0-9]_*.sql` 전부. 각 파일이 `통과했습니다`로 끝나야 한다 |
| 산식 버전 | `supabase-migration-digest-rls-matrix-v1` |
| 표·제약·인덱스 digest | `public`·`private`·`kb`·`demo`의 모든 일반 표를 대상으로 `pg_get_constraintdef`·`pg_indexes.indexdef`·표 이름을 클라이언트에서 정렬해 SHA-256. 기준 DB와 운영 DB가 세 값 모두 같아야 한다 |
| 교차 소유 행렬 | 카탈로그에서 읽은 모든 표에 대해 회원 B가 회원 A의 행을 읽기·수정·삭제·명의 삽입, 익명이 모든 표 조회, Worker가 모든 표 조회. 허용되어서는 안 되는 접근 0건, 교차 소유 거부 ≥200, 익명 거부 ≥60, Worker는 회원 본문 표 13개를 모두 거부 |
| closed slot·token 재사용 | 닫힌 upload slot 경로 재업로드 20회와 접근 차단 객체의 Signed URL 허가 20회가 모두 거부 |
| 접근 차단 | 삭제 요청 함수 뒤 같은 소유자의 Case 조회가 즉시 0건. DB 안 지연을 기록하며 앱 P95 ≤2초는 `B-DELETE-01`·`B-STORAGE-01`이 따로 측정한다 |
| 운영 Preflight | pooler 6543, 접속 역할 `finshield_worker`(RLS 우회 없음·로그인), 모든 표 RLS enable+force, `anon` 권한 잔존 0, `private`·`kb`·`demo` 스키마 노출 0, Worker 회원 본문 표 거부 13/13, Private Bucket 2개(quarantine 10 MiB)·exports 없음, `storage.objects` 회원 정책은 본인 slot INSERT 하나, `postgres` bypassrls, `vector`·`pgcrypto`·`pg_trgm`이 `extensions` 스키마, PreCase 로그인 역할 없음 |
| 결과 파일 | `contract`·`local`·`remote`·`schema_match` 관측값만. DSN·비밀번호·서버 오류 원문·회원 데이터는 없다 |

ADR 15.1의 Storage·RLS 행은 cross-owner/worker 200과 closed slot/token reuse 20을 최소 표본으로 둔다. 이 harness는 그 표본을 카탈로그 기반 행렬로 만들어 손으로 적은 표 목록이 낡는 일을 막는다.

## 실행

1. GitHub `provider-spike` environment에 `FINSHIELD_DATABASE_URL`(운영 프로젝트 Supavisor pooler 6543, `finshield_worker`) secret을 둔다. 값은 비밀번호 관리자에만 보관한다.
2. `Supabase Evidence` workflow를 main에서 `B-SUPABASE-01`로 dispatch한다.
3. harness가 기준 DB를 만들고 시험·행렬을 실행한 뒤 운영 DB를 관측해 `result.json`을 만든다. 정책 미달이면 결과 파일을 만들지 않는다.
4. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다. 채택 전에는 `PASS`로 표시하지 않는다.

## 로컬 재현

- `supabase/tests/run-local.sh`가 같은 Stub·Migration·시험을 Docker `fs-pg`에서 실행한다.
- `node supabase/tests/verify-remote.mjs`가 `.env.local`의 DSN으로 운영 Preflight만 실행한다.
- `.github/scripts/test-supabase-evidence.mjs`가 결과 정책의 mutation test다.

## 하지 않는 것

- 운영 DB에서 불변식 시험을 실행하지 않는다. 시험 데이터를 운영 표에 넣지 않는다.
- `service_role`이나 Migration DSN을 harness에 주지 않는다.
- 운영 관측이 실패해도 기준 DB 결과만으로 `PASS`를 만들지 않는다.
