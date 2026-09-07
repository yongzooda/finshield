# Cohere 계정 관측과 검색 변경 검토

이 기록은 `B-PROCESSOR-PRIVACY`·`B-RETRIEVAL-01`의 남은 결정을 구체화한다. 기존 ADR의 Provider·검색 범위·합격식을 바꾸거나 Gate를 채택하는 문서가 아니다.

## 실제 계정 관측

2026-09-07 로그인된 Cohere Dashboard의 Data Controls에서 학습 사용 허용 스위치가 On인 것을 확인했다. 설정은 변경하지 않았다. Billing에는 최근 7일의 유료 Embed와 Trial Embed 사용 행이 모두 있었지만 이 화면만으로 배포 Secret과 계정의 연결을 검증한 것은 아니다. 개인 이름·청구 수단·키·원문은 저장하지 않고 `evidence/development/privacy/2026-09-07-cohere-settings.json`에 관측 범위만 남겼다.

계정 전체의 학습 사용을 Off로 바꾸는 것이 제안이다. 같은 계정의 다른 프로젝트에도 영향을 주고 변경 이후 자료에 적용되므로 사용자 결정을 받는다. 과거 전송의 소급 삭제나 ZDR 활성화로 표현하지 않는다.

[공식 데이터 약속](https://cohere.com/enterprise-data-commitments)은 학습 제외 설정과 별개로 기본 로그 30일 및 법적·보안 예외를 설명한다. ZDR은 별도 승인이 필요하고 DPA는 제공 요청 대상이다. 이 계정의 서명된 DPA·ZDR·처리 region·하위처리자 조건은 아직 확인하지 못했다. 실제 사용자 입력 전송은 계속 허용하지 않는다. Anthropic·CLOVA·Supabase·Vercel의 전체 계약 검증도 남아 있다.

## 검색 변경 대안

기존 gate는 두 차례 미달했다. `retrieval-spike.md`의 재평가 제한을 유지하고 실패셋에 다시 맞추지 않는다.

| 대안 | 요구사항·구현 영향 | 비용·검증 영향 |
|---|---|---|
| 현재 금융 범위 + Cohere Rerank Fast 후보 | AI-007의 네 단계를 유지하고 relevance 산출을 모델로 교체한다. 기관·시점·권위·fingerprint는 명시적 정책으로 유지한다. ADR의 결정적 Rerank 선택 변경이 필요하다 | 검색 API 호출·기한·예약/정산이 추가된다. 품질 개선은 아직 가설이며 독립된 새 가족·회귀 원장과 사전등록 합격식이 필요하다 |
| 현재 금융 범위 + Cohere Rerank Pro 후보 | 같은 경계에서 더 큰 모델을 비교할 수 있다 | Fast보다 공식 검색 단가가 높다. 먼저 여러 모델을 평가셋에 반복해 맞추는 방식은 사용하지 않는다 |
| 검증 가능한 상품·기관·상황으로 범위 축소 | 통합 요구사항·제품 계획·ADR·안내의 범위 변경이 필요하다 | 범위 밖 금융 권유는 미지원 처리해야 한다. 어려운 실패 가족만 빼서 기존 수치를 높이는 변경은 허용하지 않는다 |

첫 제안은 금융 범위를 유지한 Fast 후보의 개발 전용 검증이다. 현재 Embed 후보 풀 20을 유지하고, 변경된 relevance와 Authority/Freshness 조합은 실제 측정 전에 고정한다. 기존 평가셋은 회귀 이력이며 새 Gate로 재사용하지 않는다. 새 평가셋의 가족·문서·정답·hash, 개발/holdout 분리, 실패·모호 응답·중복·과거판 금지 기준까지 등록한 뒤 한 번 측정한다. 지금은 후보 제안이며 채택이나 품질 통과가 아니다.

## 예상 비용과 결정 범위

공식 [가격 페이지](https://cohere.com/pricing)의 Advanced retrieval models 탭에서 Fast는 1,000 search당 USD 2.00, Pro는 USD 2.50을 확인했다. 따라서 100 search unit이면 각각 USD 0.20·0.25다. 요청 수와 search unit은 같다고 가정하지 않는다. 긴 문서의 청구 단위와 실제 응답의 사용량을 확인하고 호출 전 상한을 예약해야 한다. 문서 처리 권고는 [공식 Rerank 문서](https://docs.cohere.com/docs/reranking-best-practices)를 따른다.

개발 후보 20 Claim의 Fast 시험은 최대 25 search unit·USD 0.05로 제한하는 안을 준비했다. 기존 합성 전용·일일 예산 안의 잔여액을 먼저 확인하고 부족하면 실행하지 않는다. 새 평가 Gate 비용·실제 사용자 데이터 허용·유료 플랜 변경·새 계약 수락은 이 개발 후보 결정에 포함하지 않는다. 모델 추가와 ADR 변경이므로 승인 전에 호출하거나 검색 구현을 교체하지 않는다.
