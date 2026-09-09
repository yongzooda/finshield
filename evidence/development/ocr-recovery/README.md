# OCR·인용·복구 개발 검증

- `png-first-live.json`: 첫 PNG Red Team 인용 실패. 삭제하지 않는다.
- `scan-live-v20.json`: 실제 CLOVA 스캔 PDF 6 Claim·59.439초·PARTIAL=false. 코드 2b6ae8a. 당시 목적 표현 PII 오탐 1곳을 별도로 수정했다.
- `png-final-live.json`: 최종 547af19 실제 PNG·6 Claim·50.806초·PARTIAL=false. 원문과 Claim 금융 문구 보존.
- `sample-fixtures.json`: 사용자 합성 PDF를 PNG·image-only PDF로 변환한 기능 시험 입력. 독립 품질 평가셋으로 사용하지 않는다.
- `live-recovery-preregistration.md`, `live-recovery-v20.json`: 실제 Vercel 동시 재연결, 같은 Job, ambiguous Run 안전 종결·stale 거부·다른 세션 복원·DB 원장 확인.
- `revalidation-browser.*`, `browser.*`: 로컬 운영 빌드에 합성 API 응답을 연결한 UI 시험. Live Provider 시험으로 표현하지 않는다.
- `public-alignment.json`, `public-result.png`, `public-ui.txt`: 실제 공개 주소의 코드547af19/DB0069 일치와 합성 회원 실제 결과 조회.
- `account-deletion.json`: 공개 탈퇴·재접근 거부와 실제 DB/Storage/Auth 부재.
- `required-547af19.txt`: 실제 병합 후보64fe019d의 필수 검사 로컬 통과. GitHub check 성공이 아니다.
- `required-pin-failure.txt`, `pii-purpose-first.txt`: 중간 실패, 이후 수정과 재검증을 함께 보존한다.

727 기본 테스트, 선택적96skip, 실제 Worker DB 통합3건, 66 Migration·SQL52파일. 두 Live 파일과 복구 표본은 정식 F1·장애20종·P95·전체 E2E/Claim 평가를 대체하지 않는다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다. 원문 개인정보·토큰·비밀번호는 저장하지 않았다.
