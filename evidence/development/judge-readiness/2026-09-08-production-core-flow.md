# 심사 전 Production 핵심 흐름 실측

요구사항: `SCP-008`, `AUTH-001`, `AUTH-005`, `S-002`, `S-017`, `B-DEMO-01`, `B-E2E-01`, `N-QLT-009`.

최초 측정 대상은 main `fee233f7c12062ef362e6f3671791fb0fba06926`의 Production 배포 `dpl_J5k1UZjDRkQ3WRsPRn5QB5sVMiCu`다. 회원 복수 Claim 후속 측정은 main `ca513b932669890196033f4202735425a0f7d949`의 Production 배포 `dpl_QTRd63S9iw839ediR8aApXcdsczT`에서 했다. 두 배포의 Runtime은 Node `v24.18.0`, 실행 region은 `icn1`이었다. 실제 사용자 정보 대신 별도 합성 입력과 합성 계정만 사용했다.

## 공개 Demo API

Production `/api/demo`에 공개 Seed 실행을 요청해 HTTP 스트림과 DB 실행 원장을 함께 확인했다.

| 항목 | 실측값 |
|---|---|
| Run | `8561b2b4-2dfa-4770-9563-b32c8be6e965` |
| HTTP | `200`, 59.780초에 스트림 종료 |
| DB 종결 | `SUCCEEDED`, 58.947초 |
| 최종 상태 | `MATERIAL_RISK_FOUND`, `partial=false` |
| Agent | Product·Fraud·Sales·Regulation·CoVe·Red Team·Evidence Judge 7개 모두 `SUCCEEDED` |
| Claim | 5건: `CONTRADICTED` 4건, `UNKNOWN` 1건 |
| Evidence | 6건 |
| 비용 | 13호출, USD 0.107026 전액 정산 |
| 미확정 예약 | 0건 |

법령 근거에는 법령명·실제 조문 번호·한 조문의 본문이 함께 저장됐다. `UNKNOWN` Claim에는 근거를 억지로 연결하지 않았고, 최종 결론은 Product와 공식 사칭 방지 안내를 인용했다.

## 실제 브라우저

1440px 데스크톱 브라우저에서 `https://finshield-gamma.vercel.app/live-demo`를 열고 `체험 시작하기`를 눌렀다. 약 30초 뒤에도 `확인하는 중` 상태가 유지됐고, 다음 확인 시 `항목별 확인 결과`로 전환됐다. 실행 중 2단계 입력 화면으로 돌아가거나 같은 버튼을 다시 누르게 되는 현상은 재현되지 않았다.

| 항목 | 실측값 |
|---|---|
| Run | `38f5a21d-a6e0-4e3c-a577-13b43471d186` |
| DB 종결 | `SUCCEEDED`, 60.714초 |
| 최종 상태 | `MATERIAL_RISK_FOUND`, `partial=false` |
| Agent | 7개 모두 `SUCCEEDED` |
| Claim·Evidence | 5건·6건 |
| 비용 | 13호출, USD 0.110488 전액 정산 |
| 미확정 예약 | 0건 |

근거 펼치기와 `원문 열기` 링크를 확인했고 브라우저 Console 오류는 없었다. 390×844 viewport에서도 공개 Demo와 회원가입 화면이 렌더링되고 문서 스크롤이 동작했다. 결과 화면 원본은 [Production 공개 Demo 결과](2026-09-08-production-demo-success.png)에 보존한다.

## 회원가입과 계정 정리

Production에서 합성 이메일·비밀번호로 `/api/finshield/signup`을 호출했다. 가입은 HTTP 200과 `needs_confirmation=false`로 끝났고 같은 세션의 프로필 조회도 200이었다. 이어 최근 인증이 유지된 상태에서 계정 탈퇴 영수증을 만들고 삭제 Workflow를 접수했다. 약 6초 뒤 세 번째 조회에서 `COMPLETED`를 확인했고 같은 자격 정보의 재로그인은 401로 거부됐다.

Vercel Runtime Log에는 과거 `/api/finshield/signup` 503과 현재 설정 적용 뒤 200이 함께 남아 있다. 현재 Production에는 직접 가입 허용 설정이 존재한다. 합성 이메일·비밀번호·Token은 기록하거나 커밋하지 않았고 시험 계정은 완전히 삭제했다.

## 실패 이력과 수정 경계

같은 v6 Manifest의 이전 Production Run `0cd8d398-afc9-4332-9cd1-2f792ee0dd44`는 법령 Source Snapshot의 `article_no` 누락으로 PostgreSQL `23514`가 발생해 `FAILED`로 종결됐다. 이 실패를 삭제하지 않았다. main `fee233f7`은 법령 검색과 본문 선택에서 실제 한 조문을 고정하도록 수정했고, 위 API·브라우저 두 실행은 그 수정 이후 성공 표본이다.

Provider의 최근 관측값이 없는 Health 응답은 `unknown`·전체 `degraded`를 유지했다. 이는 위 실행 실패를 뜻하지 않지만 Provider 전체가 정상이라는 근거로도 사용하지 않는다.

## 회원 복수 Claim 실패와 수정

Production 회원 거래 전 검증에서 Run 준비 함수가 원격 Migration 0045 미적용으로 `42501`을 반환했다. 화면은 실행 실패 뒤 2단계로 돌아갔고 같은 버튼을 눌러도 다시 실패했다. PR #259는 원격 함수가 없을 때 회원 RLS와 기존 Security Definer 함수로 Run·Claim을 안전하게 준비하는 호환 경로를 추가했다. 같은 Case의 재시도는 새 Case를 만들지 않고 결과 화면까지 종결됐다. 원격 DB에는 Migration 0045를 적용하지 않았으므로 함수 적용 완료로 기록하지 않는다.

그 뒤 회원 6~7 Claim 합성 입력에서 전체 요청이 63~72초 안에 종결됐지만, 잘못된 Citation 하나가 여러 Claim 결과를 버리거나 Evidence Judge가 12초를 넘는 문제가 드러났다. 다음 순서로 실패 원본을 보존하며 수정했다.

| main | Run | DB 종결 | 결과와 확인 범위 |
|---|---|---:|---|
| `ce2077a` | `67b076e4-d6c5-4728-9df0-1feec28b3f2c` | `PARTIAL`, 63.698초 | Citation 실패를 해당 Claim에만 격리해 6개 Claim 중 4개에 근거 버튼을 보존했다. Judge는 시간 안에 끝났지만 인용 정책 실패가 남았다. |
| `fbc6d95` | `ee0f72a5-32b1-49e4-99ce-c617ddd1e2e2` | `PARTIAL`, 70.012초 | 모델 출력 Schema를 실제 전달 Evidence ref로 제한했다. Fraud는 종결됐지만 Judge가 `JUDGE_DEADLINE_EXCEEDED`로 끝나 최종 여섯 항목을 모두 확정하지 않았다. |
| `ca513b9` | `6b76dbc6-9528-43e6-825d-ad6e51223fb8` | `PARTIAL`, 60.486초 | Judge 입력을 Claim 최대 4개씩 두 배치로 나눠 같은 12초 경계에서 병렬 실행했다. Judge 시간 초과가 사라졌고 최종 Claim 6건·Claim-Evidence 연결 4건·Evidence 3건·Passport 1건을 저장했다. |
| `ba42700` | `a53b10f7-da93-4d16-9194-2f28e918d26f` | `PARTIAL`, 71.520초 | 판정 상태별 인용 자격을 출력 Schema에서 제한했다. `CITATION_INVALID`와 `JUDGE_CITATION_INVALID`는 발생하지 않았고 Product/Institution의 판단 호출만 9초 상한을 넘겨 `DEADLINE_EXCEEDED`로 끝났다. 나머지 Domain·CoVe·Red Team·Judge는 모두 성공했다. |

마지막 실행의 부분 사유는 `CITATION_INVALID` 4건, `JUDGE_CITATION_INVALID` 1건과 Product·Fraud·CoVe·Red Team의 부분 상태다. 공식 근거 정책을 통과하지 못한 항목은 `UNKNOWN`으로 유지했고, 기준을 낮추거나 근거 없는 결론을 승격하지 않았다. 처리 중 5초와 약 30초에 실행 화면과 Agent 진행 상황이 유지됐고 약 1분 뒤 결과로 전환됐다. 2단계 회귀, 중복 버튼, Console 오류는 재현되지 않았다. 결과 화면은 [Production 회원 6 Claim 결과](2026-09-08-production-member-six-claim-result.png)에 보존한다.

`ba42700` 후속 실행에서는 선택한 7개 Claim과 13개 Tool 호출이 모두 저장됐다. Product/Institution은 Tool 선택과 공식 상품·기관 조회까지 성공했지만 마지막 판단이 9초 제한을 넘겼다. 전체 실행은 결과 화면과 Passport로 종결됐고 2단계로 돌아가지 않았다. 이 실측을 근거로 선택 6초, 판단 11초, Domain 단계 18초, 순차 전체 115초의 `finshield-p0-loan-v7` Manifest를 별도 변경으로 만들었다. 새 Manifest의 로컬 적용과 시간 합 계약만 확인했으며 원격 DB 적용과 수정 후 Production 재실측 전에는 정상 전체 완료로 세지 않는다.

같은 `/verify`에서 결과를 본 뒤 상단 `새 검증`을 누르면 Client Component 상태가 남아 이전 결과가 유지되는 문제도 재현했다. PR #263은 이 링크에서 문서 탐색을 수행하게 했고, Production에서 전송하지 않은 입력과 이전 결과가 사라진 1단계로 초기화되는 것을 확인했다.

후속 측정에 쓴 합성 계정은 최근 비밀번호 재인증 뒤 탈퇴를 접수했다. 네 Case를 차례로 정리한 요청은 `COMPLETED`로 종결됐고 화면도 비로그인 상태와 `자료 정리와 계정 삭제를 확인했습니다`로 전환됐다. 같은 자격 정보의 재로그인은 HTTP 401이었다. 합성 자격 파일과 브라우저 세션은 제거했다.

## 판정 범위

이 기록은 Production 공개 Demo 2회, 회원가입·탈퇴 1회와 회원 복수 Claim 후속 실행의 개발 실측이다. 다음 항목은 이 기록으로 완료 처리하지 않는다.

- `B-DEMO-01`: 실제 Agent 실행은 확인했지만 Implementation Gate가 `NO-GO`이고 정식 Release harness·채택 PR 조건을 충족하지 않아 `NOT-EVALUATED`를 유지한다.
- `B-E2E-01`: 회원 Text·Image·PDF 입력부터 OCR·Mask·Claim·Agent·Passport·다른 기기 조회까지 한 실행으로 잇는 Release 표본은 이번에 실행하지 않았다.
- 회원 거래 전 검증: Text 6 Claim은 실행·결과·재시도·새 검증 초기화를 확인했지만 인용 정책 실패에 따른 `PARTIAL`이 남아 정상 전체 완료 표본이 아니다. Image·PDF와 다른 기기 복원도 이 표본으로 대체하지 않는다.
- `B-OCR-01`, `B-RETRIEVAL-01`, Workflow 장애 20종, 개인정보 처리자·Vercel 계약, `B-CLAIM-01`은 기존 상태를 유지한다.
- Implementation Gate는 `NO-GO`, Release Gate는 `NOT-EVALUATED`다.
