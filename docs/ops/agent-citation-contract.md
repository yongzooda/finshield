# Agent 인용 자격 전달과 운영 배포

2026-09-09. AI-005·AI-012·EV-007·PASS-002 관련 결함 수정이다.

모델에 전체 근거 목록과 일반 규칙은 주었지만, Claim별 사후 인용 제약을 계산한 목록은 전달하지 않았다. 개인 승인 심사 자료·상품 종료·개별 신청 마감·일반 예방 지침의 사용 범위가 엇갈리면 사후 검증이 CITATION_INVALID로 낮췄다. 사용자 화면과 기존 실제 실행의 실패는 삭제하지 않는다. 과거 실행의 원본 모델 응답을 남기지 않았으므로 각각의 실패 원인을 확정했다고 표현하지 않는다.

Domain·CoVe·Red Team·Judge 판단 입력에 같은 서버 검사로 계산한 verified_refs/contradicted_refs/context_refs를 전달한다. 자격 목록은 해당 사실의 지지·반박을 대신하지 않는다. 실제 인용 ref 복원, 미제공 ref 거부, 참고·STALE·불완전 근거 거부, 개인 승인·마감·범죄 범위 검사와 독립성 검사는 그대로다. 모델 출력의 실패를 임의로 성공 처리하거나 재시도 호출을 추가하지 않는다.

Migration 0058은 Agent p0-v4·프롬프트 v4·Manifest v12를 추가한다. 기존 Tool p0-v3, 시간·비용 상한, Evidence/Result 정책, 과거 실행과 Passport는 보존한다. 운영에는 이전 Manifest 존재와 새 버전 부재를 확인한 뒤 이 Migration만 트랜잭션으로 적용한다. 빈 격리 DB의 전체 Migration과 SQL 45까지 통과했다.

사용자는 GitHub 한도 장애에서 로컬 검사 후 배포를 명시 승인했다. PR #293의 실제 병합 후보 cfc3877에서 pr-check.yml의 모든 실행 단계·원격 증거 조회·한국어 기록 검사·타입·lint·기본 683건·Preview를 로컬 실행해 통과했다. GitHub는 관리자 병합도 Required check 실패로 거부했다. 보호 규칙을 변경하거나 원격 CI 성공을 위조하지 않고, 검증 커밋으로 Vercel 운영 후보를 만들어 실제 확인 후 승격한다. 병합 대기 PR과 운영 commit의 차이를 기록한다.

현재 인용 계약 기본 시험 687건 통과·선택적 96건 skip, 타입·build 통과, lint 오류 0·기존 경고 2다. 새 시험은 승인/마감/범죄의 자격 거부, 행동 비교 허용, 종료·참고·STALE 혼합 거부, ref 복원, Domain/독립 검토/Judge 실제 모델 경계의 계약 전달을 확인한다. 실제 PDF와 정상 안내의 Provider 실행·운영 승격은 후속 기록을 따른다. Implementation NO-GO·Release NOT-EVALUATED이며 정식 Gate 채택은 아니다.
