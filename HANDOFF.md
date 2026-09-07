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

## 2026-09-07 저비용 Health 실제 측정

- main run `34084937234`에서 실제 Next HTTP 100회와 DB 장애 시험이 통과했다. 외부 fetch·HTTP·HTTPS 전송 시도는 정상·장애 모두 0회이며 계측 제어는 각각 1회다.
- 보호 Preview와 Production에서도 DB 정상 응답을 확인했다. 미관측 Provider는 `unknown`·전체 `degraded`로 보존한다.
- 별도 Adoption에서 B-HEALTH-01의 부분 PASS만 채택한다. Implementation은 NO-GO, Release는 NOT-EVALUATED다.

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
