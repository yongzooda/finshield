# 재검증 만료 Lease와 소진 작업 종결 통합

REV-001·N-AVL-005·N-OPS-004, 이슈 #282. PR #285의 0053을 운영 0065 뒤의 `0067_revalidation_fencing_and_orphan.sql`로 이식한다. 과거 Migration 번호를 소급 적용하거나 ledger를 조작하지 않는다. 기존 0053 원문 구현과 37번 SQL 시험을 그대로 보존해 현재 53번 시험으로 대조한다.

만료 Lease는 새 Worker 선점 전에도 실패·최종화 쓰기를 하지 못한다. 재선점은 token을 회전하고 최대 시도를 소진한 만료 Job을 활성 Run과 함께 종결한다. 불명확한 기존 Provider 응답은 재호출하지 않는다. 기존 `failRevalidation`의 트랜잭션 및 완료 응답 복원 경로를 유지한다.

격리 PostgreSQL 17에 Migration 64개와 SQL 시험 51파일이 통과했다. 현재 Lease 만료·회전·stale heartbeat·소진 Orphan·이전 Passport 보존·취소 멱등성을 확인했다. 별도의 실제 Worker DB 통합 시험 1개에서 Run 쓰기 SQL 오류 주입 전체 rollback, 잘못된 Lease 무변경, 재시도와 반복 호출 동일 종결, 과거 Job만 실패한 상태 복원이 통과했다. 이 시험은 실제 Vercel 배포 장애 20종 전체 시험이 아니다. B-JOB-01·B-DEADLINE-01 채택 상태는 유지한다.

추가 보완: 원래 wrapper의 `now()`는 트랜잭션 시작 시각이라 대기 중 만료를 놓칠 수 있다. Job과 runtime을 먼저 잠그고 `clock_timestamp()`로 유효성을 확인한다. 같은 트랜잭션 안에서 10ms 임대를 만든 뒤 20ms 실제 대기한 시험도 실패·최종화 쓰기를 거부했다.

시각 경계 시험의 첫 전체 실행은 만료 쓰기 거부 뒤 재선점 단계에서 실패했다(`fencing-migrations-final.txt`). 원래 선점·heartbeat에도 `now()`가 남아 있었기 때문이다. 두 경계를 같은 실제 시각 검사로 바꾼 뒤 Migration 64개·SQL 시험 51파일 전체와 OCR·재검증 DB 통합 2건이 통과했다. 실패 원본을 보존한다.

진행 기록과 접수 복구 보완: 0069는 진행 이벤트도 현재 Lease를 요구하고 token 없는 Worker의 직접 이벤트 추가 권한을 회수한다. API는 RUNNING 작업의 임대가 만료됐으면 GET에 복구 필요를 표시하고 POST에서 같은 Job을 다시 Workflow에 전달한다. 유효한 Worker가 있으면 재전달하지 않는다. 화면에도 처리 연결 재시도를 표시한다. 실제 격리 DB의 동시 Worker 두 개 중 하나만 선점했고, 만료 Worker의 진행 쓰기가 거부됐으며 이벤트 수는 불변이었다. OCR·원자적 실패·진행 복원 통합 3건 통과.
