# B-RUNTIME-01 실행 Runtime 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-RUNTIME-01`. 해제 조건은 Preview·Production의 실제 Node minor·patch와 deployment와 region이다.
- 상위 기준은 ADR 8.2와 15.1의 Health·Runtime 행이다.
- 현재 상태: `NOT-EVALUATED`
- 같은 15.1 행의 health 100회와 DB 장애 표현은 `B-HEALTH-01`이 따로 잰다. 여기서는 Runtime 값만 본다.

## 왜 배포 안에서 읽어야 하는가

ADR 8.2는 Vercel이 고르는 단위가 `24.x` major이고 minor와 patch는 플랫폼 갱신에 따라 달라진다고 적었다. 그래서 `24.x`를 고정 Snapshot으로 표현하지 말고 각 Run manifest에 실제 값을 남기라고 요구한다.

그 값은 밖에서 알 수 없다. GitHub Actions에서 `process.version`을 읽으면 runner의 Node를 재게 된다. `package.json`의 `engines`를 읽으면 우리가 바란 값을 읽는 것이지 도는 값을 읽는 것이 아니다. 그래서 배포 안에 관측 endpoint를 두고 그 응답만 증거로 쓴다.

Implementation Gate가 `NO-GO`인 동안에도 관측성 작업은 허용된다. 이 endpoint는 P0 사용자 기능이 아니다.

## 응답이 그 배포에서 나왔다는 근거

주소만 보고 판단하지 않는다. Vercel API가 알려준 deployment ID와 배포가 스스로 응답에 적은 deployment ID가 같을 때만 완전한 기록으로 센다. 두 값이 어긋나면 그 응답이 어느 배포에서 나왔는지 알 수 없으므로 표본에서 빠진다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 산식 버전 | `runtime-deployment-manifest-v1` |
| 대상 | Preview와 Production |
| 대상별 표본 | 3 배포 |
| 기대 Node major | 24 |
| Probe 경로 | `/api/runtime-manifest` |

endpoint가 없던 시절의 배포는 404를 돌려준다. 그런 배포는 표본에 넣지 않고 건너뛴다. 그래서 이 harness를 넣은 뒤 Preview와 Production이 각각 세 번 배포된 다음에야 측정할 수 있다.

## 합격선

| 항목 | 기준 |
|---|---|
| Production 표본 | `3` |
| Preview 표본 | `3` |
| Node·region·deployment ID 기록 | `100%` |
| deployment ID 불일치 | `0` |
| 형식이 어긋난 manifest | `0` |
| Node major가 24가 아닌 배포 | `0` |

기록률이 합격선이다. 여섯 배포 중 하나라도 값을 못 받으면 통과가 아니다.

받은 Node 판과 region의 가짓수도 함께 남긴다. minor와 patch가 배포마다 다르다는 사실이 ADR 8.2의 판단 근거이기 때문이다.

## 실행

1. `provider-spike` environment에 `VERCEL_TOKEN`을 둔다. 값은 비밀번호 관리자에만 보관한다.
2. `Runtime Evidence` workflow를 main에서 `B-RUNTIME-01`로 dispatch한다.
3. 정책 미달이면 결과 파일을 만들지 않는다.
4. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

## 알려진 한계

- Vercel이 Node를 올리면 이 증거는 그 시점의 값이 된다. 27일 TTL이 지나면 다시 재야 한다.
- Preview 도메인은 배포마다 달라진다. 등록 도메인 `Referer` 문제는 `B-LAW-01`이 따로 본다.
- 배포 보호가 켜져 있으면 Probe가 401을 받는다. 그 경우 표본이 모자라 정책이 막는다.
- 결과 파일에는 Node 판과 region과 일치 여부만 남는다. token과 deployment ID 원문은 남지 않는다.
