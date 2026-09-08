# Cohere Fast 제품 Retrieval 결정

기준일: 2026-09-08  
관련 요구사항: `AI-007`, `D-008`, `D-009`, `N-OPS-003`, `N-QLT-010`  
관련 이슈: #278

## 결정

두 번의 `B-RETRIEVAL-01` Gate에서 결정적 relevance 재정렬이 위험 핵심 Recall 0.967과 fees·freshness·mixed_name slice 기준에 미달했다. 같은 Gate에 계속 맞추지 않는다는 사전등록 절차에 따라 Provider 변경을 선택한다.

제품 검색은 `Metadata Filter → Postgres Keyword → Cohere embed-v4.0 Exact KNN → Cohere rerank-v4.0-fast → Authority/Freshness/Fingerprint` 순서로 실행한다. Keyword와 Vector 후보는 각각 20개이며 합집합 최대 40개를 Fast에 전달해 최종 5개를 고른다. Fast는 relevance만 계산한다. 공식 자료 범위, 기준일, 권위, 적용 시점, 같은 원문의 중복 제거는 코드와 DB의 결정적 정책으로 남는다.

개발 split의 512바이트 제한은 해당 fixture의 고정 조건이며 제품 입력 상한으로 재사용하지 않는다. 제품은 확인된 Claim 입력 2,000자와 DB Chunk 운영 상한 32KiB 안에서만 Fast를 호출하고, Cohere의 [Rerank v4 입력·Chunk 공식 사양](https://docs.cohere.com/docs/reranking-best-practices)에 맞춰 `max_tokens_per_doc=4096`을 Manifest와 코드 검토 범위에 포함한다.

개발 split 4가족·20 Claim의 run `34128723611`은 Fast macro Recall·Precision 1.00, P95 382ms, Embed 포함 USD 0.040829였다. 이 값은 변경 선택의 근거이며 Gate PASS가 아니다. 노출되지 않은 새 가족과 기존 합격선을 먼저 고정하고 main에서 한 번 측정해야 한다.

## 실패와 비용 경계

- Embed 또는 Fast가 실패하면 기존 Keyword·Vector 또는 Keyword 순서를 참고 결과로 보존할 수 있지만 Tool 원장에는 `RETRIEVAL_DEGRADED`와 구체 이유를 남긴다.
- timeout·5xx·응답 유실처럼 과금 여부가 불명확하면 예약을 유지하고 자동 재호출하지 않는다.
- Fast 상한은 Global day USD 2.00, Owner day USD 0.50, Case USD 0.50, Run USD 0.10이다. 전체 Provider 합산 상한도 함께 적용된다.
- Cohere 대시보드의 학습 사용 Off는 확인했지만 DPA·ZDR·region·하위처리자 계약 채택을 대신하지 않는다. 그 계약이 채택되기 전까지 실제 개인정보 입력 허용 근거로 쓰지 않는다.

## 배포 조건

실행 Manifest v8과 비용 함수는 Migration 0052에 있다. 실제 FinShield DB에 0045·0050·0051·0052를 순서대로 적용하고 `COHERE_API_KEY`를 Production에 등록하기 전에는 새 제품 경로를 Production 완료로 표시하지 않는다. `B-RETRIEVAL-01`은 새 평가와 별도 Adoption PR 전까지 `NOT-EVALUATED`다.
