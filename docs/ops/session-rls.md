# 직접 DB·Storage 세션 폐기 경계

요구사항은 `AUTH-001`·`SEC-AUTH-002/003`이다. 전체 계정 탈퇴와 별개로 현재 세션의 로그아웃이 즉시 직접 접근에 반영돼야 한다.

2026-09-07 실제 합성 세션은 Auth 로그아웃 204 뒤에도 기존 JWT로 PostgREST `profiles` 한 행을 읽었다. 실패 원본은 `evidence/development/auth/2026-09-07-session-rls-before.json`에 보존한다. JWT 만료만 기다리는 정책으로는 이 경계를 충족하지 못했다.

Migration 0037은 `auth.sessions`의 현재 세션·Owner·만료와 JWT 만료를 검사한다. public 회원 표의 Restrictive 정책은 기존 Owner 정책과 AND로 결합한다. 회원 실행 권한이 있는 정의자 Helper 네 곳과 기반 RLS를 우회하는 `run_progress_v`도 검사한다. 관리형 Auth 표를 노출하거나 기존 Migration을 재실행하지 않았다. 별도의 서버 Worker 함수는 기존 API Owner 검증·내부 권한을 유지한다.

## 검증

- 격리 DB: Migration 37개·SQL 26파일·494개 허용/거부 검증 통과. 정상 세션 대조군과 무효 세션 7종의 조회·수정·RPC·진행 View·Storage 쓰기를 검사했다. Auth `not_after` 만료도 거부했다.
- 실제 DB: 0037 적용 후 표 81개·함수 107개·제약 741개·인덱스 255개·정책 188개·View 6개 digest가 빈 기준 DB와 일치했다. RLS/FORCE 81개, anon 누출 0건, Worker 회원 본문 거부 13표다.
- 실제 합성 세션: 로그아웃 후 직접 표·View 여섯 곳 조회 0행, 활성 세션 RPC false, 요약 RPC 세 곳 빈 결과, Storage 본문 및 기발급 TUS 쓰기 거부. 다른 정상 세션은 개인정보 한 행과 같은 경로 업로드를 허용했다. 실제 비어 있지 않은 세 RPC 결과에 대한 폐기 대조는 격리 SQL에서 확인했다.
- 시험 Case는 보호 Preview의 삭제 경로로 COMPLETED와 조회 부재를 확인했다. 이 경로는 Storage 물리 부재를 확인한 뒤 완료를 기록한다. 시험으로 만든 두 Auth 세션도 정리했다.
- 정책 하나를 실제 격리 DB Transaction에서 제거하면 digest가 달라지고 Rollback 뒤 복원됨을 확인했다. 정책·View 누락 결과를 거부하는 mutation test를 추가했다.

재현은 `supabase/tests/session-rls-live.mjs`의 명시적 합성 실행 설정을 사용한다. 자격·JWT·원본 경로는 결과에 쓰지 않는다. 실패한 새 테스트의 불완전 fixture와 로컬 node_modules 심볼릭 링크로 발생한 Turbopack 빌드 실패는 제품 또는 Gate 통과로 계산하지 않았다. 의존성을 해당 worktree에 설치한 뒤 Production build가 통과했다. 기본 테스트 420개 통과·83개 선택 skip, TypeScript·lint 오류 0건(기존 경고 2개)을 확인했다.

## Evidence 영향

기존 Supabase 증거는 정책과 View 본문을 직접 비교하지 않았다. `supabase-migration-policy-digest-rls-matrix-v2`를 사전등록하고 여섯 digest를 모두 비교한다. 변경 파일의 trusted SHA를 갱신하고, 기존 Supabase·Rate·Consent·Storage·Delete 결과는 원본을 보존한 채 STALE로 분리한다. 새 main 실행의 A=W·artifact·TTL·scope와 실제 merge candidate를 확인하는 별도 Adoption 전까지 PASS를 재사용하지 않는다.

기발급 Signed URL 자체의 수명과 취소는 별도 파일 삭제 계약이다. 이 검증을 전체 계정 탈퇴·Auth 수명 전체·Release 완료로 표현하지 않는다. 세션 저장 구조와 로그아웃 시 세션 부재 기준은 [Supabase 공식 세션 문서](https://supabase.com/docs/guides/auth/sessions)를 참조했다.
