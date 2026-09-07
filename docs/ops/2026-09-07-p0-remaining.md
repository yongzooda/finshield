# 2026-09-07 개발 재개 확인표

원격 확인 기준은 main `6e096aa`, Draft #192 `e84b52a`다. Draft의 원격 CI `34091783329`와 Preview는 성공했고 기존 기능 worktree는 clean이었다. 현재 작업은 main에서 분리한 `fix/auth-session-logout`의 보안 수정이다. 기존 기능 브랜치를 강제 checkout하거나 제출 확정본을 수정하지 않았다.

현재 ADR metadata는 Implementation `NO-GO`, Release `NOT-EVALUATED`다. main 부분 PASS는 13/20, Draft는 Next/Workflow 빌드 범위 차이로 Health를 상속하지 않아 12/20이다. 아래 Draft 검증은 기존 파일·코드·개발 증거의 확인이며 이번에 전부 재실행한 목록이 아니다.

| 요구사항·차단 항목 | 확인된 구현·검증 | 남은 작업·단계 |
|---|---|---|
| AUTH-001~002·AUTH-011 | 로그인 존재, Draft 삭제 재인증 실측, 이번 서버 로그아웃·세션 격리 실제 확인 | refresh 보관·갱신·회전·만료 복귀·직접 RLS 세션 폐기 미완료 |
| AUTH-005·D-014·SEC-PRI-005 | Migration 0036 선행 정리 Guard, Draft Case 삭제·반복 요청 실제 확인 | 전체 계정 탈퇴·신규 작업 경합·Auth 마지막 삭제 미구현·Live 미검증 |
| INP-001~013·CLM-001~004·B-OCR-01 | Draft native PDF·PNG·10쪽 스캔의 실제 처리·물리 삭제 연결 | 정식 field F1 0.9791667 실패 유지, 개발 진단·새 가족 사전등록 평가·OCR 확인 UX 필요 |
| AI-006~008·EV-002~009·B-RETRIEVAL-01 | 후보 생성 PASS, 종단 두 차례 미달. 이번 실제 worker 조회에서 KB 문서·청크·Embedding 각 0건 | 기존 gate 재측정 금지, 범위/Provider 별도 결정·공식 자료 적재·미연결 도구 필요 |
| REV-001~007·N-PERF-005/009·B-JOB-01·B-DEADLINE-01 | Draft 실제 재검증 NO_CHANGE·과거 판 보존, 격리 DB 종결 rollback·중복 복구 | 실제 배포 장애 20종·Lease·취소 경합·기한·Orphan·TTL 검증 및 Gate 미채택 |
| AI-009~021·EV-001~016·RES-001 | Draft 단일 Claim 실제 실행·저장과 실패 안전 상태 | 복수 Claim은 부분 결과, 독립 검토 품질·실질적 적합성·일반 상품 유효 시점 미완료 |
| PC-001~011 | Draft 가입 사실·계약 문구·설문 4개 저장·복원 실제 확인 | Sales/Regulation Agent 재사용·가입 후 파일 경계·법적 표현 품질 미완료 |
| PASS-002/004·CASE-004/006·REV-005 | Draft 이전 Passport·새 판·새로고침 복원 | 프로필 변경 불변성·다른 기기 완료 기록·50건 이후 목록·Outbox Orphan 검증 필요 |
| SEC-PRI·SEC-AI-008·B-PROCESSOR-PRIVACY·B-PRIVACY-VERCEL | 합성 전용 조건, PII·동의·삭제 구성요소 검증 존재 | 실제 계정 설정·DPA·보존·region·하위처리자·로그·PII 경계 미채택 |
| N-OPS-002~004·B-HEALTH-01 | Draft 모델 비용 예약·실사용 정산·미확정 보존, main 저비용 Health PASS | OCR/Embedding 비용·사용량 대조·다중 인스턴스 실제 경로·Draft Health 재측정 필요 |
| N-QLT-010·B-SPIKE-01 | NO-GO 허용 격리·보안 검증 단계 | 선행 blocker·사전등록 Claim 평가·실제 component vertical·구현/실패 안전성 검토 후 GO 판단 |
| N-QLT-009·B-DEMO/E2E/BUILD/CLAIM | Release 미평가 | GO 이후 전체 수직 흐름·필수 Live skip 0·판정 품질 평가 필요 |

다음 인증 작업은 refresh 보관/회전과 로그아웃 경쟁의 설계를 함께 검증해야 한다. 전체 탈퇴는 Profile Guard를 유지한 채 신규 작업 차단과 마지막 Auth 삭제의 원자성을 먼저 격리 시험한다. OCR·검색 실패셋은 회귀 이력으로 보존한다. 유료 플랜·새 계약·범위 변경은 이 작업에 포함하지 않는다.
