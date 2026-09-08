# 보호 배포 재검증 복구 개발 시험

대상: 새 코드 2b6ae8a, Manifest v20, 원격 Migration 0069, 본 작업에서 생성한 합성 계정의 첫 PNG Case만 사용한다.

1. Worker 함수로 Job을 접수하고 10초 Lease와 RUNNING Run을 생성한다. 모델 호출은 하지 않는다. Lease 만료 후 GET은 같은 Job의 recovery_required=true를 반환해야 한다.
2. 서로 독립 HTTP 요청 두 개로 같은 Job 재연결 POST를 동시에 보낸다. 실제 Vercel Workflow가 처리하며 모델 결과 불명확 경로는 자동 모델 재호출 없이 Job/Run을 FAILED로 함께 종결해야 한다.
3. 두 응답은 동일 Job, 실패 이벤트 1개, 이전 Passport 보존, 새 Passport/모델 비용 예약 0, Lease 해제여야 한다. 늦게 돌아온 기존 Lease의 진행 쓰기는 거절해야 한다.
4. 별도 로그인 세션과 새 GET에서 같은 terminal을 복원한다. 실패/응답 유실은 그대로 기록한다.

이 시험은 실제 배포의 복구 경계 표본이다. 장애 20종 전체·P95·정식 B-JOB/B-DEADLINE 채택을 대체하지 않는다.
