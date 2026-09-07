# Migration 0037 뒤 증거 재채택

보안 PR #226의 세션 RLS와 PR #224의 갱신을 병합한 최종 main `72e54054ee358407c5d23afa227e824ce13bf484`에서 다시 측정했다. 실제 시험 대상과 Workflow SHA는 모두 이 main으로 일치한다. 측정 이후 main을 고정하고 별도 Adoption PR #230의 실제 merge candidate를 strict 검사한다.

| 항목 | main 실행 | 관측 |
|---|---|---|
| Supabase | 34119203303 | Migration 37개·SQL 26파일·494개 검증, 여섯 digest 일치, 교차 Owner 237건·anon 81건·Worker 13표 거부 |
| Rate | 34119206073 | 동시 예약 60회 상한 초과 0건·원장 불일치 0건, Rate 40회 중 10회 허용·30회 거부 |
| Consent | 34119208728 | 거부 7경로 전송 0건, 허용 1경로 전송 1건, PII 잔존 전송 0건 |
| Storage | 34119211665 | 실제 회원 업로드 1건 허용, 부당 접근·닫힌 TUS 재사용 8경로 거부 |
| Delete | 34119341918 | 합성 40 Case 중 대상 35건 삭제, 경계 이전 5건 보존, 최대 214초, teardown 객체 잔존 0건 |

artifact 존재·TTL·trusted SHA·scope·원본 hash를 index에 등록한다. 최종 채택은 실제 merge candidate의 strict 검사와 원격 CI를 통과해야 한다. 과거 실패와 0036의 측정 원본은 삭제하지 않는다.

Rate·Consent는 외부 Provider를 호출하지 않는 격리 DB 계약이다. Delete의 실제 60초 경계와 API Worker 검증은 24시간 전체 대기나 Vercel Workflow 장애 20종을 대신하지 않는다. 기능 Draft #192의 Health 범위는 여전히 별도다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다.

## 이전 측정과 채택 거부 이력

앞선 main `f0026375d74ff9af09d6c64c73ac1186df59ad93` 실행은 아래처럼 성공했지만, 측정 뒤 PR #228이 main에 들어갔다. 채택 PR의 실제 merge candidate 검사 run `34118664928`은 시험한 main 바로 위의 후보가 아니며 이후 변경에 adoption allowlist 밖의 파일이 있음을 검출해 거부했다. 실패를 무시하거나 규칙을 완화하지 않고 PR #224까지 병합한 최종 main에서 위 다섯 항목을 전부 다시 실행했다. 아래 원본은 이력이며 현재 index가 채택하지 않는다.

| 항목 | main 실행 | 관측 |
|---|---|---|
| Supabase | 34117043317 | Migration 37개·SQL 26파일·494개 검증, 여섯 digest 일치, 교차 Owner 237건·anon 81건·Worker 13표 거부 |
| Rate | 34117045905 | 동시 예약 60회 상한 초과 0건·원장 불일치 0건, Rate 40회 중 10회 허용·30회 거부 |
| Consent | 34117048344 | 거부 7경로 전송 0건, 허용 1경로 전송 1건, PII 잔존 전송 0건 |
| Storage | 34117050514 | 실제 회원 업로드 1건 허용, 부당 접근·닫힌 TUS 재사용 8경로 거부 |
| Delete | 34117232679 | 합성 40 Case 중 대상 35건 삭제, 경계 이전 5건 보존, 최대 205초, teardown 객체 잔존 0건 |

## 측정 후 합성 자산 정리

첫 Storage 실행의 합성 Case 한 개는 Dashboard 파일 삭제가 남긴 `.emptyFolderPlaceholder` 때문에 최초 Purge가 false였고 CLEANING을 유지했다. 해당 Case 폴더 표식까지 제거한 뒤 Cleanup 5개와 물리 부재 Guard·Case Purge가 통과했다.

최종 Storage 실행 `34119211665`의 Case도 생성 시각·소유자·시험 제목을 대조한 뒤 삭제 요청을 접수했다. 해당 Case 폴더를 Storage UI로 삭제하고 Cleanup 5개의 SUCCEEDED, 물리 부재 Guard와 Purge true를 확인했다. 다른 시험 Case를 정리 대상으로 추정하지 않았다. 이 운영 정리를 정식 Gate 관측값으로 덮어쓰지 않는다.

두 번째 채택 CI `34120289550`은 최종 main과 일치했으나 채택 PR에 포함한 `docs/ops` 문서 두 개가 기존 allowlist 밖이라 거부했다. 운영 확인표 변경을 이 PR에서 제외하고 이 설명을 허용된 evidence 경로로 옮겼다. 원본 artifact·합격식·validator는 변경하지 않았다.
