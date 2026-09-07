# FinShield 모델 비용 원장

요구사항: `N-OPS-003`, `SEC-OPS-003`, `AI-016`, `E-011`, `EC-015`.

`0034_model_usage_context.sql`부터 마스킹 입력, 회원 검증 Run, 공개 Demo Run은 각각 자기 문맥으로 `private.usage_reservations`에 예약한다. 정확히 한 문맥만 허용하며, 사용자 자료를 Demo 회원 Case로 복제하지 않는다. `GLOBAL_DAY`, `OWNER_DAY`, `CASE`, `RUN` 네 범위에서 예약액과 사용액을 합해 다음 호출을 차단한다. 상한을 설정하지 않았으면 외부 호출 전에 거부한다.

가격은 [Anthropic 공식 가격표](https://platform.claude.com/docs/en/about-claude/pricing)를 2026-09-07 확인한 Sonnet 5의 입력 100만 토큰당 USD 2, 출력 USD 10으로 고정했다. 가격 버전은 `sonnet5-usd-20260907`이며 USD 1을 1,000,000 microunits로 계산한다. 입력 예약은 UTF-8 본문·구조화 스키마 바이트 수에 여유분을 더하고 출력 상한을 합산한다. 예약 추정치를 실제 토큰 사용량으로 표시하지 않는다.

응답의 토큰 사용량은 형식/거절 판정 전에 정산한다. 계량은 이전 PreCase 원장을 호출하지 않는다. 429처럼 과금하지 않은 요청과 호출 전 취소는 예약을 해제한다. 타임아웃·통신 단절·알 수 없는 캐시 쓰기·정산 장애는 `RESERVED`와 `reconcile_required`를 유지한다. 미확정 호출은 0달러 성공으로 계산하지 않는다. Agent·Judge에는 보고된 토큰·비용과 미확정 여부를 남긴다.

예산 거부가 발생하면 나머지 Agent·Judge 외부 호출을 중단하고 `TOOL_BUDGET`에 따른 보류로 처리한다. 운영 상한은 `private.budget_limits`에서 관리하고 기존 Counter의 상한을 바꿀 때 진행 중 예약을 별도로 검토한다. 이 변경은 운영 상한을 자동으로 늘리거나 초기화하지 않는다.

2026-09-08 심사 운영은 [심사 운영 예산 정책](judge-budget-policy.md)을 따른다. 합성 개발 시험용 USD 0.50 전체 상한을 운영 상한으로 사용하지 않고, Anthropic·Cohere Embed의 Provider별 상한과 전체 합산 상한을 함께 강제한다.

## 검증과 제한

- SQL 시험 23은 마스킹 전/타인 입력 차단, 예약액 합산, 네 범위 정산, 중복 정산 거부, Demo 분리를 검증한다.
- 단위 시험은 예약 거부 시 Provider 0회, 거절 응답 정산, 429 예약 해제, 타임아웃 예약 보존, 예산 거부 후 후속 Agent/Judge 0회를 검증한다.
- 격리 로컬 DB와 실제 Provider에서 합성 단일 Claim 실행 15호출 USD 0.074604를 정산했다. 합성 복수 Claim 실행은 14호출 USD 0.096782를 정산하고 시간 초과 1호출을 미확정 예약으로 남겼다. Intake 비용은 별도 입력 문맥이며 위 Run 합계에 포함하지 않았다. 이는 개별 시험 결과이고 P95나 전체 운영 비용 보증이 아니다.
- 이 실제 시험의 복수 Claim에는 Domain 시간 초과·미연결 분쟁 도구에 따른 부분 결과가 있었다. 정상 전체 흐름 통과로 표시하지 않는다.
- CLOVA OCR, Cohere Embedding, 법령/Tool Rate의 전체 비용 통합과 Provider 사용량 대조 자동화는 남아 있다. 운영 DB/환경 적용·Release Gate 통과 전이며 공개 서비스 활성화를 뜻하지 않는다.
