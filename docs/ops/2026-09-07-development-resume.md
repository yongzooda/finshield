# 개발 재개 기록 · 2026-09-07

사용자는 클로드 이동 요청을 취소하고 현재 작업을 계속 진행하도록 요청했다. 아래 내용을 개발 작업 지시와 현황으로 읽고 FinShield의 남은 P0 구현을 이어서 진행해 줘. 단순 계획 제시로 끝내지 말고, 허용된 작업을 실제로 구현·검증하고 이슈·브랜치·PR 단위로 정리해 줘. 미확인 결과를 완료로 표시하지 마.

## 사용자 요청과 현재 중단 지점

처음에는 서비스 완성도 점검에서 발견한 P0 부족분의 개발을 요청했다. 이후 공모전 기획서와 기능명세서에 남아 있던 이미지 5종·7곳에 필요한 기능을 먼저 완성하도록 우선순위를 좁혔다. 제출 시간이 되어 사용자가 「지금 제출본 확정」을 선택했다. 개발을 멈추고 문서에 실제 확인 현황과 목표 설계를 구분했다. 이제 이 작업 브랜치에서 남은 서비스를 계속 완성하는 단계다.

제출본 확정은 서비스 완료나 실제 제출 접수 확인이 아니다. 제출 문서는 사용자 추가 요청 없이 다시 수정하지 마. 이번 커밋·푸시는 작업 보존이며 Production 배포·main 병합 승인이 아니다.

## 작업 위치와 읽는 순서

- 저장소: https://github.com/yongzooda/finshield
- 이어받을 브랜치: `codex/p0-audit-contract-spike`
- 작업 시작 기반: `d55d3136e5106c536f1f741f776db36c9284bf38`
- 현재 작업 폴더: `/Users/yongju/.codex/worktrees/f5b6/finshield`
- 별도 로컬 checkout: `/Users/yongju/Developer/finshield` (현재 브랜치와 같다고 가정하지 마.)
- 기존 전체 결함 추적: https://github.com/yongzooda/finshield/issues/190
- 배포 주소: https://finshield-gamma.vercel.app

먼저 `git status`, 현재 브랜치, 원격 PR 상태와 diff를 확인해. 현재 worktree의 로컬 변경을 덮어쓰지 마. 다른 checkout이면 fetch 후 이 원격 브랜치에서 이어받아.

`CLAUDE.md` → `HANDOFF.md` → `docs/02-integrated-requirements.md` → `docs/01-product-plan.md` → `docs/03-database-spec.md` → `docs/adr/001-p0-provider-stack.md` → 관련 기능명세를 순서대로 읽어. 다음 기록도 읽어:

- `docs/ops/2026-09-07-mvp-audit.md`
- `docs/ops/2026-09-07-submission-stop.md`
- `docs/ops/local-environment.md`, `docs/ops/supabase-project.md`
- `docs/ops/quality-evaluation-plan.md`
- `.github/ISSUE_PR_PLAYBOOK.md`, `docs/ops/korean-record-corrections.md`

## 반드시 유지할 기준

요구사항 02가 최상위이고 DB 명세 03과 Provider ADR을 따른다. ADR metadata는 현재 Implementation `NO-GO`, Release `NOT-EVALUATED`다. 제출 준비 요청에 따라 일부 기능 코드는 작성됐지만 Gate를 변경하거나 출시 완료로 표시하지 않았다. 기존 PASS는 이번 코드의 검증 증거가 아니다. NO-GO에서 허용되는 Spike·격리 인프라·Fixture·보안/삭제 검증을 먼저 정리하고 정식 Gate 절차를 따른다. 차단 원인을 숨기거나 합격선을 낮추지 마.

4개 Domain Agent, 별도 CoVe·Red Team·Evidence Judge, 공식 근거 연결, 3개 독립 판단 축, 불변 Passport/재검증 버전, 소유자 접근 제어, 서버에서 확정한 Claim, 비모델 PII Gate를 유지한다. 요청이나 UI에 Agent 이름만 추가한 모의 구현은 안 된다. 근거 부족·시간 초과·충돌을 보류로 보존한다.

기존 PreCase 저장소·배포에는 쓰지 마. PreCase는 FinShield 내부 가입 후 보호 모듈이다. 커밋·이슈·PR은 한국어, 훅 우회 금지, AI 공동저자/서명 금지. main 직접 push 금지, 검증을 통과한 PR만 squash merge한다.

## 이번 브랜치에서 작성한 것

아래는 구현 및 일부 검증 현황이며 전체 기능 완료 목록이 아니다.

1. **서버 기준 Claim 확정**: `run-input.ts`, intake/verify 경로, Migration 0027. 클라이언트가 보낸 Claim 본문·종류·진행 단계를 그대로 믿지 않고 소유자·revision을 확인한다. 수정 문구에 PII Gate를 다시 적용하고 run에 고정한 Claim/profile을 로드한다. 항목 편집 UI를 추가했다.
2. **Case·Passport 조회 계약**: `case-detail.ts`, Case API, Migration 0026. 접근 불가한 원본 테이블 대신 소유자용 View를 사용한다. 항목 문구·이유·근거 원문/출처/시점/해시, 공식 행동 경로 표시를 추가했다.
3. **독립 검토와 최종화**: model-adapter/runner/orchestrator/finalize. CoVe·Red Team의 서로 다른 출력 schema와 실행 기록, 근거 소유 범위, 항목별 지지·반박 관계를 보완했다. 누락/실패한 검토는 보류 처리한다. 진위성·거래 위험·개인 적합성을 각각 구성한다. 단, 개인 적합성의 실질적 규칙 엔진은 아직 없다.
4. **실행 제한·Judge 이력**: Anthropic 요청 timeout/abort/retry 옵션, 단계 예산, 짧은 출력 prompt, Judge 결과 Claim 누락·중복 검사 및 실행 이력 코드를 추가했다. 마지막 수정의 정상 Live 재실행은 하지 못했다.
5. **수동 재검증**: Migration 0028, `revalidate.ts`와 API. 본인 작업만 lease하고 heartbeat 실패를 전달한다. 알림 작업이 원본 정리 작업을 가져가지 않도록 필터링한다. 실제 실행은 아직 HTTP 요청에 묶여 있다.
6. **가입 후 보호 코드**: 기존 Passport Claim과 사용자가 입력한 계약 문구를 비교한다. `SAME_TEXT`/`DIFFERENT_TEXT`/`NOT_PROVIDED`이며 문구 비교일 뿐 의미·법적 판단이 아니다. 질문 응답/차이를 저장하고 후속 설명·정정 문의 안내를 구성했다. 전체 브라우저 흐름은 검증 전이다.
7. **공식 상품 본문**: `tools/official-product.ts`가 고정한 진흥원 공식 URL에서 실제 본문을 읽고 원문 해시/위치를 만든다. 이전 제목만 있는 검색 결과를 보완하려는 코드다. 정상 최종 결과까지 연결 검증하지 못했다.
8. **파일 처리 기반만 작성**: `@vercel/sandbox@3.2.1`, 파일 슬롯 API, Storage 읽기 helper, 격리 parser와 worker, Migration 0029. 파일 업로드 UI, `/api/finshield/files/process`, OCR client, 원문 대조·Claim 연결·삭제 worker는 미구현이다. 0029는 미적용·미검증이다.

## 실제 확인 결과와 한계

- 배포 서비스: 홈, 회원 텍스트 입력, Claim 추출·선택, 프로필 화면을 확인했다.
- 로컬 개발 서버 + FinShield 실제 DB: Claim 수정, 보류 결과 저장, 회원 Case 상세 200 및 기록 조회를 확인했다.
- 실제 모델 검증과 재검증은 모두 단계 시간 초과로 6개 항목이 보류됐다. 새 Passport와 `NO_CHANGE` 비교 화면을 확인했지만 정상 근거 검증 성공은 아니다. 완료 알림 화면은 확인하지 못했다.
- 격리 Sandbox에서 합성 PDF 1쪽·207자 네이티브 추출이 약 2.7초에 성공했다. 업로드/OCR 서비스 성공은 아니다. 원본 사용자 파일이나 비밀을 Snapshot에 넣지 않았다.
- 마지막 로컬 검사: 타입 검사 통과, 린트 오류 0·기존 경고 2, 테스트 406 통과·82 건너뜀. 실제 Provider를 쓰지 않는 CI placeholder 환경으로 테스트했다.
- SQL: 0001~0028 및 불변식 01~18 통과, 새 테스트 19 별도 통과. 0029 적용 후 전체 SQL 회귀가 남았다.
- Production build, 최종 수정의 Live 전체 흐름, 새 브랜치의 전체 원격 CI는 완료로 간주하지 마. 원격 PR 체크 결과를 직접 확인해.
- 재개 시점 DB 명세 validator는 통과했다. ADR validator는 B-MODEL-01의 package.json/package-lock.json trusted policy pin 불일치로 실패했다. 로컬 실행에서는 Actions 권한·head 검증 조건도 충족하지 못했다. pin만 바꿔 기존 PASS를 재사용하지 말고 증거 갱신 절차를 따른다.

## 원격 DB와 설정: 재개 시 먼저 확인

- FinShield Supabase ref: `exarejrwvjochjdminzo` (서울). 기존 PreCase 프로젝트와 혼동하지 마.
- 실제 FinShield DB에 0026~0028과 동등한 SQL 함수 변경을 대시보드에서 트랜잭션으로 적용했다. migration ledger에는 별도 등록하지 않았다. 재적용 전 실제 함수 정의·권한·ledger를 비교해야 한다.
- 0029는 로컬 파일만 있다. 운영에 적용하지 않았다.
- 합성 검증 Case: `c9a707ee-8a65-4436-90b3-3f0f2ff2d0cd`.
- 합성 테스트 사용자 ID: `dce68ee4-001d-48c1-a3b3-ee3c436deaa2`. 이메일: `finshield-submission-f5b6-20260907@example.com`. 비밀번호는 문서·Git에 없다. 기존 실제 사용자 계정의 비밀번호나 프로필을 바꾸지 마.
- `/Users/yongju/Developer/finshield/.env.local`의 `DATABASE_URL`이 실제 FinShield worker DB였다. 같은 파일의 `FINSHIELD_DATABASE_URL`은 당시 오래된 localhost 설정이었다. 값은 로그에 출력하지 말고 대상 host/role을 비밀 없이 확인해.
- 위 로컬 설정의 모델은 `claude-opus-5`였고 마지막 검증 서버에서 ADR 기준 `claude-sonnet-5`를 명시적으로 사용했다. 사용 환경마다 ADR 모델과 실제 적용값을 확인해.
- 로컬 worktree에는 `.env.local`을 만들지 않았다. 테스트가 실제 비밀을 자동으로 읽지 않도록 CI placeholder 환경을 분리했다.
- Supabase 서버 키의 작업용 임시 파일은 제거했다. 사용자 원본 환경 파일은 변경하지 않았다. CLOVA 자격증명은 이 로컬 작업에 구성하지 못했다.
- Vercel project: `prj_aBYCkjjqdix6jKB14gQPtqtBoeOQ`, team: `team_ey0VM6Dm21aC2HUDWs37dPjs`.
- 점검 당시 Production에 `SUPABASE_SECRET_KEY`, `CLOVA_*`가 없었고 Preview에도 FinShield 인증/DB 설정 보완이 필요했다. 배포별 환경을 다시 조회해. API 키·DB URL·토큰을 채팅/문서/로그/Git에 넣지 마.
- Parser Snapshot: `snap_qRKcMtdxiAzmQhd3hKfIsjeVWVzo`. 의존성만 포함한다. 사용 가능 여부와 만료를 확인하고 재현 가능한 생성 절차를 마련해. 실행 VM은 `persistent:false`, `deny-all`, 35초 제한이며 실행 후 중지한다.
- 종료한 로컬 개발 서버는 3107 포트였다. 개발용 Docker `finshield-f5b6-audit`, 포트 55437은 이 작업의 격리 테스트 DB다. 다른 컨테이너는 건드리지 마.

## 앞으로 할 작업: 우선순위와 완료 조건

### 1. 현재 브랜치·Gate·DB 상태 정리

변경 diff와 새 함수의 소유권/권한을 리뷰하고 미완성 파일 코드를 서비스 완료로 취급하지 마. 0026~0029와 DB 명세·운영 적용 이력을 동기화하고, 0029를 격리 DB에서 먼저 시험해. requirements ID와 의미를 보존해.

Migration 추가는 Supabase/Storage/Consent/Rate/Delete 등 scope digest를, package 변경은 Model 등 관련 Evidence scope를 바꾼다. 어떤 PASS가 무효인지 validator로 확인하고 이력은 보존한다. main 실행·SHA pin·strict check·mutation test·별도 Adoption PR 규칙을 따른다. 기존 main에서 성공한 실행을 새 코드의 증거로 채택하지 마.

### 2. 정상 텍스트 검증 한 건을 실제 끝까지 완성

가장 먼저 실제 공식 근거로 최소 Claim 1건의 정상 전체 흐름을 재현해. 이어서 합성 권유 전체 항목으로 확대해. 4개 Domain → CoVe → Red Team → Judge → Claim/Evidence 저장 → Case/Passport 화면까지 같은 run을 추적한다. Mock이나 임의 결론으로 시간 초과를 감추지 마.

확인할 원인:

- 실제 조사 단계가 8초/12초, Judge가 8초에서 반복 실패했다. 중복 도구 루프, 호출 횟수, 검색 query, 직렬 단계 비용, 응답 크기를 측정해. ADR 예산을 조용히 늘리지 마.
- KB knowledge_documents/chunks는 점검 당시 0건이었다. 적재·검색·공식 출처를 실제로 연결해.
- `get_source_snapshot`, `search_consumer_warning`, `analyze_risk_pattern`, `check_documents`, `search_dispute_case` 등 registry의 미연결 도구를 점검해.
- 공식 상품 페이지에 당시 보증 종료 고지가 있었다. 날짜·유효 범위까지 보존하고 샘플의 연 3%를 실제 공식 조건으로 취급하지 마. 원문은 실행 시 다시 확인해.
- 일부 tool 구현이 abort signal을 실제 fetch/DB까지 전달하지 않는다. deadline 이후 후속 호출·쓰기 차단을 확인해.
- 실패/부분 review output이 최종 판단에 잘못 쓰이지 않는지, 같은 evidence의 항목별 관계가 덮어써지지 않는지 검사해. CONFLICT 저장에는 DB가 요구하는 지지·반박 근거가 있어야 한다.
- Judge 기록의 token/cost가 현재 0으로 저장된다. 실제 사용량과 정확한 FinShield 원장으로 연결해.
- 기존 budget meter가 FinShield에 없는 legacy 테이블을 조회해 `42P01`을 기록했다. PreCase DB를 연결하는 방식으로 해결하지 마.
- verify 예외/스트림 종료 후 run이 항상 terminal 상태로 정리되는지 확인해.

완료 조건: 실제 공식 근거가 있는 정상 결과와 근거 부족/충돌/실패 결과를 구분해 저장하고, 재조회 시 같은 내용·시점·출처가 보이며 교차 사용자 조회가 거부된다.

### 3. 파일/OCR 전체 수직 흐름

회원 업로드 → one-use slot/TUS → MIME/Magic Byte/크기/페이지/위험 검사 → 격리 native PDF parsing 또는 별도 동의 후 CLOVA OCR → 원문 위치와 추출 항목 대조·수정 → PII 검사 → Claim 확정 → 검증·Passport까지 연결해. OCR 동의 거절 시 원본 외부 전송 0건이어야 한다.

현재 없는 process API·업로드 UI·OCR client·page provenance·삭제 worker를 구현한다. 확인/취소/Case 삭제 중 먼저 발생하는 시점에 원본 삭제를 시작하고 24시간 상한 및 파생 자료까지 검증한다. 민감 자료를 sandbox snapshot에 보관하지 않는다. 텍스트·PNG·native PDF·scan PDF·손상/암호화/크기 초과·동의 거절을 실제 흐름으로 확인한다.

### 4. 요청과 독립적인 실행·재검증·알림

ADR의 Workflow/Job Runner에 맞춰 request 종료·새로고침·연결 단절에도 상태를 조회/복구하도록 한다. lease, fencing, retry/replay, 취소, heartbeat, orphan, Provider 결과 불명확 상태를 시험한다. 이전 버전을 보존하고 새 결과와 판단·근거·행동 변화를 비교한다. NO_CHANGE 사례와 실제 변경 사례, 완료 알림 클릭까지 검증한다. 사용하지 않는 오래된 `loadConfirmedClaims` 등 직접 테이블 조회 경로를 정리한다.

### 5. 가입 후 보호와 실질적 개인 적합성

가입 사실과 송금/피해 의심을 별도 상태로 유지한다. Passport에서 이어받은 가입 후 답변/계약 비교를 저장하고 새로고침 후 복원한다. 문구 차이를 의미나 위법 판단으로 확대하지 말고 Sales Conduct/Regulation Agent·공식 자료와 연결한다. 정상 관리/추가 설명/정정 문의/분쟁 준비의 분기를 합성 사례로 검증한다.

개인 적합성은 현재 profile completeness 기반 보류 중심이다. 명세의 상환부담·목적·유동성 등 결정적 규칙과 이유를 구현하고 당시 profile snapshot으로 계산한다. 결과 UI의 내부 reason code·중복 제한 사유도 사용자 표현으로 정리한다.

### 6. 삭제·Privacy·Release 검증과 배포

Case/계정 삭제 503 설정 문제를 해결하고 교차 사용자 접근·기발급 URL·원본/파생 자료 물리 삭제를 확인한다. 공개 체험의 정상 종료, 신뢰센터의 실제 지원 범위, 설정 누락/장애 상태, Rate/Budget/Deadline을 검증한다. 합성 자료로 모바일을 포함한 전체 흐름을 확인하고 Release Gate 증거를 확보한 뒤 정상 PR 절차로 배포한다. Provider 키 존재나 Preview READY만으로 기능 성공을 선언하지 마.

## 제출 산출물과 결과 보고

확정본 PDF는 저장소 `output/pdf/`에도 보존했다. HWPX·샘플·ZIP 전체는 아래 로컬 폴더에 있다:
`/Users/yongju/Documents/FinShield_공모전_최종제출_20260907`

기획서 5쪽·명세서 8쪽이다. 기존 이미지 빈자리 7곳을 실제 확인 현황으로 바꿨고 실제 캡처 4종은 유지했다. 모든 PDF 페이지를 렌더링해 검사했고 HWPX XML·전체 문단과 PDF의 텍스트 일치를 확인했다. HWPX는 최종 수정 후 한컴에서 재출력하지 않았으므로 현재 PDF를 확정본으로 사용한다. 이전 생성 스크립트를 실행하면 문구가 돌아갈 수 있으니 안내 파일을 먼저 읽어. 원본은 `_제출확정전_원본`에 보존했다.

재개 직후에는 현재 PR/CI와 가장 먼저 해결할 차단점만 간단히 보고하고 작업을 진행해. 각 단계가 끝날 때 실제 완료한 흐름, 확인한 증거, 남은 제한을 기록해. 마지막에는 커밋·PR·배포 URL, 테스트 결과, 미완료 기능을 명확히 알려 줘.
