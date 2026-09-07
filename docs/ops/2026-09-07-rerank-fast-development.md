# 승인된 Fast 개발 시험 사전등록

요구사항 AI-007·N-OPS-003, 전체 미완료 추적 #190. 사용자가 Cohere 학습 사용 끄기와 합성 Fast 개발 시험 최대 USD 0.05를 승인했다. 대시보드의 학습 사용을 Off로 바꾸고 새로 연 페이지에서 Off를 확인했다. 현재 계정 설정 확인이며 DPA·보존·배포 Key의 소속 증명을 대신하지 않는다.

개발용 v5의 4가족 20 Claim만 측정한다. 문서 240개의 Embed v4.0 1024차원 → 기관·기준일 Metadata → 실제 Postgres Keyword → Exact KNN Vector 후보 20과 Keyword 후보 20의 합집합 최대 40 → Fast relevance 순서다. 기존 Case 자리 배분과 source fingerprint 중복 제거, Authority·Freshness는 유지한다. 최종 점수는 Fast relevance 0.60 + Authority 0.25 + Freshness 0.15로 실행 전에 고정한다. 같은 후보에 기존 결정적 점수를 적용한 개발 결과도 함께 보존한다. 기존 두 차례 실패 Gate는 재측정하지 않는다.

Cohere 공식 [가격](https://cohere.com/pricing)과 [Rerank 처리 문서](https://docs.cohere.com/docs/reranking-best-practices)를 확인했다. Fast는 1,000 search units당 USD 2, 한 단위는 최대 100문서다. 이 시험의 각 문서·질의는 UTF-8 512바이트 이하, 합집합 후보 40개 이하로 강제하고 긴 문서 분할은 사용하지 않는다. Embed의 입력 토큰 비용까지 USD 0.05에 포함한다. 과금 사용량이 없거나 timeout/5xx이면 예약을 보존하고 중단한다. 성공한 표본만 재실행하거나 25단위를 넘기지 않는다.

원본 JSONL 원장을 호출 전 fsync하고 실제 과금 단위·지연·결과를 추가한다. 실패해도 artifact를 보존한다. GitHub main의 고정 SHA, 첫 실행·첫 attempt만 허용하며 이전 dispatch가 있으면 새 호출을 막는다. 키는 기존 provider-spike 환경에서만 읽고 출력하지 않는다. 일일 원장의 현재 사용·예약액을 매 호출 전에 읽어 합성 시험 예상액과 합산해 USD 0.50을 넘으면 거부한다. 운영 DB 원장은 읽기만 하며 개발 비용 원장은 artifact에 남긴다. 이 방식은 격리된 일회 시험의 한도이고 운영 다중 인스턴스 합산 예약의 증거가 아니다. 이 작업 중 다른 유료 모델 시험을 동시에 실행하지 않는다.

결과는 개발 진단이다. PASS·Adoption Evidence를 만들지 않고 제품의 결정적 Rerank도 바꾸지 않는다. 새 독립 가족과 사전등록 Gate, Provider 변경 ADR 결정은 개발 결과를 확인한 뒤 별도 처리한다.

호출 전 모의 통합 시험에서 기존 SQL이 각 단계 20개를 합쳐 최대 40개를 반환한다는 사실을 확인했다. 첫 모의 실행의 20개 합집합 제한은 CANDIDATE_POOL_INVALID로 중단됐다. 두 단계의 후보를 잘라 버리지 않도록 합집합 한도만 40으로 맞췄다. 실제 Provider 호출 이전 수정이며 단계별 후보 20과 기존 검색 계약은 유지한다.

실제 격리 PostgreSQL에 모의 Embed/Fast를 연결한 시험은 43개 모의 요청으로 20 Claim·4 Case까지 종결했다. 계약 시험과 기본 테스트 449건, lint·build를 통과했다. 선택적 85건은 건너뛰었고 여기까지 실제 Provider 호출은 0건이다.
