# FinShield

Evidence-Verified Multi-Agent 금융 의사결정 생애주기 검증 플랫폼

> 돈을 움직이기 전에, 근거부터 확인하세요.

금융소비자가 대출·저축성상품·투자 권유를 실행하기 전에 입력 내용을 Claim으로 구조화하고, 전문 Agent가 공식 상품·기관·공시·법령·분쟁 근거와 개인 적합성을 조사한다. 핵심 Claim은 CoVe·Red Team·Evidence Policy로 재검증하며, 결과를 Evidence Passport로 저장한다. 실제 가입 후에는 별도 사이트 이동 없이 FinShield 내부의 PreCase 가입 후 보호로 이어진다.

## 현재 상태

이 저장소는 [PreCase](https://github.com/yongzooda/precase)의 2026-09-02 `main` 제품 코드를 기반으로 시작했다.

- Next.js·Agent·Tool·Supabase Migration·테스트 코드를 FinShield 기준선으로 이전
- 기존 PreCase 저장소와 배포 사이트는 그대로 유지
- 과거 실험 원본 `measure/` 87개는 중복 복사하지 않으며 PreCase 저장소를 정본으로 사용
- 현재 Runtime에는 PreCase 이름과 환경변수가 일부 남아 있으며 FinShield 기능 구현 과정에서 단계적으로 분리
- FinShield의 요구사항 정본은 [docs/02-integrated-requirements.md](./docs/02-integrated-requirements.md)
- 상위 서비스 기획은 [docs/01-product-plan.md](./docs/01-product-plan.md)
- DB 구현 기준은 [docs/03-database-spec.md](./docs/03-database-spec.md)
- P0 Provider·외부 연동·실행 인프라 결정과 Implementation/Release Gate는 [docs/adr/001-p0-provider-stack.md](./docs/adr/001-p0-provider-stack.md)

현재 Commit은 문서·개발 기준선이다. 현재 채택 증거는 `B-MODEL-01`·`B-EMBED-01`·`B-SOURCE-02`·`B-SOURCE-03`·`B-FILE-SAFETY`·`B-RUNTIME-01`·`B-LAW-01` 7개다. 새 실행 의존성의 모델 증거는 main 재측정과 별도 채택을 거쳤으며, 현재 상태의 정본은 ADR metadata다. `N-QLT-010` Implementation Gate는 `NO-GO`이고 `N-QLT-009` Release Gate는 기능 구현 뒤 평가한다. FinShield 기능 전체의 구현·운영 검증 완료를 뜻하지 않는다.

P0 Evidence는 active main Ruleset·strict required `check`·SHA 고정 Action·mutation test·main 실행·별도 Adoption PR로 관리한다. GitHub Organization Required Workflow와 외부 App attestation은 제출 후 강화 항목이며, 완료 전 증거를 외부 독립 CI가 보증했다고 표현하지 않는다.

## 서비스 경계

| FinShield | PreCase 기반 가입 후 보호 |
|---|---|
| 거래 전 진위성·거래위험·개인 적합성 검증 | 가입 후 설명 적정성·이해도·분쟁 준비 |
| 상품·기관·공시·문서·개인 프로필 | 법령·분쟁조정·약관·판매행위 |
| 중단·추가 확인·조건부 진행 | 정상 관리·문의·정정·분쟁 준비 |

사용자는 `precase.vercel.app`으로 이동하지 않는다. PreCase의 Agent·Tool·데이터·안전장치를 FinShield 내부 모듈로 재사용한다.

## 문서

| 문서 | 상태 |
|---|---|
| `docs/01-product-plan.md` | 확정 |
| `docs/02-integrated-requirements.md` | 확정·최상위 개발 기준 |
| `docs/03-database-spec.md` | 확정·DB 구현 기준 |
| `docs/adr/001-p0-provider-stack.md` | Architecture 승인·Implementation Gate `NO-GO` |
| `docs/04-feature-spec.md` | `N-QLT-010` Implementation Gate `GO` 후 작성 |

문서 간 충돌 시 우선순위는 다음과 같다.

1. `docs/02-integrated-requirements.md`
2. `docs/01-product-plan.md`
3. DB·기능명세
4. 승인 ADR — 담당 구현 선택에만 적용하며 상위 요구·명세를 덮지 않음
5. `CLAUDE.md`, `AGENTS.md`
6. 코드와 테스트

## 개발 환경

```bash
npm install
# 기존 설정을 덮어쓰지 않는다. 아래 설정 안내를 읽고 실제 전용 개발 값을 입력한다.
cp -n .env.example .env.local
chmod 600 .env.local
npm run dev
```

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

기존 PreCase 테스트 호환을 위해 일부 `PRECASE_*` 환경변수가 남아 있다. 이름만 먼저 바꾸지 않고 관련 코드·테스트·배포 설정을 한 작업 단위에서 함께 이관한다.

`.env.local`의 위치·필수값·시험과 배포의 차이는 [로컬 환경변수 설정 안내](./docs/ops/local-environment.md)를 따른다. 예제 복사만으로 전용 DB·Provider 검증이 완료되지 않는다. Production 또는 PreCase 비밀값을 임의로 복사하지 않는다.

## 저장소 구조

```text
docs/          FinShield 기획·요구사항·DB·ADR·기능 명세
src/app/       화면과 API Route
src/lib/       Agent·Tool·Evidence·운영 모듈
supabase/      Migration과 RLS
scripts/       데이터 적재·분류·검증
.github/       이슈·PR·CI·협업 규칙
HANDOFF.md     진행 상황과 다음 작업의 정본
CLAUDE.md      축소 불가 개발 규칙
```

## 저장소 읽는 법

- `main`은 배포 브랜치다.
- 작업 브랜치는 기본적으로 `codex/` 접두사를 사용한다.
- 작업 완료 후 이슈를 만들고 PR 첫 줄에 `Closes #N`을 적는다.
- PR은 squash merge하며 머지 후 브랜치를 삭제하지 않는다.
- 머지 전 타입 검사·린트·테스트와 배포 Preview를 확인한다.
- 커밋 메시지에 AI 공동저자·생성 도구 트레일러를 넣지 않는다.
- 커밋·squash 메시지·이슈·PR·직접 작성한 댓글의 설명은 한국어로 쓴다. 로컬 훅 활성화: `git config core.hooksPath .githooks`. 기존 커스텀 훅은 덮어쓰지 않는다.
- 기존 SHA를 보존한 [한국어 정정 기록](./docs/ops/korean-record-corrections.md)을 함께 확인한다.

자세한 규칙은 [.github/ISSUE_PR_PLAYBOOK.md](./.github/ISSUE_PR_PLAYBOOK.md)를 따른다.

## 라벨

| 유형 | 의미 |
|---|---|
| `feat` | 기능 |
| `fix` | 결함 |
| `chore` | 설정·정리 |
| `docs` | 문서 |
| `refactor` | 구조 개선 |
| `test` | 테스트 |

| 영역 | 기준 |
|---|---|
| `SCP 범위` | 서비스 범위·우선순위 |
| `F 기능` | 기능 요구사항 |
| `S 화면` | 화면·사용자 흐름 |
| `D 데이터` | 논리 데이터 |
| `AI 에이전트` | Agent·RAG·CoVe·Evidence Policy |
| `E 연동` | API·MCP |
| `N 비기능` | 성능·가용성·접근성 |
| `SEC 보안` | 개인정보·RLS·파일·Prompt Injection |
| `DB` | Schema·Migration·Index |

P0·P1·P2는 라벨 대신 요구사항 속성과 마일스톤으로 관리한다.

## 일정 기준

- 공모전 제출: 2026-09-07 10:00 KST
- 서비스 접근 유지: 2026-09-07 11:00 ~ 2026-09-11 23:59 KST
