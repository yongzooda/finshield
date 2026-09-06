# B-CONSENT-01 동의 격리 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-CONSENT-01`. 해제 조건은 동의 거절 전송 0건과 감사 row다.
- 상위 기준은 `SEC-PRI-010`(동의 거절 시 외부 전송 0회), `INP-013`(처리 순서 고정), `SEC-AI-007`(모델에는 마스킹된 데이터만)이다.
- 현재 상태: `NOT-EVALUATED`
- ADR 14.2가 이 blocker를 prototype으로 규정한다. 동의 게이트는 harness의 구현이고 제품이 같은 계약을 그대로 구현한다.
- 외부 OCR Provider를 실제로 부르지 않는다. 받은 것을 전부 기록하는 가짜 client를 경계에 둔다. 동의가 없는데 그 client가 한 번이라도 호출되면 미달이다.
- PII fixture 100건 이상이라는 `B-PROCESSOR-PRIVACY`의 요구는 이 blocker의 해제 조건이 아니다. 다만 같은 실행에서 마스킹 경계도 함께 관측한다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 산식 버전 | `consent-isolation-raw-transfer-v1` |
| 동의 유형 | `EXTERNAL_OCR_RAW_TRANSFER` 하나 |
| 기준 DB | GitHub Actions service container `pgvector/pgvector:pg17`에 `00_supabase_stub.sql` 뒤 Migration 전부를 적용 |
| 원본 전송 경로 | `consent-gate.mjs`의 함수 하나뿐이다. 그 함수만 외부 client를 부른다 |
| 차단 사유 | `ABSENT`, `DENIED`, `REVOKED`, `SUPERSEDED`, `RAW_DELETED`, `WRONG_INPUT` |
| 감사 | 전송과 차단 모두 `private.audit_events`에 한 줄을 남긴다. 전송은 `EXTERNAL_OCR_RAW_SENT:OK`, 차단은 `EXTERNAL_OCR_RAW_BLOCKED:BLOCKED:<사유>`다 |
| PII 경계 | 제품이 쓰는 `src/lib/agents/pii.ts`를 그대로 부른다. 복사본을 만들지 않는다 |

## 시나리오

| 키 | 상황 | 기대 |
|---|---|---|
| `absent` | 동의 기록이 없다 | `ABSENT` 차단 |
| `denied` | 거절 동의 하나 | `DENIED` 차단 |
| `revoked_after_granted` | 허용 뒤 철회가 이어졌다 | `REVOKED` 차단 |
| `denied_after_granted` | 허용 뒤 거절이 이어졌다 | `DENIED` 차단 |
| `superseded_out_of_order` | 대체 동의가 더 이른 시각으로 들어왔다 | `SUPERSEDED` 차단 |
| `wrong_input` | 동의는 있으나 입력 행이 그것을 가리키지 않는다 | `WRONG_INPUT` 차단 |
| `raw_deleted` | 동의는 있으나 원본이 이미 지워졌다 | `RAW_DELETED` 차단 |
| `granted` | 유효한 허용 동의 | 전송 |

`superseded_out_of_order`는 시계 오차나 backfill로 생길 수 있는 이상 상태다. 최신 시각만 보고 판단하면 뚫리므로 대체 여부도 함께 본다.

## 합격선

| 항목 | 기준 |
|---|---|
| 동의하지 않은 시나리오의 외부 전송 | `0` |
| 동의한 시나리오의 외부 전송 | 시나리오 수와 같다 |
| 감사 기록이 없는 결정 | `0` |
| 결정과 다른 감사 기록 | `0` |
| 외부가 받은 내용과 보내려던 원본의 차이 | `0` |
| 마스킹을 통과한 문장의 원문 식별자 잔존 | `0` |
| 정상 문장의 잘못된 차단 | `0` |

거부만 잘하는 게이트는 통과가 아니다. 허용 경로가 실제로 전송했는지를 함께 요구한다.

## 실행

1. `Consent Isolation Evidence` workflow를 main에서 `B-CONSENT-01`로 dispatch한다. 외부 secret이 필요 없다.
2. harness가 기준 DB를 만들고 시나리오마다 입력·객체·동의를 넣은 뒤 전송 경로를 부른다.
3. 정책 미달이면 결과 파일을 만들지 않는다.
4. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

## 알려진 한계

- 이 증거는 동의 게이트의 계약을 measure한다. 실제 CLOVA 연동은 `B-OCR-01`의 범위다.
- 삭제 격리는 원본이 지워진 뒤 전송 경로가 막히는지까지만 본다. 24시간 물리 삭제 자체는 `B-DELETE-01`이 잰다.
- 게이트는 harness의 prototype이다. 제품이 다른 경로로 원본을 내보내면 이 증거는 그것을 잡지 못한다. 제품 구현 시 원본 전송 경로를 하나로 유지해야 한다.
