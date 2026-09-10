# B-PROCESSOR-PRIVACY·B-PRIVACY-VERCEL 처리자 계약 inventory

2026-09-10 기록이다. 두 차단 항목이 요구하는 「학습·보존·DPA·region·하위처리자·PII fail-closed」와 「요금제 조건·고객 콘텐츠·region·Log 보존·Workflow 권한·실개인정보 미처리」를 처리자별 축으로 나누고, 각 축이 확인됐는지를 저장소가 기계적으로 검사하게 한다.

이 문서는 계약을 확인했다고 주장하지 않는다. **현재 관측된 축은 0개다.**

## 왜 목록부터 만드는가

지금까지 이 두 항목은 "남아 있다"는 문장으로만 추적됐다. 그러면 무엇을 얼마나 확인했는지 셀 수 없고, 공식 문서 링크를 붙이는 것과 계정을 실제로 읽는 것이 섞인다. 그래서 축을 먼저 고정하고, 관측 근거가 저장소에 있을 때만 확인됨으로 셀 수 있게 한다.

## 검사 규칙

`.github/fixtures/processor-privacy/inventory.json` 이 처리자 다섯과 축 서른을 고정한다. `.github/scripts/processor-privacy-policy.mjs` 가 아래를 강제한다.

- 상태는 `OBSERVED`·`UNVERIFIED`·`NOT_APPLICABLE` 셋뿐이다.
- `OBSERVED` 는 `evidence/` 아래의 실제 관측 파일 경로, `YYYY-MM-DD` 관측일, 관측 방법이 모두 있어야 한다. 파일이 없으면 거부한다.
- `UNVERIFIED`·`NOT_APPLICABLE` 은 관측 항목이 비어 있어야 한다. 근거 없이 상태만 바꾸는 것을 막는다.
- 축이 하나라도 빠지면 거부한다.
- 경로 탈출과 `evidence/` 밖 경로를 거부한다.
- coverage 는 `해당 없음`을 뺀 축 중 관측된 비율이다. 1이 아닌 blocker 는 `PASS` 후보가 아니다.

`.github/scripts/test-processor-privacy-evidence.mjs` 가 변조 17건을 거부하는지 확인한다. 모든 축을 근거 없이 `OBSERVED` 로 바꾸는 시도도 거부 대상에 포함했다.

## 지금 상태

| 처리자 | 축 | 해당 없음 | 관측됨 | 남은 확인 |
|---|---|---|---|---|
| Anthropic | 6 | 0 | 0 | 6 |
| Cohere | 6 | 0 | 0 | 6 |
| CLOVA OCR | 6 | 0 | 0 | 6 |
| Supabase | 6 | 1 | 0 | 5 |
| Vercel | 6 | 0 | 0 | 6 |

Cohere 학습 사용은 2026-09-07 관측에서 **켜져 있었다**(`evidence/development/privacy/2026-09-07-cohere-settings.json`). 이후 껐다는 기록이 `HANDOFF.md` 에 있지만 같은 형식의 재관측 파일이 없다. 근거 없이 `OBSERVED` 로 올리지 않고 재관측 대상으로 둔다.

## 계정 소유자가 해야 하는 것

`actor` 가 `account-owner` 인 축은 제가 대신 확인할 수 없다. 각 콘솔에 로그인해 표시된 값을 읽고, 아래 형식의 관측 파일을 `evidence/development/privacy/` 에 남긴 뒤 inventory 항목을 `OBSERVED` 로 바꾸면 검사가 그 축을 셉니다. 개인 이름·청구 수단·키·원문은 넣지 않는다.

```json
{
  "schema_version": "processor-account-observation-v1",
  "observed_on": "2026-09-10",
  "provider": "Anthropic",
  "method": "로그인된 콘솔의 표시된 UI 읽기",
  "sources": ["https://console.anthropic.com/settings/..."],
  "settings_changed": false
}
```

확인해야 할 값은 inventory 의 `required` 필드에 축마다 적어 뒀다. 요약하면 다음과 같다.

1. **Anthropic** 조직의 학습 사용 설정, 요청·응답 보존 기간, 서명된 DPA 와 서명일, 처리 region, 하위처리자 목록.
2. **Cohere** 현재 학습 사용 설정(2026-09-07 이후 값), 기본 로그 보존 기간, DPA·ZDR 승인 여부, region, 하위처리자.
3. **CLOVA OCR** 업로드 원본의 학습 사용 여부, 원본·인식 결과 보존 기간과 삭제 요청 경로, 위수탁 계약과 국외 이전 조항, region, 하위처리자.
4. **Supabase** 백업·로그 보존과 삭제 후 잔존 기간, 서명된 DPA, Project region 과 백업 위치, 하위처리자.
5. **Vercel** 현재 요금제 약관의 실개인정보 처리 허용 여부, 고객 콘텐츠·지원 접근 조건, 함수 실행 region, Runtime Log 보존 기간, Workflow 실행 기록 접근 권한.

공식 문서 링크만으로는 `OBSERVED` 가 되지 않는다. 그 계정에 적용되는 값을 읽은 기록이어야 한다.

## 저장소가 확인해야 하는 것

`actor` 가 `repository` 인 다섯 축은 실행 경계 측정이다. 마스킹에 실패한 본문이 각 Provider 로 나가지 않는 것, 동의하지 않은 원본이 OCR 로 나가지 않는 것, 역할 경계 밖에서 회원 본문이 읽히지 않는 것, 실개인정보가 실행 로그와 Workflow 인자에 남지 않는 것이다. 기존 `B-CONSENT-01`·`B-SUPABASE-01` 결과와 겹치는 부분이 있지만 그 결과를 그대로 옮겨 적지 않고 이 축으로 다시 측정한다.

## Gate 영향

두 차단 항목은 `provider-evidence.mjs` 에 policy 가 없고 `evidence/provider-stack-gate.json` 에 항목도 없다. 따라서 지금 상태에서는 `PASS` 자체가 거부된다. 이 PR 은 확인 대상을 셀 수 있게 만들 뿐 어떤 축도 통과시키지 않는다. Implementation Gate 는 `NO-GO`, Release Gate 는 `NOT-EVALUATED` 를 유지한다.

실제 사용자 개인정보는 계약 확인 전까지 계속 처리하지 않는다. 이 경계는 이 문서가 완성돼도 자동으로 풀리지 않는다.
