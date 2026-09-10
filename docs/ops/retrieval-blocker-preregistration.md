# 검색 blocker 재정의 수용식 사전등록 초안

이 문서의 수용식은 검토를 거쳐 ADR 5.2·14.2·15.1·15.2에 반영됐다. 반영 뒤에는 이 문서가 아니라 ADR이 정본이다. 측정 결과를 본 뒤 합격선·산식·표본 구성을 바꾸지 않는다. 배경과 순서는 [재정의 영향 분석과 순서](embed-blocker-redefinition-plan.md), 실패 근거는 [v2 실패 원인 분해](provider-embed-failure-analysis.md)에 있다.

## 1. 무엇을 왜 나누는가

`AI-007`은 비정형 자료 검색을 `Metadata Filter → Keyword → Vector → Authority/Freshness/Relevance Rerank`로 규정한다. `AI-006`은 기관·상품 식별에서 Vector 유사도만으로 사실을 확정하지 말라고 규정한다.

현재 `B-EMBED-01` 수용식은 Filter도 Keyword도 Rerank도 없는 Vector 단계 단독에 그 판별을 요구한다. 측정 결과 실패가 정확히 그 지점에 몰렸고, 모든 정답은 상위 8위 안에 있었다. 따라서 blocker를 요구사항 구조에 맞춰 두 단계로 나눈다.

| blocker | 담당 단계 | 무엇을 증명하는가 |
|---|---|---|
| `B-EMBED-01` | Vector 1차 후보 생성 | 필요한 근거가 후보 풀 안에 빠짐없이 들어오는가 |
| `B-RETRIEVAL-01` | Filter·Keyword·Vector·Rerank 종단 | 최종 top 5가 대상·시점이 맞는 근거만 담는가 |

후보 생성 결과를 종단 품질 합격으로 표시하지 않는다. 반대도 마찬가지다.

## 2. 사전등록 원칙

- 수치는 관측값이 아니라 파이프라인 요구에서 유도한다.
- 이 문서가 병합된 뒤에 평가셋을 만들고, 그 뒤에 측정한다.
- 측정 결과를 본 뒤 이 문서의 합격선·산식·표본 구성을 바꾸지 않는다.
- 노출된 v1·v2 평가셋을 재사용하지 않는다. 새 시나리오 가족을 쓴다.
- 이 재정의가 측정 뒤에 이뤄졌다는 사실을 제출 문서에 명시한다.

## 3. `B-EMBED-01` 재정의: 1차 후보 생성

### 3.1 계약

Provider 계약은 바꾸지 않는다. Cohere `embed-v4.0`, 1024차원, float, cosine, 문서 `search_document`, 질의 `search_query`, Exact KNN, 재시도 없음, 요청 시작 간격 1,100ms를 유지한다. Provider와 차원을 바꿔야 한다는 근거는 지금까지의 측정에 없다.

### 3.2 후보 풀 크기

후보 풀 `k = 20`으로 고정한다.

유도 근거는 다음과 같다. Rerank는 결정적 코드이므로 후보당 비용이 작지만, `AI-007`이 단계별 후보 수를 Trace에 남기도록 요구하므로 입력이 감사 가능한 크기여야 한다. P0 KB corpus 규모에서 20은 corpus의 약 10% 이하이고 최종 top 5의 4배다. Rerank가 뒤집을 여지를 주면서 Filter 입력을 묶어 둔다.

개발용 측정에서 관측된 `모든 정답을 담는 최소 k`의 최대값은 8이었다. 이 관측은 20이 비현실적이지 않다는 확인에만 사용하고 `k`를 관측값에 맞춰 정하지 않는다.

### 3.3 합격선

| 항목 | 기준 |
|---|---|
| 관련 unit Recall@20 | `= 1.00` (질문 전체) |
| 위험 핵심 unit Recall@20 | `= 1.00` |
| Provider Query HTTP P95 | `≤ 1,500ms` |
| 비용 | 실행일 고정 단가로 환산해 기록 |

1단계에서 빠진 근거는 이후 어떤 단계로도 복구할 수 없으므로 부분 회수를 허용하지 않는다. 이 기준은 기존 `Recall@5 ≥ 0.90`보다 `k`에서 느슨하고 허용 오차에서 엄격하다. 두 성질을 함께 표시하고 완화라고 부르지 않는다.

Recall@1·@3·@5·@10은 관측값으로 함께 기록하되 합격 판정에 쓰지 않는다.

## 4. `B-RETRIEVAL-01`: 종단 component

### 4.1 단계 계약

| 단계 | 입력 | 동작 | 결정성 |
|---|---|---|---|
| Metadata Filter | 질문의 대상 제약 | 기관코드·상품코드 정확 일치, 기준일이 적용 범위 밖인 문서 제외 | 결정적 |
| Keyword | Filter 통과 문서 | Postgres `tsvector` FTS | 결정적 |
| Vector | Filter 통과 문서 | 3절 계약의 Exact KNN, 후보 풀 20 | Provider 의존 |
| Rerank | 두 결과의 합집합 | `authority_level`·Freshness·Relevance 결정적 점수로 재정렬, `source_fingerprint`가 같은 문서는 하나로 계산 | 결정적 |

필드는 `docs/03-database-spec.md`의 목표 스키마를 그대로 따른다. `kb.knowledge_chunks.metadata`가 날짜·기관·상품 필터를, `search_vector`가 FTS를, `kb.source_snapshots`의 `authority_level`·`effective_from`·`effective_to`·`source_fingerprint`가 Rerank와 중복 출처 판정을 담당한다.

한쪽 단계가 비었다고 근거를 채워 넣지 않는다. Filter가 모든 문서를 제외하면 결과는 0건이며 안전 판정이 아니다.

### 4.2 합격선

기존 종단 기준을 그대로 적용하고 완화하지 않는다.

| 항목 | 기준 |
|---|---|
| Recall@5 | `≥ 0.90` |
| 위험 핵심 Recall@5 | `= 1.00` |
| Precision@5 | `≥ 0.80` |
| 모든 slice Recall@5 | `≥ 0.90` |
| 가족별 Precision@5 | `≥ 0.80` |
| Provider Query HTTP P95 | `≤ 1,500ms` |
| Filter가 정답을 제외한 건수 | `0` |
| 중복 `source_fingerprint`가 독립 근거 수를 늘린 건수 | `0` |

### 4.3 선행 조건

Keyword 단계는 실제 Postgres `tsvector` 경로를 써야 하므로 이 blocker는 `B-SUPABASE-01` 통과에 의존한다. 그 전에는 Filter·Vector·Rerank 부분만 개발용 데이터로 시험할 수 있고 그 결과를 `B-RETRIEVAL-01`의 `PASS`로 계산하지 않는다. 이 의존은 임계 경로를 늘리므로 일정 보고에 포함한다.

FTS를 Node 코드의 근사 구현으로 대체해 통과시키지 않는다.

## 5. v3 평가셋 설계

### 5.1 구성

- 새 시나리오 가족만 사용한다. v1·v2 가족·문서·질문을 재사용하지 않는다.
- Gate 20가족 100질문, 개발용 4가족 20질문으로 나눈다. 개발용 문서는 corpus의 혼동 문서로 남고 Gate 분모에 들어가지 않는다.
- 질문 구성은 다중 항목 80개(관련 unit 5개)와 단일 사실 20개(관련 unit 1개)로 v2와 같게 둔다. 산식 정의를 동일하게 유지해 해석을 단순화한다.
- 위험 질문 30개를 6가족에 배치한다. 위험 핵심 unit을 지정한다.
- Gate hard-negative unit 40개 이상을 둔다.

### 5.2 문서 필드

각 문서는 목표 스키마를 반영한 필드를 가진다.

| 필드 | 용도 |
|---|---|
| `institution_code`, `product_code` | Metadata Filter 대상 일치 |
| `effective_from`, `effective_to` | 기준일 적용 범위 |
| `authority_level` | Rerank 권위 축 |
| `source_fingerprint` | 재게시·복제 그룹 |
| `channel_type` | 공식 채널 질문 |
| `text` | 임베딩·FTS 입력 |

hard negative는 이름이 거의 같은 다른 기관, 대체된 과거 버전, 만료된 시점 자료, 인접 상품을 포함한다. 이는 v2에서 실제로 실패한 유형이다.

### 5.3 질문 필드

각 질문은 `relevant_units`, `critical_units`, `hard_negative_units`, 판정 이유인 `rationale`에 더해 대상 제약을 가진다.

| 필드 | 용도 |
|---|---|
| `target_institution_code`, `target_product_code` | Filter가 쓰는 대상 |
| `as_of_date` | Filter가 쓰는 기준일 |

대상 제약이 없는 질문은 Filter를 적용하지 않고 전체 corpus를 후보로 둔다. 제약이 있는데 Filter가 정답을 제외하면 실패다.

### 5.4 산식

산식 버전은 새로 붙인다. 정의는 v2와 같다.

- Recall@k = 질문별 `찾은 관련 unit 수 / 전체 관련 unit 수`의 평균
- 위험 핵심 Recall@k = 위험 질문별 `찾은 핵심 unit 수 / 전체 핵심 unit 수`의 평균
- Precision@5 = 전체 관련 hit 수 / `(5 × 질문 수)`
- 반환이 k 미만이면 빈 자리는 0점
- 누락·중복 질문, 빈 정답 집합, 알 수 없는 ID는 실패

### 5.5 표본 구성 상한

다중 항목 80개와 단일 사실 20개 구성에서 Precision@5의 이론적 상한은 `(80×5 + 20×1) / 500 = 0.84`다. 따라서 `Precision@5 ≥ 0.80`은 정답 칸 400개 이상, 즉 micro Recall 0.952 이상을 요구한다. 다중 항목 slice에서는 관련 unit 수와 top-k가 모두 5라서 Precision@5와 Recall@5가 같은 값이 된다.

이 제약을 알고 유지한다. 상한을 올리려고 단일 질문을 빼거나 관련 문서를 늘리지 않는다.

가족별 Precision `≥ 0.80`은 관련 칸 상한 21에 분모 25이므로 가족당 누락 1칸만 허용한다.

## 6. 지킬 것

- 이 문서가 병합되기 전에는 새 평가셋을 만들지도 측정하지도 않는다.
- 측정 뒤 합격선·라벨·질문을 결과에 맞춰 바꾸지 않는다.
- 여러 실행 중 최고 결과를 고르지 않는다.
- 후보 생성 결과를 종단 품질 합격으로 표시하지 않는다.
- 부분 spike를 blocker `PASS`로 계산하지 않는다.
- 합성 기관·상품·수치·날짜를 실제 공식 Source로 재사용하지 않는다.
- 평가셋 작성자가 내용을 알고 있으므로 독립 블라인드 평가라고 부르지 않는다. 같은 가족의 다섯 질문을 독립 사건으로 세지 않는다.

## 7. Claim 단위 재사전등록 (2026-09-05)

### 7.1 경위를 숨기지 않는다

3절과 5절은 그대로 둔다. 그 내용으로 v3·v4 를 측정했고 결과는 다음과 같다.

| 실행 | 구성 | 관련 unit Recall@20 | 판정 |
|---|---|---|---|
| v3 run `33954521524` | Filter 없음 (사전등록 구성 아님) | 0.902 | 기준선 관측 |
| v4 run `33955613801` | Filter → Exact KNN, 풀 20 | 0.970 | `FAIL` |

두 번 모두 다중 항목 질문에서만 빠졌고 단일 사실 질문은 1.00 이었다. ADR 15.1 의
미달 규칙에 따라 `최적화`를 택했다. 합격선·후보 풀 크기·Filter 계약은 바꾸지 않고
**질의 단위**를 바꾼다. 이것이 측정 결과를 본 뒤의 재구성이라는 사실을 제출 문서에
명시한다.

### 7.2 왜 Claim 단위인가

요구사항은 Intake 가 추출한 Material Claim 을 CoVe 가 `별도 질문·검색으로 독립
재검증`하도록 정한다. 근거 검색은 Claim 마다 일어나고, 여러 사실을 한 문장에 묶은
사용자 문단을 통째로 임베딩하는 경로는 제품에 없다. 3절·5절의 다중 항목 질문은
제품이 하지 않는 검색을 재고 있었다.

### 7.3 v5 질의 계약

- 질의 하나는 Claim 하나다. 사용자가 주장하거나 안내받았다고 말한 사실 한 문장이다.
- Claim 은 참·거짓·부분 참을 섞는다. gate 100개 중 참 ≥30, 거짓 ≥30 이다. 거짓
  Claim 의 관련 unit 은 그 Claim 을 반박하는 문서다. 잘못된 수치를 담은 Claim 이
  올바른 수치 문서를 회수하는지가 이 단계의 핵심 시험이다.
- Claim 마다 관련 unit ≥1, hard negative ≥2, 대상 기관·상품·기준일 필드를 둔다.
  5.2 문서 필드와 5.3 의 Filter 계약은 그대로 쓴다.
- Case 하나는 같은 입력에서 나온 Claim 5개다. Case 풀은 Claim 풀 5개의 합집합이며
  그 크기를 원장에 남긴다 (`AI-007` 단계별 후보 수).
- 5절의 `다중 항목 80 / 단일 사실 20` 구성은 적용하지 않는다. 모든 Claim 이 단일
  사실 질의다.

### 7.4 합격선

| 항목 | 기준 |
|---|---|
| Claim 별 관련 unit Recall@20 | `= 1.00` (gate 전체 macro) |
| Case 합집합 풀 Recall | `= 1.00` |
| 위험 핵심 unit Recall@20 | `= 1.00` |
| Query Provider P95 | `≤ 1,500ms` |

3.3 과 같다. 낮추지 않는다.

### 7.5 표본

- 새 시나리오 가족 24개. v1·v2·v3·v4 와 가족·문장을 재사용하지 않는다.
- gate 20가족 100 Claim, 개발용 4가족 20 Claim. 위험 6가족 30 Claim 에 핵심 unit.
- 가족당 문서 10개, corpus 240개. 다중 가족이 한 기관을 공유해 Filter 뒤 후보 공간이
  후보 풀 20 보다 크다. 계약 검사가 이를 강제한다.
- gate hard negative unit ≥40.

### 7.6 지킬 것

- 이 절을 병합한 뒤 v5 를 만들고, 그 뒤 한 번 측정한다.
- 측정 결과를 본 뒤 이 절의 합격선·산식·표본 구성을 바꾸지 않는다.
- v5 가 미달하면 ADR 15.1 로 돌아간다. 다시 질의 단위를 바꾸는 선택은 없다.

## 8. `B-RETRIEVAL-01` 측정 단위 확정 (2026-09-06)

### 8.1 무엇이 문제인가

7절이 질의 단위를 Claim 하나로 바꾸면서 gate 100 Claim 이 모두 단일 사실 질의가 됐고,
Claim 마다 관련 unit 이 정확히 1개다. `docs/ops/quality-evaluation-plan.md` 의 산식
`Precision@5 = sum_q(|T_q ∩ R_q|) / (5 × 질문 수)` 를 Claim 단위로 적용하면 이론상
최대값이 `100 / (5 × 100) = 0.200` 이다. ADR 15.1 의 종단 합격선 `Precision@5 ≥ 0.80`
은 어떤 파이프라인으로도 통과할 수 없다.

0.80 은 v2 구성(다중 항목 80 + 단일 사실 20, 이론상 최대 0.84)에서 도달 가능한지
먼저 확인하고 고정한 값이다. 7절의 재정의는 `B-EMBED-01` 의 후보 생성만 보고
이뤄졌고 종단 합격선이 같은 평가셋을 쓴다는 사실을 함께 보지 않았다. 측정을
시작하기 전에 발견했고, 발견 시점과 경위를 여기에 남긴다.

### 8.2 무엇을 정하는가

종단 top 5 의 측정 단위는 **Case** 다. 합격선은 바꾸지 않는다.

- Case 하나는 같은 입력에서 나온 Claim 5개다 (7.3).
- 단계 계약(4.1)은 Claim 마다 그대로 돈다. Filter·Keyword·Vector 는 Claim 별로
  실행하고 각 단계의 후보 수를 원장에 남긴다.
- Rerank 입력은 그 Case 에 속한 Claim 5개의 Keyword·Vector 결과 합집합이다.
  `source_fingerprint` 가 같은 문서는 하나로 계산한다 (4.1).
- 최종 top 5 는 Case 마다 하나다. Case 의 관련 unit 은 그 Case 에 속한 Claim 들의
  관련 unit 합집합이며 5개다. 따라서 `Precision@5` 의 상한은 1.00 이고 ADR 15.1 의
  `≥ 0.80` 은 낮추지 않은 채로 의미를 가진다.
- gate 는 20 Case 다. `Recall@5`·`Precision@5`·slice·가족별 지표를 Case 단위로 센다.
  위험 핵심 unit Recall@5 는 위험 6가족의 Case 를 분모로 한다.
- Claim 별 후보 생성 지표는 `B-EMBED-01` 의 것이며 이 blocker 의 합격 판정에
  쓰지 않는다. 반대도 마찬가지다.

### 8.3 왜 이 단위인가

ADR 5.2 와 15.2 는 종단 결과를 `최종 top 5` 로 부르고 단계별 후보 수를 함께
남기라고 정한다. 7.3 은 이미 `Case 풀은 Claim 풀 5개의 합집합이며 그 크기를 원장에
남긴다` 고 적었다. 제품이 사용자에게 보여 주는 근거도 Case 하나에 대한 묶음이다.
Case 단위 측정은 그 구조를 그대로 재는 것이며 합격선 완화가 아니다.

### 8.4 이 평가셋으로 잴 수 없는 것

v5 corpus 240개 문서의 `source_fingerprint` 는 모두 서로 다르다. 그래서 ADR 15.1 의
`중복 source_fingerprint 가 독립 근거 수를 늘린 건수 0` 은 이 평가셋에서 구조적으로
0 이며, 중복 제거가 실제로 동작한다는 증거가 되지 못한다. 파이프라인은 4.1 대로
중복 제거를 구현하고 원장에 fingerprint 묶음을 남기되, 그 수치를 통과한 시험으로
표시하지 않는다. v5 는 `B-EMBED-01` 채택 증거의 scope 파일이라 문서를 더하지 않는다.
복제 출처 처리의 실제 시험은 별도 평가셋이 필요하며 이 blocker 의 범위 밖이다.

### 8.5 지킬 것

- 이 절을 병합한 뒤에 측정한다. 측정 결과를 본 뒤 8.2 의 단위·산식·합격선을
  바꾸지 않는다.
- Case 단위가 미달하면 ADR 15.1 의 미달 규칙으로 돌아간다. 측정 뒤에 단위를 다시
  바꾸는 선택은 없다.
- 이 확정이 `B-EMBED-01` 채택 뒤에 이뤄졌다는 사실을 제출 문서에 명시한다.

## 9. Fast Provider 변경 뒤 v6 재평가 사전등록 (2026-09-08)

### 9.1 변경 사유와 이전 실패 보존

v5 종단 Gate는 main run `34027686263`과 `34029362670`에서 모두 미달했다. 두 번째
실행은 Recall@5·Precision@5가 각각 0.910이었지만 위험 핵심 Recall@5 0.967,
fees·freshness·mixed_name slice와 한 가족의 Precision 기준을 충족하지 못했다. 이
결과와 원본은 그대로 보존하며 새 측정으로 소급해 덮지 않는다.

ADR 15.1의 미달 절차에 따라 결정적 relevance 재정렬에서 Cohere
`rerank-v4.0-fast`로 Provider를 변경했다. 노출된 개발 split의 run `34128723611`은
변경 선택의 근거일 뿐 Gate 증거가 아니다. v6은 그 개발·Gate 가족과 문장을 재사용하지
않는다.

### 9.2 고정 평가셋

- 평가셋: `finshield-korean-finance-retrieval-fast-v6`
- 전부 Gate인 새 20가족·100 Claim·240문서, 위험 6가족
- 고유 `source_fingerprint` 220개와 재게시 중복 문서 20개. 각 가족에서 한 중복을
  실제 후보로 넣고 최종 독립 근거 수가 늘지 않는지 잰다.
- 가족마다 Claim 5개와 관련 unit 5개, 문서 12개를 둔다. 비슷한 기관, 만료 자료,
  미래 자료, 인접 상품, 비공식 홍보, 재게시를 hard negative로 포함한다.
- slice는 `channel`, `eligibility`, `fees`, `freshness`, `mixed_name`, `numeric`,
  `product`, `regulation`, `risk`다.

가족 ID는 다음과 같이 고정한다.

`guarantee_fee_refund`, `prepayment_waiver`, `variable_rate_reset`,
`grace_period_limit`, `bridge_loan_cost`, `refinance_cash_request`,
`consultant_deposit`, `remote_app_install`, `account_transfer_check`,
`loan_certificate_fee`, `collection_threat`, `credit_line_renewal`,
`mortgage_ltv`, `policy_loan_eligibility`, `student_repayment`,
`auto_loan_title`, `rent_deposit_guarantee`, `microcredit_rate`,
`debt_adjustment_effect`, `broker_disclosure`.

생성기는 `.github/scripts/generate-retrieval-fast-v6.mjs`, 커밋된 결과는
`.github/fixtures/retrieval-fast-v6.json`이다. 계약 시험이 두 값의 byte-equivalent
구조와 규모·중복·정답 참조를 검사한다. 이 평가셋에는 개발 split이 없다.

### 9.3 고정 파이프라인과 입력 경계

1. 기관과 기준일 Metadata Filter를 적용한다.
2. 실제 Postgres FTS Keyword 20개와 Cohere `embed-v4.0` 1024차원 Exact KNN
   Vector 20개를 만든다.
3. 합집합 최대 40개를 Cohere `rerank-v4.0-fast`에 보낸다.
4. Fast relevance 0.60, Authority 0.25, Freshness 0.15를 합성하고 같은
   `source_fingerprint`를 하나로 접는다.
5. Claim마다 최고 후보 한 자리를 먼저 보장한 뒤 Case top 5를 확정한다.

Fast 질의는 최대 8,192 bytes, 문서는 각 32,768 bytes, 문서당
`max_tokens_per_doc=4096`으로 고정한다. Claim 하나에 Embed 1회와 Fast 1회를 쓰며,
문서 Embed 3 batch를 포함해 전체 Provider 요청은 203회다. 요청 ID 원문은 저장하지
않고 고유 개수와 SHA-256만 남긴다.

### 9.4 합격선과 비용

기존 품질 합격선을 낮추지 않는다.

| 항목 | 기준 |
|---|---|
| Recall@5 | `>= 0.90` |
| 위험 핵심 Recall@5 | `= 1.00` |
| Precision@5 | `>= 0.80` |
| 모든 slice Recall@5 | `>= 0.90` |
| 가족별 Precision@5 | `>= 0.80` |
| Claim Embed+Fast 합산 Provider P95 | `<= 1,500ms` |
| Fast 단독 P95 | `<= 1,500ms` |
| Filter 정답 제외 | `0건` |
| 중복 fingerprint의 독립 근거 증가 | `0건` |
| 총 Provider 비용 | `<= USD 0.25` |

Fast는 Claim당 search unit 1개, 전체 100개를 정확히 기록하며 현재 고정 단가로
USD 0.20이다. Embed 과금 입력 token과 비용을 합쳐 총액 상한을 검사한다. 사용자가
승인한 제품 검증 예산 범위이며 과금 단위가 불명확하면 성공 artifact를 만들지 않는다.

### 9.5 실행과 실패 보존

- 이 절·평가셋·harness·정책·trusted SHA가 main에 먼저 병합되기 전에는 Provider를
  호출하지 않는다.
- main 첫 attempt에서 한 번만 실행한다. workflow에는 개발 모드나 평가셋 선택 입력을
  두지 않는다.
- 정책 미달·timeout·응답 형식 오류·DB 오류면 결과 artifact를 만들지 않고 실행 로그와
  실패 run을 보존한다. 같은 v6을 튜닝해 다시 통과시키지 않는다.
- 통과하더라도 원본 artifact의 `A=W`, scope digest, TTL과 실제 artifact 존재를 확인한
  별도 Adoption PR 전에는 `B-RETRIEVAL-01`을 `PASS`로 바꾸지 않는다.
