# 앱 알림 복구 구현과 격리 검증

REV-005·REV-006·N-AVL-005·EC-020. Migration 0040은 알림 INSERT와 Outbox DELIVERED를 같은 트랜잭션으로 종결한다. 이벤트별 실패는 해당 INSERT를 rollback하고 원문 없는 NOTIFY_FAILED·backoff를 남긴다. 기존 PROCESSING에서 5분 이상 멈춘 이벤트는 마지막 시도에서도 복구할 수 있다. 완료 이벤트 재요청과 과거 INSERT만 성공한 이벤트는 같은 deduplication key의 알림 한 건으로 끝난다.

최초 검증·중대 변화·변화 없음 문구를 구분하고 삭제/탈퇴 Case에는 새 알림을 만들지 않는다. 파일 삭제 Outbox는 다루지 않는다. 최종화 뒤 기존 호출과 알림센터 GET의 소유자 제한 배치가 복구를 실행한다. 모든 사용자가 이탈한 뒤 주기적으로 깨우는 전역 Dispatcher는 아직 연결하지 않았으며, 최대 실패 횟수의 FAILED는 운영 복구 대상이다.

알림은 저장된 Job·Passport ID를 주소에 넣어 해당 판으로 이동한다. 요청한 Passport가 없으면 최신 판으로 바꿔 보여 주지 않는다. 알림·Passport·재검증 화면은 계정 전환 때 이전 세션의 자료를 숨기며 늦은 읽기 응답도 버린다.

실제 격리 SQL 29는 알림 INSERT 후 Outbox 업데이트 실패를 주입해 부분 알림 부재, FAILED 원장, 오류 제거 후 재시도를 확인했다. 마지막 시도의 PROCESSING Orphan, 반복 전달, 별도 소유자, 초기/변화 없음 문구와 다른 이벤트 보존도 확인했다. 전체 Migration 40개·SQL 29파일이 통과했으며 RLS/FORCE RLS 누락과 anon 권한 누출은 없었다. 기본 테스트는 572건 통과·96건 선택적 skip이며 TypeScript·lint·build를 통과했다. 이 시험은 원격 Migration 적용·Live 알림·브라우저 비교 이동의 성공 증거가 아니다.
