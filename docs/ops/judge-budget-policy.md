# 심사 운영 예산 정책

요구사항: `N-OPS-003`, `SEC-OPS-003`, `AI-016`, `E-010`, `E-011`.

2026-09-07의 `synthetic-file-probe-20260907`·`synthetic-shared-probe-20260907` 상한은 실제 Provider 연결을 처음 확인한 합성 개발 시험용이었다. 전체 일 USD 0.50, 사용자 일 USD 0.30, Case·Run USD 0.20은 단일 Claim 실측 USD 0.074604에는 충분했지만, 같은 Case에서 최초 검증·파일·재검증·가입 후 점검을 연속하는 심사 흐름을 수용하지 못한다.

Migration 0046은 다음 상한을 `judge-readiness-20260908-v1`로 등록한다. USD 1은 1,000,000 microunits다.

| Provider | Global day | Owner day | Case | Run |
|---|---:|---:|---:|---:|
| 전체 합산 | USD 20.00 | USD 3.00 | USD 3.00 | USD 0.80 |
| Anthropic `claude-sonnet-5` | USD 20.00 | USD 3.00 | USD 3.00 | USD 0.80 |
| Cohere `embed-v4.0` | USD 1.00 | USD 0.25 | USD 0.25 | USD 0.10 |

전체 합산 상한이 Anthropic과 Cohere의 합산 지출을 막지막으로 제한한다. 이미 등록된 더 높은 수동 상한은 낮추지 않는다. 현재 유효한 Counter도 함께 증액하되 `reserved_microunits`·`consumed_microunits`를 초기화하거나 줄이지 않는다. 사용량이 불확정한 Provider 호출은 계속 예약 상태로 남는다.

Cohere `rerank-v4.0-fast`는 제품 운영 상한에 등록하지 않는다. 승인된 합성 개발 시험의 별도 원장과 USD 0.05 상한을 그대로 사용하며, Vercel Production에서는 호출하지 않는다.

이 변경은 내부 소프트 상한을 변경하며 Provider 유료 플랜·계약·외부 계정의 지출 한도를 변경하지 않는다. Provider 계정 자체의 쿼터·잔액이 부족하면 앱은 그 거절을 별도로 보존한다.
