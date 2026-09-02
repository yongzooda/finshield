# 측정 원자료

**화면(S-06)이 공개하는 수치는 전부 여기서 파생된다.** 원자료가 없으면 수치를
재현할 수 없고, 재현할 수 없는 수치는 공개하면 안 된다 (N-803).

이 폴더가 생긴 이유 — 원자료가 `~/Downloads/프리케이스/results`에만 있었다.
그 폴더가 정리되면 공개 수치의 근거가 사라지고, 실제로 macOS 권한이 바뀌자
읽을 수 없게 되어 적재가 막혔다 (2026.08.17).

**그때는 요약본 두 개만 옮겼다.** 산출 코드와 데이터셋은 여전히 다운로드
폴더에만 있었고, 그 폴더를 지우려다 발견해 2026.08.26에 `experiment/`로
마저 들여왔다. 같은 사고를 두 번 겪지 않기 위해 **이제 재현에 필요한 것이
전부 저장소 안에 있다** — 원문 HWP만 예외다(아래).

## 파일

| 파일 | 무엇을 잰 것인가 | 출처 |
|---|---|---|
| `product-measure.jsonl` | **제품 기준** — 소비자 진술에서 정제한 사실관계로 판단 | `measure-product-live.test.ts` |
| `kpi_report.json` | **이전 실험** — 완결된 결정서로 위원회 결과 예측 | `pilot_law.py` → `report_kpi.py` |
| `reproducibility.json` | 위 실험의 재현 2회차 | `reproducibility.py` |
| `consistency-measure.jsonl` | **R-04 자기일관성** — 120건 × 판단 3회 (기각) | `measure-consistency-live.test.ts` |
| `prompt-train.jsonl` · `prompt-holdout.jsonl` | **확신도 루브릭 본실험** — 훈련 60건 × 변형 3종 × 2회 / 홀드아웃 60건 × V2 × 2회 (기각) | `measure-prompt-live.test.ts` |

**기각된 실험의 원자료도 지우지 않는다.** 두 실험 모두 사전 고정 기준으로
판정했고(R-04 · 본실험), 그 판정이 실제로 수행됐다는 근거가 원자료다.
요약과 한계는 `consistency-measure.md` · `prompt-measure.md`.

**둘은 다른 과제를 잰 것이다.** 실험 수치를 제품 성능으로 걸어 두었던 것이
2026.08.17에 바로잡은 문제다. 실험 수치는 지우지 않는다 — 당시 측정이 실제로
수행된 기록이고, 화면에는 「이전 측정」으로 구분해 싣는다.

## 다시 적재하기

```bash
.venv/bin/python scripts/load_validation_stats.py \
  --results-dir measure --product-measure measure/product-measure.jsonl
```

## 다시 측정하기 (제품 기준)

```bash
PRECASE_LIVE=1 npx vitest run src/lib/agents/__tests__/measure-product-live.test.ts
```

한 건씩 `product-measure.jsonl`에 쌓이고, 중단돼도 다시 돌리면 이어서 한다.
실측 120건에 약 1시간 30분.

## `consult-measure.jsonl` · `consult-measure.md`

① 상담 계층 슬롯 추출 측정 (2026.08.23 · 진술 43건). 요약과 한계는 `consult-measure.md`.

이 측정이 따로 필요한 이유는 **제품 측정이 판단 계층만 잰다**는 데 있다.
`measure-product-live.test.ts`는 `consult`를 호출하지 않고 `channel`을 상수로 둔다.
그 격리는 의도적이지만, 그 바깥 구간이 통째로 미측정으로 남아 있었다.

---

## `experiment/` — 이전 실험 일체 (2026.08.26 편입)

`kpi_report.json`·`reproducibility.json`을 **만들어 낸 코드와 데이터**다.
README가 출처로 `pilot_law.py` → `report_kpi.py`를 지목하면서 정작 그 파일이
저장소에 없던 상태를 바로잡은 것이다.

| 경로 | 무엇 |
|---|---|
| `experiment/src/` | 측정 파이프라인 20개 — `collect` → `parse` → `dataset` → `experiment` → `analysis` |
| `experiment/results/` | 실험 결과 14개 (RAG 대조·법령 모델 비교·임계 홀드아웃·용어 효과·채널×연령) |
| `experiment/data/` | `labels_v1.json` **360건**(코퍼스 라벨) · `eval_set.json` **120건**(검증셋) · `corpus.json` · `leakage_report.json`(누출 점검) 등 |
| `experiment/docs/` | 기획서 수정안 1·2차, 실험·재측정 실행순서 (2026.08 초 문서 — **현행 정본이 아니다**) |
| `experiment/requirements.txt` | `src/` 재실행에 필요한 파이썬 의존성 |

`kpi_report.json`과 `reproducibility.json`은 **`measure/` 최상위가 정본이다.**
`experiment/results/`에 사본을 두지 않았다 — 같은 수치가 두 곳에 있으면 언젠가
갈라진다.

### ⚠️ 원문 HWP는 저장소에 없다

`.gitignore`가 `data/raw/`·`*.hwp`를 **「공공누리 범위 밖 재배포 방지」**로
막고 있다. 금감원 조정결정서 원문 665개(약 100MB)는 저장소 밖에 압축 보관한다.

```
~/Documents/precase-원자료-hwp-20260826.zip   (78MB · 670개 · 전량 해시 대조 완료)
```

`experiment/src/collect/fss_collect.py`로 재수집할 수 있으나, 금감원 페이지가
바뀌면 그대로 복원되지 않는다. **이 압축본이 사라지면 되돌릴 방법이 없다.**
`experiment/data/panel_reasoning.json`이 HWP 파일명을 키로 쓰므로, 풀 때
파일명이 깨지지 않는 도구를 쓸 것(macOS 기본 `unzip`은 정상).

### ⚠️ 저장소를 공개로 바꾸기 전에 확인할 것

`experiment/data/corpus.json`·`eval_set.json`·`panel_reasoning.json`은
**조정결정서 본문을 담는다.** 지금은 저장소가 private이라 재배포가 아니지만,
공개로 전환하면 `.gitignore`가 원문 HWP를 막아 둔 이유가 그대로 적용된다.
공개 전에 이 세 파일의 처리를 먼저 정할 것.
