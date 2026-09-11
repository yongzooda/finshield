# SQL 완료 표시 수정 뒤 Supabase 증거 채택

## 범위

- 기준 main: `e5d05cae3fa3e1f91b671561f0174c1e48d85b5e`
- 요구사항: `N-QLT-010`, `SEC-AUTH-002`, `SEC-AUTH-003`
- 채택 대상: `B-SUPABASE-01`
- 채택 PR: #324

main `7ac52bd5` 의 측정 run `34499535894` 는 SQL 계약 시험 40~52·54 열네 파일이 완료 알림을 `통과` 로만 끝내 수집기가 실패로 판정했다. PR #323 이 알림 문구만 `통과했습니다` 로 고쳤고 단언·대상 객체·Migration 은 바꾸지 않았다. 이 파일들은 B-SUPABASE-01 scope 에만 있어 먼저 채택된 12건의 scope 는 바뀌지 않았다.

측정 전에 같은 Migration 을 적용한 격리 DB 와 운영 DB 의 schema digest 를 읽기 전용으로 미리 대조해 여섯 개가 모두 같음을 확인했다. 정식 측정은 main 에서 `workflow_dispatch` 로 한 번 시작했고 첫 시도에 통과했다.

| Blocker | Run | Artifact | 관측 |
|---|---:|---:|---|
| `B-SUPABASE-01` | `34559818408` | `10183919799` | Migration 68개·SQL 시험 54파일, 단언 516개 통과·실패 0개, schema digest 6/6 일치, RLS 83/83, anon 잔존 0건, 교차 Owner 거부 247건, 예상 밖 허용 0건 |

결과 원본과 Actions archive 의 SHA-256 은 `evidence/provider-stack-gate.json` 에서 채택 PR 번호와 함께 고정한다.

## Retrieval 선행 조건

ADR 14.2 는 `B-RETRIEVAL-01` 해제 조건에 `B-SUPABASE-01` 선행을 적는다. PR #313 은 이 조건이 채워지지 않았다는 사실을 원장에 적었다. 이번 채택으로 조건이 채워져 Retrieval 원장 행을 그렇게 고친다.

## Gate 경계

부분 PASS 는 13/20 이다. OCR·Embed·Processor Privacy·Vercel Privacy·Workflow·Deadline·Component Spike 가 남아 Implementation Gate 는 `NO-GO`, Release Gate 는 `NOT-EVALUATED` 를 유지한다.
