## 2026-09-08 최신 main DB 경계 증거 재채택

- main `fb360014e54647dd99d37970a1ed733ddb80fd5f`에서 Rate·Consent·Storage·Delete·Health를 다시 측정했다. run `34195224699`·`34195228845`·`34195233135`·`34195237392`·`34195239872`가 각 strict policy를 통과해 PR #271에서 채택한다.
- 삭제 대상 35건의 원본·OCR·Vector·기발급 URL 잔존과 teardown 객체 잔존은 0건이다. Health 100회는 외부 Provider 전송 0건이며 DB 장애를 503으로 종결했다. 이 결과는 전체 Live Vertical Slice나 Workflow 장애 시험을 대신하지 않는다.
- 같은 main의 Supabase run `34195221430`은 원격에 Migration 0045의 `private.prepare_initial_verification_retry` 함수 하나가 없어 실패했다. 다른 schema digest와 RLS 시험은 일치했으나 실패를 채택하지 않는다. 함수 복구 뒤 재측정한다.
- 현재 부분 PASS는 12/20이다. OCR·Retrieval·Supabase·Processor Privacy·Vercel Privacy·Job·Deadline·Component Spike가 남아 있어 Implementation `NO-GO`, Release `NOT-EVALUATED`를 유지한다.

## 2026-09-08 회원 복수 Claim 심사 위험 보완

- Production 가입 오류는 직접 가입 설정 복원 뒤 합성 회원가입 200·프로필 조회 200·탈퇴 완료·재로그인 401로 확인했다. 운영 Anthropic 상한은 전체 일 USD 20, 사용자·Case USD 3, Run USD 0.80이며 Cohere는 전체 일 USD 1, 사용자·Case USD 0.25, Run USD 0.10이다. Cohere 학습 사용은 Off다. `rerank-v4.0-fast`는 Production에서 차단하고 승인된 합성 개발 시험만 최대 USD 0.05로 유지한다.
- 회원 `/api/finshield/verify`의 원격 0045 함수 부재 `42501`은 PR #259의 호환 경로로 보완했다. 같은 실패 Case 재시도가 결과로 종결됐다. 원격에는 0045가 아직 적용되지 않았으므로 Migration 완료로 기록하지 않는다.
- PR #261은 Citation 실패를 해당 Claim에만 격리했고, PR #265는 모델 Schema가 실제 Evidence ref만 내도록 제한했다. PR #267은 5~8 Claim의 Evidence Judge를 최대 4개씩 배치 실행한다. main `ca513b9` Production 회원 6 Claim Run은 60.486초에 종결됐고 `JUDGE_DEADLINE_EXCEEDED` 없이 Claim 6건·Evidence 3건·Passport 1건을 저장했다.
- 마지막 회원 Run은 Citation 정책 실패와 Product·Fraud·CoVe·Red Team 부분 상태 때문에 `PARTIAL`이다. 공식 근거 기준을 낮추지 않았으며 회원 정상 전체 성공 또는 Release 완료로 보지 않는다. 처리 중 2단계 회귀·Console 오류는 재현되지 않았고 PR #263의 같은 경로 `새 검증` 초기화도 Production에서 확인했다.
- 이 실측에 쓴 합성 계정의 네 Case와 계정은 탈퇴 Workflow `COMPLETED` 뒤 재로그인 401로 정리했다. 합성 자격 파일과 브라우저 세션도 제거했다.
- [Production 회원·공개 Demo 실측](evidence/development/judge-readiness/2026-09-08-production-core-flow.md)에 실패와 수정 순서를 보존한다. Implementation `NO-GO`, Release `NOT-EVALUATED`다.

## 2026-09-08 심사 전 Production 핵심 흐름 확인

- main `fee233f7` Production 공개 Demo를 API와 실제 브라우저로 실행해 각각 58.947초·60.714초에 성공 종결했다. 두 실행 모두 7개 Agent 성공, Claim 5건·Evidence 6건이며 비용 USD 0.107026·0.110488을 전액 정산했다. 처리 중 2단계로 돌아가는 현상은 공개 Demo에서 재현되지 않았고 결과 근거 펼치기·원문 링크도 동작했다.
- Production 합성 회원가입 200·프로필 조회 200 뒤 계정 탈퇴 Workflow `COMPLETED`와 재로그인 401을 확인했다. 과거 가입 503과 현재 성공을 함께 보존했고 시험 계정은 삭제했다.
- 앞선 v6의 법령 원장 `23514` 실패는 삭제하지 않고 수정 후 성공과 함께 [실측 기록](evidence/development/judge-readiness/2026-09-08-production-core-flow.md)에 남겼다. 회원 Text·Image·PDF 전체 E2E를 이번 표본으로 대체하지 않으며 Implementation `NO-GO`·Release `NOT-EVALUATED`를 유지한다.

## 2026-09-08 공개 Demo v5 실측과 Regulation 후속

- main `2a86ba4`·원격 0048에서 공개 Demo는 55.354초에 종결됐다. Product·Fraud·Sales·CoVe·Red Team·Judge 성공, Claim `CONTRADICTED` 4건·`UNKNOWN` 1건, 권위 A·`FRESH`·`DIRECT` Evidence 5건과 Source 연결을 확인했다. 모델 12호출 USD 0.097440은 정산됐다.
- Regulation 도구 선택은 4초를 넘어 `PARTIAL`이었고 미확정 예약 1건을 보존했다. Migration 0049와 v6 Manifest는 Domain 선택 6초·단계 16초로 보정하며 순차 단계 상한 합은 106초다. 화면에는 약 1분 소요와 단계 갱신을 안내한다.
- v6 원격 적용·재실행 전이며 `B-DEMO-01`·Implementation·Release Gate는 변경하지 않는다. [상세 기록](docs/ops/demo-evidence-connection.md)을 따른다.

## 2026-09-08 공개 Demo 지연·최신성 후속

- main `b05470d`와 원격 0047 적용 뒤 실제 공개 Demo는 60.933초에 부분 종결됐다. Product·Regulation·CoVe·Red Team과 Evidence 5건·Tool-Source 연결은 성공했지만 Sales 7초 판단 제한과 Judge 8초 제한이 만료돼 최종 Claim 다섯 건은 모두 `UNKNOWN`이었다.
- 사칭 안내 재조회 사건이 Demo Seed가 고정한 Snapshot이 아닌 동일 본문 중복 행에 연결돼 `STALE`로 보이는 문제도 확인했다. Migration 0048은 검증된 같은 Hash의 재조회 사건을 Seed Snapshot에 연결하고, v5 Manifest에 Domain 15초·Review 15초·Judge 12초와 공개 Demo 110초 상한을 고정한다.
- 격리·원격 적용과 실제 재실행 전 기록이다. Judge 없이 Domain 결론을 최종 결과로 승격하지 않으며 `B-DEMO-01`·Implementation·Release Gate는 변경하지 않는다. [상세 기록](docs/ops/demo-evidence-connection.md)을 따른다.

## 2026-09-08 공개 Demo 공식 근거 연결 보완

- Production 공개 체험은 약 20~25초에 종결됐지만 Product·Fraud·CoVe·Red Team·Judge가 인용 검증에 실패해 다섯 Claim이 모두 `UNKNOWN`이었다. Tool 성공 원장에도 Source 연결이 0건이었다.
- main `43c40a0`의 B-SOURCE-03 run `34156392378`로 공식 상품·사칭 안내를 다시 확인했다. Migration 0047은 두 문서·Chunk의 새 KB Release와 v4 Manifest를 추가하고, Demo는 Seed가 승인한 Snapshot 범위만 조회한다. Recorder의 저장 Snapshot 연결 누락도 수정했다.
- 격리 DB에서 47개 Migration·SQL 34파일, 관련 단위 시험과 타입 검사가 통과했다. 원격 Migration·배포·실제 Demo 재실행 전이며 `B-RETRIEVAL-01`·`B-DEMO-01`을 PASS로 바꾸지 않았다. [상세 기록](docs/ops/demo-evidence-connection.md)을 따른다.

## 2026-09-08 심사 운영 예산 증액

- 합성 개발 시험용 전체 일 USD 0.50·Case/Run USD 0.20을 심사 운영 상한으로 사용하지 않도록 Migration 0046을 추가했다. 전체 합산은 일 USD 20, 사용자·Case USD 3, Run USD 0.80이다.
- Cohere `embed-v4.0`의 누락된 운영 예산을 추가했다. `rerank-v4.0-fast`는 운영 예산에 등록하지 않고 Production에서 호출을 코드로도 차단했다. 승인된 합성 Fast 개발 시험의 USD 0.05 상한은 그대다.
- 기존 미확정 예약·사용량을 초기화하지 않고 현재 Counter를 증액한다. 더 높은 수동 상한은 낮추지 않으며 Worker에게는 변경 권한이 없다.
- 격리 DB의 46개 Migration·전체 SQL 시험, Vitest 606건, 타입, 린트, Production build가 통과했다. Migration 0046은 실제 FinShield DB에 적용했고 Production main `43c40a0`의 Runtime manifest와 Health를 확인했다. 적용 뒤 상한 12행·활성 Counter·Worker 변경 거부를 확인했으며 미확정 예약 4건 USD 0.172932는 그대로 보존했다. Gate metadata는 변경하지 않았다.

## 2026-09-08 계약 PDF 수정 후 실측 완료·사용자 요청으로 작업 종료

계약 문서 비용 거부를 PR #242로 수정해 main `d4a180f`에 병합했고 원격은 0044다. 구조 해시 6종 일치 후 보호 Preview의 native PDF 처리·문구 확인·두 세션 복원·동일 확인 재시도·과거 Claim 불변과 원본/Case 물리 삭제를 확인했다. 첫 실패와 추가 비용 USD 0.003914를 함께 보존했다. [실측](evidence/development/aftercare/2026-09-08-document-preview.md)을 따른다. 기본 602건 통과·선택적 96건 건너뜀, 44 Migration/SQL 32파일·타입·빌드 통과다. 사용자 요청에 따라 여기서 추가 P0 구현을 멈춘다. Implementation NO-GO·Release NOT-EVALUATED와 Draft #192를 유지한다.

## 2026-09-08 가입 후 PDF 실측 실패와 비용 경계 수정

PR #240은 main `7b3c29c`로 병합됐고 원격 CI가 통과했다. 원격 0043의 구조 해시 6종 일치, RLS/FORCE 83개·anon 누출 0건을 확인했다. 실제 계약 PDF는 마스킹 뒤 비용 예약에서 실패했고 추가 과금은 없었다. 실패 Case는 삭제했다. Migration 0044와 처리 실패 정리를 보완했으며 [실패와 검증 범위](docs/ops/aftercare-input-budget.md)를 따른다. 전체 P0·Gate 완료는 아니다.

## 2026-09-08 가입 후 계약 PDF 비용 예약 수정

보호 Preview의 실제 계약 PDF가 마스킹 뒤 비용 예약에서 거부된 실패를 재현했다. Migration 0044는 같은 Case의 AFTERCARE 문서에 기존 비용 경계를 연결한다. 격리 44 Migration·32 SQL 파일이 통과했으며 상한·소유권·확인 후 재호출 거부를 검사했다. 원격은 0043이며 수정 후 실제 파일 검증과 Gate 재채택은 남아 있다. [실패와 수정 범위](docs/ops/aftercare-input-budget.md)를 따른다.

## 2026-09-08 가입 후 계약 문서 DB 경계

PC-008·PC-011의 Migration 0043과 격리 SQL 시험을 기능 Draft에서 분리했다. 동일 Case의 가입 후 문구는 전용 표에 저장하며 과거 Claim/Passport를 변경하지 않는다. 원격 적용 전 기록은 [검증 범위](docs/ops/aftercare-document-contracts.md)에 보존한다.

## 2026-09-08 가입 후 문서 입력 구현

PC-008·PC-011의 동일 Case Image/PDF 입력·인식 문구 확인·이전 Claim 연결·원본 삭제·저장 복원을 기능 Draft에 추가했다. 거래 전 Claim/Passport는 유지한다. 원격 0043 적용과 배포 검증은 아직 전이며 [격리 구현 범위](docs/ops/aftercare-document-inputs.md)를 따른다. 한국어 기록 검사 PR #238은 main `486667b`에 병합됐고 원격 CI가 통과했다. 전체 Implementation NO-GO·Release NOT-EVALUATED를 유지한다.

## 2026-09-08 실제 가입 후 Agent·원격 0042 검증

원격 0042의 해시 6종 일치와 보호 Preview 점검 접수·중복 방지·두 세션 복원·부분 저장·Case 삭제를 확인했다. Sales 인용 오류와 공식 조회 0건을 보존했으며 두 Agent 품질 성공은 아니다. 추가 비용 USD 0.024174, 합산 일일 사용 USD 0.257351이고 미확정 예약은 0이다. [실측 범위](evidence/development/aftercare/2026-09-08-agent-preview.md)를 따른다. 최신 기능 CI의 Git 메타데이터 검사 실패는 별도 수정 중이다. Gate는 NO-GO이며 과거 기록은 아래에 남긴다.

## 2026-09-08 가입 후 DB 계약 main 통합

분리 PR #236의 실제 merge candidate `6015fa9`와 CI `34139544176`이 통과해 main `dd203fd`로 squash merge됐다. 원격 DB는 0041이며 0042 적용을 준비 중이다. 기능 구현은 기존 Draft #192에 보존한다. main 부분 PASS 8/20·기능 Draft 7/20, Implementation NO-GO·Release NOT-EVALUATED를 유지한다.

## 2026-09-08 가입 후 Agent 실행 연결

PC-005의 점검 전용 Job·Workflow에서 기존 Sales Conduct·Regulation & Dispute Runner와 Tool을 재사용하고 근거·실행·비용을 같은 점검에 귀속했다. 요청 복원·중복 억제·취소·기한·미확정 실행 실패·부분 결과와 과거 Passport 불변을 격리 검증했다. 0042 원격 적용과 새 Preview 검증, 가입 후 파일 입력과 품질 Gate는 남아 있다. [검증 범위](docs/ops/aftercare-agent-review.md)를 따른다.

## 2026-09-08 실제 계정 탈퇴 검증

별도 합성 계정의 Case·실제 TUS PNG에서 보호 Preview 계정 탈퇴 Workflow를 완료했다. 첫 응답 유실 후 다른 세션 복원·접수 후 새 작업 차단·중복 요청·Auth 마지막 삭제·영수증만으로 완료 조회를 확인했다. Auth/Profile/Case/Storage 부재와 완료 원장 1건을 별도 SQL로 확인했다. 기존 시험 계정은 보존하고 임시 Preview 허용 값을 복원했다. [검증 범위](evidence/development/deletion/2026-09-08-account-preview.md)를 따른다. 신규 Slot 차단의 500은 409 안내로 수정했고 전체 장애·Live OCR 파생물 삭제·Release 완료는 아니다.

## 2026-09-07 23시 50분: 원격 DB 계약 적용

PR #234를 main `2ae0230`으로 squash merge하고 원격에 0038~0041만 forward 적용했다. 적용 전 기존 0037 해시 6종, 적용 후 0041 격리 기준 해시 6종이 각각 일치했다. RLS/FORCE 81개·anon 누출 0·Worker 본문 거부 13표를 확인했다. main CI 34134803969는 통과했다. main 부분 PASS 8/20, 기능 Draft는 Health 차이로 7/20이며 정식 재채택 전이다. 실제 합성 계정 탈퇴·Profile/알림 복원을 검증 중이다.

## 2026-09-07 23시: 프로필 적합성 규칙 추가

- Migration 0041은 실행 Snapshot의 부담·비상 자금·목적과 유효한 상품 조건을 결정적 규칙으로 비교한다. 자기신고 확정값을 거부하고 정책 Trace를 불변 Passport 해시에 연결했다.
- 실제 격리 DB에서 현재 프로필 변경 뒤 과거 축/Passport 해시 불변, 종료·다른 상품 제외와 타인 조회 거부를 확인했다. SQL 30파일·기본 575건·타입·린트·빌드 통과, 선택적 skip 96건이다.
- 원격에는 0038~0041이 없고 공용 KB 문서/청크 0/0이다. 별도 DB 계약 PR·적용·Live 검증이 남았으며 이 기록은 Gate 채택이 아니다.
- [검증 범위](evidence/development/profile/2026-09-07-profile-policy.md)를 참조한다.

## 2026-09-07 최종 통합 상태

- 보안 PR #224·#226과 별도 증거 채택 PR #230이 main에 병합됐다. main은 `5498a6d`, 기능 Draft #192의 부분 PASS는 12/20이다. main의 13/20과 Health 측정 범위 차이를 유지한다.
- 실제 증거 채택은 merge candidate `72f6ed3`의 CI `34120542628`이 통과했다. 두 번의 채택 CI 거부 이력과 모든 원본은 보존했다.
- 기본 시험 550건·선택적 94건 건너뜀, 별도 실제 TUS 갱신/삭제 1건 통과다. 코드·브라우저·자연 만료·배포 표본의 범위는 세션 갱신 기록을 따른다. 전체 P0·Release 완료가 아니다.
- 계정 탈퇴 전체 흐름·OCR·검색·Workflow 장애·개인정보 계약·판정 품질은 남아 있다. Cohere 학습 설정 변경과 Rerank Fast 개발 후보는 사용자 결정 전 실행하지 않는다.

## 2026-09-07 P0 DB 계약 분리

Migration 0038~0041과 SQL 시험을 기능 Draft #192에서 분리했다. 새 작업 차단·Auth 마지막 삭제·합산 비용·알림 원자성·Profile Snapshot 비교를 격리 검증했다. 원격은 0037이며 별도 적용/검증이 필요하다. DB scope의 증거 5개를 STALE로 두어 main 부분 PASS는 8/20이다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다. `docs/ops/p0-cleanup-profile-contracts.md`를 따른다.

## 2026-09-07 세션 보안 뒤 증거 재채택

- 별도 PR #230에서 최종 main `72e5405`의 Supabase·Rate·Consent·Storage·Delete 원본을 채택한다. 첫 채택 CI 거부와 두 번의 원본을 모두 보존한다. [측정 범위](evidence/adoption/2026-09-07-session-rls.md)를 따른다.
- 부분 PASS는 main 13/20이며 Implementation NO-GO·Release NOT-EVALUATED다. 기능 Draft의 Health 범위는 별도다.

## 2026-09-07 갱신 보안의 기능 Draft 통합

- main PR #224·#226의 Cookie 갱신·직접 세션 RLS를 기존 기능 Draft에 통합했다. 재검증 Job·중단 신호·서버 Claim·상세 Passport 계약은 보존했다.
- 가입 후 점검과 재검증 조회는 세션 식별자를 사용해 갱신 시 재초기화하지 않는다. 파일 Slot·Process·중단과 TUS 시작·청크·복구 조회에 최신 세션을 적용했다.
- 기본 시험 550건 통과·선택적 94건 건너뜀, 타입·린트 오류 0건·빌드 통과다. TUS 응답 유실·Offset 복원·취소·계정 교체 시험을 포함한다. 기존 린트 경고 2건은 유지한다.
- main 배포의 실제 Cookie 갱신·로그아웃·다른 세션 유지와 정리를 확인했다. [원본](evidence/development/auth/2026-09-07-session-refresh-production.json)은 합성 API 경계이며 전체 파일 Live·Release 증거가 아니다.
- 보호 Preview에서 합성 PNG의 Slot 예약·실제 TUS 시작/청크의 Cookie 회전 두 번·파일과 Case 삭제 COMPLETED·조회 404·세션 정리 200이 통과했다. OCR·모델은 호출하지 않았다.
- 다섯 DB 증거의 재채택 전 현재 Draft PASS는 7/20이다. main은 8/20이며 Health 한 항목의 차이를 유지한다.

## 2026-09-07 세션 갱신 보안 보완

- `AUTH-002` 서버 Cookie 갱신과 보호 요청 전 갱신을 연결했다. 갱신·로그아웃·로그인 교체 경합과 저장하지 않은 입력 보존을 검증했다.
- 기본 시험 449건 통과·선택적 85건 건너뜀, 타입·린트·빌드 통과다. 실제 Supabase 회전·동시 요청·응답 유실 복구와 로컬 Chrome 검증은 [세션 갱신 기록](docs/ops/session-refresh.md)을 따른다.
- 실제 기본 1시간 만료 뒤 조회 거부·Cookie 갱신·조회 복구와 세션 정리가 통과했다. 전체 탈퇴·Gate·Release 완료가 아니다. 직접 RLS는 아래 별도 보안 검증을 따른다.

## 2026-09-07 직접 RLS 세션 경계 보완

- 로그아웃 뒤 유효 JWT로 직접 PostgREST 개인정보 행을 읽는 문제를 실제 재현했다. 원본 실패를 보존한다.
- Migration 0037은 회원 Base table·정의자 Helper·진행 View·Storage slot에서 활성 Auth 세션을 검사한다. 실제 원격 적용·폐기 JWT의 직접 조회·Storage/TUS 거부와 다른 세션 보존·합성 Case 정리를 확인했다. 세부 범위는 `docs/ops/session-rls.md`를 따른다.
- Supabase·Rate·Consent·Storage·Delete의 기존 증거 5개는 DB scope 변경으로 STALE이다. Implementation은 NO-GO이며 새 main 측정과 별도 Adoption이 필요하다.

## 2026-09-07 서버 로그아웃 보안 수정 통합

- main PR #222의 보안 수정을 통합했다. Production 합성 새 세션의 폐기·조회 네 경로 401·다른 세션 유지·시험 세션 정리를 확인했다.
- 상세 Passport 조회 계약과 삭제 전 재인증을 보존하고 로그아웃과 재인증의 동시 실행을 막는다. 기본 시험 517건 통과·선택적 91건 건너뜀이다.
- [실제 검증 기록](docs/ops/session-signout.md)에 새 브랜치 Preview 실패와 Production 성공을 분리했다. 통합 Draft의 보호 Preview에서도 같은 인증 시험과 시험 세션 정리가 통과했다. Gate는 바꾸지 않는다.

## 기능 브랜치의 Health 재측정 경계

- main은 PR #212에서 B-HEALTH-01을 채택했다. 이 기능 브랜치는 `withWorkflow`와 파일 추적 설정이 있는 Next 설정을 사용하므로 main 측정의 build scope와 다르다.
- 원본 실측은 보존하고 이 브랜치에서만 Health를 NOT-EVALUATED로 되돌렸다. 기능·Workflow 인프라 기준선이 main에 반영된 뒤 같은 100회 시험을 다시 측정·채택해야 한다.

# 2026-09-07 추가 개발 기록

- 실제 CLOVA 합성 3문서·12쪽의 응답·페이지·고정 앵커 진단이 통과했다. 전체 파일 서비스·OCR Gate 통과는 아니다.
- 캐시 근거의 수집 시각·만료·출처 등급을 보존하고 모델 입력의 DB 식별자를 제거했다.
- 상세 이력과 남은 장애는 `docs/ops/2026-09-07-development-resume.md`를 따른다. 확정 제출 문서는 보존했다.

# FinShield HANDOFF

## 2026-09-07 제출 이후 개발 재개

- 사용자가 제출본 확정 후 커밋·푸시를 요청했고, 클로드 이동 요청을 취소한 뒤 현재 작업의 개발 계속을 요청했다.
- 최신 작업 상태와 재개 지시는 [개발 재개 기록](docs/ops/2026-09-07-development-resume.md)를 우선 확인한다. 아래 과거 완료·다음 작업 목록은 기준선 이력이므로 현재 작업 브랜치 상태와 구분한다.
- 작업 브랜치는 `codex/p0-audit-contract-spike`다. 서버 Claim 확정, Case 조회, 독립 검토 계약, 보류 결과 저장·수동 재검증을 보완했고 파일 파서·가입 후 비교 코드는 전체 연결 검증 전이다.
- 초기 실제 회원 검증은 시간 초과로 보류됐다. 이후 합성 단일 Claim의 실제 Provider·공식 근거·로컬 worker 저장(약 47초)과 native PDF의 실제 파서·모델·로컬 저장(약 11초, Storage 대체)을 통과했다. 재검증/만료 정리 Workflow와 가입 후 점검 복원도 격리 구현·시험했다. 실제 Storage/OCR 전체 흐름과 Production 반영·Release는 미완료다.
- FinShield DB에 0026~0035를 적용하고 원격·로컬 전체 schema digest 일치를 확인했다. 기존 Migration ledger는 없으며 소급 기록을 만들지 않았다. 관련 Evidence scope를 다시 측정 중이다.
- 11시 추가: 모델 비용 예약·실사용 정산·미확정 보존을 연결했고 입력 취소/늦은 결과 차단을 보완했다. 단위 시험 430건과 실제 합성 단일/복수 Claim 저장을 확인했다. 복수 Claim은 Domain 시간 초과/분쟁 자료 미연결에 따른 부분 결과다.
- 제출 확정 PDF는 `output/pdf/`에 보존했다. 상세 중단 기록은 [제출 우선 중단 기록](docs/ops/2026-09-07-submission-stop.md)을 따른다.
- 13시 추가: 실제 회원 native PDF의 업로드·분석·저장·복원, 보호 Preview의 PNG OCR·8 Claim 추출·물리 삭제, 로컬 HTTP Workflow의 실제 재검증 NO_CHANGE·새 판 보존·새로고침 복원을 확인했다. 10쪽 스캔 인용 페이지 구분은 보완 후 재검증 중이다. 기본 시험 445건 통과·89건 선택적 건너뜀, 실제 로컬 DB 경계 7건 통과다.

## OCR 정식 측정 실패 보존

- 첫 main 실측은 112쪽 처리·숫자·부정 표현·지연 기준을 충족했으나 URL 필드 7개 차이로 F1 0.97917에 그쳐 실패했다. [실패 기록](docs/ops/ocr-quality-failure-20260907.md)과 원본을 보존했고 B-OCR-01은 해제하지 않는다.

## 계정 정리 보호 적용 뒤 DB 증거 재채택

- Migration 0036을 실제 FinShield에 적용했다. 새 main에서 Supabase·Rate·Consent·Storage·Delete 측정 5종이 성공했고 별도 Adoption PR #220에 원본·scope·실행 출처를 등록했다. API 전체 계정 탈퇴나 Release 완료는 아니다.

## 계정 삭제 선행 정리 Guard

- DB 명세 13.3의 Profile 삭제 Guard가 빠져 있었다. 미완료 ACCOUNT 삭제 요청을 남긴 채 Auth 삭제가 성공하는 경로를 로컬 Transaction에서 재현하고 Rollback했다.
- Migration 0036과 SQL 시험 25번으로 Case·임시물·미완료 삭제가 있으면 Auth/Profile 삭제를 차단한다. 빈 로컬 기준 DB의 Migration 36개·SQL 시험 25개가 통과했다. 탈퇴 API·최근 재인증·최종 Worker 완료는 아니다.
- DB scope 변경에 따라 Supabase·Rate·Consent·Storage·Delete를 NOT-EVALUATED로 되돌리고 과거 원본을 보존한다. 원격 적용과 새 main 측정·별도 Adoption이 필요하다. `docs/ops/account-deletion-guard.md`를 따른다.

## OCR 품질 평가 사전등록

- 8개 합성 가족의 Text·Image·digital/scanned PDF 32문서·112쪽과 페이지별 정답·hash 원장을 고정한다. 실제 16회 CLOVA 요청·88쪽을 main에서 측정하는 절차를 등록하며 B-OCR-01은 실제 측정·별도 Adoption 전까지 미평가다.
- 숫자·부정 exact, 기관·상품·URL field F1, 지원 페이지 성공률, 10쪽 P95를 분리한다. 선명한 합성 인쇄 문서 중심이며 실제 사용자 파일·외부 블라인드 평가가 아니다. 자세한 경계는 `docs/ops/ocr-quality-spike.md`를 따른다.

## 2026-09-07 저비용 Health 실제 측정

- main run `34084937234`에서 실제 Next HTTP 100회와 DB 장애 시험이 통과했다. 외부 fetch·HTTP·HTTPS 전송 시도는 정상·장애 모두 0회이며 계측 제어는 각각 1회다.
- 보호 Preview와 Production에서도 DB 정상 응답을 확인했다. 미관측 Provider는 `unknown`·전체 `degraded`로 보존한다.
- 별도 Adoption에서 B-HEALTH-01의 부분 PASS만 채택한다. Implementation은 NO-GO, Release는 NOT-EVALUATED다.

## 2026-09-07 저녁 인증 보안 보완

- 최신 재개 확인표는 [P0 남은 작업](docs/ops/2026-09-07-p0-remaining.md)이다. 기존 Draft #192와 기능 worktree는 보존한다.
- `AUTH-001` 서버 로그아웃을 연결해 현재 Supabase 세션만 폐기하고 반복 요청을 복원한다. 실제 새 세션 두 개의 한쪽 폐기·refresh 거부·다른 쪽 보존을 확인했다. 최초 오류 응답 계약 실패도 보존했다.
- [인증 검증 범위](docs/ops/session-signout.md)를 따른다. refresh 갱신·직접 RLS 세션 폐기·전체 탈퇴·Release는 완료가 아니다. 실제 KB 문서·청크·Embedding은 이번 조회에서도 각 0건이다. Gate metadata는 유지한다.

## 저비용 Health 인프라와 증거 준비

- N-AVL-001에 맞춰 외부 Provider 조회를 Health 요청에서 제거하고 FinShield DB·최근 상태 Cache로 분리한다. 실제 Next HTTP 100회·DB 장애·전송 계측을 같은 main SHA로 측정하는 절차를 등록한다. B-HEALTH-01은 별도 실제 실행·Adoption 전까지 NOT-EVALUATED다.

## 최신 Supabase 증거 재채택

- Migration 0035와 SQL 완료 표기를 반영한 main의 실제 Supabase 검증이 통과했다. 별도 Adoption에서 부분 PASS를 복구한다.

## DB 계약 변경 뒤 증거 재채택 준비

- 새 main의 Rate·Consent·Storage·Delete 측정과 별도 artifact 채택을 진행했다. Migration 0035 기준이며 네 부분 PASS를 복구한다. Supabase 전체·나머지 blocker와 Release는 완료가 아니다.

## 2026-09-07 입력·Worker 인프라 계약

- Migration 0026~0035와 SQL 시험 19~24를 별도 인프라 변경으로 등록했다. 빈 로컬 DB에 전체 Migration·시험을 적용해 통과했다.
- 새 기능의 Runtime·운영 DB 적용·Live 검증 완료는 아니다. `docs/ops/input-worker-contract-spike.md`에 적용 경계를 기록한다.

## 현재 기준

- 저장소: `yongzooda/finshield`
- 기반: PreCase 2026-09-02 `main` 제품 Snapshot
- 요구사항 정본: `docs/02-integrated-requirements.md`
- 상위 기획: `docs/01-product-plan.md`
- DB 구현 기준: `docs/03-database-spec.md`
- Provider Stack ADR: `docs/adr/001-p0-provider-stack.md`
- Provider Implementation Gate (`N-QLT-010`): `NO-GO` — `B-MODEL-01`·`B-EMBED-01`·`B-SOURCE-02`·`B-SOURCE-03`·`B-FILE-SAFETY`·`B-RUNTIME-01`·`B-LAW-01`·`B-RATE-01`·`B-CONSENT-01`·`B-STORAGE-01`·`B-DELETE-01`·`B-SUPABASE-01`이 `PASS`다.
- Migration `0025`가 들어와 `B-SUPABASE-01`·`B-RATE-01`·`B-CONSENT-01`·`B-STORAGE-01`·`B-DELETE-01`의 scope digest가 바뀌었다. 다섯을 다시 재서 채택한다.
- Product Release Gate (`N-QLT-009`): `NOT-EVALUATED` — P0 기능 구현 뒤 평가한다. Claim 판정 품질 `B-CLAIM-01`을 포함해 4개다.
- 배포: Vercel `finshield` Production 연결 완료 (`https://finshield-gamma.vercel.app`)
- 기존 PreCase 저장소·배포: 유지
- 작업 기록: 커밋·squash·이슈·PR·직접 작성한 댓글은 한국어. 과거 SHA는 사용자 승인대로 보존하고 `docs/ops/korean-record-corrections.md`의 정정표를 따른다.
- 로컬 설정: `docs/ops/local-environment.md`를 따른다. `.env.local` 부재는 GitHub Provider 시험의 장애 원인이 아니며 실제 전용 개발 DB 설정과 구분한다.

## 2026-09-07 모델 재측정 결과 채택

- main run `34078050277`과 artifact `10002820639`를 별도 Adoption PR #198에서 채택한다. 합성 50건·실제 호출 100회와 결정적 장애 20건이 동일 정책을 통과했다.
- 직전 run `34077370635`도 통과했지만 OCR 진단 PR #196 병합으로 main이 바뀌어 최신 main에서 다시 측정했다. 두 원본 결과를 보존한다. 아래 재측정 대기 기록은 이 채택 전 이력이다.
- 이 부분 PASS는 Agent 전체·TUS/Storage/OCR·금융 판단 품질의 성공이 아니다. Implementation은 NO-GO, Release는 NOT-EVALUATED를 유지한다.

## 2026-09-07 실행 의존성 사전등록

- 격리 Parser와 요청에서 독립된 Job 검증을 위해 Sandbox·Workflow SDK 및 취약점 수정 의존성을 고정했다. 애플리케이션 기능 코드는 이 변경에 포함하지 않는다.
- 패키지 실행 scope가 바뀌어 `B-MODEL-01`을 `NOT-EVALUATED`, 과거 증거를 `STALE`로 되돌렸다. 아래 모델 측정 완료 항목은 과거 이력이다. 새 main 측정과 별도 Adoption PR을 거쳐야 현재 부분 PASS가 된다.
- 합격식·모델·Fixture·실행 권한·검사 조건을 유지한다. 상세는 `docs/ops/provider-model-spike.md`를 따른다.

## 2026-09-07 제품 점검과 화면 개편

- [서비스 완성도 점검](docs/ops/2026-09-07-mvp-audit.md)을 먼저 확인한다. 아래 과거 작업 완료 목록은 제품 전체의 완료 목록이 아니다.
- 공개 체험이 약 300초 후 종결 응답 없이 멈추고, 회원 Case 상세가 502인 문제를 재현했다. 합성 시험 Case 삭제도 배포 설정 누락으로 503이다.
- Text 입력·일부 Agent·프로필·기록 UI는 존재한다. 파일/OCR, Claim 편집, 독립 검토 출력 계약, 실질적 적합성, 요청과 독립적인 재검증, 가입 후 Agent 연결은 미완료다.
- 홈·공통 메뉴·가입 후 보호 진입·회원 화면을 정리하고 스트림 단절 오류 처리와 Passport 이전 버전 선택을 보완했다. Gate metadata는 변경하지 않았다.
- 과거 기획서의 ‘MVP 완료 가정’과 실제 완료 상태를 구분한다.

## 완료 상태

- [x] 비공개 FinShield 저장소 생성
- [x] PreCase 제품 코드·Agent·Tool·테스트·Supabase Migration 이전
- [x] 과거 측정 원본은 PreCase 저장소를 정본으로 유지
- [x] FinShield 기획서 등록
- [x] README·AGENTS·CLAUDE·HANDOFF 초기화
- [x] 이슈·PR·CI 템플릿 이식
- [x] GitHub 라벨 생성
- [x] main 브랜치 보호와 GitHub Actions `check` 필수 설정
- [x] FinShield 통합 요구사항 명세서와 P0·P1·P2 기준선 확정
- [x] FinShield 목표 데이터베이스 명세와 D-001~D-032 구현 기준선 확정
- [x] Vercel Production 배포 연결 및 `READY` 확인
- [x] P0 Provider·외부 연동·실행 인프라 Architecture Decision과 분리된 Implementation/Release Gate 기준선 확정
- [x] `PUBLIC_MCP_ENABLED=false` P0 공개 `/api/mcp` runtime 404 차단과 ADR drift 검증
- [x] main Ruleset strict required status 활성화와 `B-CI-INTEGRITY` fail-closed preflight·contract test
- [x] `B-CI-INTEGRITY`를 상위 `N-QLT-010`에 맞춰 P0 비차단·제출 후 강화 `DEFERRED`로 재분류
- [x] `B-MODEL-01` Sonnet 5 합성 50건 Live harness·결정적 fault fixture·main-only Evidence 계약 구현
- [x] `B-MODEL-01` main Live Evidence 50건·100 request 합격 및 repository-controlled artifact 채택
- [x] `B-EMBED-01` v2 실패 원인 분해와 개발용 split 전체 순위 측정
- [x] 검색 blocker를 `AI-007` 파이프라인에 맞춰 1차 후보 생성과 종단 Retrieval로 재정의
- [x] 재정의 뒤 `B-MODEL-01` main Live Evidence 재측정과 재채택
- [x] 재정의된 `B-EMBED-01` 을 v4 평가셋으로 main 에서 측정. `FAIL`(Recall@20 0.97)
- [x] ADR 15.1 미달 규칙에 따라 최적화를 선택. 검색 단위를 사용자 문단에서 Claim 하나로 바꿨다. 합격선·풀 크기·Filter 계약은 그대로다. 측정 뒤 재구성이라는 사실을 제출 문서에 명시한다
- [x] Claim 단위 v5 평가셋과 harness, `B-EMBED-01` 측정·채택 (run `33956964817`, Claim별 Recall@20 1.00)
- [x] `B-MODEL-01` 재측정과 재채택 (run `33956322908`)
- [x] FinShield 전용 Anthropic Workspace 키로 `B-MODEL-01` 재측정과 채택
- [x] `.env.example`을 PreCase 복사본에서 FinShield 기준으로 재작성
- [x] FinShield 전용 Supabase 프로젝트 생성과 Migration 기준선 전환
- [x] 명세 6절 표·7.2 서버 함수·9.3 안전 View를 Migration `0004`~`0019`로 구현, 불변식 시험 16개 파일
- [x] `B-SUPABASE-01` 증거 harness와 main 전용 workflow, 운영 프로젝트 `0009`~`0018` 적용·측정·채택 (run `34028092302`)
- [x] `B-SOURCE-02`·`B-SOURCE-03` 햇살론15 Snapshot harness와 main 전용 workflow, 측정·채택 (run `33981161310`·`33981225371`)
- [x] `B-FILE-SAFETY` 합성 Fixture 103건과 격리 Parser 증거 harness, main 전용 workflow, 측정·채택 (run `34027891135`)
- [x] `B-RETRIEVAL-01` 종단 측정 단위 확정과 Case 단위 증거 harness, main 전용 workflow
- [x] `B-RETRIEVAL-01` gate 두 번 측정. 둘 다 미달이며 합격선을 낮추지 않았다 (run `34027686263`·`34029362670`)
- [x] `B-RATE-01` 동시 예약·정산 원장·Rate·Provider 직렬화 증거 harness 와 main 전용 workflow, 측정·채택 (run `34032841560`), 측정·채택 (run `34030770858`)
- [x] `B-STORAGE-01` 인증 사용자 Storage 권한·발급 token 재사용 증거 harness, main 전용 workflow, 측정·채택 (run `34034102812`)
- [x] `B-CONSENT-01` 동의 격리 게이트와 원본 전송 경계 증거 harness, main 전용 workflow, 측정·채택 (run `34033055193`), 측정·채택 (run `34031574803`)

## 다음 작업 순서

1. `N-QLT-010` Live Spike 증거 확보와 Implementation `NO-GO` 차단 해제
   - `B-MODEL-01`은 의존성 변경 뒤 재측정한다. `B-EMBED-01`·`B-SOURCE-02`·`B-SOURCE-03`은 채택됐다. `B-EMBED-01` v1·v2 실패 이력(run `33861971976`·`33870910880`, issue #29)은 회귀셋으로 보존하고 재실행하지 않는다.
   - 채택된 `B-SOURCE-03` 결과는 `scripts/kb/load-source-snapshots.mjs`로 `kb.source_snapshots`에 적재한다. 운영 적재는 Migration 적용 뒤 한다.
   - 나머지 16개 blocker는 `docs/ops/quality-evaluation-plan.md`에 따라 기준 완화·결과 맞춤 라벨 수정 없이 진행하며 Gate 상태를 변경하지 않는다.
2. P0 `docs/04-feature-spec.md` — Implementation Gate가 `GO`가 된 뒤 확정
3. 인증·FinancialCase·Claim·Evidence 수직 구현
4. Image·PDF File Gateway·OCR·PII Gate 구현
5. FinShield Multi-Agent·Hybrid RAG·CoVe·Evidence Policy 구현
6. PreCase 가입 후 보호 모듈 분리·통합
7. 수동 재검증·Evidence Passport·앱 알림
8. `햇살론15` 사칭 권유 Text·Image·PDF P0 Demo와 평가셋
9. 신뢰센터·보안·배포 Gate 점검

정상 저축·투자/OpenDART 도메인은 P0 대출 수직 흐름을 완료한 뒤 P1로 확장한다.

## 알려진 이관 상태

- Runtime과 환경변수에 PreCase 이름이 남아 있다.
- 기존 화면은 PreCase 기준이며 FinShield UI로 재구현해야 한다.
- 기존 PreCase의 Stateless 저장 금지 정책은 FinShield 계정·기록 정책과 다르다.
- 기존 `LIKELY/UNLIKELY`·자체 신뢰도 1~5는 FinShield 최종 결과로 사용할 수 없다.
- `PRECASE_CI` 등 호환 환경변수는 코드·테스트를 함께 수정하는 PR에서 변경한다.
- PreCase 기준선 Migration은 `supabase/precase-baseline/`으로 옮겼고 FinShield 프로젝트에 적용하지 않는다. FinShield Forward-only Migration은 `supabase/migrations/0001`~`0017`이며 운영 프로젝트에는 `0008`까지 적용됐다. 절차와 적용 이력은 `docs/ops/supabase-project.md`를 따른다.
- DB 명세가 확정됐다는 사실은 Migration·RLS·Storage Policy가 구현·적용됐거나 P0 기능이 작동한다는 뜻이 아니다.
- Provider ADR의 Architecture Decision이 승인됐다는 사실은 Implementation 또는 Product Release Gate 통과를 뜻하지 않는다.
- 공개 `/api/mcp`는 P0에서 GET·OPTIONS·POST 모두 404 `MCP_DISABLED`로 차단하며, 기존 MCP protocol 구현은 P1 재검증 전까지 외부 route에서 사용하지 않는다.
- Anthropic Sonnet 5의 auth·quota·schema·strict tool·지연·비용은 FinShield 전용 Workspace 키로 `B-MODEL-01` 범위에서 Live 검증됐다. 무효가 된 이전 run 세 건(`33783765337`·`33883439885`·`33912191567`)의 결과 파일도 이력으로 보존한다. Cohere `embed-v4.0`은 `B-EMBED-01`, 공공데이터 금융위·진흥원 API는 `B-SOURCE-02`·`B-SOURCE-03` 범위에서 Live 검증됐다. CLOVA OCR과 법제처 API는 아직 Live 검증되지 않았다.
- 전용 FinShield Supabase Project와 RLS·교차 소유 거부는 `B-SUPABASE-01` 범위에서 검증됐다. authenticated TUS one-use slot·24시간 물리 삭제와 Vercel Workflow Replay·Fencing은 아직 검증되지 않았다.
- 법제처는 등록 도메인 `Referer`를 대조한다. 동적 egress IP는 차단 사유가 아니지만 배포 도메인이 바뀌면 재등록이 필요하므로 request-time Live 조회를 기본값으로 두지 않고 공식 Snapshot 수집 경로를 검증한다.
- Vercel Function region은 `vercel.json`의 `regions`로 `icn1`(서울)에 고정한다. Supabase 프로젝트가 `ap-northeast-2`라 기본값 `iad1`이면 DB 왕복마다 태평양을 건넌다. Hobby는 단일 region까지 허용한다.
- Vercel은 Hobby를 유지한다. DPA가 없으므로 제출 범위에서 실제 개인정보를 처리하지 않고, 자유 입력은 고지와 PII Gate로 강제한다. Fluid compute의 300초 상한은 Hobby에서도 그대로라 판단 예산에 영향이 없다.
- GitHub의 Vercel success status는 Build/Deploy 성공이며 Provider 기능 성공 증거가 아니다.
- main Ruleset의 required `check`는 strict·bypass 0·Actions retention 90일 기준을 충족한다. 저장소가 개인 소유이고 외부 Required Workflow·App attestation이 없다는 위험은 `B-CI-INTEGRITY = DEFERRED`로 보존하되 P0 Implementation·Release Gate를 차단하지 않는다. P0 증거는 외부 독립 보증이 아닌 `repository-controlled evidence`로만 표시한다.

## 2026-09-07 전체 P0 구현 우선 재개

사용자가 전체 P0 구현 우선 진행을 지시했고 Cohere 학습 사용 Off 및 Fast 합성 개발 시험 최대 USD 0.05를 승인했다. Off 변경과 별도 페이지 재확인을 완료했으며 아직 유료 Provider 호출은 하지 않았다. 계정 탈퇴의 API·화면·Workflow·DB 작업 차단·Auth 마지막 삭제를 기능 Draft에서 구현했다. 격리 SQL과 API 검증은 `evidence/development/deletion/2026-09-07-account-deletion.md`를 따른다. Migration 0038의 원격 적용·Live 파일/Auth/다기기 검증은 남아 있다. 0038로 기능 Draft의 DB 관련 다섯 증거는 STALE이며 Health도 기존 STALE이므로 7/20이다. main은 13/20을 유지한다. Implementation NO-GO·Release NOT-EVALUATED이며 Draft #192 전체를 병합하지 않는다.

공용 KB 도구·Cohere 비용 경계도 구현했다. 상세 범위와 한계는 `evidence/development/retrieval/2026-09-07-public-kb-runtime.md`를 따른다. Migration 0039는 전체/Provider 합산 예약을 추가하며 상한을 자동 설정하지 않는다. PreCase의 고정 corpus 중 20문서·28청크를 로컬 격리 DB에서 검색·본문 복원했다. 참고용·UNKNOWN이며 원격 공식 KB 완성이나 Fast Live 성공은 아니다. 실제 Provider 호출은 아직 0건이다.

기록·삭제 목록에 50건 이후 Cursor 조회를 추가했다. 생성 시각의 microsecond와 ID 동점을 보존하고 계정 전환 시 과거 목록/지연 응답을 격리한다. 기본 573건·선택적 skip 96건과 빌드 통과이며 실제 다기기 대량 목록은 별도 검증이 필요하다.

알림 INSERT·Outbox 완료의 원자성과 과거 PROCESSING 복구를 Migration 0040으로 추가했다. SQL 29파일·기본 572건·빌드가 통과했고 알림은 저장된 Job/Passport 판으로 이동한다. 전역 주기 Dispatcher·원격 적용·Live UI는 아직 검증하지 않았다. 별도 보호 Preview API에서 합성 Case 51개를 두 로그인 세션으로 페이지 조회하고 모두 삭제했다. 기록은 `evidence/development/notifications/`·`evidence/development/records/`를 따른다.
## 2026-09-07 Fast 합성 개발 시험

사용자 승인 범위의 개발 전용 실행 경로를 추가했다. `docs/ops/2026-09-07-rerank-fast-development.md`에 산식·개발 split·최대 USD 0.05·첫 dispatch/attempt·원장 보존을 사전등록했다. 제품 기능 Draft #192와 별도이며 기존 실패 Gate를 재평가하거나 제품 Rerank를 바꾸지 않는다. 현재 계약 시험·기본 449건과 빌드를 통과했고 선택적 85건은 건너뛰었다. 실제 Provider 결과는 실행 뒤 별도 기록한다.

Fast 실제 개발 시험은 main run 34128723611에서 완료했다. Embed 23회·Fast 20회, USD 0.040829, 미확정 0, Fast P95 382ms다. 개발 Case macro Recall/Precision은 동일 후보의 결정적 0.95 → Fast 1.00이며 위험·중복·독립 holdout 품질을 증명하지 않는다. 원본은 `evidence/development/retrieval/fast-34128723611/`에 보존했다. 운영 DB 원장 밖의 개발 비용이므로 다음 일일 예산 확인 때 별도 합산한다. PR #232만 main에 병합했고 main CI·배포 성공 뒤 clean 기준 폴더 8개를 origin/main 00b192a에 맞췄다. 기능 Draft #192는 보존한다.
