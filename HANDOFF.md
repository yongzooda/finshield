# FinShield HANDOFF

## 현재 기준

- 저장소: `yongzooda/finshield`
- 기반: PreCase 2026-09-02 `main` 제품 Snapshot
- 요구사항 정본: `docs/02-integrated-requirements.md`
- 상위 기획: `docs/01-product-plan.md`
- DB 구현 기준: `docs/03-database-spec.md`
- Provider Stack ADR: `docs/adr/001-p0-provider-stack.md`
- Provider Implementation Gate (`N-QLT-010`): `NO-GO` — `B-MODEL-01` PASS, 나머지 18개 blocker 미해제
- Product Release Gate (`N-QLT-009`): `NOT-EVALUATED` — P0 기능 구현 뒤 평가
- 배포: Vercel `finshield` Production 연결 완료 (`https://finshield-gamma.vercel.app`)
- 기존 PreCase 저장소·배포: 유지
- 작업 기록: 커밋·squash·이슈·PR·직접 작성한 댓글은 한국어. 과거 SHA는 사용자 승인대로 보존하고 `docs/ops/korean-record-corrections.md`의 정정표를 따른다.
- 로컬 설정: `docs/ops/local-environment.md`를 따른다. `.env.local` 부재는 GitHub Provider 시험의 장애 원인이 아니며 실제 전용 개발 DB 설정과 구분한다.

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

## 다음 작업 순서

1. `N-QLT-010` Live Spike 증거 확보와 Implementation `NO-GO` 차단 해제
   - `B-EMBED-01`: v1 run `33861971976` 실패 이력 보존. PR #33의 v2 첫 main run `33870910880`도 품질 실패(순위 원장 재계산 Recall 0.888 / 위험 28/30 / Precision 0.728, Artifact 0). 상세는 issue #29. 지연·비용 로그는 조기 종료로 누락돼 검증 불가하며 추정하지 않는다. v2는 노출된 회귀셋으로 보존하고 재실행하지 않는다. 다음은 원인 분석·검색 설계 검토 후 새 가족 미측정 평가셋의 사전등록이다. `docs/ops/quality-evaluation-plan.md`에 따라 기준 완화·결과 맞춤 라벨 수정 없이 진행하며 Gate 상태를 변경하지 않는다.
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
- 현재 `supabase/migrations/0001~0006`은 이식된 PreCase 기준선이며 FinShield 목표 Schema가 아니다. 전용 Project 확인 뒤 새 Forward-only 기준선으로 전환한다.
- DB 명세가 확정됐다는 사실은 Migration·RLS·Storage Policy가 구현·적용됐거나 P0 기능이 작동한다는 뜻이 아니다.
- Provider ADR의 Architecture Decision이 승인됐다는 사실은 Implementation 또는 Product Release Gate 통과를 뜻하지 않는다.
- 공개 `/api/mcp`는 P0에서 GET·OPTIONS·POST 모두 404 `MCP_DISABLED`로 차단하며, 기존 MCP protocol 구현은 P1 재검증 전까지 외부 route에서 사용하지 않는다.
- Anthropic Sonnet 5의 auth·quota·schema·strict tool·지연·비용은 `B-MODEL-01` 범위에서 Live 검증됐다. Cohere `embed-v4.0`, CLOVA OCR, 공공데이터·법제처 API는 아직 Live 검증되지 않았다.
- 전용 FinShield Supabase Project·RLS·authenticated TUS one-use slot·24시간 물리 삭제와 Vercel Workflow Replay·Fencing은 아직 검증되지 않았다.
- 법제처는 등록 IP와 Vercel 동적 egress가 충돌할 수 있어 request-time Live 조회를 기본값으로 두지 않고 공식 Snapshot 수집 경로를 검증한다.
- GitHub의 Vercel success status는 Build/Deploy 성공이며 Provider 기능 성공 증거가 아니다.
- main Ruleset의 required `check`는 strict·bypass 0·Actions retention 90일 기준을 충족한다. 저장소가 개인 소유이고 외부 Required Workflow·App attestation이 없다는 위험은 `B-CI-INTEGRITY = DEFERRED`로 보존하되 P0 Implementation·Release Gate를 차단하지 않는다. P0 증거는 외부 독립 보증이 아닌 `repository-controlled evidence`로만 표시한다.
