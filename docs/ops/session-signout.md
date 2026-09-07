# AUTH-001 서버 세션 로그아웃

개인정보 설정의 로그아웃이 `sessionStorage`만 지워 발급처의 세션을 남겼다. `DELETE /api/finshield/session`은 같은 Origin과 세션 식별자를 확인한 뒤 Supabase `/auth/v1/logout?scope=local`로 현재 세션을 폐기한다. 다른 로그인 세션은 유지한다. DB Migration·Provider·빌드 설정·Gate metadata는 바꾸지 않는다.

서명 검증은 Supabase가 수행한다. 앱이 JWT Payload를 읽는 목적은 비어 있거나 nil인 `session_id`를 미리 거부하는 것이다. Supabase 구현은 이 식별자가 없으면 `scope=local`도 전체 로그아웃으로 내려갈 수 있다. 임의 Token 디코딩을 인증으로 사용하지 않는다. 응답은 캐시하지 않고 외부 요청은 10초 상한·요청 취소 신호·리다이렉트 거부를 적용한다.

204 또는 403의 `error_code=session_not_found|user_not_found`만 완료로 처리한다. 첫 폐기 응답이 유실된 뒤 같은 Token으로 재시도해도 종결을 복원한다. 전송 오류·429·5xx·알 수 없는 응답은 고정 오류로 반환하고 UI는 Token과 재시도 동작을 유지한다. 만료·변조 Token의 401은 탭의 로그인 정보만 지우며 서버 종료를 확인하지 못했다고 표시한다.

## 실제 확인과 제한

로컬 Chrome에서 합성 비밀번호 로그인→실제 기록 조회 200→로그아웃 확인→로그인 화면 복귀를 확인했다. 이전 Token으로 기록 목록·상세·프로필·알림 HTTP 요청은 모두 401이었다. 합성 네트워크 실패에서는 Token·재시도 버튼이 유지됐다. 브라우저 예외와 오류 오버레이는 없었다. 기본 시험 420건 통과·선택적 83건 건너뜀, 타입·린트 통과(기존 경고 2개)다. 실제 Auth 시험 1건은 기본 시험의 건너뜀과 별도로 실행했다.

- 첫 합성 시험은 세션 폐기 자체는 성공했지만 반복 요청이 503이었다. 실제 오류 응답의 `code`는 HTTP 숫자이고 문자열은 `error_code`였다. 실패 원본을 보존하고 해당 계약을 수정했다.
- 수정 후 실제 FinShield Auth에 새 세션 두 개를 만들었다. 첫 세션의 `/user`는 200→403, refresh는 400, 앱 `resolveOwner`는 인증 거부, 반복 로그아웃은 200이었다. 다른 세션은 `/user` 200과 같은 Owner를 유지했다. 시험에서 만든 두 세션의 정리도 확인했다.
- 단위 시험 23건, 실제 Auth 통합 시험 1건을 분리했다. 통합 시험은 `FINSHIELD_AUTH_LIVE=1`로 명시적으로 켠 경우만 실행하고 FinShield project URL·기존 합성 fixture Owner를 확인한다. 자격증명 파일 경로는 `FINSHIELD_AUTH_FIXTURE_PATH`, 비밀 없는 결과 경로는 `FINSHIELD_AUTH_REPORT_PATH`다.
- 원본은 `evidence/development/auth/`에 보존한다. 오류 필드 실패, 조회 API 실패, 조회 보완 전 Auth 시험, 최종 통합 시험을 각각 분리했다. 제품 품질 Gate artifact·외부 독립 평가로 채택하지 않는다.

브라우저 HTTP 검증에서 추가로 로그아웃 후 기록 목록이 200인 실패를 재현했다. 기록 목록·상세·프로필·알림 GET 네 곳이 세션 확인 없이 RLS로 직접 읽고 있었다. 네 경로의 조회 전에 `resolveOwner`를 적용하고, 실제 폐기 Token으로 네 경로가 모두 401을 반환함을 통합 시험했다. 이전 Token의 서명이 유효해도 앱의 민감 조회를 허용하지 않는다.

Supabase의 발급 JWT는 만료 전까지 암호학적으로 유효할 수 있다. 이번 시험은 앱의 `/auth/v1/user` 기반 인증 거부를 확인했으며 직접 PostgREST·Storage RLS 접근의 즉시 폐기 보증은 아니다. 직접 접근의 세션 유효성, refresh token 보관·갱신·회전 경합, 전체 탈퇴·다른 기기 인증 수명은 남아 있다. `AUTH-001~002` 전체나 Release 완료로 표시하지 않는다.

## 새 브랜치 Preview 확인 실패

PR #222의 첫 SHA `2d91ec05d5ec221421da8842fe39bcb56352191c`에서 CI와 Preview 빌드는 통과했다. 보호 Preview의 Runtime manifest로 같은 SHA·Preview 환경·배포 ID를 확인했지만 로그인 단계에서 시험이 중단됐다. 별도 잘못된 합성 자격증명 요청도 HTTP 500이었다. 생성된 시험 세션은 없고 원본은 `2026-09-07-session-preview.json`에 보존한다. Preview 로그아웃의 배포 검증은 통과하지 않았다.

기존 격리 설정 절차는 `codex/p0-audit-contract-spike`에만 환경변수를 등록한다. 새 브랜치의 누락 설정이 의심되지만 Vercel CLI와 연결 API가 팀 접근 403을 반환해 원격 설정·로그로 원인을 확정하지 못했다. 로그인은 현재 DB 환경변수도 요구한다. Production의 같은 잘못된 합성 로그인은 정상 인증 거부 401이었으며, 이 관측만으로 로그아웃의 Production 성공을 뜻하지 않는다. 설정 범위·배포 보호·유료 계약은 변경하지 않았다.

참고: [Supabase 세션](https://supabase.com/docs/guides/auth/sessions), [로그아웃 계약](https://supabase.com/docs/reference/javascript/auth-signout), [발급처 세션 검증 구현](https://github.com/supabase/auth/blob/master/internal/api/auth.go), [현재 세션 폐기 구현](https://github.com/supabase/auth/blob/master/internal/api/logout.go). 2026-09-07 문서·소스 확인과 실제 계정 관측을 구분한다.

## 병합 후 Production 확인

PR #222는 최종 CI 통과 후 `4ca57bbeef88ca67e1eafdad4838c2cc0a63c381`로 squash 병합했다. Runtime manifest에서 같은 Production SHA를 확인한 뒤 합성 새 세션 두 개로 로그인 200·초기 기록 조회 200·타 Origin 거부 403·로그아웃 200·폐기 Token의 조회 네 곳 401·반복 로그아웃 200·다른 세션 조회 200을 확인했다. 시험에서 만든 두 세션은 모두 정리했고 원본은 `2026-09-07-session-production.json`이다. 모델·OCR 호출이나 회원 자료 쓰기는 없었다.

최종 PR CI의 첫 실행은 ADR 변조 시험의 임시 폴더 삭제에서 `ENOTEMPTY`로 중단됐다. 검사 코드·기준 변경 없이 같은 SHA의 재실행 `34110723447`이 통과했다. 첫 실패 로그와 별도 Preview 로그인 실패는 현재 성공으로 덮지 않는다.

기능 Draft #192에 main을 통합하면서 상세 Passport 조회 계약과 삭제 재인증을 보존했다. 재인증 중 로그아웃, 로그아웃 중 삭제 실행을 함께 막는다. 통합 뒤 기본 시험은 517건 통과·선택적 91건 건너뜀이다. 기능 브랜치의 Health는 여전히 미평가이며 전체 P0·Release 완료가 아니다.
