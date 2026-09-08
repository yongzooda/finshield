# 심사 운영 예산 정책

요구사항: `N-OPS-003`, `SEC-OPS-003`, `AI-016`, `E-010`, `E-011`.

2026-09-07의 `synthetic-file-probe-20260907`·`synthetic-shared-probe-20260907` 상한은 실제 Provider 연결을 처음 확인한 합성 개발 시험용이었다. 전체 일 USD 0.50, 사용자 일 USD 0.30, Case·Run USD 0.20은 단일 Claim 실측 USD 0.074604에는 충분했지만, 같은 Case에서 최초 검증·파일·재검증·가입 후 점검을 연속하는 심사 흐름을 수용하지 못한다.

Migration 0046은 다음 상한을 `judge-readiness-20260908-v1`로 등록한다. USD 1은 1,000,000 microunits다.

| Provider | Global day | Owner day | Case | Run |
|---|---:|---:|---:|---:|
| 전체 합산 | USD 20.00 | USD 3.00 | USD 3.00 | USD 0.80 |
| Anthropic `claude-sonnet-5` | USD 20.00 | USD 3.00 | USD 3.00 | USD 0.80 |
| Cohere `embed-v4.0` | USD 1.00 | USD 0.25 | USD 0.25 | USD 0.10 |
| Cohere `rerank-v4.0-fast` | USD 2.00 | USD 0.50 | USD 0.50 | USD 0.10 |

전체 합산 상한이 Anthropic과 Cohere의 합산 지출을 막지막으로 제한한다. 이미 등록된 더 높은 수동 상한은 낮추지 않는다. 현재 유효한 Counter도 함께 증액하되 `reserved_microunits`·`consumed_microunits`를 초기화하거나 줄이지 않는다. 사용량이 불확정한 Provider 호출은 계속 예약 상태로 남는다.

2026-09-08 후속 지시에서 사용자는 심사 흐름을 막지 않도록 예산을 필요한 수준으로 조정하고 Fast를 제품 검색에 연결하는 결정을 승인했다. Migration 0052는 `rerank-v4.0-fast`의 별도 상한을 위 표와 같이 등록한다. search unit당 등록 단가가 USD 0.002이므로 Run USD 0.10은 최대 50 search unit 예약을 허용한다. 전체 합산 Run USD 0.80은 그대로 유지해 Anthropic과 Cohere의 합계가 무제한으로 커지지 않게 한다.

이 변경은 내부 소프트 상한을 변경하며 Provider 유료 플랜·계약·외부 계정의 지출 한도를 변경하지 않는다. Provider 계정 자체의 쿼터·잔액이 부족하면 앱은 그 거절을 별도로 보존한다.
