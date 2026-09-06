# B-STORAGE-01 Storage 권한 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-STORAGE-01`. 해제 조건은 positive/negative test와 발급 URL·token 재사용 거부다.
- 상위 기준은 ADR 6.1의 업로드 흐름과 `SEC-FILE-001`·`SEC-FILE-002`·`SEC-FILE-006`이다.
- 현재 상태: `NOT-EVALUATED`
- 교차 소유 200건과 즉시 접근 차단은 `B-SUPABASE-01`의 행렬이 이미 쟀다. 여기서는 실제 Storage HTTP 경로만 본다.

## 왜 우회 키를 쓰지 않는가

`service_role`은 RLS를 전부 우회한다. 그 키로 재면 제품이 실제로 쓰는 경로가 아니라 우회 경로를 재는 셈이다. 이 harness는 시험 전용 계정으로 실제 로그인해 받은 사용자 JWT만 쓴다. 공개 키(`anon` 또는 publishable)는 브라우저에 나가도 되는 값이고 RLS를 그대로 지킨다. 결과 파일에 우회 키 미사용 사실을 남기고 정책이 그것을 확인한다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 산식 버전 | `storage-authenticated-slot-v1` |
| Bucket | `finshield-quarantine`, 비공개, 상한 10 MiB |
| slot 생성 | `private.open_upload_slot`가 만든다. 경로는 `소유자/Case/입력/무작위.확장자`이고 호출자가 고르지 못한다 |
| 자격 | 시험 계정 로그인으로 받은 사용자 JWT. 우회 키를 쓰지 않는다 |
| 덮어쓰기 | `x-upsert: false`로만 올린다 |

## 시나리오

| 키 | 기대 | 내용 |
|---|---|---|
| `open_slot_upload` | 허용 | 서버가 준 경로에 회원이 올린다 |
| `same_path_upsert` | 거부 | 같은 경로에 다시 올린다 |
| `foreign_path_upload` | 거부 | 다른 소유자 경로에 올린다 |
| `anonymous_upload` | 거부 | 로그인 없이 올린다 |
| `owner_read` | 거부 | 본인 객체를 직접 읽는다. 열람은 서버가 발급하는 짧은 URL로만 한다 |
| `owner_list` | 거부 | 본인 폴더를 나열한다 |
| `oversize_upload` | 거부 | 상한을 넘는 본문을 올린다 |
| `closed_slot_upload` | 거부 | 닫힌 slot 경로에 올린다 |
| `resumable_token_after_close` | 거부 | slot이 열려 있을 때 재개 업로드 URL을 받아 두고 닫은 뒤 본문을 보낸다 |

마지막 항목이 ADR 6.1이 Live Gate에서 보라고 한 지점이다. 발급된 URL의 유효시간이 앱 설정만으로 짧아졌다고 가정하지 않는다.

## 합격선

| 항목 | 기준 |
|---|---|
| 허용되지 않은 쓰기 | `0` |
| 허용되지 않은 읽기 | `0` |
| 덮어쓰기 통과 | `0` |
| 닫힌 slot의 발급 token 재사용 통과 | `0` |
| 정상 업로드 경로 | 기대한 만큼 모두 통과 |
| 우회 키 사용 | `false` |

막기만 하는 결과는 통과가 아니다. 정상 업로드가 실제로 동작해야 한다.

## 실행

1. `provider-spike` environment에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_TEST_EMAIL`, `SUPABASE_TEST_PASSWORD`를 둔다. 값은 비밀번호 관리자에만 보관한다.
2. `Storage Evidence` workflow를 main에서 `B-STORAGE-01`로 dispatch한다.
3. 정책 미달이면 결과 파일을 만들지 않는다.
4. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

## 알려진 한계

- 이 시험은 운영 프로젝트에 시험용 객체를 잠깐 만든다. 격리 Bucket의 24시간 만료와 Cleanup 경로가 지운다.
- 24시간 물리 삭제와 기발급 열람 URL의 만료는 `B-DELETE-01`이 잰다. 여기서는 업로드 경계만 본다.
- Magic Byte 검증 자체는 `B-FILE-SAFETY`가 쟀다. 여기서는 slot이 선언 MIME을 거르는지만 본다.
- 시험 계정의 비밀번호는 GitHub environment secret에만 있고 결과 파일과 로그에 남지 않는다.
