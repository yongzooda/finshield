# FinShield 품질 평가 경계와 선행 시험

관련: N-QLT-003~010, AI-006~012, EV-004~016, CLM-004, RES-003. 이 문서는 Spike·Fixture 설계이며 제품 기능 완료 증거가 아니다. Gate의 정본은 ADR metadata다.

## 1. 단계별 증명 범위

| 단계 | 지금 또는 실행 전 고정할 내용 | 통과로 주장할 수 없는 것 |
|---|---|---|
| B-MODEL-01 | 구조화 출력·strict tool·오류 adapter·지연·비용 | 금융 사실 판정 정확도 |
| B-EMBED-01 | 고정 corpus의 질의별 관련 Evidence unit·위험 핵심 unit 검색, raw rank 재계산 | 실제 공식 Source 최신성, Hybrid RAG, 최종 Claim 정확도 |
| B-SPIKE-01 | 선행 blocker 준비 뒤 실제 component 경로·fault·terminal·비용·삭제 원장 | Auth/UI 포함 제품 전체 완료 |
| P0 Claim 평가·Release | 같은 입력·출처 버전의 Claim 정답과 E2E·Policy assertion, 다른 기기 결과 조회 | 미지원 상품·입력 또는 미래 무결함 보장 |

NO-GO 동안 실제 제품 UI를 먼저 완성하지 않는다. 지금은 합성 평가 데이터·산식·실행 계약을 준비하며, 실제 파이프라인이 생기면 UI 마감 전에 실패 안전성을 확인한다. B-SPIKE를 앞선 Provider·보안 blocker 대신 실행하지 않는다.

## 2. Embedding v2 재설계 이력

v1 run 33861971976은 Recall 0.61, 위험 핵심 0.7333333333333333, Precision 0.58로 실패했다. v1은 직접 반박 근거의 오답 라벨, 동일 core 다섯 복제, 임의 primary ID hit 산식, 좁은 coverage가 있어 성능 추정에 사용하지 않는다. 원본 fixture와 실패 이력을 보존한다. v2로 v1 수치를 재채점해 PASS로 바꾸지 않는다.

v2는 24개 합성 시나리오 가족, 각 7개 서로 다른 문서 passage, 120개 질문이다. 20가족 100질문을 Gate용 미측정 집합으로 고정하고 4가족 20질문을 개발용으로 분리한다. 질의당 직접 답하는 unit과 제외할 혼동 문서를 ID로 명시한다. 개발용 질문은 Live Gate 분모와 Provider query 호출에 넣지 않지만 그 문서는 전체 corpus의 distractor로 남긴다.

- 80개 다중 항목 질문은 서로 다른 다섯 사실을 요구한다. 같은 core를 다섯 번 복제하지 않는다.
- 20개 단일 사실 질문은 정답이 하나다. 같은 상품의 다른 사실을 Precision을 올리기 위한 정답으로 승격하지 않는다.
- 전체 168 passage에서 검색하며 Gate용 hard-negative unit은 40개, 위험 질문은 6가족 30개다.
- 단일 passage/fact의 복제는 같은 `unit_id`로 묶는다. 한 계약의 다섯 passage는 다섯 검색 unit일 수 있지만 다섯 독립 출처가 아니다. `source_family`를 보존한다.
- 합성 상품·기관·금리·날짜·`.example` URL은 실제 상품 사실이나 공식 Snapshot이 아니다. 금융 조언·Demo Source·KB 적재에 재사용하지 않는다.
- 현재/과거 날짜 구분은 임베딩이 읽는 합성 문장 기준이다. Metadata Filter·실제 Snapshot 유효성은 후속 Hybrid/Source 시험에서 따로 검증한다.

평가셋 작성자가 내용을 알고 있으므로 독립 블라인드 평가라고 부르지 않는다. 동일 가족의 다섯 질문도 통계적으로 독립인 다섯 사건이 아니다. 외부 일반화 정확도나 신뢰구간을 100개 독립 사건처럼 발표하지 않는다. 자동 schema 검사는 의미상 정답 여부를 보증하지 않는다.

## 3. 정답 판정 규칙과 검토 기록

질문이 요청한 사실에 직접 답하는 지지·반박 문장은 모두 relevant다. 주장에 반대한다는 이유로 hard negative로 지정하지 않는다. 같은 주제라는 이유만으로 relevant로 지정하지도 않는다. 다른 대상·지정 시점 밖 자료·요청하지 않은 사실은 nonrelevant다. 질의에 비교 자체가 포함되면 비교 대상의 문서도 답이 될 수 있어 별도로 검토한다.

이번 작성 검토는 전 24가족의 168문서·120질문을 대상으로 위 규칙을 적용했다. 질의별 선택 이유는 fixture의 `rationale`에 있다. 기관명 비교 질문은 비교 대상 문서를 잘못 배제하지 않도록 해당 기관코드를 묻는 질문과 구분했다. 발신번호 조작, 승인 뒤 중개비, 검색광고 공식성 반박은 관련 근거로 보존하고 회귀 assertion을 둔다. 이는 저장소 내부 작성·자체 검토이며 외부 전문가 검토 완료 기록이 아니다.

새 Live 실행 전에 PR에서 다음을 확인한다.

1. 질문의 모든 요청 항목을 정답 passage가 실제로 답하는지, hard negative가 직접 답하지 않는지 확인한다.
2. 식별자·숫자·부정어·시점·혼합 기관명·위험 6가족 및 짧은 질의가 빠지지 않았는지 확인한다.
3. corpus·qrels·산식·harness hash를 commit으로 고정한 뒤 main에서만 실행한다.
4. Gate 결과를 본 뒤 같은 평가셋에 맞춰 표현·라벨·검색을 조정하지 않는다. 해당 집합은 노출된 회귀셋으로 취급하고 변경 사유와 모든 실패를 남긴다. 새 성능 선택에는 새 시나리오 가족으로 고정한 미측정 평가셋이 필요하다.
5. 실패 원인이 Provider/전송인지 평가 의미인지 구분한다. 점수를 올리기 위한 문서 복제·불리한 질문 제외·기준 완화·반복 실행 중 최고 결과 선택을 금지한다.

Runner는 Provider 호출 전에 GitHub dispatch 이력과 과거 commit의 fixture Blob SHA를 검사해 같은 v2 파일의 재사용·run attempt 2 이상을 차단한다. 이전 dispatch가 설치·전송 단계에서 실패했어도 보수적으로 소비된 집합으로 취급한다. 권한 오류·불완전 이력·1,000개 초과 이력은 fail-closed한다. 이 통제도 저장소 수준이며 삭제된 Actions 이력이나 권한자의 파일 변경을 외부에서 증명하지 못한다. 공백·라벨만 바꿔 hash를 갱신하는 우회는 허용하지 않고 새 시나리오 가족의 내용 검토가 필요하다.

## 4. 검색 지표와 해석

산식 버전은 `query-macro-unit-recall-v2`다. `R_q`는 질문별 관련 unit 집합, `C_q`는 그 부분집합인 위험 핵심 unit, `T_q`는 Exact cosine 순위의 중복 unit 제거 후 상위 5개다.

- Recall@5 = mean_q(|T_q ∩ R_q| / |R_q|), 기준 ≥0.90.
- 위험 핵심 Recall@5 = 위험 질문에 대한 mean_q(|T_q ∩ C_q| / |C_q|), 기준 =1.00.
- Precision@5 = sum_q(|T_q ∩ R_q|) / (5 × 질문 수), 기준 ≥0.80. 5개 미만이면 빈 자리는 0점이다.
- Provider HTTP P95 ≤1,500ms. 시작 간 pacing 대기와 Exact KNN 시간을 분리한다. 제품 종단 지연과 동일하지 않다.
- qrels가 비었거나 질의가 누락·중복되면 분모에서 빼지 않고 실패한다. 결과의 임의 PASS나 집계값은 신뢰하지 않고 신뢰된 fixture와 ID/score 원장을 재계산한다.

Recall은 관련 항목 중 찾은 비율, Precision은 반환 항목 중 관련 비율이라는 [IR 기본 정의](https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-unranked-retrieval-sets-1.html)를 따른다. v1의 지정 primary hit와 다르므로 v1/v2 점수를 성능 개선 전후처럼 비교하지 않는다. 상위 합격 수치와 Provider·dimension·cosine·Exact KNN 선택은 변경하지 않는다.

v2의 완벽한 순위도 단일질문 20개 때문에 Precision 최고값은 (80×5 + 20×1)/500 = 0.84다. 이론상 가능한 기준인지 먼저 확인했으며 0.80을 낮추거나 관련 문서를 추가하지 않는다. 전체 통과에는 적어도 400/500 relevant hit가 필요하다. 표본 구성이 매우 엄격하다는 한계를 공개하고, 실제 실패를 봐도 단일질문을 제거하지 않는다. 다중 항목 질문은 관련 unit 수와 top-k가 모두 5라서 해당 slice의 Precision@5와 Recall@5가 항상 같은 값이 된다. 두 지표를 독립된 두 축으로 읽지 않는다. 단일질문 20개가 만점이라고 가정하면 Recall 0.90은 정답 칸 370, Precision 0.80은 정답 칸 400을 요구하므로 v2에서는 Precision 선이 더 엄격하다. 가족별 Precision 0.80은 관련 칸 상한 21에 분모 25이므로 가족당 누락 허용치가 1칸이다. 실측 분해는 [v2 실패 원인 분해](provider-embed-failure-analysis.md)에 있다.

전체 수치만 공개하지 않는다. 보존한 query별 counts에서 단일/다중, 시나리오 가족, numeric/mixed_name/freshness 등 slice와 각 slice의 위험 핵심 Recall을 함께 재계산한다. v2의 추가 사전등록 조건으로 모든 slice의 Recall ≥0.90, 각 가족의 Precision ≥0.80을 요구해 특정 가족의 실패가 전체 평균에 가려지지 않게 한다. 단일 질문 slice의 Precision 상한은 0.20이므로 이 slice에 0.80을 잘못 적용하지 않는다. 위험 표본이 없는 slice는 위험 지표를 null로 표시한다. 위험 핵심 누락은 평균으로 상쇄하지 않는다. 품질 문제가 있으면 B-EMBED-01을 해제하지 않는다.

## 5. 최종 서비스 평가 계약

파이프라인 품질은 검색 결과 존재 여부와 별도로 시험한다. 아래 기대 동작을 합성 Claim fixture에 고정하고 실제 pipeline 실행 결과와 비교한다. 단위 테스트의 가짜 판정 출력을 제품 정확도로 집계하지 않는다.

| 사례 | 필수 검증 |
|---|---|
| 정상·직접 공식 근거 | 올바른 Claim 상태·Typed Citation; 모든 질문을 보류해서 안전성 시험만 통과하지 않음 |
| 숫자·단위·부정 표현 변조 | 원문 의미 보존, 반박 근거 연결; 숫자 하나만 다른 상품을 확정 근거로 쓰지 않음 |
| 다른 상품·기관·시점 | 높은 vector 유사도만으로 VERIFIED/CONTRADICTED 금지; Structured Lookup·대상·날짜 확인 |
| 공식 출처 충돌 | CONFLICT 및 양쪽 근거 보존, 다수결·평균 금지 |
| 검색 0건·미지원·경고 없음 | UNKNOWN; 안전 또는 부존재 판정 금지 |
| 사용자 정보 부족 | NEED_MORE_INFORMATION; 다른 검증 가능 Claim은 계속 |
| 유사 분쟁·사기 경보 | reference_only; 현재 거래의 사기·위법 확정 금지 |
| 복제 출처 | independent evidence 증가 0; 원문 fingerprint 그룹 유지 |
| OCR 숫자·부정어 오류 | 미확인 자동 확정 금지, 사용자 대조·부분실패 보존 |
| CoVe·Red Team 장애·Provider timeout | 영향 Claim 보류, 확보 Evidence·비용·terminal 원장 보존 |
| Injection·미등록 Citation | 역할·Tool 권한 불변; 없는 출처·URL·수치 저장/표시 0 |

N-QLT-004의 분자·분모는 실행 전에 고정한다: Claim extraction은 정답 원자 Claim과 추출 Claim의 대응 precision/recall 및 숫자·부정어 exact, verification precision은 올바르게 확정한 Claim/확정한 Claim, unsupported rate는 적격 근거 없는 확정/확정한 Claim, coverage는 충족 필수 Material 항목/전체 필수 항목, conflict·abstention은 상태별 confusion matrix, 정상 오탐은 정상 사례의 근거 없는 위험 판정/정상 사례다. 분모 0은 PASS 또는 100%가 아니라 N/A이며 해당 상태의 표본 누락은 평가 실패다.

근거 없는 확정·유사사례 오용·경고 부재 오용·허위 Citation 등 요구사항의 금지 동작은 시험에서 0건이어야 한다. 그 외 통계 지표의 표본 배분·수용값은 실제 Claim 평가셋과 함께 별도 사전등록 PR에서 확정하며, 미확정 상태를 서비스 품질 합격으로 표시하지 않는다. LLM_ONLY/RAG/RAG_COVE/FULL은 같은 정답·입력·Snapshot 버전·Case 전체를 사용하고 불리한 사례를 제외하지 않는다. FULL이 유리하다고 미리 가정하지 않는다.

이 절의 계약은 ADR의 Release blocker `B-CLAIM-01`이 강제한다. 금지 동작 0건은 이미 고정된 합격선이고, 통계 지표의 표본 배분과 수용값은 실제 평가셋과 함께 별도 PR에서 사전등록한다. Implementation Gate를 `GO`로 바꾸려면 그 사전등록이 먼저 끝나야 한다. 기능을 만든 뒤 판정 품질을 처음 정의하지 않는다는 뜻이다.

B-EMBED 통과, CI 초록색, UI 완성 중 어느 것도 이 Claim 평가나 Release Gate를 대신하지 않는다. 9월 7일 목표보다 이 검증이 늦어지면 일정 위험을 보고하고 미완료 상태를 유지한다.
