# B-RATE-01 예산·Rate 원장 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-RATE-01`. 합격선은 ADR 15.1의 Rate·Budget 행이고 직렬화 계약은 ADR 4.3·10.1이다.
- 현재 상태: `NOT-EVALUATED`
- 이 문서는 검토된 harness의 실행 계약이다. workflow 성공만으로 `PASS`가 되지 않는다.
- 외부 Provider를 부르지 않는다. 예산·Rate·직렬화 원장은 전부 Supabase Postgres의 원자 함수이고 그것만 잰다.
- Provider 실제 응답과 429 헤더는 `B-MODEL-01`이 따로 measure했다. 여기서는 원장이 재시도 시각을 돌려주는지만 본다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 산식 버전 | `rate-budget-concurrent-ledger-v1` |
| 기준 DB | GitHub Actions service container `pgvector/pgvector:pg17`에 `00_supabase_stub.sql` 뒤 Migration 전부를 적용 |
| 동시 예약 | 60개 연결이 각각 하나씩 예약한다. Node에서 순서를 맞추지 않는다. 맞추면 DB 잠금이 아니라 Node 직렬화를 재게 된다 |
| 예약 단위 | 100 microunit. RUN 범위 상한 2,000이라 20건만 들어간다. 나머지 세 범위는 넉넉히 둬 어느 범위가 막았는지 헷갈리지 않게 한다 |
| 정산·해제 | 승인된 예약의 절반은 실제 사용으로 정산하고 절반은 해제한다 |
| Rate | 창 60초에 상한 10, 시도 40건을 동시에 던진다 |
| Provider 직렬화 | 최소 간격 1,000ms로 슬롯 5개를 받는다. CLOVA 기본 1 TPS다 |
| 실행 식별자 | Run과 Case를 실행마다 새로 만든다. 같은 DB에 다시 돌려도 예산 Counter가 앞 실행에 오염되지 않는다 |

## 합격선

ADR 15.1의 값을 그대로 쓴다.

| 항목 | 기준 |
|---|---|
| 동시 예약 표본 | `≥ 50` |
| cap 초과 승인 | `0` |
| 예약·정산 원장 불일치 | `0` |
| 재시도 시각 없는 429 | `0` |
| 승인 수 | 상한이 허용하는 정확한 수 |
| 정산 뒤 남은 예약액 | `0` |
| Provider 슬롯 최소 간격 | `≥ 1,000ms` |

## 실행

1. `Rate Budget Evidence` workflow를 main에서 `B-RATE-01`로 dispatch한다. 외부 secret이 필요 없다.
2. harness가 기준 DB를 만들고 fixture를 넣은 뒤 네 묶음을 관측한다.
3. 정책 미달이면 결과 파일을 만들지 않는다. 실패 사유는 종류만 로그에 남는다.
4. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

## 알려진 한계

- 이 증거는 원장의 원자성과 계약을 measure한다. 실제 Provider가 429를 어떻게 돌려주는지는 `B-MODEL-01`의 범위다.
- Circuit Breaker의 개방·복구는 `record_provider_outcome`의 불변식 시험이 덮는다. 여기서는 슬롯 배분만 본다.
- 동시성은 한 DB 인스턴스 안의 여러 연결로 만든다. 여러 Serverless 인스턴스에서 도는 상황 자체를 재현하지는 않는다. 원장이 DB에 있다는 사실이 그 차이를 없앤다는 것이 ADR의 판단이다.
