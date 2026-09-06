# B-DELETE-01 물리 삭제 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-DELETE-01`. 해제 조건은 확인·중단·Case 삭제·기발급 URL·24시간 cleanup이다.
- 상위 기준은 ADR 6.4 삭제 계약과 15.1 물리 삭제 행, `INP-011`·`D-012`·`SEC-FILE-006`이다.
- 현재 상태: `NOT-EVALUATED`
- 업로드 경계 자체는 `B-STORAGE-01`이 이미 쟀다. 여기서는 올라간 뒤 사라지는지만 본다.
- 삭제 원장과 cleanup 함수는 `0013`에 이미 있다. 그런데 산출물을 만드는 경로가 없었다. worker는 `NOBYPASSRLS`라 소유자 표에 직접 쓰지 못한다. 그래서 Migration `0020`이 페이지·OCR 임시물·Case vector·Claim 등록과 사용자 중단 함수를 채운다.
- `0020`은 `advance_input_stage`도 고친다. Claim 확인 분기가 원본과 OCR 임시물만 청소에 넣고 Case vector를 빠뜨리고 있었다. ADR 15.1은 case vector 잔존까지 0건을 요구한다.

## 왜 여기서는 서버 키를 쓰는가

`B-STORAGE-01`은 우회 키를 쓰지 않았다. 재려던 것이 회원 권한의 경계였기 때문이다. 삭제는 반대다. 격리 Bucket의 객체를 지울 권한은 회원 JWT에 없고, 24시간 만료 청소는 회원이 접속하지 않아도 돌아야 한다. 제품에서도 서버가 키를 들고 지운다. 그래서 이 harness는 서버 키를 삭제와 OCR 임시물 쓰기에만 쓴다.

대신 부재는 서버 키로 판정하지 않는다. 특권 키로 목록을 조회해 "없다"고 적으면, 지운 사실이 아니라 조회 결과를 적는 셈이 된다. 판정은 두 경로로만 한다.

| 판정 경로 | 내용 |
|---|---|
| 기발급 열람 URL | 지우기 전에 서버가 발급한 URL을 자격 없이 그대로 부른다 |
| 회원 JWT 읽기 | 회원 본인의 token으로 객체 경로를 직접 읽는다 |

결과 파일에 이 사실을 남기고 정책이 확인한다.

상태 판정도 소유자 표를 직접 읽지 않는다. worker 역할은 `public.case_inputs`와 `private.input_objects`를 읽지 못하고 `storage` schema 자체를 쓰지 못한다. 그래서 `private.case_embeddings`와 `private.file_cleanup_jobs`와 `public.deletion_requests`만 본다.

객체가 사라졌다는 판정은 세 경로로만 한다. 지우기 전에 발급한 열람 URL과 회원 JWT 읽기, 그리고 `finish_file_cleanup_job`이다. 이 함수는 객체가 아직 있으면 성공 기록 자체를 거부한다. 부재 확인이 DB 안에서 일어나므로 특권 키로 목록을 조회해 판정할 필요가 없다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 산식 버전 | `delete-24h-physical-erasure-v1` |
| Bucket | `finshield-quarantine` |
| Case 수 | 40 |
| 삭제 상한 | 86,400초 |
| 발급 URL 수명 | 900초 |
| 만료 대상 수명 | 60초 |
| 보존 대상 수명 | 3,600초 |
| 경계를 만든 방식 | 만들 때 정한 수명 |
| 멱등 key 범위 | 실행마다 다름 |
| 서버 키 사용 범위 | 삭제와 OCR 임시물 쓰기 |

발급 URL을 제품의 60초가 아니라 900초로 만든다. 오래 사는 URL일수록 삭제 뒤에도 통할 시간이 길어 시험이 더 엄격해진다. 짧게 잡으면 "그냥 만료됐다"로 설명되는 관측이 섞인다. 정책은 확인 시점의 경과가 수명보다 짧았는지도 함께 본다.

## Case 구성

| family | 유발 | 건수 | 기대 |
|---|---|---|---|
| `claim_confirmed` | Claim 확인 | 10 | 삭제 |
| `user_stopped` | 사용자 중단 | 10 | 삭제 |
| `case_deleted` | Case 삭제 요청과 Purge | 10 | 삭제 |
| `ttl_boundary_due` | 만료를 지난 대상 | 5 | 삭제 |
| `ttl_boundary_early` | 만료가 남은 대상 | 5 | 보존 |

Case마다 원본 객체 하나, OCR 임시 객체 하나, Case vector 하나를 만든다. 셋이 모두 사라져야 그 Case를 통과로 센다.

경계 이전 대상 다섯 건은 일부러 남긴다. 만료 청소가 그것까지 집어가면 규칙이 시간이 아니라 우연으로 도는 것이다. 관측이 끝나면 그 다섯 건도 지우고 시험을 마친다.

경계는 `expires_at`을 나중에 고쳐서 만들지 않는다. 만들 때 정한 수명이 실제로 지나가기를 기다린다. 시각을 손으로 옮기면 청소가 시간에 반응했다고 말할 수 없다. 결과에 그 방식을 남기고 정책이 확인한다.

삭제를 유발하는 것도 제품 함수다. harness가 청소 대기열에 직접 넣지 않는다. Claim 확인은 입력 단계를 한 칸씩 전진시켜 `CLAIM_CONFIRMED`에 도달하고, 중단은 `private.stop_case_input`을, Case 삭제는 `private.request_case_deletion`과 `private.purge_case`를 부른다.

## 합격선

| 항목 | 기준 |
|---|---|
| 남은 원본 객체 | `0` |
| 남은 OCR 임시 객체 | `0` |
| 남은 Case vector | `0` |
| 남은 원본·임시물 메타데이터 | `0` |
| 삭제 뒤 기발급 URL 통과 | `0` |
| 삭제 뒤 회원 JWT 읽기 통과 | `0` |
| 삭제까지 걸린 최대 시간 | 86,400초 이하 |
| 만료 이전 대상의 청소 진입 | `0` |
| 만료 이전 대상의 잔존 | `5` |
| Purge 완료 Case | `10` |
| 시험이 남긴 객체 | `0` |

막기만 하는 결과는 통과가 아니다. 삭제하기 전에는 발급 URL이 실제로 본문을 돌려줬어야 한다. 그러지 않으면 뒤의 부재가 무엇을 뜻하는지 알 수 없다. 정책은 삭제 대상 35건 전부에서 이것을 확인한다.

## 실행

1. Migration `0020`을 운영 Supabase 프로젝트에 적용한다.
2. `provider-spike` environment에 `SUPABASE_SECRET_KEY`를 더한다. `B-STORAGE-01`이 쓰는 네 값은 이미 있다. 값은 비밀번호 관리자에만 보관한다.
3. `Delete Evidence` workflow를 main에서 `B-DELETE-01`로 dispatch한다.
4. 정책 미달이면 결과 파일을 만들지 않는다.
5. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

Case 삭제 요청의 멱등 key에는 실행 표식을 넣는다. 고정 key를 쓰면 `request_case_deletion`이 이전 실행의 요청을 그대로 돌려주고, 그러면 이번 실행의 Case에는 청소 작업이 하나도 생기지 않는다. 첫 측정에서 실제로 그 일이 일어나 `case_deleted` 계열 10건의 객체가 남았다.

## 알려진 한계

- 24시간 경계는 짧은 수명으로 줄여 만든다. 실제로 24시간을 기다리지 않는다. DB 제약이 `expires_at`을 생성 후 24시간 안으로 이미 묶고 있으므로 상한 자체는 Schema가 강제한다.
- Vercel Hobby Cron의 하루 1회 실행은 여기서 재지 않는다. ADR 6.4가 이미 그것을 유일한 삭제 장치로 쓰지 않기로 했다.
- Backup 복원 뒤의 재삭제는 Release Gate 항목이다.
- 청소 대상의 Storage 경로를 돌려주는 함수가 아직 없다. worker 역할은 `storage` schema를 쓰지 못한다. 그동안 harness는 청소 작업이 들고 있는 소유자·Case·입력으로 접두사를 만들어 Storage API로 대상을 찾는다. 지울 것을 찾는 용도이지 부재를 판정하는 경로가 아니다. 지우는 행위와 부재 확인은 제품 경로 그대로이지만, 제품의 Cleanup Worker는 이 함수가 생기기 전에는 동작할 수 없다. 다음 Migration 묶음에서 채운다.
- 결과 파일에는 Case 표식과 수치만 남는다. 객체 경로·식별자·서버 키는 남지 않는다.
