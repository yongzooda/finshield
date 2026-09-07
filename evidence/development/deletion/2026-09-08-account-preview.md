# AUTH-005 실제 계정 탈퇴 개발 검증

보호된 기능 Preview `d89d8ef`의 Vercel 배포 `A2a9uKiuavVWJdvpt9K5QSbpruuF`에서 별도로 만든 합성 계정 하나를 삭제했다. 기존 시험 계정과 실제 사용자 자료는 이 시험에 사용하지 않았다. DB는 main `2ae0230`의 Migration 0041까지 적용했다.

- 독립 비밀번호 로그인 두 세션을 만들고 빈 Case와 파일 Case를 생성했다. 실제 TUS로 합성 PNG를 올리고, 삭제 전 Storage GET 200과 원본 바이트 일치를 확인했다.
- 다른 Origin의 탈퇴 POST는 403이었다. 최초 접수는 ACCESS_BLOCKED와 영수증을 반환하고 아직 Workflow를 예약하지 않았다. 첫 응답의 영수증을 버린 뒤 두 번째 세션의 GET으로 같은 요청을 복원했다.
- 접수 후 새 Case의 DB 생성은 ACCOUNT_DELETING으로 거부됐다. 새 파일 Slot도 차단됐으나 HTTP 500이었다. 원본 결과를 보존하며 후속 수정에서는 동일한 Guard 거부를 HTTP 409와 삭제 진행 안내로 변환한다. 수정된 응답은 단위 시험 범위다.
- 영수증 수신 후 실제 Vercel Workflow를 예약했다. 중복 POST는 같은 요청 ID였으며, 상태는 ACCESS_BLOCKED에서 COMPLETED로 바뀌었다.
- Auth admin 조회 404, Storage GET 부재, 기존 토큰의 Profile API 401, 영수증만 사용하는 GET·POST의 COMPLETED 복원과 기존 시험 계정의 Auth 보존을 확인했다.
- 별도 관리자 읽기 전용 SQL에서 Auth·Profile·Case·활성 원본/OCR·Embedding·Storage·미완료 요청은 모두 0건, 계정 완료 원장 이벤트는 1건이었다.

원본은 [API 검사](2026-09-08-account-preview.json), [부재 조회 SQL](2026-09-08-account-absence.sql), [실제 조회 결과](2026-09-08-account-absence.txt)다. OCR·Embedding은 이 표본에서 생성하지 않았으므로 해당 파생물의 Live 삭제 시험으로 세지 않는다. 이 시험에는 모델·OCR 유료 호출이 없다.

Preview의 합성 계정 허용 값은 시험 전에 지정 계정으로 잠시 변경하고, 시험 후 원래 값으로 복원·재배포했다. 키·세션·영수증·비밀번호는 원본 증거에 포함하지 않는다.

Auth 실패 rollback과 신규 작업 동시 경합은 앞선 격리 SQL 시험이며, 이번 실제 배포 표본과 구분한다. 전체 장애 20종·계정 삭제 화면 브라우저 조작·Release Gate 통과를 뜻하지 않는다. DB 증거 다섯 항목은 STALE이며 새 main 측정과 별도 Adoption이 필요하다.
