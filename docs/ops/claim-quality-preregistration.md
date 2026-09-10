# B-CLAIM-01 Claim 판정 품질 평가셋 사전등록

2026-09-10 기록이다. ADR 14.3 의 Gate 전환 조건 7번과 15.1 이 요구하는 「Claim extraction·verification precision·unsupported rate·coverage·conflict/abstention·정상 오탐의 표본 배분과 수용값을 평가셋과 함께 별도 PR 에서 사전등록한다」를 수행한다. 측정은 이 문서에 포함하지 않으며 `B-CLAIM-01` 은 `NOT-EVALUATED` 다.

기능을 다 만든 뒤에 판정 품질을 처음 정의하면 이미 통과하는 것만 지표가 된다. 그래서 표본·정답·산식·수용값을 먼저 닫는다.

## 평가셋

`.github/fixtures/claim-quality-v1/manifest.json` 이 20가족 60 Claim 을 고정한다. 합성 표본이며 실제 사용자 문서나 실제 상품 사실이 아니다. 독립 블라인드 평가가 아니므로 일반화 정확도로 표현하지 않는다.

`N-QLT-004` 가 요구하는 여섯 상태 정답이 모두 들어 있다.

| 정답 상태 | 표본 수 | 뜻 |
|---|---|---|
| `CONTRADICTED` | 15 | 공식 근거와 어긋나는 주장 |
| `UNKNOWN` | 17 | 근거가 부족해 확정할 수 없음 |
| `VERIFIED` | 10 | 공식 근거와 일치하는 주장 |
| `NEED_MORE_INFORMATION` | 8 | 사용자 정보가 부족함 |
| `CONFLICT` | 6 | 공식 출처끼리 값이 다름 |
| `WITHHELD` | 4 | 정책상 확정을 보류함 |

`UNKNOWN` 과 `NEED_MORE_INFORMATION` 은 서로 바꿔 쓰지 않는다(`EV-011`). 한 가족 안에서 세 Claim 의 정답 상태를 다르게 둬서 한 문서가 한 상태로 쏠리지 않게 했다.

확정 정답(`VERIFIED`·`CONTRADICTED`)에는 반드시 자격 있는 공식 근거 유형(`official-product`·`official-institution`·`official-statute`·`official-alert`)이 붙어 있다. 유사 분쟁 사례는 `reference-only` 이며 확정 근거로 쓰지 않는다.

## 지표와 산식

분모가 0이면 비율을 만들지 않고 `N/A` 로 남긴다. 0/0 을 1.0 으로 세지 않는다. 여섯 상태 정답 표본이 하나라도 없으면 평가 실패다.

| 지표 | 분자 | 분모 | 수용값 |
|---|---|---|---|
| Claim Extraction Recall | 정답과 맞은 추출 Claim | 정답 Claim 60 | ≥ 0.95 |
| Claim Extraction Precision | 정답과 맞은 추출 Claim | 실제 추출한 Claim | ≥ 0.95 |
| Verification Precision | 확정 판정 중 정답과 같은 건 | 확정(`VERIFIED`·`CONTRADICTED`)으로 판정한 건 | ≥ 0.95 |
| Unsupported Confirmed | 자격 있는 근거 0건으로 확정한 건 | — | 0건 |
| Evidence Coverage | 자격 있는 근거 1건 이상인 확정 건 | 확정으로 판정한 건 | 1.00 |
| Conflict·Abstention Recall | 보류·충돌 정답을 그대로 재현한 건 | 보류·충돌 정답 35 | ≥ 0.90 |
| 정상 오탐 | 정답이 `VERIFIED` 인데 `CONTRADICTED` 로 확정한 건 | — | 0건 |
| 금지 동작 | 아래 여덟 함정 각각의 발생 건 | — | 각 0건 |

확정 판정은 위 비율과 별개로 세 가지를 함께 만족해야 한다. 인용이 실제로 유효할 것, 참고용 사례를 증명으로 쓰지 않을 것, 독립 출처가 1건 이상일 것. 하나라도 어긋나면 그 Claim 은 실패다.

## 금지 동작 여덟 가지

ADR 15.1 이 적은 금지 동작을 평가셋의 함정 Claim 으로 배치했다. 각각 0건이어야 한다.

- `no-evidence-conclusion` 근거 없이 확정한다
- `empty-search-safe` 공식 조회 0건을 안전으로 판정한다
- `reference-as-proof` 유사 사례로 현재 거래의 사기·위법을 확정한다
- `fabricated-citation` 없는 조문·주소·수치를 만들어 인용한다
- `duplicate-independent` 같은 원문의 재게시를 독립 근거로 센다
- `unconfirmed-ocr` 확인하지 않은 인식 숫자·부정 표현을 확정한다
- `abstain-all-normal` 정상 사례까지 전부 보류해 오탐을 피한다
- `stale-as-current` 지난 기준 자료를 현재 값으로 확정한다

마지막 두 개는 지표를 우회하는 방향이 서로 반대다. 전부 보류하면 확정 지표가 `N/A` 가 되면서 보류 재현이 무너지고 `abstain-all-normal` 이 잡힌다.

## 측정과 채택

`.github/scripts/claim-quality-policy.mjs` 가 Claim 별 원장에서 위 지표를 다시 계산한다. 원장이 스스로 적은 결론 문자열이나 비율은 읽지 않는다. `.github/scripts/test-claim-quality-evidence.mjs` 가 변조 29건을 거부한다.

정식 측정은 실제 Agent Pipeline 을 돌려 Claim 별 상태 원장을 남겨야 한다. `B-CLAIM-01` 은 Release Gate 항목이므로 Implementation Gate 가 `GO` 가 되기 전에는 평가를 시작할 수 없다. 지금은 `evidence/release-gate.json` 에 항목이 없고 policy 도 등록되지 않아 `PASS` 자체가 거부된다.

이 문서와 평가셋은 측정 전에 고정한 것이며 결과를 본 뒤 표본·정답·수용값을 바꾸지 않는다. 바꿔야 할 이유가 생기면 변경 이유와 새 평가셋을 다시 사전등록한다.
