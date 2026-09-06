# B-LAW-01 법제처 API 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-LAW-01`. 해제 조건은 OC와 등록 도메인 `Referer`와 Preview·Production의 403·429·5xx와 D+1이다.
- 상위 기준은 ADR 5.2와 5.4다.
- 현재 상태: `NOT-EVALUATED`
- 공식 출처 Snapshot의 해시와 attribution 자체는 `B-SOURCE-02`가 이미 쟀다. 여기서는 법제처 API의 접근 조건만 본다.

## 왜 배포 안에서 부르는가

ADR 5.2는 법제처가 요청의 `Referer`를 신청 시 등록한 도메인과 대조한다고 적었다. 그리고 Preview와 Production 각각에서 probe해 어느 범위까지 통과하는지 여기서 확인하라고 요구한다.

GitHub Actions에서 직접 부르면 우리 배포가 아니라 runner의 환경을 재게 된다. 그래서 배포 안에 관측 endpoint를 두고 그 응답만 증거로 쓴다. 응답이 정말 그 배포에서 나왔는지는 배포가 스스로 적은 deployment ID를 Vercel API의 값과 맞춰 확인한다.

## endpoint를 어떻게 잠그는가

이 endpoint는 우리 OC로 외부 API를 부른다. 열어 두면 아무나 쿼터를 태울 수 있다.

그래서 OC에서 유도한 시각 한정 표식을 요구한다. OC 자체는 오가지 않는다. 시험을 돌리는 쪽과 배포 쪽이 이미 같은 값을 환경에 들고 있으므로 새 secret을 만들 필요가 없다. 앞뒤 한 시간까지 받아 경계에서 흔들리지 않게 한다.

## 시나리오

| 키 | Referer | 보려는 것 |
|---|---|---|
| `registered` | 등록 도메인 | 제품 경로가 실제로 통하는가 |
| `absent` | 없음 | 헤더가 없으면 어떻게 되는가 |
| `deployment_url` | 그 배포의 고유 주소 | Preview 도메인이 통과하는 범위 |
| `unregistered` | 우리 소유가 아닌 예약 도메인 | 대조가 실제로 걸리는가 |
| `snapshot` | 등록 도메인 | 고정 질의의 본문 해시 |
| `change_recent` | 등록 도메인 | 어제 자 변경 조문의 반영 여부 |

다른 프로젝트의 등록 도메인은 쓰지 않는다. ADR 5.2가 금지한다. 미등록 사례에는 예약된 `.example` 도메인만 쓴다.

## 합격선

| 항목 | 기준 |
|---|---|
| 기록 수 | 13 |
| 형식이 어긋난 기록 | `0` |
| deployment ID 불일치 | `0` |
| 등록 도메인 통과 | Preview·Production 둘 다 |
| 고정 질의 본문 해시 | 두 번 모두 같음 |
| 등록하지 않은 도메인 통과 | `0` |
| 시간 초과 | `0` |
| 서버 오류 | `0` |

등록하지 않은 도메인으로도 통하면 ADR 5.2의 전제가 틀린 것이다. 그때는 조용히 통과시키지 않고 막는다. 전제를 고치는 것은 ADR 변경으로 한다.

## 실행

1. `provider-spike` environment에 `LAW_API_OC`와 `VERCEL_TOKEN`을 둔다.
2. Vercel 프로젝트에 Protection Bypass for Automation이 켜져 있어야 한다. 배포 고유 주소가 보호돼 있기 때문이다.
3. `Law Evidence` workflow를 main에서 dispatch한다. `development`는 관측만 찍고 결과 파일을 만들지 않는다.
4. 산식을 고쳐야 하면 `development`로만 돌린다. Gate는 한 번만 쓴다.
5. `gate`로 돌려 통과하면 별도 Adoption PR에서 채택하고 ADR 14.1·14.2를 갱신한다.

## 알려진 한계

- 하루 쿼터의 정확한 숫자는 공식 문서에 없다. 이 시험은 실제 계정에서 429가 나는지만 기록한다.
- Preview 도메인은 배포마다 달라진다. 그 도메인이 통과하지 못하더라도 Production 실패로 해석하지 않는다.
- 변경 조문의 D+1 반영은 어제 자 조회 결과로 기록한다. 하루를 실제로 기다리지는 않는다.
- 결과 파일에는 상태와 소요 시간과 본문 길이와 본문 해시만 남는다. 요청 주소와 OC와 본문 원문은 남지 않는다.
