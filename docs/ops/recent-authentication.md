# AUTH-011·Case 삭제 전 재인증

DB 명세 13.2의 삭제 선행 조건에 따라 Case 삭제 API는 같은 Origin과 최근 5분의 비밀번호 인증을 요구한다. 이 시간은 FinShield의 보수적 구현 정책이며 Supabase가 정한 보장 수치가 아니다. 서버 시계 오차로 미래 30초까지 허용하고 그보다 앞선 시각·문자형 시각·누락 기록은 거부한다.

서버는 먼저 기존 `resolveOwner`로 Supabase `/auth/v1/user`에 Token을 검증하고 확인된 소유자를 얻는다. 그 뒤 같은 Token의 `sub`와 익명 여부, `amr`의 `password` 인증 시각을 읽는다. Payload 디코딩만으로 신원을 인정하지 않는다. 최신 `iat`나 `token_refresh`는 비밀번호 재입력으로 계산하지 않는다. 이 구분은 [Supabase JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-fields)의 인증 방법·시각 필드를 따른다(2026-09-07 확인).

오래된 세션에는 `403 REAUTHENTICATION_REQUIRED`를 반환하고 DB 삭제·원본 정리를 호출하지 않는다. 화면은 다시 로그인한 뒤 선택한 기록의 삭제 확인으로 돌아간다. 재인증 자체가 삭제를 자동 실행하지 않는다. Origin 누락·다른 출처도 삭제 전에 거부한다. 비브라우저 API 검증은 요청 대상과 같은 Origin을 명시해야 한다.

삭제 API가 실제 `COMPLETED`를 반환하면 화면에서도 해당 기록을 제거하고 완료로 안내한다. `PENDING`은 기존 정리 중 안내를 유지한다. 계정 전체 탈퇴 API·재인증 후 계정 정리 Worker·Auth 최종 삭제는 여전히 별도 구현과 검증이 필요하다.
