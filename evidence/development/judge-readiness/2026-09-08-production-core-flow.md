# 심사 전 Production 핵심 흐름 실측

요구사항: `SCP-008`, `AUTH-001`, `AUTH-005`, `S-002`, `S-017`, `B-DEMO-01`, `B-E2E-01`, `N-QLT-009`.

측정 대상은 main `fee233f7c12062ef362e6f3671791fb0fba06926`의 Production 배포 `dpl_J5k1UZjDRkQ3WRsPRn5QB5sVMiCu`다. Runtime은 Node `v24.18.0`, 실행 region은 `icn1`이었다. 실제 사용자 정보 대신 별도 합성 입력과 합성 계정만 사용했다.

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

## 판정 범위

이 기록은 Production 공개 Demo 2회와 회원가입·탈퇴 1회의 개발 실측이다. 다음 항목은 이 기록으로 완료 처리하지 않는다.

- `B-DEMO-01`: 실제 Agent 실행은 확인했지만 Implementation Gate가 `NO-GO`이고 정식 Release harness·채택 PR 조건을 충족하지 않아 `NOT-EVALUATED`를 유지한다.
- `B-E2E-01`: 회원 Text·Image·PDF 입력부터 OCR·Mask·Claim·Agent·Passport·다른 기기 조회까지 한 실행으로 잇는 Release 표본은 이번에 실행하지 않았다.
- 사용자 제보의 회원 거래 전 검증 화면: 공개 Demo에서는 2단계 회귀가 재현되지 않았지만 회원 Claim 선택·재시도 전체 흐름을 이 표본으로 대체하지 않는다.
- `B-OCR-01`, `B-RETRIEVAL-01`, Workflow 장애 20종, 개인정보 처리자·Vercel 계약, `B-CLAIM-01`은 기존 상태를 유지한다.
- Implementation Gate는 `NO-GO`, Release Gate는 `NOT-EVALUATED`다.
