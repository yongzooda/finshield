# 최신 main DB 경계 증거 재채택

## 범위

- 기준 main: `fb360014e54647dd99d37970a1ed733ddb80fd5f`
- 요구사항: `N-QLT-010`, `N-OPS-002`, `SEC-006`, `AUTH-005`
- 채택 대상: `B-RATE-01`, `B-CONSENT-01`, `B-STORAGE-01`, `B-DELETE-01`, `B-HEALTH-01`
- 관련 이슈: #270

Migration 0049와 최신 거래 전 검증 코드가 반영된 같은 main SHA에서 다섯 항목을 다시 측정했다. 모든 실행은 `workflow_dispatch`로 main에서 시작했고, 시험 대상 SHA와 Workflow SHA가 같으며, 각 Workflow의 strict raw-metric policy가 성공했다.

| Blocker | Run | Artifact | 관측 |
|---|---:|---:|---|
| `B-RATE-01` | `34195224699` | `10043645651` | 동시 예약 60회에서 상한 초과 허용 0건, 정산 불일치 0건, Rate 40회 중 10회 허용·30회 거부, Provider 슬롯 최소 간격 1,000ms |
| `B-CONSENT-01` | `34195228845` | `10043648574` | 동의 거절·철회 등 7경로 외부 전송 0건, 허용 1경로 전송 1건, 감사 누락 0건, PII 132개 중 잔존 15개 전송 차단, 정상 25개 오차단 0건 |
| `B-STORAGE-01` | `34195233135` | `10043645920` | 실제 회원 업로드 1건 허용, 부당 쓰기·읽기·덮어쓰기·닫힌 TUS 재사용 8경로 허용 0건 |
| `B-DELETE-01` | `34195237392` | `10043815404` | 합성 40 Case 중 삭제 대상 35건의 원본·OCR·Vector·기발급 URL 잔존 0건, 만료 전 5건 보존, 최대 삭제 199초, teardown 객체 잔존 0건 |
| `B-HEALTH-01` | `34195239872` | `10043669488` | 실제 Next HTTP 100회와 DB 장애 2회에서 Provider 전송 0건, DB 장애 응답 503, 미관측 Provider 상태 `unknown` 유지 |

각 artifact는 정확히 하나의 sanitized `result.json`만 포함한다. 결과 파일과 Actions archive의 SHA-256은 `evidence/provider-stack-gate.json`에서 실제 채택 PR 번호와 함께 고정한다.

## 제외한 실패

같은 main의 Supabase run `34195221430`은 로컬 135개와 원격 134개의 routine 수가 달라 실패했다. Table·constraint·index·view·policy digest와 RLS 부정 시험은 일치했지만, 원격에 Migration 0045의 `private.prepare_initial_verification_retry(uuid,uuid,uuid)`가 없었다. 실패를 성공으로 채택하지 않으며, 단일 함수 복구 뒤 새 main 실행으로 다시 측정한다.

## Gate 경계

이 채택은 해당 격리 계약과 운영 경계의 PASS다. 제품의 전체 Live Vertical Slice나 Provider 품질 PASS가 아니다. `B-SUPABASE-01`, OCR, Retrieval, Processor Privacy, Workflow, Deadline, Component Spike가 남아 있으므로 Implementation Gate는 `NO-GO`를 유지하고 Release Gate는 `NOT-EVALUATED`를 유지한다.
