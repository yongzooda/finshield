# 실제 가입 후 계약 PDF 연결

PC-008·PC-011의 보호 Preview `da43afe`에서 같은 Case의 합성 native PDF 한 쪽을 TUS로 올렸다. 격리 파서·PII·실제 Sonnet 5 추출 뒤 이전 Claim에 연결해 확인했다. 처리 응답은 200, 8.285초였다. 이 단일 값은 P95·정식 OCR 품질 측정이 아니다.

다른 로그인 세션에서 확인 전 문구와 확인 후 문구·기준 Passport·대상 Claim을 복원했다. 같은 확인 요청을 다른 세션으로 반복해 성공했고 거래 전 Claim Snapshot은 `연 금리는 5%입니다` 그대로였다. 모델 추출은 합성 계약의 7% 문구를 사용했다. 거래 전 Passport는 SQL Fixture이며 이번 시험에서 거래 전 Agent나 가입 후 두 Agent 점검을 실행하지 않았다.

원본 정리 SUCCEEDED와 미완료 정리 없음, Storage 조회 불가를 확인한 뒤 관리자 SQL에서 원본 0·확인 문구 1·기존 Claim 1·OCR 임시물 0을 확인했다. native PDF이며 OCR 동의는 false다. 마지막으로 실패·성공 시험의 두 Case를 API로 삭제하고, 관리자 SQL에서 Case·문구·입력·원본 잔존이 모두 0임을 확인했다. 시험용 새 로그인 세션만 종료했다.

추가 비용은 USD 0.003914, 전체 Provider 일일 누적은 USD 0.261265다. 미확정 예약은 0이며 승인된 상한과 Fast 추가 호출 금지는 유지했다.

첫 시험은 마스킹 뒤 비용 함수의 lifecycle 조건으로 404가 됐고 과금은 0이었다. [실패 원본](2026-09-08-document-preview-failure.json)을 보존했다. PR #242의 실제 병합 후보 `02f0c1e`와 CI `34144213641`, Preview 배포가 통과해 main `d4a180f`로 squash merge했다. 원격 0044 적용 후 구조 해시 6종은 격리 DB와 일치했다.

기본 시험 602건·격리 44 Migration/SQL 32파일·TypeScript·빌드가 통과했다. 선택적 96건은 건너뛰었고 lint는 기존 경고 2건이다. 브라우저 화면 조작·전체 OCR 품질·공식 근거를 갖춘 두 Agent 정상 완료·장애 20종·Gate 채택은 이 결과에 포함하지 않는다. 원격 UI의 마지막 읽기 전용 조회는 빈 편집기 오류 뒤 다시 입력해 성공했다. 결과 JSON과 UI 원본은 합성 식별자를 일관된 별칭으로 치환해 저장했다.
