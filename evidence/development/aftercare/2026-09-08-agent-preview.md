# 실제 가입 후 두 Agent 점검 표본

2026-09-08 보호 Preview의 합성 단일 Claim에서 점검 API·Workflow·Sonnet 5를 실행했다. 배포는 `6ZyZHFJoJDpnVntPSLDtuQtx5eVY`, 기능 SHA는 `8002d56`이다. 기준 Passport는 SQL로 만든 합성 UNKNOWN이며 거래 전 Agent 실행을 검증한 표본이 아니다.

접수 후 첫 응답을 후속 세션에서 재사용하지 않고 다른 로그인 세션의 GET으로 같은 Job을 복원했다. 같은 요청 key의 POST는 같은 Job을 반환했다. 두 Agent와 Tool 4회 실행, 답변 4개·계약 비교·같은 기준 Passport·부분 점검 결과가 저장됐다. Agent 실행 구간은 약 13.8초이며 전체 접수 후 완료는 약 19.4초다. 반복 표본/P95 측정은 아니다.

Sales Conduct는 공식 자료가 없는 상황의 출력에서 `CITATION_INVALID`로 실패했다. Regulation & Dispute는 UNKNOWN과 근거 부족을 반환했다. 네 Tool의 검색 결과는 모두 비었다. 최종 상태는 PARTIAL이며 실제 근거를 사용한 두 Agent 정상 완료·PC-005 품질 통과로 채택하지 않는다. 실패 출력은 사용자 판단으로 승격되지 않았다. 기존 자료 부족·고정된 상담/신고 안내의 개선도 남아 있다.

실제 모델 비용은 USD 0.024174, 미확정 호출·잔여 예약은 0이다. 사전에 기존 Fast 개발 실측 USD 0.040829를 전체 일일 원장에 한 번만 반영했다. 기존 Anthropic과 합쳐 호출 전 USD 0.233177, 호출 후 USD 0.257351이다. 전체 USD 0.50·소유자 USD 0.30·Case/실행 USD 0.20 상한을 유지하고 전체 Provider 합산 정책을 활성화했다. Fast를 제품 기본값으로 바꾸거나 추가 Fast 시험을 하지 않았다.

시험 후 새 Case만 최근 비밀번호 인증으로 삭제했다. 삭제 COMPLETED, Case 조회 404와 점검 Job의 실제 DB 부재를 확인했다. 기존 합성 계정과 기존 Case는 유지하고 이번 로그인 세션만 로그아웃했다. 새 점검 UI 브라우저 검증은 이 표본에 포함되지 않는다.

0042는 main `dd203fd`의 정확한 파일만 forward 적용했다. 원격·격리 기준의 구조 해시 6종이 일치하며 RLS/FORCE 82개, anon 누출 0건, 기존 Worker 본문 거부 목록 13표를 확인했다. 새 점검 표의 Worker 직접 읽기 거부는 격리 SQL 시험에 포함됐다. Migration ledger는 소급 작성하지 않았다.

배포는 성공했지만 기능 CI `34140437795`는 Git 병합 충돌 메타데이터 두 행의 언어 검사에서 실패했다. 원본 실패를 보존하고 별도 수정 PR에서 검사 차이를 고친다. Implementation NO-GO·Release NOT-EVALUATED, main 부분 PASS 8/20·기능 7/20과 Gate 재채택 필요 상태를 유지한다.
