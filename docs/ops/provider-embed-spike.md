# B-EMBED-01 Cohere 검색 품질 Spike 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-EMBED-01`
- 현재 상태: `NOT-EVALUATED`
- 이 문서는 검토된 harness의 실행 계약이다. workflow 성공만으로 `PASS`가 되지 않는다.
- 실제 개인정보·운영 문서·사용자 입력은 사용하지 않는다. 버전 고정 합성 한국어 금융 Fixture만 외부 Provider로 전송한다.
- 기존 `B-MODEL-01` Evidence scope를 보존하기 위해 SDK와 `.env.example`을 변경하지 않고 Node 24 native `fetch`로 Cohere v2 API를 호출한다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| Model | `embed-v4.0` |
| 문서 / Query input type | `search_document` / `search_query` |
| Embedding | `float`, 1024차원 |
| 거리 / 검색 | cosine / 전체 corpus Exact KNN, 문서 ID tie-break |
| Fixture | 20주제, 문서 140개, Query 100개, hard-negative 문서 40개, hard-negative probe 40개 |
| 위험 핵심 Query | 선입금·원격제어·기관사칭·인증정보·공식채널·중개수수료 30개 |
| Recall@5 | `primary_document_id`가 top 5에 든 Query 수 / 전체 Query 수, `>= 0.90` |
| 위험 핵심 Recall@5 | 주제별 `risk_core_document_id`가 top 5에 든 위험 Query 수 / 위험 Query 수, `= 1.00` |
| Precision@5 | top 5의 동일 주제 관련 문서 수 / `(전체 Query 수 * 5)`, `>= 0.80` |
| Query P95 | Query별 Cohere HTTP 요청 wall time P95, `<= 1,500ms` |
| 비용 | 응답 `meta.billed_units.input_tokens * USD 0.12 / 1,000,000` |
| 재시도 | 없음. 각 Query는 실제 단일 Provider 요청 1회로 측정 |
| 요청 간격 | 문서 batch와 Query 모두 요청 시작 사이 최소 1,100ms; HTTP P95 측정은 대기 이후 시작 |

가격은 2026-09-04 Cohere 공식 가격 페이지의 Embed 4 text 입력 `USD 0.12 / 1M tokens`를 고정한다. 공식 문서에 따른 text input 한도 inventory는 분당 2,000개이며, 합격 판정은 실제 요청의 HTTP 200·dimension·finite/non-zero vector·billed unit과 함께 검증한다.

공식 근거:

- [Embeddings 모델·input type·dimension](https://docs.cohere.com/v1/docs/embeddings)
- [Embed v4 모델과 cosine 지원](https://docs.cohere.com/docs/cohere-embed)
- [v2 Embed API 응답과 billed units](https://docs.cohere.com/v2/reference/embed)
- [Rate limits](https://docs.cohere.com/v2/docs/rate-limits)
- [가격](https://cohere.com/pricing)

## Secret과 실행

값은 채팅·이슈·PR·로그에 남기지 않는다. Repository `Settings → Environments → provider-spike → Environment secrets`에 정확히 `COHERE_API_KEY`로 등록한다. `provider-spike`의 protected branch 정책을 유지한다.

1. harness PR을 review·merge하고 main SHA를 확인한다.
2. `Provider Embedding Evidence` workflow를 main에서 `B-EMBED-01`로 수동 실행한다.
3. 실패하면 artifact가 생성되지 않는지 확인하고 상태를 `NOT-EVALUATED`로 유지한다.
4. 성공하면 run/job/step, main SHA, artifact ID/digest, `result.json` SHA-256와 scope hash를 수집한다.
5. 별도 Adoption PR에는 sanitized `result.json`, evidence index, ADR 상태와 provenance만 포함한다.
6. Adoption PR validator가 GitHub 원격 provenance와 27일 TTL을 확인한 뒤에만 `PASS`를 채택한다.

결과에는 Query·문서 전문, vector, API key, 원본 Provider request ID, 원본 응답을 저장하지 않는다. Request ID는 중복 확인 후 정렬된 목록의 SHA-256만 저장한다.

## 실패 이력과 진단

- Run `33860915928`, main `7036ba1d27e6eba8c995eba1673e2211c6a3b904`: 설치가 약 5분 걸려 취소를 요청했으나, 그 직후 설치가 완료되어 문서 batch 2개와 Query 98개까지 처리한 뒤 HTTP 429 발생. Run은 cancelled, artifact 0개이며 채택하지 않는다.
- 이 관측만으로 계정의 분당·월간 quota를 단정하지 않는다. 공식 text input 한도와 실제 429는 별도로 기록한다.
- 후속 harness는 약 54회/분 이하로 요청 시작을 제한한다. 429 재시도 없이 실패하며, 숫자형 `Retry-After`만 안전하게 기록한다. HTTP P95 기준(1.5초), Fixture와 모든 품질 합격식은 변경하지 않는다.
- 전체 측정 완료 시 고정 schema 집계 수치를 로그에 남겨 기준 미달을 진단한다. 실패 시에도 PASS artifact는 만들지 않는다. 실패 실행의 총 billed token·비용은 완전한 원장이 없으므로 임의 추정해 확정하지 않는다.
