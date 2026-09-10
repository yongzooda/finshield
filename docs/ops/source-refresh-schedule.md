# 공식 근거 신선도 자동 갱신

요구사항: `S-001`, `EV-009`, `N-OPS-004`. ADR 8.5 의 갱신 후보 6~24시간을 따른다.

## 왜 필요한가

공식 근거는 마지막 수집 기록 뒤 24시간이 지나면 `STALE` 이 되고 확정 판정에 쓰이지 않는다.
2026-09-08 19:39Z 에 한 번 만료돼 공개 Demo·회원 검증의 확정 판정이 모두 `UNKNOWN` 으로 떨어졌다.
2026-09-10 에는 사람이 수집 결과를 받아 적재기를 직접 실행해 풀었다.
사람이 매일 같은 일을 하면 심사 기간 중 한 번만 놓쳐도 Demo 가 근거 부족으로 보인다.

## 실행 내용

`.github/workflows/source-refresh.yml` 이 6시간마다 main 에서 돈다. 수동 실행도 된다.

1. `run-source-evidence.mjs --run` 으로 공공데이터 두 API 와 진흥원 공식 페이지를 수집한다.
   Gate 증거 harness 를 고치지 않고 그대로 부른다.
2. `--validate` 로 같은 raw-metric 정책을 통과한 결과만 다음 단계로 넘긴다.
3. `scripts/kb/load-source-snapshots.mjs --apply` 가 운영 KB 에 Snapshot 과 수집 기록을 적재한다.
   같은 identity 는 새 행을 만들지 않고 `UNCHANGED` 기록만 남긴다.
4. `scripts/kb/refresh-demo-seed-sources.mjs` 가 공개 Demo 고정 근거에 재수집 기록을 잇는다.
   방금 수집한 원문 해시가 고정 Snapshot 의 해시와 같을 때만 쓴다.
   끝에 고정 근거마다 신선 기한을 확인하고 하나라도 신선하지 않으면 실패로 끝낸다.

접속은 `provider-spike` 환경의 `FINSHIELD_DATABASE_URL`(`finshield_worker`)과 `DATA_GO_KR_SERVICE_KEY` 를 쓴다.
두 값 모두 이미 증거 수집 Workflow 가 쓰던 비밀이며 새로 추가하지 않았다.
worker 는 `kb` 표에 추가만 할 수 있어 기존 Snapshot·기록을 바꾸거나 지우지 않는다.

## 실패했을 때

- 공공데이터 접속 시간 초과처럼 수집이 실패하면 적재하지 않고 끝난다. 6시간 뒤 다시 시도한다.
  24시간 기한 안에 세 번 더 시도할 수 있다.
- 원문 해시가 바뀌면 고정 근거에 기록을 잇지 않고 실행이 실패한다.
  내용이 바뀐 자료를 옛 Snapshot 의 신선한 근거로 쓰지 않기 위해서다.
  이때는 Demo Seed 의 고정 근거를 새 Snapshot 으로 다시 검토해야 한다.
- 실패한 예약 실행은 GitHub 이 저장소 관리자에게 알린다.

## 경계

- 이 Workflow 는 운영 자료 갱신이며 Gate 증거 수집이 아니다. 결과를 증거 artifact 로 올리지 않고 채택하지 않는다.
- 금융위 상품 레코드의 기준월이 바뀌면 새 Snapshot 이 생기고 Demo 고정 근거는 기존 기준월에 머문다.
  고정 근거를 바꾸는 일은 Seed 검토와 함께 따로 한다.
- 실행 기록은 GitHub Actions 이력에 남는다. 로그에는 serviceKey·DSN·응답 원문을 남기지 않는다.
