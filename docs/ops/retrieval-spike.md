# B-RETRIEVAL-01 종단 검색 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-RETRIEVAL-01`. 단계 계약은 `AI-007`, 합격선은 ADR 15.1의 종단 Retrieval 행이다.
- 현재 상태: `NOT-EVALUATED`. gate 를 두 번 쟀고 두 번 다 미달이다. 아래 실행 이력을 따른다
- 이 문서는 검토된 harness의 실행 계약이다. workflow 성공만으로 `PASS`가 되지 않는다.
- 측정 단위는 Case다. 근거는 `retrieval-blocker-preregistration.md` 8절이며 그 문서가 정본이다.
- 평가셋은 `B-EMBED-01`이 쓴 v5를 그대로 쓴다. 문서를 더하거나 빼지 않는다.
- 선행 조건인 `B-SUPABASE-01`은 통과했다. Keyword 단계는 실제 Postgres `tsvector`를 쓴다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 산식 버전 | `retrieval-case-top5-filter-keyword-vector-rerank-v1` |
| 평가셋 | `finshield-korean-finance-embed-v5`. 문서 240개, gate 20가족 100 Claim, 위험 6가족 |
| 기준 DB | GitHub Actions service container `pgvector/pgvector:pg17`에 `00_supabase_stub.sql` 뒤 Migration 전부를 적용 |
| Metadata Filter | 질의의 대상 기관과 기준일만 건다. 상품은 걸지 않는다. `AI-006`이 상품 식별을 확인 대상으로 보기 때문이며 평가셋의 `filter_policy`가 같은 내용을 적어 두었다 |
| Keyword | `kb.knowledge_chunks.search_vector`에 `plainto_tsquery('simple', …)`. Node 근사 구현을 쓰지 않는다 |
| Vector | Cohere `embed-v4.0`, 1024차원, cosine, Exact KNN, 후보 풀 20. `B-EMBED-01`과 같은 Provider 계약이다 |
| Rerank | 아래 점수로 재정렬한다. 결과를 본 뒤 가중치·환산식을 바꾸지 않는다 |
| 측정 단위 | Case. Claim 5개의 후보 합집합에 Rerank를 걸어 Case마다 top 5 하나를 만든다 |

### Rerank 점수

- `relevance` = `0.70 × vector` + `0.30 × keyword`
  - `vector` = `1 - cosine 거리`를 0..1로 자른 값. 후보에 없으면 0
  - `keyword` = 그 질의 안 `ts_rank`의 최대값으로 나눈 값. 후보에 없으면 0
  - Claim 여러 개에서 나온 후보는 가장 높은 `relevance`를 쓴다
- `authority` = `A` 1.0, `B` 0.6, `C` 0.3
- `freshness` = 같은 Case 후보 집합 안에서 적용 시작일이 가장 이른 것을 0, 가장 늦은 것을 1로 두고 선형으로 환산한다. 날짜나 범위가 없으면 1이다. 기준일 밖은 Filter가 이미 제외했으므로 종료일 유무는 쓰지 않는다
- 최종 = `0.60 × relevance` + `0.25 × authority` + `0.15 × freshness`
- 같은 `source_fingerprint`는 하나로 계산하고 점수가 높은 쪽만 남긴다
- Case의 top 5는 Claim 5개를 모두 대표한다. Claim마다 그 Claim에서 가장 높은 후보에 한 자리를 먼저 주고 남는 자리를 전체 점수로 채운다. 전체 점수 상위 5개만 뽑으면 어떤 Claim의 근거가 하나도 들어가지 않을 수 있고, 그것은 Claim마다 근거를 요구하는 `AI-007`과 어긋난다
- 동점은 권위, 적용 시작일, unit 이름 순으로 결정적으로 끊는다

## 합격선

ADR 15.1의 값을 그대로 쓴다. 낮추지 않는다.

| 항목 | 기준 |
|---|---|
| Recall@5 (20 Case macro) | `≥ 0.90` |
| 위험 핵심 unit Recall@5 (6 Case) | `= 1.00` |
| Precision@5 (20 Case macro) | `≥ 0.80` |
| 모든 slice Recall@5 | `≥ 0.90` |
| 가족별 Precision@5 | `≥ 0.80` |
| 질의 Provider P95 | `≤ 1,500ms`. Claim 하나를 임베딩하는 요청 하나의 지연이다. `B-EMBED-01` 과 같은 방식으로 재고, DB 검색 지연은 원장과 `db_p95_ms` 에 따로 남긴다 |
| Filter가 정답을 제외한 건수 | `0` |
| 중복 `source_fingerprint`가 독립 근거 수를 늘린 건수 | `0` |

Case마다 관련 unit이 5개이므로 `Recall@5`와 `Precision@5`는 같은 값이 된다. 가족별 기준은 20개 Case 각각이 top 5 안에 관련 unit 4개 이상을 담아야 한다는 뜻이다.

## 원장

`AI-007`이 요구하는 단계별 후보 수를 Claim 100건마다 남긴다. Filter 통과 문서 수, Keyword 후보 수, Vector 후보 수, 합집합 크기, 후보 풀 안의 관련 unit 수, Provider 질의 지연과 DB 검색 지연이다. Case마다 후보 합집합 크기와 중복 제거로 접힌 수를 남긴다.

## 실행

dispatch 입력 `mode`가 `gate`면 증거를 만들고 `development`면 개발용 4가족 20 Claim만 재고 증거 파일을 만들지 않는다. 개발용 진단은 gate 수치를 바꾸지 않으므로 Rerank 후보안을 비교할 때 쓴다.

1. `Retrieval Evidence` workflow를 main에서 `B-RETRIEVAL-01`로 dispatch한다. `provider-spike` environment의 `COHERE_API_KEY`를 쓴다.
2. harness가 기준 DB를 만들고 문서 240개와 gate Claim 100개를 임베딩한 뒤 corpus를 적재한다.
3. Claim마다 DB 함수로 Filter·Keyword·Vector를 돌리고, Case마다 Rerank로 top 5를 만든다.
4. 정책 미달이면 결과 파일을 만들지 않는다. 실패 사유는 종류만 로그에 남는다.
5. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

## 실행 이력

| 실행 | 구성 | Recall@5 | 위험 핵심 | 미달 항목 |
|---|---|---:|---:|---|
| main run `34027686263` | 최초 사전등록 구성 | 0.900 | 0.967 | 위험 핵심, slice freshness·mixed_name·fees·product, 가족 `score_model_factors` Precision |
| main run `34029362670` | 신선도 규칙 수정과 Case 자리 배분 | 0.910 | 0.967 | 위험 핵심, slice fees·freshness·mixed_name, 가족 `score_model_factors` Precision |

첫 측정은 질의 P95 를 DB 검색 시간으로 적는 결함이 있었다. 두 번째 측정은 Provider 요청 기준으로 P95 149ms, P50 87ms 다.

두 측정 사이에 두 가지를 고쳤고 둘 다 개발용 4가족 20 Claim 에서만 비교한 뒤 gate 를 한 번 썼다.

- 신선도 규칙: 종료일 유무로 절반을 깎던 것을 같은 후보 집합 안의 적용 시작일 최신도로 바꿨다. Filter 가 기준일 밖을 이미 제외하므로 종료일은 낡음의 근거가 아니다
- Case 자리 배분: 전체 점수 상위 5개만 뽑던 것을 Claim 마다 한 자리를 먼저 주도록 바꿨다. 어떤 Claim 의 근거가 비는 것은 `AI-007` 과 어긋난다

두 수정이 첫 측정 뒤에 이뤄졌다는 사실을 제출 문서에 명시한다. 개발용 Recall@5 는 0.850 에서 0.950 으로 올랐다.

## 미달을 어떻게 읽는가

파이프라인은 필요한 근거의 91%를 top 5 안에 넣는다. 남은 미달은 세 가지에 몰려 있다.

- 이름이 비슷한 다른 기관 질문에서 같은 기관의 인접 주제 문서가 자리를 가져간다
- 수수료 질문에서 같은 기관의 다른 수수료 문서와 갈린다
- 대체된 과거 버전이 있는 질문에서 현재 문서를 항상 위로 올리지 못한다
- 위험 30건 중 1건의 핵심 근거가 top 5 밖으로 밀린다

ADR 15.1 은 미달일 때 최적화·범위 변경·Provider 변경 중에서 고르라고 정한다. 합격선을 낮추는 선택지는 없다. 최적화는 위 두 가지로 한 번 했고 gate 를 한 번 더 쓰지 않는다. 같은 gate 에 반복해 맞추면 수치만 오르고 실제 품질은 그대로다. 다음 판단은 범위 변경이나 Provider 변경이며 별도 결정으로 남긴다.

## 알려진 한계

- v5 corpus 240개 문서의 `source_fingerprint`가 모두 다르다. 중복 출처 지표는 구조적으로 0이며 중복 제거가 동작한다는 증거가 되지 못한다. 파이프라인은 중복 제거를 구현하고 접힌 수를 원장에 남기되 그 수치를 통과한 시험으로 표시하지 않는다. 사전등록 8.4가 같은 내용을 적어 두었다.
- 평가셋은 합성 문서다. 실제 공시·약관의 다양성을 대신하지 않는다.
- 이 blocker는 검색 단계의 품질만 measure한다. Claim 판정 품질은 `B-CLAIM-01`이 별도로 사전등록한다.
- Rerank는 이 harness의 결정적 구현이다. 제품이 같은 점수를 쓰도록 구현할 때 이 문서를 기준으로 삼는다.
- 첫 gate 측정(run `34027686263`)은 미달이었다. 그때의 `freshness` 규칙이 종료일 유무만 보고 현재 유효한 자료를 절반으로 깎는 설계 오류였고 위 규칙으로 고쳤다. 이 수정이 측정 뒤에 이뤄졌다는 사실을 제출 문서에 명시한다.
