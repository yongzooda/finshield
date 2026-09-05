# ADR 정정 대기 목록

`docs/adr/001-p0-provider-stack.md` 본문을 한 글자라도 고치면 ADR decision
digest 가 달라지고, 이미 채택한 Implementation `PASS` 증거가 모두 무효가 된다.
정규화 대상은 Gate metadata 두 줄, blocker 표의 상태 열, 14.1 `EVID-*` 행뿐이고
나머지 산문·범위·해제 조건은 전부 digest 에 들어간다.

따라서 발견한 정정 사항을 바로 고치지 않고 여기에 모은다. 채택된 `PASS` 가
적을 때 한 PR 로 묶어 고치고, 영향받는 blocker 를 다시 측정한다.

정정을 미루는 동안에도 발견 사실 자체는 여기에 남긴다. 문서가 서로 어긋난
상태를 모른 채 구현하지 않기 위해서다.

## 대기 중

없음.

## 처리 완료

### 1. 임시 객체 경로 형식이 ADR 과 DB 명세에서 다르다 (2026-09-05 처리)

`owner_id/case_id/input_id/random.<safe_ext>` 로 통일했다. ADR 6.1 과 DB 명세 6.2 를 같은 PR 에서 고쳤다. `B-EMBED-01` Claim 단위 전환 ADR 변경에 묶어 처리해 별도 재측정 비용은 들지 않았다.

- ADR 6.1: `owner_id/case_id/input_id/random-id`
- DB 명세 6.2 `private.input_objects.object_path`: `<owner>/<case>/<random>.<safe_ext>`

`input_id` 포함 여부와 확장자 표기가 다르다. `input_id` 가 있으면 같은 Case 의
서로 다른 입력이 경로에서 구분되고, 확장자는 서버 검증 결과를 경로에 남긴다.
두 장점을 합치면 `owner_id/case_id/input_id/random.<safe_ext>` 가 된다.

`B-STORAGE-01` 은 발급 경로와 재사용 거부를 시험하므로 그 전에 하나로 정해야
한다. `0004` Migration 은 경로 조작만 거부하고 segment 구성을 고정하지 않았다.

영향 blocker: `B-STORAGE-01`, `B-DELETE-01`

2026-09-05 Hobby·법제처 등록 도메인 정정은 채택된 `PASS` 가 0개일 때 처리해
재측정 비용이 없었다.
