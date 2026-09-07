# 격리 Preview 서버 연결

`N-QLT-010`의 합성 파일·보안 진단을 위해 GitHub `provider-spike`의 기존 서버 키를 Vercel의 고정 FinShield 실험 브랜치에 준비한다. Production·다른 프로젝트·공유 Preview 설정은 변경하지 않는다.

워크플로는 main 수동 실행만 허용하며 프로젝트·팀·서버 DB 역할·6543·OCR 호스트·기존 Preview SSO 보호를 검사한다. 비밀은 Vercel Secret으로 저장하고 값이나 응답 전문을 로그·artifact로 내보내지 않는다. Git 브랜치는 `codex/p0-audit-contract-spike`로 고정한다. 파일 Gateway는 false로 둔다. 기능 활성화·배포·실제 사용자 자료 처리는 이 구성에 포함하지 않는다.

[Vercel Secret 공식 문서](https://vercel.com/docs/environment-variables/sensitive-environment-variables)에 따라 API의 sensitive·secret 유형과 Preview branch를 명시한다. 설정 존재는 OCR·파일·Workflow Gate 통과가 아니다.
