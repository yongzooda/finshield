# B-JOB-01·B-DEADLINE-01 장애 20종 사전등록

2026-09-10 기록이다. 재검증 Workflow Job 의 장애 20종과 입력별 기한 표본을 **측정 전에** 고정한다. 결과를 본 뒤 이 목록·기대 결과·합격식을 바꾸지 않는다. 이 문서는 Gate 채택 문서가 아니며 `B-JOB-01`·`B-DEADLINE-01` 은 여전히 `NOT-EVALUATED` 다.

## 왜 지금 고정하는가

`docs/ops/2026-09-09-current-service-status.md` 의 실제 Vercel 표본은 두 개의 동시 POST 가 같은 Job 으로 합류하고, 불명확한 Run 이 모델 재호출 없이 실패로 종결되는 것을 보여 준다. 그 표본은 장애 **두 종**이고 전체 20종이 아니다. 기능을 만든 뒤에 통과한 장애만 골라 목록을 정하면 시험이 스스로를 증명하게 되므로, 목록을 먼저 닫고 그다음에 측정한다.

## 장애 20종

`전달` 열은 그 장애를 어디까지 관측해야 하는지다. `vercel` 은 실제 배포의 전달 경계까지 봐야 하고, `db` 는 DB 계약만으로 결정적으로 관측할 수 있는 항목이다. `계약` 열은 지금 저장소에서 그 불변식을 붙잡고 있는 SQL 계약 파일이다.

| ID | 장애 | 전달 | 유일하게 허용하는 종결 | 계약 |
|---|---|---|---|---|
| F01 | 같은 요청 키·같은 본문의 중복 전달 | vercel | `JOINED_EXISTING_JOB` | 56 |
| F02 | 같은 요청 키에 다른 본문 | db | `REJECTED_PAYLOAD_MISMATCH` | 56 |
| F03 | 응답 유실 뒤 새 키로 재요청 | vercel | `REJECTED_ACTIVE_JOB` | 56 |
| F04 | 살아 있는 Lease 중 다른 Worker 선점 | vercel | `REJECTED_LEASE_HELD` | 56 |
| F05 | 종결 Job 재전달 | db | `REJECTED_TERMINAL_REPLAY` | 53 |
| F06 | 만료 Lease 의 진행 쓰기 | db | `REJECTED_STALE_LEASE` | 53 |
| F07 | 만료 Lease 의 실패·최종화 | db | `REJECTED_STALE_LEASE` | 53 |
| F08 | 회전된 옛 token 의 쓰기 | db | `REJECTED_ROTATED_LEASE` | 53 |
| F09 | 알 수 없는 token 의 진행 기록 | db | `REJECTED_UNKNOWN_LEASE` | 56 |
| F10 | 현재 Lease 의 heartbeat | db | `LEASE_EXTENDED` | 53 |
| F11 | 실행 중 취소 요청 | vercel | `CANCEL_REQUESTED_NOT_TERMINAL` | 56 |
| F12 | 취소 종결의 중복 전달 | vercel | `CANCELLED_ONCE` | 56 |
| F13 | 종결 뒤 최종화 시도 | db | `REJECTED_AFTER_TERMINAL` | 56 |
| F14 | 반복 취소 | db | `CANCELLED_ONCE` | 53 |
| F15 | 종결 상태의 다른 세션 조회 | vercel | `TERMINAL_RESTORED` | 56 |
| F16 | Run 없는 재시도 소진 | vercel | `FAILED_RETRY_EXHAUSTED` | 53 |
| F17 | Run 있는 재시도 소진 | vercel | `FAILED_PROVIDER_RESULT_UNKNOWN` | 53 |
| F18 | Provider 결과 미확정 예약 | db | `RESERVATION_PRESERVED_THEN_SETTLED` | 56 |
| F19 | 같은 예약의 이중 정산 | db | `REJECTED_DOUBLE_SETTLE` | 56 |
| F20 | 상한 초과 예약과 만료 예약 sweep | db | `REJECTED_BUDGET_EXCEEDED` | 56 |

`53` 은 `supabase/tests/53_revalidation_fencing.sql`, `56` 은 `supabase/tests/56_workflow_fault_matrix.sql` 이다. DB 계약 통과는 필요 조건이며 `transport` 가 `vercel` 인 열 개 항목의 전달 경계를 대신하지 않는다.

## 20종 공통 합격식

주입한 각 장애가 아래를 **모두** 만족해야 그 장애가 통과다. 하나라도 어긋나면 그 장애는 실패이고, 20종 전부 통과해야 `B-JOB-01` 이 `PASS` 후보가 된다.

- `injected` 가 실제로 참이다. 주입하지 못한 장애를 성공으로 세지 않는다.
- 종결 상태가 위 표의 값과 정확히 같다. `PASS` 같은 결론 문자열은 증거가 아니다.
- terminal 행이 정확히 하나다.
- 중복 Job 이 0건이다.
- 복구 과정의 추가 모델 호출이 0건이다.
- 이전 Passport 수가 그대로다.
- 그 종결에 해당하는 이벤트가 정확히 하나다.
- 임의로 해제한 미확정 예약이 0건이다.

시험 뒤 실행 중으로 남은 Job·Run 은 0건이어야 한다. 남은 미확정 예약은 있을 수 있지만 반드시 같은 수 이하의 재조정 행으로 설명돼야 한다.

## 입력별 기한 표본

`B-DEADLINE-01` 은 Text 120,000ms·Image 180,000ms·PDF 180,000ms 세 표본을 각각 한 번 측정한다.

- 관측 시간이 그 입력의 상한을 넘지 않는다.
- 기한 초과에서 하위 호출을 실제로 중단한다.
- 중단 신호가 2,000ms 안에 모델·도구·DB 경계로 전달된다(`N-AVL-008`).
- Run 이 `FAILED` 또는 `PARTIAL` terminal 행으로 종결된다.
- 다른 세션에서 그 종결 상태를 조회할 수 있다.
- 부분 저장 표시가 종결 상태와 일치한다.
- 중단 뒤 모델 호출이 0건이다.

세 표본은 개별 관측이며 P95 가 아니다. P95 는 별도 표본 수를 정한 뒤에만 표현한다.

## 이번 변경으로 고친 것

`private.settle_revalidation_cancel` 은 이미 종결된 Job 에도 상태·Lease·이벤트를 다시 썼다. 지금까지는 호출자인 `cancel_revalidation_job` 과 `claim_case_revalidation_job` 이 상태를 먼저 보고 한 번만 부르는 데 기대고 있었다. Workflow Job 은 같은 단계를 다시 전달할 수 있으므로 F12 의 기대(`CANCELLED_ONCE`)를 함수 자체가 지켜야 한다. Migration `0071` 이 종결된 Job 에서 조기 반환하도록 바꿨고 기존 terminal 행·이벤트는 건드리지 않는다.

## 측정과 채택

`.github/scripts/workflow-fault-policy.mjs` 가 위 합격식을 다시 계산하고 `.github/scripts/test-workflow-fault-evidence.mjs` 가 변조 34건을 거부한다. 실제 측정은 배포된 Vercel Workflow 와 운영과 같은 구성의 DB 를 함께 써야 하며, GitHub Actions 가 과금으로 시작되지 않는 동안에는 정식 main 단일 실행과 별도 Adoption 을 수행할 수 없다. 로컬 실행 결과를 Gate 증거로 채택하지 않는다.

`B-JOB-01`·`B-DEADLINE-01` 은 `evidence/provider-stack-gate.json` 에 항목이 없고 `provider-evidence.mjs` 에 policy 가 등록되지 않았으므로 지금 상태에서는 `PASS` 자체가 거부된다. 실행 harness 와 workflow 를 같은 pin 으로 등록하는 것은 실제 측정을 수행하는 후속 PR 에서 한다.
