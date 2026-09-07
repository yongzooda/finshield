# 가입 후 점검 실행 DB 계약

PC-005·PC-007·N-OPS-003의 Migration 0042를 기능 Draft에서 분리했다. 같은 Case·기준 Passport·Manifest를 가진 점검 Job에 마스킹 답변과 계약 비교, 두 Agent의 Tool/Snapshot 실행 Trace를 고정한다. 과거 거래 전 Run·Passport에 가입 후 실행을 추가하지 않는다.

요청 key·본문 Hash, 단일 Lease, 갱신·취소·기한 회수, Provider 결과 미확정 시 재호출 거부, 결과 저장의 원자성, 정상/부분 종결과 별도 비용 문맥을 추가한다. 회원 RLS·FORCE RLS·활성 세션·계정 삭제 Guard·Case Cascade를 적용하며 Worker는 표를 직접 읽거나 쓰지 못한다. Provider 한도와 전체 합산 한도·미확정 예약은 기존 원장에서 강제하고 상한을 올리지 않는다.

42 Migration·SQL 31파일을 격리 DB에서 통과했다. 실제로 요청 중복·다른 회원 거부·잘못된 Lease·Allowlist 밖 Agent/Tool 거부·점검 결과 SQL 실패 rollback·재시도·부분 결과·정상 종결·취소·기한·미확정 실행 종결·과거 Passport 불변과 Provider 합산 상한을 검사했다. 합성 SQL Trace이며 실제 모델 실행 증거가 아니다.

원격 DB는 0041까지 적용됐다. 이 PR에는 API·UI·Workflow·모델 실행 코드가 없다. 원격 0042 적용과 합성 Preview 검증은 후속 이력에 남긴다. DB 증거 다섯 항목은 이미 STALE이며 main 부분 PASS 8/20·Implementation NO-GO·Release NOT-EVALUATED를 유지한다.
