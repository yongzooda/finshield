# 2026 금융 AI Challenge 서비스 기획서

# FinShield

## Evidence-Verified Multi-Agent 금융 의사결정 생애주기 검증 플랫폼

> **돈을 움직이기 전에, 근거부터 확인하세요.**

---

## 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | FinShield 최종 서비스 기획서 |
| 문서 상태 | 개발 기준선(Baseline) |
| 버전 | v1.0 |
| 작성일 | 2026-09-02 |
| 대상 공모전 | 2026 금융 AI Challenge |
| 기존 자산 | PreCase 저장소·데이터·도구·안전 설계 |
| 핵심 범위 | 거래 전 검증 + 가입 후 PreCase 보호 |

이 문서는 FinShield의 서비스 목적, 범위, 사용자 흐름, 핵심 기능, AI 구조, PreCase 통합 방식, 데이터·보안 원칙, MVP 우선순위를 확정하는 기준 문서다. 상세 API 요청·응답, 컬럼 정의, 화면 컴포넌트와 테스트 케이스는 후속 명세서에서 관리한다.

---

# 1. 서비스 요약

## 1.1 한 줄 정의

**FinShield는 금융소비자가 대출·저축성 금융상품·투자 권유를 실행하기 전 입력한 금융정보를 Claim으로 구조화하고, 전문 AI Agent들이 공식 상품·기관·공시·법령·분쟁 근거와 개인 적합성을 조사한 뒤 RAG·CoVe·Red Team·Evidence Policy로 재검증하며, 결과를 Evidence Passport로 저장하고 실제 가입 후에는 PreCase로 이어서 보호하는 계정 기반 금융 의사결정 생애주기 검증 플랫폼이다.**

## 1.2 핵심 질문

> **“내가 지금 하려는 이 금융거래와 정보, 어디까지 믿고 진행할 수 있는가?”**

기존 금융서비스가 주로 “어떤 상품이 좋은가?”를 다룬다면 FinShield는 그보다 앞선 “이 거래와 정보 자체를 믿을 수 있는가?”를 다룬다.

## 1.3 핵심 가치

1. 금융정보의 진위성과 거래 위험을 실행 전에 확인한다.
2. 정상 상품이라도 사용자의 상황에 적합한지 별도로 확인한다.
3. 모든 핵심 판단을 Claim과 Evidence 단위로 설명한다.
4. AI가 만든 초기 판단을 CoVe와 Red Team이 독립적으로 재검증한다.
5. 근거가 부족하거나 충돌하면 확정하지 않고 보류한다.
6. 가입 후에는 PreCase가 설명 적정성·이해도·분쟁 준비를 이어서 관리한다.

---

# 2. 기획 배경

금융소비자는 문자, 카카오톡, 전화, 영업점, 웹페이지, 상품설명서, 투자제안서 등 다양한 채널에서 금융정보를 접한다. 하지만 해당 정보를 검증하려면 다음 내용을 서로 다른 서비스에서 찾아야 한다.

- 금융회사 또는 기업의 실재 여부
- 금융상품의 존재 여부
- 실제 금리·한도·수익률·우대조건
- 공식 URL·전화번호·판매 채널 여부
- 선입금·앱 설치·원격제어 등 위험 신호
- 소비자경보와 유사 금융사기 유형
- 관련 법령·약관·분쟁조정 사례
- 개인의 상환능력·유동성·위험감수 수준

일반 소비자가 이를 직접 수집하고 출처의 권위성과 최신성까지 비교하기는 어렵다. 특히 금융정보의 오류는 단순한 검색 실패가 아니라 송금·대출·투자·상품 가입으로 이어져 직접적인 금전 손실을 일으킬 수 있다.

생성형 AI만 사용하는 경우 다음 문제가 발생할 수 있다.

- 존재하지 않는 상품·조건을 생성하는 Hallucination
- 변경된 금리·공시·규정의 최신성 문제
- 답변이 어느 근거에서 나왔는지 알 수 없는 Source Ambiguity
- 초기 결론을 지지하는 정보만 찾는 Confirmation Bias
- 검색 단계 오류가 최종 결론까지 전파되는 Error Propagation

FinShield는 AI에게 모든 판단을 맡기는 대신 AI의 판단 자체를 근거와 정책으로 다시 검증한다.

---

# 3. 공모전 적합성

2026 금융 AI Challenge는 AI 기반으로 금융 현안을 해결하고 이를 실제 작동 가능한 웹서비스로 구현하는 것을 요구한다. FinShield는 다음 측면에서 공모전 주제와 부합한다.

- 금융소비자 보호라는 명확한 금융 현안을 해결한다.
- 문자·이미지·PDF·URL 등 실제 서비스 채널을 고려한다.
- AI가 비정형 정보 이해, Claim 추출, Agent 선택, 검색, 비교, 반증 탐색, 설명을 수행한다.
- RAG·Vector DB·Multi-Agent·CoVe·Red Team을 핵심 기능에 사용한다.
- 결과의 정확성뿐 아니라 근거·보류·실패 상태를 제공한다.
- PreCase의 실제 데이터와 검증 자산을 재사용하여 구현 가능성을 높인다.

---

# 4. 서비스 목표와 비목표

## 4.1 목표

- 사용자가 접한 금융 권유의 사실성과 위험을 거래 전에 검증한다.
- 개인의 금융 상황과 상품 특성을 비교해 적합성을 설명한다.
- Claim별 공식 근거, 충돌, 미확인 상태를 투명하게 제공한다.
- 검증 결과와 근거를 계정에 영구 보관한다.
- 공식 근거 변경 시 영향을 받은 Claim을 재검증한다.
- 가입 후에는 PreCase 기능으로 소비자보호 여정을 연속적으로 관리한다.
- 신뢰센터에서 실제 평가 결과와 한계를 공개한다.

## 4.2 비목표

MVP에서는 다음 기능을 제공하지 않는다.

- 금융상품 순위·추천·판매
- 사용자를 대신한 가입·송금·투자 실행
- 신용점수 또는 사기확률처럼 보이는 임의의 0~100 점수
- 실시간 주식·가상자산 매매 신호
- 모든 국내 금융상품의 범용 검증
- 범용 금융 챗봇·뉴스·자산관리 대시보드
- Open Banking 기반 실제 계좌 연결
- 법률·금융 전문가를 대체하는 확정적 조언

---

# 5. 핵심 사용자

## 5.1 Primary Target

- 문자·메신저·전화로 대출 권유를 받은 사용자
- 저축성 금융상품의 실제 조건을 확인하고 싶은 사용자
- 투자제안서 또는 비상장 투자 권유를 받은 사용자
- 검색한 금융정보의 사실성을 판단하기 어려운 사용자
- 자신의 상황에서 금융상품이 적절한지 판단하기 어려운 사용자

## 5.2 보호 강화 대상

- 사회초년생
- 금융 초보자
- 고령층
- 디지털 금융 취약계층
- 향후 다국어 지원이 필요한 외국인 금융소비자

## 5.3 사용자 모드

| 모드 | 설명 |
|---|---|
| 일반 | 기본 금융 용어와 요약 중심 설명 |
| 금융 초보 | 전문용어 풀이, 단계별 행동 안내 강화 |
| 고령자·쉬운 설명 | 짧은 문장, 큰 글씨, 이해 확인 질문, 향후 TTS 지원 |

사용자 모드에 따라 설명 방식은 달라지지만 Evidence Policy와 최종 Claim 상태는 달라지지 않는다.

---

# 6. MVP 대표 시나리오

장기적으로 여러 금융 의사결정을 지원하지만 공모전 MVP에서는 성격이 다른 세 시나리오로 범위를 제한한다.

## 6.1 Scenario A — 대출 권유 검증

대표 입력:

> “OO은행 정부지원 특별대출 대상자입니다. 연 2.1%, 최대 5천만 원 가능합니다. 오늘 안에 신청하고 보증료 30만 원을 먼저 입금하세요.”

검증 항목:

- 금융기관 실재 여부
- 상품 존재 여부
- 금리·한도·조건
- 공식 URL·전화번호·계좌 여부
- 선입금·앱 설치·긴급성·과도한 개인정보 요구
- 소비자경보·유사 사기 패턴
- 사용자의 추가 상환부담

MVP의 대표 완성 시나리오로 사용한다. 텍스트와 캡처 이미지 입력을 모두 지원한다.

## 6.2 Scenario B — 저축성 금융상품 가입 검증

대표 입력:

> “ABC 저축은행 12개월 적금이고 최고 연 4.2%라고 안내받았습니다.”

검증 항목:

- 금융회사와 상품의 존재 여부
- 기본금리와 우대금리
- 우대조건·가입기간·중도해지 조건
- 예금자보호 관련 공식정보
- 사용자의 자금 목적과 유동성 필요성
- 설명 내용과 공식 상품문서의 차이

정상 거래를 위험하다고 오탐하지 않는다는 것을 보여주는 비교 시나리오로 사용한다.

## 6.3 Scenario C — 투자 권유 검증

대표 입력:

> “B테크는 다음 달 상장이 확정됐고 올해 매출이 3배 증가했습니다. 지금 투자하면 원금이 보장됩니다.”

검증 항목:

- 기업 실재 여부
- 공시·재무정보
- 상장 확정 Claim
- 매출 증가 Claim
- 원금보장 표현의 근거
- 제안서와 공식정보의 불일치
- 사용자의 투자 목적·기간·손실 감내 수준

PDF 투자제안서를 통한 비정형 문서 분석과 OpenDART 활용을 보여주는 제한된 실제 작동 시나리오로 사용한다.

---

# 7. 핵심 검증 축

## 7.1 Authenticity — 진위성

핵심 질문: **“제시된 금융정보가 사실인가?”**

- 실제 금융회사·기업인가?
- 실제 상품인가?
- 상품명·금리·한도·기간·수익률이 공식 근거와 일치하는가?
- 투자제안서와 공시·재무정보가 일치하는가?
- URL·전화번호·계좌가 공식 채널인가?

## 7.2 Transaction & Sales Risk — 거래·판매 위험

핵심 질문: **“거래와 판매 과정에 비정상적이거나 위험한 신호가 있는가?”**

- 기관 사칭 가능성
- 선입금 또는 개인 계좌 요구
- 앱 설치·원격제어 요구
- 비공식 URL
- 긴급 결정 강요
- 과도한 개인정보 요구
- 설명 누락·오인 가능성
- 사기·분쟁 패턴과의 의미적 유사성

## 7.3 Suitability — 개인 적합성

핵심 질문: **“정상적인 상품이라도 이 사용자에게 적합한가?”**

- 소득·기존 부채 대비 상환부담
- 자금 목적과 상품 기간
- 단기 유동성 필요성
- 투자 가능 자금과 손실 감내 수준
- 위험성향과 상품 위험의 불일치

## 7.4 Evidence Confidence

Evidence Confidence는 네 번째 사용자 판단축이 아니다. 다음 정보를 Claim별 메타데이터로 제공한다.

- 출처 권위성
- 발행일과 조회일
- 원문 버전·해시
- 독립 근거 수
- 출처 간 충돌 여부
- CoVe·Red Team 검증 여부

---

# 8. 서비스 생애주기

```text
금융 권유·상품정보 수신
        ↓
FinShield 사전 검증
        ↓
중단 / 추가 확인 / 진행
        ↓
가입 사실 등록
        ↓
PreCase 가입 후 보호
        ↓
정상 관리 / 추가 설명 / 정정·문의 / 분쟁 준비
        ↓
근거 변경 시 FinShield 재검증
```

## 8.1 Case 상태

- `DRAFT`
- `INPUT_REVIEW`
- `VERIFYING`
- `VERIFIED`
- `NEED_MORE_INFORMATION`
- `STOPPED_BY_USER`
- `ENROLLED`
- `AFTERCARE_IN_PROGRESS`
- `ACTION_REQUIRED`
- `CLOSED`

Case 상태는 사용자 여정을 나타내며 Claim 검증 상태와 분리한다.

---

# 9. 사용자 입력과 문서 처리

## 9.1 입력 방식

- Text
- Image
- PDF
- URL

## 9.2 처리 흐름

1. 파일 확장자뿐 아니라 MIME·Magic Byte를 검증한다.
2. 파일 크기와 페이지 수를 제한한다.
3. 악성 파일과 Prompt Injection 위험을 검사한다.
4. OCR 또는 PDF Parser로 텍스트를 추출한다.
5. 주민등록번호·전화번호·계좌번호 등 PII를 마스킹한다.
6. 금융기관·상품·회사·금리·한도·행동요구 등의 Claim을 추출한다.
7. 사용자가 Claim을 수정·삭제·추가한다.
8. 검증 결과를 바꿀 수 있는 정보가 부족하면 최소 추가 질문을 한다.
9. 확인된 Claim만 Agent 검증에 전달한다.

## 9.3 원본 보관 정책

- 회원 여부와 관계없이 업로드 원본은 기본적으로 영구 보관하지 않는다.
- 원본은 임시 저장소에서 처리 후 삭제한다.
- 마스킹된 Claim, Evidence, 결과, 파일 메타데이터만 저장한다.
- 원본 보관이 필요한 경우 별도의 명시적 동의를 받고 암호화 저장한다.
- 사용자는 보관 자료를 언제든 내려받거나 삭제할 수 있다.

MVP 권장 제한은 이미지·PDF 10MB, PDF 10쪽이다. 이는 법적 기준이 아니라 개발·비용·지연시간을 위한 운영 기준이며 성능시험 후 조정한다. 초기값은 30쪽이었으나 OCR Provider의 동기 API 한도와 1 TPS 안전 한도를 실제 요금·성능 자료로 대조해 10쪽으로 낮췄다.

---

# 10. FinancialCase와 Claim 구조

## 10.1 FinancialCase

모든 검증은 하나의 `FinancialCase`로 관리한다.

주요 정보:

- Case ID
- 사용자 ID
- 시나리오 유형
- 입력 채널
- 마스킹된 입력
- 사용자 확인 Claim
- 검증 당시 금융 프로필 스냅샷
- Agent 실행 기록
- Evidence와 Claim 연결
- 최종 결과 버전
- Evidence Passport
- 가입 여부와 가입일
- PreCase 사후관리 결과
- 재검증 기록과 알림

## 10.2 Claim

Claim은 검증 가능한 최소 사실 단위다.

예시:

- “발신자는 OO은행이다.”
- “정부지원 특별대출 상품이 존재한다.”
- “적용 금리는 연 2.1%다.”
- “보증료 30만 원을 먼저 송금해야 한다.”
- “제공 URL이 공식 신청 채널이다.”

Claim은 문서 전체 요약보다 작고 Evidence 문장보다 큰 단위로 설계한다.

## 10.3 Evidence Gap Resolver

모든 추가정보를 요구하지 않고 결론을 바꿀 수 있는 최소 정보만 질문한다.

예시:

- 선입금을 요구한 계좌 명의가 무엇인가?
- 공식 대표번호로 직접 확인했는가?
- 투자금이 비상자금인가?
- 상품을 유지할 예정 기간은 얼마인가?

부족한 정보가 입력되면 전체 분석이 아니라 영향받은 Claim과 Agent만 다시 실행한다.

---

# 11. Multi-Agent 구조

## 11.1 Agent 목록

| Agent | 책임 |
|---|---|
| Intake Agent | 문서 이해, PII 마스킹, 엔터티·Claim 추출 |
| Orchestrator Agent | Case 분류, Agent 선택, 비용·시간 예산 관리 |
| Product & Institution Agent | 금융기관·상품·조건·공식 채널 검증 |
| Fraud & Channel Agent | 사칭·URL·계좌·선입금·앱 설치·긴급성 분석 |
| Sales Conduct Agent | 판매 설명·권유 과정·오인 가능성 검토, PreCase 재사용 |
| Regulation & Dispute Agent | 법령·판례·분쟁조정·약관 검색, PreCase 재사용 |
| Suitability Agent | 금융 프로필과 상품 부담·위험 비교 |
| CoVe Agent | 중요한 Claim의 독립 재검색·재검증 |
| Red Team Agent | 초기 판단을 뒤집는 반대 근거 탐색 |
| Evidence Judge | Claim-Evidence 구조와 정책에 따른 상태 결정 |
| Action Guide Agent | 공식 확인·중단·신고·정정·분쟁 준비 안내 |

## 11.2 실제 Multi-Agent 조건

각 Agent는 다음을 가져야 한다.

- 별도 실행 단위와 Agent ID
- 입력·출력 JSON Schema
- 사용할 수 있는 Tool Allowlist
- 실행 시작·종료 시간
- 근거 조회 로그
- 실패·보류 이유
- 모델·토큰·비용 메타데이터
- `agent_runs` 저장 기록

화면에 Agent 이름만 여러 개 표시하고 하나의 Prompt에서 모두 처리하는 구조는 사용하지 않는다.

## 11.3 실행 최적화

- 모든 요청에 모든 Agent를 실행하지 않는다.
- Orchestrator가 3~6개의 필요한 Agent를 선택한다.
- 도메인 Agent는 가능한 경우 병렬로 실행한다.
- CoVe는 결과에 영향이 큰 Material Claim에만 적용한다.
- Red Team은 고위험·고비용 의사결정 Claim에 우선 적용한다.
- 안정적인 공식 근거는 캐시하되 발행일·조회일·해시를 보존한다.
- 단순 Text Case는 15~30초, Image·PDF Case는 30~60초를 초기 목표로 하되 실제 측정 후 확정한다.

---

# 12. Retrieval Architecture

## 12.1 Structured Retrieval

정확한 값과 식별자는 API·정형 데이터 조회를 우선한다.

- 금융회사·기업 식별
- 상품 조건
- 공시와 재무정보
- 법령 식별자
- 공식 URL·문서 메타데이터

## 12.2 Hybrid RAG

비정형 문서에는 키워드 검색과 Vector 검색을 결합한다.

- 법령·판례·분쟁조정
- 약관·상품설명서
- 소비자경보
- 금융사기·판매위험 패턴
- PreCase 보유 사례·결정 데이터

검색 흐름:

1. 시나리오·상품·채널·날짜·기관으로 Metadata Filter
2. Keyword Search
3. pgvector Semantic Search
4. Authority·Freshness·Relevance 기반 Rerank
5. Claim과 Evidence 연결

## 12.3 Vector DB 격리

- 공공 Knowledge Base와 사용자 문서를 분리한다.
- 사용자 문서 Embedding은 사용자·Case별 RLS를 적용한다.
- 원본을 영구 보관하지 않는 Case는 Embedding도 처리 후 삭제할 수 있다.
- 공용 Knowledge Base에 사용자 문서를 섞지 않는다.

---

# 13. Evidence 구조와 정책

## 13.1 Evidence 필수 필드

- Evidence ID
- Source Type
- Authority Level
- Source Title
- Source URL 또는 공식 식별자
- 원문 발췌 위치
- 발행일
- 조회일
- 문서 버전·해시
- Claim과의 관계: Support / Contradict / Context
- 독립 근거 여부
- Reference-only 여부

## 13.2 Source Authority

| 등급 | 출처 |
|---|---|
| A | 법령 원문, 정부·감독기관 API, OpenDART 공시, 금융회사 공식 문서 |
| B | 공공기관 보도자료·소비자경보·공식 분쟁조정 |
| C | 검증된 연구·전문기관 자료 |
| D | 일반 웹·블로그·커뮤니티·언론 요약 |

사실 Claim은 가능한 한 A 또는 B 등급 근거를 요구한다. D 등급은 탐색과 맥락 설명에는 사용할 수 있지만 단독 확정 근거로 사용하지 않는다.

## 13.3 Evidence Policy

### EP-01. No Evidence, No Claim

근거가 없는 Claim은 확정하지 않는다.

### EP-02. Primary Source First

사실 검증은 공식 1차 근거를 우선한다.

### EP-03. Conflict Preservation

출처가 충돌하면 평균내지 않고 `CONFLICT`로 남긴다.

### EP-04. Freshness

출처 발행일·조회일·버전을 결과에 표시한다.

### EP-05. Independent Verification

동일 원문의 복제·재게시를 독립 근거로 계산하지 않는다.

### EP-06. Abstention

근거가 부족하면 `UNKNOWN`, `NEED_MORE_INFORMATION`, `WITHHELD`로 보류한다.

### EP-07. Citation Required

사용자에게 제공하는 핵심 사실 판단은 출처와 연결한다.

### EP-08. Similar Case Is Not Proof

유사 분쟁·사기 사례는 위험 패턴 참고 자료일 뿐 현재 거래의 위법·사기를 증명하는 근거가 아니다.

### EP-09. Absence of Warning Is Not Safety

경고를 찾지 못했다는 이유만으로 안전 판정을 내리지 않는다.

---

# 14. CoVe와 Red Team

## 14.1 CoVe Agent

CoVe는 기존 답변을 다시 읽고 “맞는가?”라고 묻는 Self-review Prompt가 아니다.

실행 원칙:

- 초기 Agent의 자연어 결론을 최소화한 검증 질문을 생성한다.
- 초기 검색어와 분리된 독립 검색을 수행한다.
- 원래 사용한 근거 외의 공식 출처를 우선 탐색한다.
- Claim별로 유지·반박·미확인을 기록한다.

## 14.2 Red Team Agent

Red Team은 초기 결론을 뒤집을 수 있는 반대 가설을 탐색한다.

예시:

- 선입금 요구가 정상적인 공식 절차일 가능성
- 비공식으로 보이는 URL이 공식 캠페인 도메인일 가능성
- 공시에서 찾지 못한 정보가 다른 공식 문서에 존재할 가능성
- 위험해 보이는 조건이 실제 약관에 명시된 가능성

반대 근거를 찾지 못했다고 초기 결론이 자동으로 확정되는 것은 아니다. 근거 부족은 계속 `UNKNOWN`으로 남을 수 있다.

---

# 15. 최종 결과 체계

## 15.1 Claim 상태

- `VERIFIED`: 공식 근거로 확인됨
- `CONTRADICTED`: 공식 근거와 명확히 모순됨
- `CONFLICT`: 권위 있는 출처 간 충돌이 있음
- `UNKNOWN`: 확인할 근거를 찾지 못함
- `NEED_MORE_INFORMATION`: 사용자 정보가 부족함
- `WITHHELD`: 안전 정책에 따라 판단을 보류함

## 15.2 종합 결과

정확해 보이지만 근거 없는 0~100 점수 대신 범주형 상태를 사용한다.

- 진행 전 확인 필요
- 높은 주의가 필요한 거래
- 중대한 위험 신호 발견
- 확인된 범위에서 특별한 위험 신호 없음
- 정보 부족으로 판단 보류

“특별한 위험 신호 없음”은 거래 안전 보증을 의미하지 않는다.

## 15.3 결과 화면 구성

1. 한 문장 결론
2. Authenticity 결과
3. Transaction & Sales Risk 결과
4. Suitability 결과
5. 핵심 발견
6. Claim별 상태와 Evidence
7. CoVe·Red Team 검증 기록
8. Evidence Policy 적용 결과
9. 지금 할 행동
10. 공식 확인·신고·문의 채널
11. Evidence Passport 저장

---

# 16. Evidence Passport

Evidence Passport는 한 시점의 검증 결과를 재현할 수 있는 불변 기록이다.

포함 항목:

- Case ID
- 검증 시각
- 사용자 확인 Claim
- Claim별 최종 상태
- Evidence와 출처 등급
- 발행일·조회일·버전·해시
- CoVe 결과
- Red Team 결과
- Evidence Policy 판단
- 세 축의 종합 결과
- 행동 가이드
- 검증 엔진 버전
- 사용자 금융 프로필 스냅샷

재검증 시 기존 Passport를 덮어쓰지 않고 새 버전을 생성하며 이전·현재 결과 차이를 제공한다.

---

# 17. PreCase 통합

## 17.1 통합 원칙

사용자가 별도의 `precase.vercel.app`으로 이동하지 않는다. PreCase 기능은 FinShield 내부의 `가입 후 보호` 모듈로 제공한다.

사용자에게는 하나의 서비스와 하나의 계정으로 보인다.

```text
FinShield
├─ 새 검증
├─ 검증 결과·근거
├─ 내 검증
├─ 재검증
└─ 가입 후 보호  ← PreCase 기능
```

## 17.2 사전 검증에서 재사용

FinShield의 거래 전 검증에서도 다음 PreCase 자산을 사용한다.

- Sales Conduct Agent
- Regulation & Dispute Agent
- 법령·분쟁조정·판례·약관·위험패턴 데이터
- `lookup_statute`
- `search_precedent`
- `search_case`
- `check_documents`
- `analyze_risk_pattern`
- PII 마스킹
- Prompt Injection 방어
- 출처 검증과 Citation 안전장치
- 판단 보류 정책
- Rate Limit·Budget·Health 관리

## 17.3 가입 후 연결

FinShield 결과에서 사용자가 `이 상품에 가입했어요`를 선택하면 동일한 FinancialCase의 상태를 `ENROLLED`로 변경한다.

PreCase 모듈은 다음을 추가로 확인한다.

- 실제 가입 채널과 가입일
- 직원 또는 권유자에게 들은 설명
- 손실·중도해지·우대조건 설명 여부
- 사용자의 실제 이해도
- 검증한 조건과 계약 조건의 차이
- 보유한 설명서·녹취·계약 문서
- 문의·정정·분쟁 준비에 필요한 행동

## 17.4 PreCase로 전달되는 데이터

- FinancialCase ID
- 상품·기관·채널
- 사용자 확인 Claim
- Claim 상태와 Evidence
- Evidence Passport
- 검증 당시 금융 프로필 스냅샷
- 사용자가 동의한 마스킹 자료

기본적으로 원본 이미지·PDF, 불필요한 PII, 다른 Case의 개인정보는 전달하지 않는다.

## 17.5 역할 구분

| FinShield | PreCase |
|---|---|
| 거래 전 진위성·위험·적합성 검증 | 가입 후 설명 적정성·이해도 검증 |
| 상품·기관·공시·채널 중심 | 판매행위·법령·분쟁·약관 중심 |
| 중단·추가 확인·조건부 진행 | 정상 관리·문의·정정·분쟁 준비 |

PreCase는 FinShield를 대체하지 않고 사전 검증 결과를 이어받아 사후 소비자보호를 완성한다.

---

# 18. 회원가입과 권한

## 18.1 접근 방식

| 사용자 | 접근 범위 |
|---|---|
| 비회원 체험 | 미리 준비된 Demo Case 실행, 저장·알림 제한 |
| 회원 | 실제 입력 검증, 기록, Passport, 재검증, PreCase, 설정 |
| Trusted Reviewer | 명시적으로 공유받은 Case의 읽기 또는 의견 작성 |
| 운영자 | 공개 Knowledge Base·Tool 상태·평가셋 관리, 사용자 원본 기본 접근 불가 |

## 18.2 인증 기능

- 이메일·비밀번호 회원가입
- 이메일 확인
- 로그인·로그아웃
- 비밀번호 재설정
- 세션 관리
- 탈퇴와 데이터 삭제
- 심사위원 체험 모드

운영 서비스에서는 별도의 SMTP를 구성한다. 공모전 심사 흐름이 이메일 발송 성공에 의존하지 않도록 공개 Demo와 Demo 계정을 제공한다.

## 18.3 계정으로 제공되는 기능

- 검증기록 영구 보관
- 다른 기기에서 기록 확인
- 여러 Case 관리
- 재검증 알림
- 금융 프로필 재사용
- Case별 프로필 스냅샷
- FinShield에서 PreCase로 연속 관리
- 데이터 다운로드·삭제

---

# 19. 재검증과 알림

## 19.1 재검증 정의

재검증은 모든 인터넷 페이지를 실시간 감시하는 기능이 아니다. 검증에 사용한 추적 가능한 공식 근거가 변경되었을 때 영향받은 Claim을 다시 판단하는 기능이다.

## 19.2 처리 흐름

1. 공식 API 결과·문서의 발행일, 조회일, 버전, 해시를 저장한다.
2. 스케줄 또는 이벤트로 출처를 다시 조회한다.
3. 변경된 `source_snapshot`을 감지한다.
4. 해당 Evidence와 연결된 Claim을 찾는다.
5. 영향받은 Agent와 CoVe·Judge만 재실행한다.
6. 이전·현재 결과 차이를 저장한다.
7. 결과에 영향을 주는 중요한 변경만 알린다.

## 19.3 자동·수동 범위

자동 추적:

- 공식 API
- 공시
- 버전이 있는 공식 문서
- 안정적인 공식 URL

수동 재검증:

- 임의 웹페이지
- 만료·삭제 URL
- 전화 설명
- 메신저 대화처럼 변경 감지가 불가능한 입력

## 19.4 알림 정책

- 앱 내 알림은 P0에 포함한다.
- 이메일 알림은 SMTP 준비 후 P1으로 적용한다.
- 결과에 영향을 주지 않는 변경은 알리지 않는다.
- 여러 변경은 필요하면 Digest로 묶는다.
- 사용자가 Case별로 알림을 끌 수 있다.

---

# 20. 화면 구성

## 20.1 인증

1. 공개 소개·심사 체험
2. 로그인
3. 회원가입
4. 이메일 확인·비밀번호 재설정
5. 금융 프로필 온보딩

## 20.2 검증

6. My FinShield 대시보드
7. 검증 시나리오 선택
8. Text·Image·PDF·URL 입력
9. 업로드 처리·PII 마스킹 상태
10. Case·Claim 확인
11. Evidence Gap 추가 질문
12. Agent 분석 진행·실행 기록
13. 종합 검증 결과
14. Claim-Evidence 상세
15. 개인 적합성 상세·추가정보 입력
16. 행동 가이드
17. Evidence Passport

## 20.3 계정 관리

18. 내 검증 목록
19. Case 상세·생애주기
20. 재검증 버전 비교
21. 알림 센터
22. 금융 프로필
23. Trusted Review 공유
24. 개인정보·보안·데이터 설정

## 20.4 PreCase와 신뢰

25. 가입 사실 등록
26. 가입 후 PreCase 이해도·판매행위 점검
27. PreCase 결과·문의·정정·분쟁 준비
28. 신뢰센터·평가 결과·Tool 상태

모든 화면을 공모전 P0에 각각 완성하는 것은 아니다. 기능적으로 가까운 화면은 탭·모달·상세 패널로 통합한다.

---

# 21. 외부 데이터와 Tool

## 21.1 기존 PreCase Tool

- `lookup_statute`
- `search_precedent`
- `search_case`
- `check_documents`
- `analyze_risk_pattern`

## 21.2 신규 FinShield Tool

- `search_financial_product`
- `verify_financial_institution`
- `search_company`
- `search_disclosure`
- `search_consumer_warning`
- `inspect_url`
- `get_source_snapshot`

## 21.3 주요 외부 연동

| 연동 | 용도 | 주의사항 |
|---|---|---|
| OpenDART | 기업·공시·재무정보 | 공시 대상이 아닌 모든 기업을 확인할 수 없음 |
| 국가법령정보 공동활용 API | 법령·판례·금융위 의결 | 사전 신청·키·쿼터 확인 필요 |
| 금융당국 소비자경보 | 사기·판매위험 근거 | 원문 버전과 발행일 보관 |
| 금융회사 공식 문서 | 상품·금리·조건 | API가 없으면 공식 문서 Snapshot 사용 |
| URL Reputation Service | 피싱·악성 URL 참고 | 라이선스·상업 사용 조건 확인 필요 |
| Supabase Auth·Postgres·pgvector | 계정·RDB·RAG·RLS | 모든 노출 테이블에 RLS 적용 |

공식 API를 확인하지 않은 데이터는 “연동 예정”으로 표시하며, API가 있다는 전제로 기획서나 Demo 결과를 작성하지 않는다.

---

# 22. 데이터 모델 개요

상세 컬럼·제약·인덱스는 DB 명세서에서 정의한다.

- `profiles`
- `financial_profiles`
- `financial_profile_versions`
- `financial_cases`
- `case_inputs`
- `claims`
- `evidences`
- `claim_evidences`
- `agent_runs`
- `verification_runs`
- `final_claim_versions`
- `evidence_passports`
- `source_snapshots`
- `revalidation_jobs`
- `revalidation_events`
- `notifications`
- `notification_preferences`
- `action_checklists`
- `trusted_access`
- `precase_assessments`
- `knowledge_documents`
- `knowledge_chunks`
- `knowledge_embeddings`

## 22.1 주요 데이터 원칙

- 모든 사용자 소유 데이터에 `owner_id`를 둔다.
- 모든 노출 테이블에 RLS와 최소 권한을 적용한다.
- `service_role`은 서버에서만 사용한다.
- 금융 프로필은 Case 생성 시 Snapshot을 남긴다.
- 검증 결과와 Passport는 수정 대신 새 버전을 생성한다.
- Raw Document와 Public Knowledge Base를 분리한다.
- Claim과 Evidence는 다대다 관계로 연결한다.
- 동일 원문의 복제 출처를 식별할 수 있는 Source Fingerprint를 저장한다.

---

# 23. 비기능 요구사항

## 23.1 보안

- PII 마스킹
- 업로드 파일 MIME·Magic Byte 검증
- 악성 파일 검사
- Prompt Injection 필터링
- 외부 문서를 비신뢰 입력으로 취급
- Agent별 Tool Allowlist
- 서버 전용 API Key·Service Role
- Supabase RLS
- Signed URL과 짧은 만료시간
- 민감 로그 마스킹
- Rate Limit·Budget Limit
- 감사 가능한 Agent 실행 기록

## 23.2 개인정보

- 데이터 최소 수집
- 원본 기본 미보관
- 명시적 동의 기반 원본 보관
- 보관 목적·기간 표시
- 사용자 다운로드·삭제
- 공유 권한의 만료·회수
- 삭제 시 파생 Embedding·Cache까지 처리

## 23.3 성능

- 도메인 Agent 병렬 실행
- 안정적인 공식 데이터 Cache
- Material Claim만 CoVe·Red Team 적용
- 진행 상태 Streaming
- 일부 Agent 실패 시 확인된 결과부터 표시
- 초기 목표: Text 15~30초, Image·PDF 30~60초

## 23.4 가용성

- 외부 API Timeout·Retry·Circuit Breaker
- Cache 사용 시 `STALE` 표시
- 외부 출처 장애 시 확정 대신 `UNKNOWN`
- 제출 기간 URL 상시 접근성 점검
- Demo 데이터와 외부 API 실패 Fallback 구분

## 23.5 접근성·사용성

- 모바일·태블릿·데스크톱 반응형
- 색상 외 텍스트·아이콘으로 상태 전달
- 금융용어 풀이
- 결과보다 행동 가이드 우선 노출
- 사용자가 Claim과 OCR을 수정 가능
- 위험 경고는 구체적인 이유와 근거를 포함
- 모든 기능에서 저장·삭제·공유 상태를 명확히 표시

---

# 24. 예외와 실패 안전 설계

## 24.1 상품·기관을 찾지 못함

잘못된 상품이나 사기라고 단정하지 않는다.

결과:

- `UNKNOWN`
- 확인한 범위와 출처 표시
- 정확한 상품명·문서·공식 연락처 추가 요청

## 24.2 Evidence 충돌

한쪽 출처를 임의로 선택하지 않는다.

결과:

- `CONFLICT`
- 충돌하는 출처를 함께 표시
- 최신 공식 문서 또는 기관 확인 안내

## 24.3 정보 부족

전체 입력을 다시 요구하지 않는다.

결과:

- `NEED_MORE_INFORMATION`
- 결론을 바꿀 수 있는 최소 질문
- 영향받은 Claim만 재검증

## 24.4 OCR 실패

- 실패 페이지 표시
- 페이지 재선택·재업로드
- 사용자가 직접 Claim 입력
- 불확실한 숫자·기관명 강조

## 24.5 외부 API 장애

- Retry 후 Circuit Breaker
- 검증된 Cache가 있으면 `STALE`과 조회시점 표시
- Cache도 없으면 `UNKNOWN`
- 성공한 것처럼 고정 Demo 응답을 표시하지 않는다.

## 24.6 Agent 실패

- Agent별 실패 상태 기록
- 실패한 Agent가 담당한 Claim을 확정하지 않음
- 재시도 또는 수동 확인 선택
- 전체 Case를 무조건 실패 처리하지 않음

## 24.7 이미 송금·가입함

- 단순 예방 흐름을 종료하지 않는다.
- PreCase 사후관리 또는 공식 신고·지급정지·분쟁 준비 흐름으로 전환한다.

---

# 25. 신뢰센터와 평가

## 25.1 공개 원칙

- 측정하지 않은 정확도를 표시하지 않는다.
- PreCase 검증 결과를 FinShield 전체 성능으로 표현하지 않는다.
- 성공 사례뿐 아니라 보류·실패 사례도 공개한다.
- 외부 API와 Knowledge Base의 상태·조회일을 표시한다.

## 25.2 평가셋

FinShield 전용 Claim-level 평가셋을 새로 구축한다.

구성:

- 대출·저축·투자 시나리오
- 정상·변조·미확인·충돌 Case
- Text·Image·PDF 입력
- 숫자·기관명·URL OCR 오류 Case
- Prompt Injection·악성 문서 Case
- 공식 출처 장애 Case

## 25.3 측정 지표

- Claim Extraction Accuracy
- Claim Verification Precision
- Unsupported Claim Rate
- Evidence Coverage
- Conflict Detection Accuracy
- Abstention Accuracy
- Fraud Signal Recall
- 정상 거래 오탐률
- Re-verification Alert Precision
- OCR Extraction Accuracy
- P95 Latency
- Case당 Token·API 비용

## 25.4 비교 실험

1. LLM 단독
2. 일반 RAG
3. RAG + CoVe
4. FinShield 전체 구조

비교를 통해 CoVe·Red Team·Evidence Policy가 근거 없는 Claim과 오탐을 얼마나 줄였는지 보여준다.

---

# 26. MVP 우선순위

## 26.1 P0 — 공모전 제출 필수

- 공개 Landing·심사 체험
- 로그인·회원가입·Demo 계정
- My FinShield
- Text·Image·PDF 입력
- OCR·PDF Parsing·PII Masking
- Claim 확인
- Evidence Gap 최소 질문
- 대표 대출 Case 완전 동작
- 제한된 저축·투자 Demo
- 실제 분리된 Agent 실행 기록
- Hybrid RAG·pgvector
- Claim-level Evidence
- CoVe·Red Team·Evidence Policy
- 3축 결과와 행동 가이드
- Evidence Passport
- 검증 기록
- 수동 재검증
- FinShield 내부 PreCase 가입 후 보호
- 실제 측정값만 사용하는 신뢰센터

## 26.2 P1 — 본선 경쟁력 강화

- 자동 재검증 Scheduler
- 이메일 알림
- URL 입력·콘텐츠 검증 고도화
- Trusted Reviewer 가족·상담자 공유
- 금융 초보·고령자 모드
- TTS와 이해도 질문
- 행동 체크리스트
- 만료되는 Passport 공유 링크

## 26.3 P2 — 장기 확장

- 보험·연금·펀드·채권
- Open Banking 연계
- B2B Verification API
- 익명화 위험 패턴 인사이트
- 외국인·다국어 금융 보호

---

# 27. 공모전 Demo 구성

## Demo 1 — 대출 사칭 의심 이미지

1. 문자 캡처 업로드
2. OCR·PII 마스킹
3. Claim 7개 추출과 사용자 확인
4. 기관·상품·URL·선입금 Agent 병렬 실행
5. CoVe 독립 재검증
6. Red Team 반대 근거 탐색
7. 높은 주의 결과와 공식 행동 가이드
8. Evidence Passport 저장

핵심 메시지:

> 금융기관명이 실제로 존재한다는 사실과 해당 거래가 정상이라는 사실은 다르다.

## Demo 2 — 정상 저축성 금융상품

1. 상품 설명 입력
2. 공식 조건과 우대조건 확인
3. 사용자의 12개월 자금 목적과 비교
4. 특별한 위험 신호 없음과 주의조건 표시
5. 가입 사실 등록
6. FinShield 내부 PreCase 이해도 점검
7. 우대금리·중도해지 이해 확인

핵심 메시지:

> FinShield는 모든 거래를 위험하다고 하는 서비스가 아니라 근거에 따라 정상 거래와 위험 거래를 구분한다.

## Demo 3 — 투자제안서 PDF

1. PDF 업로드
2. 상장·매출·원금보장 Claim 추출
3. OpenDART 공시·재무정보 비교
4. 미확인·모순 Claim 구분
5. 사용자 투자목적과 적합성 확인
6. 가입·투자 후 PreCase 판매 설명 점검 가능성 제시

핵심 메시지:

> 제안서의 문장을 요약하는 것이 아니라 각각을 공식 근거와 대조한다.

---

# 28. 구현 위험과 해결책

| 위험 | 영향 | 대응 |
|---|---|---|
| 지원 범위 과다 | 완성도 저하 | 대표 1개 완성 + 제한된 2개 Demo |
| 심사위원 인증 실패 | 서비스 접근 불가 | 공개 체험·Demo 계정 |
| 이메일 발송 제한 | 가입 실패 | 운영 SMTP, 심사 Flow 우회 |
| 공식 상품 API 불확실 | 결과 미제공 | 공식 문서 Snapshot과 `UNKNOWN` |
| DART 미대상 기업 | 기업 검증 누락 | 확인 범위 명시, 존재 여부 추정 금지 |
| 외부 API 장애 | 분석 중단 | Timeout·Retry·Cache·Circuit Breaker |
| Raw PDF 장기 보관 | 개인정보 유출 | 기본 삭제·별도 동의 |
| 사용자 Vector 유출 | 개인정보 침해 | Owner·Case RLS 또는 Ephemeral Embedding |
| Prompt Injection | Tool 오용 | 문서 격리·명령 무시·Allowlist |
| Agent 비용·지연 | UX 저하 | 선택 실행·병렬화·Cache·Material Claim 제한 |
| CoVe가 초기 Bias 반복 | 검증 무력화 | 초기 결론 격리·독립 Query·출처 분리 |
| 알림 과다 | 사용자 이탈 | Material Change만 알림 |
| 프로필 변경 | 과거 결과 변형 | Case별 Snapshot |
| 유사 사례 오용 | 오탐 | Reference-only 정책 |
| 점수 과신 | 잘못된 의사결정 | 범주형 결과·근거·한계 표시 |
| PreCase가 주제 잠식 | 정체성 훼손 | FinShield 사전 검증 중심, PreCase는 사후 보호 |
| 법률·금융 책임 | 사용자 오인 | 의사결정 지원 고지·공식 채널 연결 |

---

# 29. 성공 조건

공모전 MVP가 성공했다고 판단하려면 다음을 만족해야 한다.

1. 대표 대출 이미지 Case가 처음부터 끝까지 실제로 작동한다.
2. 투자 PDF에서 실제 Claim 추출과 OpenDART 조회가 동작한다.
3. 정상 저축 Case를 과도하게 위험 판정하지 않는다.
4. Agent가 실제로 분리 실행되고 각 실행·근거 기록이 남는다.
5. Claim과 Evidence가 화면에서 직접 연결된다.
6. 근거 부족·충돌·출처 장애 시 안전하게 보류한다.
7. 회원은 Case와 Passport를 다른 기기에서 다시 확인할 수 있다.
8. 가입한 Case가 별도 PreCase 사이트 이동 없이 FinShield 내부 가입 후 보호로 이어진다.
9. 재검증이 과거 결과를 덮어쓰지 않고 버전 차이를 제공한다.
10. 신뢰센터에 실제 평가 결과만 공개한다.
11. 제출된 URL이 심사 기간 동안 로그인 장벽 없이 안정적으로 열린다.

---

# 30. 최종 Positioning

FinShield는 금융상품 추천 서비스도, 보이스피싱 탐지기만도, 범용 금융 챗봇도 아니다.

> **금융소비자가 돈을 움직이기 전에 금융정보의 진위성·거래 및 판매 위험·개인 적합성을 전문 Agent와 공식 Evidence로 검증하고, 가입 후에는 PreCase의 소비자보호 기능으로 이어서 관리하는 Evidence-Verified 금융 의사결정 플랫폼이다.**

FinShield가 지향하는 변화는 다음과 같다.

> **AI가 답하는 금융에서, AI가 자신의 답을 다시 검증하는 금융으로.**

---

# 31. 참고 자료

- 2026 금융 AI Challenge: https://daker.ai/public/hackathons/2026-finance-ai-challenge
- PreCase GitHub: https://github.com/yongzooda/precase
- PreCase 배포 사이트: https://precase.vercel.app/
- OpenDART: https://opendart.fss.or.kr/intro/main.do
- 국가법령정보 공동활용 API: https://open.law.go.kr/LSO/openApi/guideList.do
- 금융보안원 2026 금융 AI 신뢰성·안전성 전략: https://www.fsec.or.kr/bbs/detail?bbsNo=11872&menuNo=69
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase RAG with Permissions: https://supabase.com/docs/guides/ai/rag-with-permissions
- Supabase Hybrid Search: https://supabase.com/docs/guides/ai/hybrid-search

