# Cohere Fast 결정 뒤 main 증거 12건 채택

## 범위

- 기준 main: `7ac52bd5f223919efe1df69e8cadc00c950e9e92`
- 요구사항: `N-QLT-010`
- 채택 대상: `B-MODEL-01`, `B-RETRIEVAL-01`, `B-FILE-SAFETY`, `B-LAW-01`, `B-RUNTIME-01`, `B-HEALTH-01`, `B-RATE-01`, `B-CONSENT-01`, `B-STORAGE-01`, `B-DELETE-01`, `B-SOURCE-02`, `B-SOURCE-03`
- 채택 PR: #313

PR #306의 Cohere Fast 제품 Retrieval 결정으로 ADR decision digest가 바뀌어 과거 채택이 모두 무효가 됐다. 같은 main SHA에서 측정을 걸고 채택이 끝날 때까지 main에 다른 PR을 병합하지 않았다. 모든 실행은 `workflow_dispatch`로 main에서 시작했고 시험 대상 SHA와 Workflow SHA가 같으며 첫 시도다. 각 Workflow의 strict raw-metric policy가 성공했다.

| Blocker | Run | Artifact | 관측 |
|---|---:|---:|---|
| `B-MODEL-01` | `34499501128` | `10161425266` | 합성 50건·Live 100회가 schema·strict tool·사후 검증 통과, fault 20건 거짓 성공 0건, 호출 P95 3,449ms |
| `B-RETRIEVAL-01` | `34499508015` | `10161418157` | 미노출 v6 100 Claim에서 Recall@5 1.00·Precision@5 1.00·위험 핵심 1.00, 질의 P95 638ms, 총비용 USD 0.2016 |
| `B-FILE-SAFETY` | `34499515046` | `10161269064` | 위험 82건 전부 거부, 정상 15건 전부 통과, 판정 어긋남 0건, 최장 6.7초 |
| `B-LAW-01` | `34499518729` | `10161264574` | 15회 중 등록 도메인 Referer 통과, 부정 6건 전부 차단, 429·5xx·시간 초과 0건 |
| `B-RUNTIME-01` | `34499528694` | `10161253403` | Preview·Production 6배포 기록 6건, deployment ID 불일치 0건, Node v24.19.0, region icn1 |
| `B-HEALTH-01` | `34499532323` | `10161290510` | 실제 HTTP 100회 외부 전송 0건, DB 장애 응답 503, 미관측 Provider 상태 `unknown` |
| `B-RATE-01` | `34499539154` | `10161275772` | 동시 예약 60회 상한 초과 0건, 정산 불일치 0건, Rate 40회 중 10회 허용 |
| `B-CONSENT-01` | `34499542659` | `10161271358` | 거절·철회 7경로 전송 0건, 허용 1경로 전송 1건, 감사 누락 0건 |
| `B-STORAGE-01` | `34499545676` | `10161270103` | 회원 업로드 1건 허용, 부당 접근 8경로 허용 0건, RLS 우회 키 미사용 |
| `B-DELETE-01` | `34499548717` | `10161585716` | 대상 35건 잔존 0건, 만료 전 5건 보존, 최대 삭제 224초 |
| `B-SOURCE-02` | `34506019177` | `10163852324` | 두 API 결과 코드 `00`, 금융위 총건수 19 전량 수신 |
| `B-SOURCE-03` | `34506182109` | `10163916299` | 현재 기준월 `202602`, 진흥원 취급기관 16/16 연결, 상품·신고센터 페이지 도달 |

각 artifact는 정확히 하나의 sanitized `result.json`만 포함한다. 결과 파일과 Actions archive의 SHA-256은 `evidence/provider-stack-gate.json`에서 채택 PR 번호와 함께 고정한다.

## 다시 실행한 두 건

Source 두 건의 첫 실행 run `34499522268`·`34499525297`은 공공데이터 접속 시간 초과로 결과 파일을 만들기 전에 멈췄다. 품질 관측이 없었으므로 같은 main에서 다시 실행한 결과를 채택한다. 실패한 첫 실행도 Actions 이력에 그대로 남는다.

## 채택하지 않는 것

- `B-OCR-01`: 사전등록한 v2 평가셋의 정식 1회 측정 run `34499511820`이 필드 F1 0.9732로 기준 0.98에 미달했다. 차이 9쌍은 모두 `earlyrepay` 가족 스캔 PDF의 주소 필드다. 실패로 기록하고 재측정해 유리한 결과를 고르지 않는다.
- `B-EMBED-01`: run `34499504669`에서 수집기가 이미 한 번 측정한 v5 평가셋의 재측정을 거부했다. 새로 검토한 미측정 평가셋을 사전등록해야 한다.
- `B-SUPABASE-01`: run `34499535894`에서 불변식 시험 14파일(40~52·54)이 완료 표시를 `통과했습니다` 대신 `통과`로 찍어 수집기가 실패로 판정했다. SQL 단언은 모두 정상 종료했지만 원격 schema digest 대조 단계에는 가지 않았다. 시험 완료 표시를 고친 뒤 새 main에서 다시 잰다.

## Retrieval의 Supabase 선행 조건

ADR 14.2는 Retrieval 해제 조건에 `B-SUPABASE-01` 선행을 적는다. 이번 Retrieval 측정은 응용 코드의 근사 구현이 아니라 실제 Postgres FTS와 pgvector 경로를 썼다. 다만 같은 창의 Supabase 측정이 실패해 선행 조건이 아직 채워지지 않았다는 사실을 14.1 원장에 그대로 적는다. 다음 Supabase 측정이 실제 schema·RLS 문제로 실패하면 Retrieval도 `NOT-EVALUATED`로 되돌린다.

## Gate 경계

이 채택으로 20개 차단 항목 중 12개가 부분 PASS가 된다. 제품의 전체 Live Vertical Slice PASS가 아니다. OCR·Embed·Supabase·Processor Privacy·Vercel Privacy·Workflow·Deadline·Component Spike가 남아 있으므로 Implementation Gate는 `NO-GO`를 유지하고 Release Gate는 `NOT-EVALUATED`를 유지한다.
