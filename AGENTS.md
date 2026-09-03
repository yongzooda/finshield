# FinShield 에이전트 작업 지침

코드나 문서를 수정하기 전에 다음 순서로 읽는다.

1. `CLAUDE.md`
2. `HANDOFF.md`
3. `docs/02-integrated-requirements.md`
4. `docs/01-product-plan.md`
5. `docs/03-database-spec.md`
6. 관련 기능명세

`docs/02-integrated-requirements.md`를 최우선 개발 기준으로 사용한다. `docs/03-database-spec.md`는 DB·Migration·RLS·Storage 구현 기준이며, 하위 명세와 코드는 요구사항 ID를 참조하고 의미나 우선순위를 조용히 바꾸지 않는다.

- 기존 PreCase 저장소와 배포에는 쓰기 작업을 하지 않는다.
- FinShield에서 PreCase는 별도 링크가 아니라 내부 `가입 후 보호` 모듈이다.
- 작업은 이슈·브랜치·PR 단위로 관리하고 squash merge한다.
- 커밋 메시지에 AI 공동저자·생성 도구 트레일러를 넣지 않는다.
