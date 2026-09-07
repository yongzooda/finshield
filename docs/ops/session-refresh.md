# AUTH-002 세션 갱신과 만료 복귀

로그인이 Access Token만 반환해 기본 수명이 지나면 보호 요청이 실패했다. Refresh Token은 서버가 발급처에서 받아 세션별 HttpOnly Cookie로 전달한다. `PATCH /api/finshield/session`은 같은 Origin·세션별 Cookie를 확인하고 Supabase의 회전 계약을 사용한다. Access는 기존 탭 저장소에 두며 Refresh를 JSON·HTML·스크립트 저장소·URL·로그에 넣지 않는다.

HTTPS Cookie는 `__Host-` 이름·`Secure`·`HttpOnly`·`SameSite=Strict`·`Path=/`를 적용한다. Domain·영구 보존 기간을 추가하지 않는다. 개발 환경의 loopback HTTP만 일반 이름·Secure 제외를 허용한다. 세션마다 Cookie 이름을 분리해 다른 탭·다른 계정의 Refresh로 바뀌지 않게 하고, Cookie가 중복되거나 대응하지 않으면 발급처를 호출하지 않는다. JWT Payload는 갱신 범위와 일정의 힌트일 뿐 인증 근거가 아니다. 발급처가 반환한 새 세션·Owner도 이전 범위와 일치해야 한다.

보호 요청은 만료 여유가 240초 이하이면 갱신을 먼저 기다린다. 같은 탭의 동시 요청은 한 Promise, 지원 브라우저의 같은 세션은 Web Locks로 직렬화한다. 자동 갱신이 실패하면 주기적 재시도를 멈추고 다음 사용자 요청에서 다시 확인한다. 알 수 없는 응답·네트워크 오류에는 Cookie를 보존하고 503을 반환한다. 발급처가 만료·폐기를 확인한 경우만 Cookie와 탭 Token을 지운다. 보호 쓰기를 먼저 보냈다가 자동 재전송하지 않는다.

로그아웃은 갱신과 같은 잠금을 쓰고 확인된 현재 세션만 폐기한다. 같은 세션의 다른 탭에는 Token 본문 없는 로그아웃 신호를 보낸다. 로그아웃·다른 계정 로그인 뒤 도착한 갱신 결과는 저장하지 않는다. 이전 요청의 실패가 새 계정까지 로그아웃시키지 않도록 상태 변경은 409로 구분한다. 만료된 보호 화면에는 원래 위치의 로그인 폼을 표시하므로 외부 복귀 URL을 받지 않는다.

React 조회 Effect는 JWT 문자열 대신 세션 식별자를 기준으로 실행한다. 갱신 때 프로필을 다시 읽어 저장하지 않은 선택을 초기화하던 경로를 막았다. 새로운 로그인 세션에서는 다시 조회하고 실제 요청에는 최신 Access를 넣는다. 기존 로그인 중 Refresh Cookie가 없는 세션은 수명 만료 후 한 번 다시 로그인해야 한다.

## 검증과 남은 경계

- 단위 시험: 동시 보호 요청 20개의 단일 갱신, 늦은 응답, 로그인 교체, 쓰기 미전송·자동 재시도 금지, Origin·Cookie 범위·발급처 장애·민감 Cookie 계약을 검증했다.
- 실제 Supabase: 합성 새 세션 두 개에서 Cookie 회전, 동시 갱신 2건, 11초 뒤 부모 Token을 통한 응답 유실 복구, 비밀번호 재인증 시각 불변, 로그아웃 뒤 갱신 거부·다른 세션 보존과 시험 세션 정리가 통과했다.
- 실제 Chrome: 로그인, 스크립트의 Refresh 접근 불가, PATCH 200·Access 교체, 저장하지 않은 프로필 선택 보존, 로그아웃을 확인했다. 이 시험은 갱신 일정만 앞당겼으며 실제 JWT 만료로 표시하지 않는다. 최초 fetch 계측의 this 바인딩 오류는 제품 오류와 구분한다.
- 실제 기본 1시간 만료 표본은 별도 준비했다. `FINSHIELD_AUTH_NATURAL_EXPIRY=1` 시험은 발급된 만료 시각을 실제로 지난 뒤에만 실행한다. 이 문서 작성 시에는 대기 중이다.

원본은 `evidence/development/auth/2026-09-07-session-refresh*.json`이다. DB·Migration·package·Provider 설정·Gate를 바꾸지 않는다. 직접 PostgREST/Storage의 폐기 세션 차단과 전체 계정 탈퇴는 후속 보안 작업이다. 전체 AUTH·P0·Release 완료로 표시하지 않는다.

근거: [Supabase 세션과 Refresh 재사용 예외](https://supabase.com/docs/guides/auth/sessions), [서버 세션·Cookie·Cache 경계](https://supabase.com/docs/guides/auth/server-side/advanced-guide). 공식 SDK의 클라이언트 Refresh 저장 방식 대신 현재 서버 Auth 중계에 Cookie 교환을 추가했으며 SDK 설치·Provider 정책 변경은 하지 않았다.
