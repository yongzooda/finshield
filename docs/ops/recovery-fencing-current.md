# 재검증 만료 Lease와 소진 작업 종결 통합

REV-001·N-AVL-005·N-OPS-004, 이슈 #282. PR #285의 0053을 운영 0065 뒤의 `0067_revalidation_fencing_and_orphan.sql`로 이식한다. 과거 Migration 번호를 소급 적용하거나 ledger를 조작하지 않는다. 기존 0053 원문 구현과 37번 SQL 시험을 그대로 보존해 현재 53번 시험으로 대조한다.

만료 Lease는 새 Worker 선점 전에도 실패·최종화 쓰기를 하지 못한다. 재선점은 token을 회전하고 최대 시도를 소진한 만료 Job을 활성 Run과 함께 종결한다. 불명확한 기존 Provider 응답은 재호출하지 않는다. 기존 `failRevalidation`의 트랜잭션 및 완료 응답 복원 경로를 유지한다.

격리 PostgreSQL 17에 Migration 64개와 SQL 시험 51파일이 통과했다. 현재 Lease 만료·회전·stale heartbeat·소진 Orphan·이전 Passport 보존·취소 멱등성을 확인했다. 별도의 실제 Worker DB 통합 시험 1개에서 Run 쓰기 SQL 오류 주입 전체 rollback, 잘못된 Lease 무변경, 재시도와 반복 호출 동일 종결, 과거 Job만 실패한 상태 복원이 통과했다. 이 시험은 실제 Vercel 배포 장애 20종 전체 시험이 아니다. B-JOB-01·B-DEADLINE-01 채택 상태는 유지한다.
