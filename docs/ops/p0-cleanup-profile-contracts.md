# P0 삭제·합산 비용·알림·프로필 DB 계약

AUTH-005·AUTH-008·D-014·N-OPS-003·REV-005·RES-001에 해당하는 Migration 0038~0041과 SQL 회귀 시험을 기능 Draft #192에서 분리했다. 화면·Workflow·모델 실행 코드는 이 PR에 포함하지 않는다. 기존 Policy·Manifest·Passport는 수정하지 않는다.

- 0038: 계정 탈퇴 접수와 신규 작업 차단, 모든 Case·임시물 정리 후 Auth 마지막 삭제, 실패 rollback·반복 종결. 0036 Profile Guard를 유지한다.
- 0039: Provider별 예약과 전체 Provider 합산 상한을 같은 트랜잭션에서 반영한다. 새 한도·유료 Provider를 활성화하지 않는다.
- 0040: 알림 생성과 Outbox 종결을 원자화하고 과거 PROCESSING을 회수한다. 전역 Dispatcher를 활성화하는 변경은 아니다.
- 0041: 새 Profile Policy v2·Manifest v3, Run Snapshot 기반 결정적 주의사항/정보 부족, 불변 정책 Trace를 추가한다. 신용심사·가입 적격·안전을 확정하지 않는다.

격리 DB의 41 Migration·SQL 30파일 시험은 통과했다. Profile 변경 후 과거 Passport 해시 불변, 종료/다른 상품 제외, 타인 조회 거부, Auth 실패 rollback, 비용 예약 rollback, 알림 중간 SQL 실패/재시도를 포함한다. 합성 SQL Trace는 실제 모델 실행 증거가 아니다.

원격 DB는 0037 상태를 재확인했다. forward Migration만 적용하고 기존 Migration 재실행이나 소급 ledger 조작을 하지 않는다. 원격 적용·schema digest·제한된 실제 API 검증은 적용 이력에 추가한다.

DB scope 변경으로 Supabase·Rate·Consent·Storage·Delete의 다섯 과거 Evidence를 STALE로 전환하고 Gate entry를 분리 보존한다. main 부분 PASS는 8/20, Implementation NO-GO·Release NOT-EVALUATED를 유지한다. 새 main 원본 측정과 별도 Adoption PR 전에는 PASS를 복원하지 않는다. main Health의 빌드 범위는 바꾸지 않는다.
