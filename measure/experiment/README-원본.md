# 프리케이스(PreCase) — 데이터·코드 저장소

**2026 금융 AI Challenge** 출품작. 불완전판매 분쟁 예방·판단·개선 AI 에이전트.

기획서 정본은 **Notion** 이며, 이 저장소는 그 기획서에 실린 **모든 수치의 원본 근거**다.

> **먼저 [`인수인계.md`](인수인계.md) 를 읽을 것.**
> 현재 상태 · 확정 KPI · **주장하면 안 되는 것** · 다음 작업 우선순위가 정리돼 있다.
> 이 README는 폴더 구조와 재집계 규칙만 다룬다.

---

## 1. 폴더 구조

```
프리케이스/
├── 인수인계.md              ← 여기부터 읽는다
├── README.md
├── requirements.txt
│
├── data/                        원본 및 구조화 데이터
│   ├── raw/cases/               금감원 원본 HWP — 재수집해야만 복구됨
│   │   ├── decision/            정식 조정결정서 256건
│   │   ├── summary/             분쟁조정사례(요약) 412건
│   │   ├── manifest.json        게시판1 수집 목록
│   │   └── manifest_board2.json 게시판2 수집 목록
│   ├── eval_set.json      ★     검증셋 120건 (기각60:인용60, 편향 7종 통제)
│   ├── corpus.json              검색 코퍼스 240건 (인용135:기각105)
│   ├── pool_matched.json  ★     편향 제거 검색 풀 180건 (출처-라벨 결합 chi2=0)
│   ├── pool_matched_report.json 결합 진단 전후 비교
│   ├── golden_candidates.json   정식 결정서 구조화 227건 (label + input_text)
│   ├── summary_candidates.json  요약 사례 구조화 135건
│   ├── parse_report.json        파싱 결과 256건 (sections 길이 포함)
│   └── ratio_set.json           배상비율 명시 사례 30건
│
├── results/                     실험·분석 결과
│   ├── law_result.json    ★★    운영 기준 = Opus 5. 정확도 76%
│   ├── law_opus_result.json     위와 동일 (모델 명시본, 기획서가 인용)
│   ├── law_sonnet_result.json   Sonnet 기준선 (되돌릴 때)
│   ├── norag_result.json        유사사례 미주입 대조군 70% (Sonnet)
│   ├── rag_result.json          유사사례 주입 대조군 68% (Sonnet)
│   ├── rag_v2_result.json       결합 제거 풀 재측정 72% (Sonnet)
│   ├── channel_age_result.json  채널·연령·특성 라벨 + 사건별 상세
│   ├── terms_effect.json        약관 유무별 (규칙 R3)
│   └── kpi_report.json          기획서 수치 일괄 산출본
│
├── src/
│   ├── collect/                 금감원 자료 수집기
│   ├── parse/                   HWP 파싱 · 섹션 분리
│   ├── dataset/                 검증셋·코퍼스 구성 · 매칭 풀 생성
│   ├── experiment/              대조 실험 · 운영 설정 실행 래퍼
│   ├── analysis/                채널·약관 분해 · KPI 일괄 산출
│   └── api_spec/                법제처 OPEN API 사양 (MCP 도구 구현 시 필수)
│
└── docs/
    ├── 기획서_수정안.md          검증에서 무엇을 왜 고쳤는지
    └── 재측정_실행순서.md        재측정 명령어 · 비용 · 판단 기준
```

---

## 2. 기획서 수치 → 근거 파일 매핑

**기획서를 검증할 때 이 표를 기준으로 대조한다. 성능 수치는 전부 Claude Opus 5 실측이다.**

| 기획서 수치 | 값 | 근거 파일 |
|---|---|---|
| 검증셋 규모 | 120건 (60:60) | `data/eval_set.json` |
| 검색 코퍼스 | 240건 (인용135:기각105) | `data/corpus.json` |
| 매칭 검색 풀 | 180건 (인용90:기각90, chi2=0) | `data/pool_matched.json` |
| 배상비율 세트 | 30건, 9~80%, 중앙값 40% | `data/ratio_set.json` |
| 사건 연도 범위 | 2007~2026 | `eval_set` + `corpus` |
| 조정결정서 파싱 | 256건 | `data/parse_report.json` |
| 정식 결정서 구조화 | 227건 | `data/golden_candidates.json` |
| 위원회 판단부 보유 | 235건 | `parse_report.json` 의 `위원회판단 > 50자` |
| 전체 파싱 성공 | 659건 | HWP 665개 중 659개 |
| **전체 정확도** | **76% (91/120)** · CI 67.4~82.6% · z=5.66 | `results/law_result.json` |
| **결론 제시 구간** | **84% (71/85)** | `확신도 >= 4` |
| **결론 제시 커버리지** | **71% (85/120)** | 동일 |
| 확신 4점 미만 | 57% (20/35) | `확신도 < 4` |
| **확신도 변별력** | **Fisher p = 0.0042** ✅ | 4↑ 대 4미만 |
| 인용 재현율 | 80% (48/60) | label=인용 & hit |
| 기각 재현율 | 72% (43/60) | label=기각 & hit |
| 오답 방향 | 인용→기각 12 : 기각→인용 17 · 결론 구간 7:7 | p=0.458, 유의하지 않음 |
| 업권별 | 증권85 은행80 보험69 미상67 카드60 | `sector` × `hit` |
| 채널별 | 식별 83.3%(30/36) : 미식별 72.6%(61/84) | `channel_age_result.json` · p=0.31 |
| 쟁점 유형별 | 판매행위 85.2%(27건) : 그 외 73.1%(93건) | `law_result` 쟁점 필드 · p=0.307 |
| 약관 유무별 | 있음 61.9%(21) : 없음 78.8%(99) | `terms_effect.json` · **p=0.158, 부호가 모델에 따라 뒤집힘** |
| 약관 원문 포함률 | 17.5% (21/120) | 동일 (규칙 R3) |
| 라벨 부착률 | 채널30% 연령8% 특성3% | `channel_age_result.json` |
| 유사사례 미주입 / 주입 / 결합 제거 | 70% / 68% / 72% | `norag` · `rag` · `rag_v2` (전부 Sonnet) |
| 3설정 합성 | 하나라도 90% · 전부 틀림 10% · 전부 맞힘 51% · 다수결 73% | `report_kpi.py` |
| 채널 문서 수 | 창구34 TM28 모집인21 온라인11 방카3 | 정식 결정서 235건 기준 |
| 채널×설명의무 | TM 71.4% 모집인42.9% 창구29.4% 온라인27.3% | 위원회 판단부 한정 |
| 소비자 특성 | 전문투자자30 고령19 투자경험13 의사능력4 | 전문 기준 235건 |
| 위원회 인용 법령 | 자본282 민법261 상법168 할부127 약관77 건보76 표준58 금소8 | **아래 §4-① 참조** |
| 교정 후 인용 법령 | 약관규제법85 상법69 민법53 자본시장17 금소0 | `law_result.json` 의 `조문` 필드 |
| 검색 풀 결합 진단 | chi2 88.8 → 0 | `data/pool_matched_report.json` |
| 법제처 API | 상법 1,184개 항목 · 판례 15,978자 | `src/api_spec/` · 인증키 OC=precase |

---

## 3. 재현 방법

```bash
# 가상환경 (삭제했으므로 재생성 필요)
cd ~/Downloads/프리케이스
python3 -m venv .venv && source .venv/bin/activate
pip install anthropic

# API 없이 돌아가는 것 — 결과 파일만으로 전부 재산출된다
cd src/analysis
python analyze_channel_age.py     # 채널·연령·특성·업권
python detect_terms.py            # 약관 유무 (규칙 5종 비교)
python report_kpi.py --json       # 기획서 수치 일괄 출력

# 매칭 풀 재생성
cd src/dataset && python build_matched_pool.py ../../data

# 원본 HWP 재파싱
python -c "
import sys; sys.path.insert(0,'src/parse')
from batch_parse import hwp_to_text, split_sections
t = hwp_to_text('data/raw/cases/decision/<파일명>.hwp')
sec = split_sections(t)   # 주문/기초사실/당사자주장/위원회판단/결론
"
```

API가 필요한 재측정(모델 교체·RAG 실험)은 [`docs/재측정_실행순서.md`](docs/재측정_실행순서.md) 참조.

**`pilot_law.py` 를 직접 실행하지 말 것.** 현재 디렉터리의 `law_result.json` 을 조용히 덮어쓴다. 반드시 `src/experiment/run_law.py` 를 쓴다.

**`law_result.json` 을 바꿨으면 파생 분석 3종을 반드시 다시 돌린다.** 빠뜨리면 한 표에 두 모델의 값이 섞인다.

---

## 4. 재집계 시 반드시 읽을 것

**① 법령 인용 횟수는 법령마다 카운팅 규칙이 다르다.**
`민법`·`상법`은 흔한 단어라 **조문번호가 붙은 경우만** 셌고(민법 261, 상법 168), 나머지는 **법령명 단독**으로 셌다(할부거래법 127, 약관규제법 77, 표준약관 58). `국민건강보험법`은 "공단"을 제외해야 76이 나온다. 규칙을 통일하면 값이 달라진다.
`report_kpi.py` 는 교정 후 인용 법령을 두 방식으로 나란히 출력하고 경고한다.

**② 채널·특성 집계의 모집단은 정식 조정결정서 235건이다.**
요약 사례집을 섞으면 편향이 생긴다. "설명의무가 쟁점이 되었다"의 정의는 **위원회 판단부에 설명의무가 명시된 경우**로 확정했다. 문서 전문 기준으로 재집계해도 다섯 채널 중 넷이 소수점까지 동일한, 정의에 둔감한 지표다.

**③ 특성 정보는 위원회 판단부에만 있다.**
같은 추출기를 입력 텍스트(판단 제거)와 전문에 각각 적용하면 전문투자자 2건 → 30건, 고령 6건 → 19건으로 벌어진다. 즉 **소비자가 제출하는 자료에는 없고 심리 과정에서 질문으로 확보된 정보**다. 상담 에이전트가 되묻는 설계의 실증 근거이자, 76%가 하한값인 이유다.

**④ 검증셋 120건 중 93건(78%)은 서비스 범위 밖 사건이다.**
약관 해석·보험금 지급·인과관계 분쟁이 다수다. 프리케이스가 다루는 판매행위 쟁점은 27건이며 그 구간 정확도는 85.2%다.

**⑤ 코퍼스의 출처–라벨 결합은 구조적 제약이다.**
정식 결정서의 기각 사건은 전체에 60건뿐이고 그 전부를 검증셋에 썼다. 그래서 코퍼스에 decision 기각이 0건이다. 부주의가 아니며, 이를 제거한 매칭 풀 180건으로 재측정해 결론이 동일함을 확인했다.

**⑥ 유의성이 확보된 지표는 둘뿐이다.**
전체 정확도(p < 0.0001)와 확신도 변별력(p = 0.0042). 채널별(p=0.31)·쟁점유형별(p=0.307)·업권별(p=0.336)·오답방향(p=0.458)·약관유무(p=0.158)는 **전부 개선 가설이며 성능 근거로 승격하지 말 것.** 자세한 목록은 [`인수인계.md`](인수인계.md) §4.

---

## 5. 개발 착수 시 바로 쓸 것

| 필요한 것 | 어디에 |
|---|---|
| 법제처 API 사양·인증키·조문 필터 규칙 | `src/api_spec/fix_statute.py` · `test_sources.py` · `statute_sample.json` |
| 판례 검색 부분일치 함정 (사건번호 정확 대조 필수) | `src/api_spec/test_sources.py` |
| 조정례 검색 데이터 | `data/corpus.json` (240건) 또는 `data/pool_matched.json` (180건, 편향 제거) |
| 검색 알고리즘 참고 구현 | `src/experiment/pilot_rag_v2.py` 의 `build_index` · `search` |
| 판단 프롬프트 (운영 설정) | `src/experiment/pilot_law.py` 의 `SYSTEM` |
