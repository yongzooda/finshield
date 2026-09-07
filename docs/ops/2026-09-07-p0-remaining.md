추가 적합성 구현: Migration 0041의 Profile Policy v2를 연결했다. 부담·목적·기간 주의사항과 가입/상환 정보 부족을 구분하며 현재 Profile 변경 후 이전 Passport 불변을 실제 격리 DB에서 확인했다. 일반 상품 조건·원격 적용·Live UI·판정 품질 Gate는 남아 있다. 상세는 `evidence/development/profile/2026-09-07-profile-policy.md`를 따른다.

Fast 개발 실제 완료: main run 34128723611, 4가족 20 Claim, USD 0.040829(Embed 포함), 미확정 0, Fast P95 382ms. 같은 후보 개발 macro Recall/Precision은 결정적 0.95·Fast 1.00이다. 기존 Gate 실패·제품 기본 Rerank는 유지한다. 운영 DB 원장 밖 개발 비용을 다음 일일 예산에 별도 합산해야 한다.

추가 알림 구현: Migration 0040의 알림·Outbox 원자성, 과거 PROCESSING 복구·중복 방지·소유자별 조회 복구를 연결했다. 실제 격리 SQL 29파일·기본 572건·빌드를 통과했다. 알림의 저장된 판 이동도 구현했으며 원격 적용·Live UI·전역 주기 Dispatcher는 남았다. 기록 페이지는 보호 Preview에서 합성 Case 51개를 별도 두 로그인 세션으로 누락/중복 없이 조회하고 전부 삭제했다.

추가 기록 구현: CASE-004·CASE-006의 생성 시각/ID Cursor로 50건 이후 기록을 이어 조회한다. 기록·삭제 화면은 계정 전환 시 이전 목록을 숨기고 늦게 도착한 다른 세션 응답을 폐기한다. 기본 573건·선택적 skip 96건, TypeScript·lint·build를 통과했다. 실제 다기기 51건 조회는 아직 검증하지 않았다.

추가 검색 구현: 공용 KB의 Snapshot·자료 준비·분쟁·위험패턴 도구, Metadata·실제 FTS·Vector·결정적 Rerank와 Cohere 비용 Adapter를 연결했다. Migration 0039로 전체/Provider 한도를 같은 원장에 예약한다. 로컬 참고 코퍼스 20문서·28청크의 검색과 DB 취소를 검증했으며 원격 공식 자료·Vector 적재·Fast 실측·품질 채택은 남아 있다.

현재 구현 추가: 전체 계정 탈퇴 API·진행 조회·화면·Workflow와 Migration 0038을 기능 Draft에 추가했다. 격리 DB의 신규 작업 차단·Auth 실패 rollback·반복 종결과 API 영수증/응답 유실 시험을 통과했다. 원격 적용과 배포 종단 검증은 남아 있다. 0038의 DB scope 변경으로 기능 Draft의 Supabase·Rate·Consent·Storage·Delete 증거도 STALE로 두며 부분 PASS는 7/20이다. main 13/20 채택에는 변경이 없다. Cohere 학습 사용 Off와 Fast 합성 시험 최대 USD 0.05는 승인됐고, 설정 Off를 새 페이지에서도 확인했다. Provider 시험 호출은 아직 0건이다.

현재 추가 보안 작업: PR #224·#226의 세션 갱신·폐기 RLS와 PR #230의 별도 증거 채택이 main에 병합됐다. main 부분 PASS 13/20, 이 기능 Draft는 Health scope 차이로 12/20이다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다. 실제 Production/Preview의 갱신·폐기·다른 세션 유지, 한 시간 자연 만료 복구, Preview TUS의 Cookie 회전·파일/Case 삭제를 각각 확인했다. 아래 최초 감사 기준선과 구분한다.

# 2026-09-07 개발 재개 확인표

원격 확인 기준은 main `6e096aa`, Draft #192 `e84b52a`다. Draft의 원격 CI `34091783329`와 Preview는 성공했고 기존 기능 worktree는 clean이었다. 현재 작업은 main에서 분리한 `fix/auth-session-logout`의 보안 수정이다. 기존 기능 브랜치를 강제 checkout하거나 제출 확정본을 수정하지 않았다.

현재 ADR metadata는 Implementation `NO-GO`, Release `NOT-EVALUATED`다. main 부분 PASS는 13/20, Draft는 Next/Workflow 빌드 범위 차이로 Health를 상속하지 않아 12/20이다. 아래 Draft 검증은 기존 파일·코드·개발 증거의 확인이며 이번에 전부 재실행한 목록이 아니다.

| 요구사항·차단 항목 | 확인된 구현·검증 | 남은 작업·단계 |
|---|---|---|
| AUTH-001~002·AUTH-011 | 로그인 존재, Draft 삭제 재인증 실측, 서버 로그아웃·세션 격리·Cookie 회전·실제 만료 복구·직접 RLS 폐기 확인 | 전체 탈퇴 수명·배포 통합의 추가 검증은 별도이며 전체 AUTH 완료 아님 |
| AUTH-005·D-014·SEC-PRI-005 | Migration 0036 선행 정리 Guard, Draft Case 삭제·반복 요청 실제 확인 | 전체 계정 탈퇴·신규 작업 경합·Auth 마지막 삭제 구현 및 격리 검증, Live 미검증 |
| INP-001~013·CLM-001~004·B-OCR-01 | Draft native PDF·PNG·10쪽 스캔의 실제 처리·물리 삭제 연결 | 정식 field F1 0.9791667 실패 유지, 개발 진단·새 가족 사전등록 평가·OCR 확인 UX 필요 |
| AI-006~008·EV-002~009·B-RETRIEVAL-01 | 후보 생성 PASS, 종단 두 차례 미달. 이번 실제 worker 조회에서 KB 문서·청크·Embedding 각 0건 | 기존 gate 재측정 금지, 범위/Provider 별도 결정·공식 자료 적재·미연결 도구 필요 |
| REV-001~007·N-PERF-005/009·B-JOB-01·B-DEADLINE-01 | Draft 실제 재검증 NO_CHANGE·과거 판 보존, 격리 DB 종결 rollback·중복 복구 | 실제 배포 장애 20종·Lease·취소 경합·기한·Orphan·TTL 검증 및 Gate 미채택 |
| AI-009~021·EV-001~016·RES-001 | Draft 단일 Claim 실제 실행·저장과 실패 안전 상태 | 복수 Claim은 부분 결과, 독립 검토 품질·실질적 적합성·일반 상품 유효 시점 미완료 |
| PC-001~011 | Draft 가입 사실·계약 문구·설문 4개 저장·복원 실제 확인 | Sales/Regulation Agent 재사용·가입 후 파일 경계·법적 표현 품질 미완료 |
| PASS-002/004·CASE-004/006·REV-005 | Draft 이전 Passport·새 판·새로고침 복원 | 프로필 변경 불변성·다른 기기 완료 기록·50건 이후 목록·Outbox Orphan 검증 필요 |
| SEC-PRI·SEC-AI-008·B-PROCESSOR-PRIVACY·B-PRIVACY-VERCEL | 합성 전용 조건, PII·동의·삭제 구성요소 검증 존재 | Cohere 학습 사용 Off 변경·새 페이지 확인, Rerank Fast 개발 후보 USD 0.05 승인. 나머지 계정 설정·DPA·보존·region·하위처리자·로그·PII 경계 미채택 |
| N-OPS-002~004·B-HEALTH-01 | Draft 모델 비용 예약·실사용 정산·미확정 보존, main 저비용 Health PASS | OCR/Embedding 비용·사용량 대조·다중 인스턴스 실제 경로·Draft Health 재측정 필요 |
| N-QLT-010·B-SPIKE-01 | NO-GO 허용 격리·보안 검증 단계 | 선행 blocker·사전등록 Claim 평가·실제 component vertical·구현/실패 안전성 검토 후 GO 판단 |
| N-QLT-009·B-DEMO/E2E/BUILD/CLAIM | Release 미평가 | GO 이후 전체 수직 흐름·필수 Live skip 0·판정 품질 평가 필요 |

Refresh 보관·회전·로그아웃 경합은 세션 갱신 기록의 표본에서 검증했다. 전체 탈퇴는 Profile Guard를 유지한 채 신규 작업 차단과 마지막 Auth 삭제의 원자성을 먼저 격리 시험한다. OCR·검색 실패셋은 회귀 이력으로 보존한다. 유료 플랜·새 계약·범위 변경은 이 작업에 포함하지 않는다.
