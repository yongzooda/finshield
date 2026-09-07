# AUTH-005·D-014 계정 삭제 선행 정리 Guard

DB 명세 13.3은 Case·임시물·미완료 삭제 요청이 남아 있으면 Profile의 BEFORE DELETE Guard가 Auth/Admin Cascade도 거부하도록 정한다. Migration 0035 기준 로컬 실제 Trigger에는 UPDATE 시각 갱신만 있었고 삭제 Guard가 없었다. Case가 없는 합성 계정에 ACCOUNT/CLEANING 요청을 만든 뒤 `auth.users`를 지우면 삭제가 성공하는 것을 Transaction 안에서 재현했다. 시험 뒤 Rollback해 계정·요청을 남기지 않았다.

Migration 0036은 소유 Case, 삭제되지 않은 원본·OCR 임시물, Case Embedding, 미완료 Cleanup Job·삭제 요청을 확인한다. 하나라도 남으면 SQLSTATE 55000·고정 오류 `ACCOUNT_CLEANUP_REQUIRED`로 Profile 직접 삭제와 Auth Cascade를 거부한다. 원문·경로·사용자 식별자를 오류 메시지에 넣지 않는다. Guard 함수에는 클라이언트·Worker 직접 실행 권한을 주지 않는다.

시험은 미완료 4개 상태의 Profile/Auth 삭제 8경로, 미완료 Case 요청과 활성 Case 3경로를 정확한 SQLSTATE로 거부하는지 확인한다. 거부 뒤 Auth·Profile·요청이 보존돼야 한다. 모든 정리가 끝난 계정과 소유 자료가 없는 계정은 삭제되고, FK 예외인 완료 요청은 보존된다. 빈 로컬 기준 DB에 Migration 36개·SQL 시험 25개를 적용해 통과했다.

이는 탈퇴 API·최근 재인증·전체 계정 삭제 Worker의 완성이 아니다. 후속 계정 삭제는 Profile 잠금으로 새 자료 생성과 직렬화하고 모든 Case의 승인된 삭제·물리 부재 확인을 끝낸 뒤 Auth를 마지막에 지워야 한다. 진행 중인 ACCOUNT 요청의 완료 표시와 최종 Auth 삭제가 어긋나지 않도록 Transaction/복구 절차를 별도로 검증해야 한다. 이 Guard를 끄거나 완료 상태를 앞당겨 우회하지 않는다.

DB 실행 scope가 바뀌므로 Supabase·Rate·Consent·Storage·Delete의 이전 원본은 이력으로 보존하고 새 main에서 재측정·별도 Adoption한다. 후속 PR #220에서 원격 적용과 새 main의 5종 실제 측정 성공을 기록했다. Supabase 비교는 36개 Migration·25개 SQL 파일·484개 검증과 원격 Schema digest 4종 일치를 확인했다. Implementation과 Release 완료로 확대하지 않는다.
