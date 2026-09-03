# FinShield 개발 규칙

2026 금융 AI Challenge 출품작. 거래 전 금융정보 검증과 가입 후 PreCase 보호를 하나의 FinancialCase로 연결한다.

상세 기준은 `docs/`를 따른다. `docs/02-integrated-requirements.md`가 최상위 개발 기준이고, `docs/01-product-plan.md`가 이를 보충한다. `docs/03-database-spec.md`는 그 아래에서 Schema·Migration·RLS·Storage 구현 기준으로 사용한다.

## 절대 규칙

### 1. 근거 없는 판단 금지

- 핵심 사실 판단은 Claim과 Evidence 연결 없이 사용자 화면에 표시하지 않는다.
- 도구가 반환하지 않은 조문·공시·상품조건·통계를 모델이 만들어 표시할 수 없어야 한다.
- 근거 부족은 `UNKNOWN`, 정보 부족은 `NEED_MORE_INFORMATION`, 충돌은 `CONFLICT`로 보존한다.
- 유사 분쟁·사기 사례는 `reference_only`이며 현재 거래의 위법·사기를 증명하지 않는다.
- 경고를 찾지 못했다는 이유로 안전하다고 판단하지 않는다.

### 2. 실제 Multi-Agent

- Agent마다 별도 입력·출력 Schema, Tool Allowlist, 실행 기록을 둔다.
- 화면에 Agent 이름만 여러 개 보여주고 하나의 Prompt에서 전부 처리하지 않는다.
- Orchestrator가 필요한 Agent만 선택하고 가능한 Domain Agent는 병렬 실행한다.
- Evidence Judge에는 가능한 한 사용자 원문 대신 확인된 Claim·Evidence 구조를 전달한다.

### 3. 독립 검증

- CoVe는 초기 결론을 반복해서 읽는 Self-review Prompt로 구현하지 않는다.
- 초기 Query·결론과 분리된 검색으로 Material Claim을 다시 검증한다.
- Red Team은 초기 결론을 뒤집을 공식 반대 근거를 찾는다.
- 동일 원문의 복제·재게시를 독립 근거로 계산하지 않는다.

### 4. 개인정보와 파일

- 업로드 원본은 회원 여부와 관계없이 기본 영구 보관하지 않는다.
- MIME·Magic Byte·크기·페이지·악성 파일을 확인한 뒤 OCR·Parsing한다.
- 동의한 외부 OCR 예외를 제외하면 비모델 PII Gate를 거친 마스킹 텍스트만 LLM·Embedding에 전달한다.
- Claim 확인·사용자 중단·Case 삭제 중 먼저 도달한 시점에 원본 삭제를 시도하고 최대 24시간을 넘기지 않는다.
- 원본 보관은 별도 동의·암호화·삭제 기능이 있을 때만 허용한다.
- 사용자 문서와 Embedding을 공용 Knowledge Base에 섞지 않는다.
- 로그에 원본 문서·PII·Secret을 남기지 않는다.

### 5. 권한과 불변 기록

- 모든 사용자 소유 테이블에 RLS와 최소 권한을 적용한다.
- `service_role`과 외부 API Key는 서버에서만 사용한다.
- FinancialCase 생성 시 금융 프로필 Snapshot을 남긴다.
- 검증 결과·Evidence Passport·재검증 결과는 덮어쓰지 않고 새 버전을 생성한다.
- 역할은 클라이언트가 수정할 수 없고 서버 전용 또는 수동 승인 경로만 사용한다.
- 공유는 명시적 초대·최소 권한·만료·회수를 지원해야 한다.

### 6. PreCase 통합 경계

- 사용자를 별도 PreCase 사이트로 이동시키지 않는다.
- Sales Conduct·Regulation & Dispute Agent와 기존 Tool·데이터·안전장치를 내부에서 재사용한다.
- FinShield가 거래 전 판단을 담당하고 PreCase는 가입 후 설명 적정성·이해도·분쟁 준비를 담당한다.
- 가입 사실·송금/피해 의심·검증 상태를 서로 다른 상태 축으로 관리한다.
- 기존 PreCase의 정확도를 FinShield 전체 성능으로 표시하지 않는다.

### 7. 금융·법적 표현

- 상품 가입·송금·투자를 대신 결정하거나 실행하지 않는다.
- 확인된 범위와 한계를 함께 표시한다.
- 확률처럼 보이는 임의의 0~100 사기 점수를 만들지 않는다.
- 신고·문의·정정은 공식 채널로 연결한다.

## 기록 규칙

- 커밋 메시지에 AI 서명·공동저자 트레일러를 넣지 않는다.
- 작은 변경은 짧게 기록하고 모든 PR 본문을 같은 길이로 만들지 않는다.
- 이슈·PR 제목에는 검색 가능한 오류 코드·화면 ID·요구사항 ID를 넣는다.
- 수치나 열거값을 바꿀 때 저장소 전체를 검색한다.
- 상세 규칙은 `.github/ISSUE_PR_PLAYBOOK.md`를 따른다.
