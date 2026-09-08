# 재검증 Lease와 Orphan 종결 경계

## 범위

이 변경은 `REV-001`, `N-AVL-005`, `N-OPS-004`의 재검증 Job DB 경계를 보완한다. 초기 검증 Stream 복구, 실제 Vercel 장애 20종, 전체 Deadline 전파와 `B-JOB-01`·`B-DEADLINE-01` 채택을 대신하지 않는다.

## 확인한 결함과 수정

- 기존 실패·최종화 함수는 `lease_token`만 비교했다. 임대가 만료됐지만 새 Worker가 아직 선점하지 않은 구간에는 과거 Worker가 결과를 쓸 수 있었다.
- 기존 Claim 함수는 `attempt_no = max_attempts`인 만료 Job을 선점하지 않았지만 terminal 상태로도 바꾸지 않아 `RUNNING` Orphan이 될 수 있었다.
- Migration `0053`은 Worker가 호출하는 실패·최종화 함수에서 token과 현재 시각의 Lease 유효성을 함께 검사한다.
- 최대 시도를 소진한 만료 Job은 같은 잠금에서 실패 이벤트와 Lease 해제를 기록한다. 활성 Run이 없으면 `WORKFLOW_RETRY_EXHAUSTED`, 있으면 Run과 Job을 `PROVIDER_RESULT_UNKNOWN`으로 종결한다. 실패 복구는 이전 Passport와 Case의 최신 Passport 포인터를 바꾸지 않는다.

## 격리 검증

새 PostgreSQL 기준으로 다음 불변식을 검사한다.

- 만료 Lease의 실패 기록·최종화 거부와 원장 무변경
- 재선점 때 token 회전·attempt 증가와 과거 heartbeat·최종화 거부
- 현재 Worker heartbeat와 Run·Job 동시 실패 종결
- terminal Job 재생 차단과 실패 이벤트 단일성
- Run 유무별 최대 시도 소진 Orphan 종결
- 실패 복구 뒤 Passport 수와 최신 포인터 보존
- 반복 취소의 terminal 행·이벤트 멱등성

격리 DB의 51개 Migration과 SQL 시험 37파일이 통과했다. RLS·FORCE RLS 누락과 익명 테이블 권한은 0건이다. CI placeholder 환경의 Vitest는 639건 통과·96건 선택적 건너뜀이고, 재검증 관련 시험은 18건 통과·실제 DB 환경이 필요한 1건 건너뜀이다. TypeScript, lint 오류 0건, Database Spec 검사와 Production build도 통과했다. 선택적 건너뜀과 격리 시험을 Live Vercel 성공으로 계산하지 않는다.

## 아직 채택하지 않은 범위

Migration `0053`은 실제 FinShield Supabase에 적용하지 않았다. 원격에는 앞선 Migration도 모두 적용되지 않은 상태이므로 순서를 건너뛰어 적용하지 않는다. 실제 Vercel의 재시작·중복 전달·응답 유실·취소/완료 경합·전체 기한과 원장 일치 시험은 남아 있다. 따라서 Implementation Gate는 `NO-GO`, Release Gate는 `NOT-EVALUATED`이며 `B-JOB-01`과 `B-DEADLINE-01`은 미채택 상태다.
