# Migration 0037 뒤 증거 재채택

별도 보안 PR #226의 세션 RLS·Helper·진행 View와 여섯 digest 비교 계약을 main에 병합한 뒤 측정했다. 실제 시험 대상과 Workflow는 모두 main `f0026375d74ff9af09d6c64c73ac1186df59ad93`이다.

| 항목 | main 실행 | 관측 |
|---|---|---|
| Supabase | 34117043317 | Migration 37개·SQL 26파일·494개 검증, 여섯 digest 일치, 교차 Owner 237건·anon 81건·Worker 13표 거부 |
| Rate | 34117045905 | 동시 예약 60회 상한 초과 0건·원장 불일치 0건, Rate 40회 중 10회 허용·30회 거부 |
| Consent | 34117048344 | 거부 7경로 전송 0건, 허용 1경로 전송 1건, PII 잔존 전송 0건 |
| Storage | 34117050514 | 실제 회원 업로드 1건 허용, 부당 접근·닫힌 TUS 재사용 8경로 거부 |
| Delete | 34117232679 | 합성 40 Case 중 대상 35건 삭제, 경계 이전 5건 보존, 최대 205초, teardown 객체 잔존 0건 |

별도 Adoption PR #230에 원본 artifact·index·TTL·trusted SHA·scope를 등록한다. 최종 채택은 실제 merge candidate의 strict 검사와 원격 CI를 통과해야 한다. 과거 실패와 0036의 측정 원본은 삭제하지 않는다.

Rate·Consent는 외부 Provider를 호출하지 않는 격리 DB 계약이다. Delete의 실제 60초 경계와 API Worker 검증은 24시간 전체 대기나 Vercel Workflow 장애 20종을 대신하지 않는다. 기능 Draft #192의 Health 범위는 여전히 별도다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다.

Storage 시험의 합성 Case 한 개는 측정 종료 뒤 별도로 정리했다. Dashboard의 파일 삭제가 남긴 `.emptyFolderPlaceholder` 때문에 최초 Purge가 false였고 CLEANING을 유지했다. 해당 시험 Case 폴더의 표식까지 제거한 뒤 Cleanup 5개와 물리 부재 Guard·Case Purge가 통과했다. 이 운영 정리를 원래 Gate 관측값으로 덮어쓰지 않는다.
