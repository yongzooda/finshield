# FinShield 에이전트 작업 지침

코드나 문서를 수정하기 전에 다음 순서로 읽는다.

1. `CLAUDE.md`
2. `HANDOFF.md`
3. `docs/02-integrated-requirements.md`
4. `docs/01-product-plan.md`
5. `docs/03-database-spec.md`
6. `docs/adr/001-p0-provider-stack.md`
7. 관련 기능명세

`docs/02-integrated-requirements.md`를 최우선 개발 기준으로 사용한다. `docs/03-database-spec.md`는 DB·Migration·RLS·Storage 구현 기준이고 `docs/adr/001-p0-provider-stack.md`는 Provider·공식 출처·실행 인프라 구현 선택을 고정한다. ADR은 상위 요구·DB·기능명세를 덮지 않는다. 하위 명세와 코드는 요구사항 ID를 참조하고 의미나 우선순위를 조용히 바꾸지 않는다.

Provider ADR의 Architecture Decision이 승인됐다는 사실을 Live 연동 성공으로 해석하지 않는다. 현재 Gate 값의 유일한 기준은 ADR metadata다. Implementation Gate가 `NO-GO`이면 Spike harness·격리 인프라·Fixture·보안/삭제 검증만 진행하고, `GO`이면 기능 구현을 진행할 수 있다. 어느 경우든 Release Gate (`N-QLT-009`)를 통과하기 전에는 출시 완료로 표시하지 않는다.

P0 Evidence는 저장소 수준 strict check·SHA pin·mutation test·main 실행·별도 Adoption PR 기준으로 채택하고 외부 독립 보증으로 표현하지 않는다. `B-CI-INTEGRITY` 외부 Required Workflow·App attestation은 제출 후 강화 `DEFERRED`이며 P0 Implementation·Release Gate를 차단하지 않는다.

- 기존 PreCase 저장소와 배포에는 쓰기 작업을 하지 않는다.
- FinShield에서 PreCase는 별도 링크가 아니라 내부 `가입 후 보호` 모듈이다.
- 작업은 이슈·브랜치·PR 단위로 관리하고 squash merge한다.
- 사용자가 2026-09-09 승인한 GitHub 과금 장애 예외: 원격 check가 과금으로 시작되지 않으면 실제 최신 main+PR 병합 후보의 필수 검사를 로컬에서 모두 수행하고 기록한 뒤 소유자 PR 전용 예외로 squash merge한다. 같은 승인 질문을 반복하지 않는다. 코드 검사 실패는 해결해야 하며 원격 성공 상태를 위조하지 않는다. 상세는 `.github/ISSUE_PR_PLAYBOOK.md`의 로컬 검증 병합 절차를 따른다.
- merge와 원격 검증까지 끝난 작업은 `git fetch origin` 후 접근 가능한 FinShield 로컬 작업 폴더를 최신 `origin/main`과 일치시키고 clean 상태를 확인한다. 사용자 로컬 변경은 덮어쓰지 않는다.
- 커밋 메시지에 AI 공동저자·생성 도구 트레일러를 넣지 않는다.
- 커밋·squash 메시지, 이슈·PR 제목과 본문, 직접 작성하는 댓글은 한국어로 쓴다. 기술명·식별자·명령어·원문 로그·GitHub 연결 구문만 원형을 유지한다. 커밋 훅과 PR 한국어 검사를 우회하지 않는다.
- 사용자가 승인한 기존 SHA 보존 방침에 따라 과거 영어 커밋은 재작성하지 않고 `docs/ops/korean-record-corrections.md`의 한국어 정정 기록을 함께 읽는다.
