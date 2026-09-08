# 결과 설명 UI 재현 자료

2026-09-08 로컬 브라우저 시험. 운영 또는 Provider 품질 통과 증거가 아니다.

`ui-fixture.json`은 기존 `member-evidence-scope/pdf-final-reproduction.json`과 `negative-final-success.json`의 합성 기록을 바탕으로 한다. PDF 쪽은 사용자 사진의 네 인용 오류·Agent 범위·적합성 다섯 제한·금리 불일치 상태를 조합했다. 수정 전 저장 원본은 그대로 보존하며 Fixture 값을 새 실제 모델 결과로 해석하지 않는다.

`browser-fixtures.mjs`는 Fixture를 생성하고 별도 브라우저 세션의 API 응답을 대체한다. `verify-fixture.mjs`는 intake/verify 스트림을 대체한다. 저장소 루트에서 CI placeholder 환경으로 포트 3117의 Next를 실행하고 별도 세션 `finshield-result-labels-30ea`에서만 사용한다. 유효하지 않은 합성 토큰은 로컬 응답 재현에만 쓰며 서버 인증·DB·Provider를 우회해 변경하는 스크립트가 아니다. 실제 Provider 또는 사용자 계정으로 실행하지 않는다.

- `case-desktop.png`, `case-mobile.png`, `case-ui.txt`: 사용자 보고와 같은 오류·상태 조합의 Case 화면.
- `passport-mobile.png`, `passport-ui.txt`: 같은 Passport의 라벨·부분 검토 안내. 최초 캡처 뒤 근거 수 문구만 ‘독립 출처 N곳’에서 ‘독립성 확인 근거 N건’으로 바로잡았다. 출처 수를 단순 연결 행 수로 표현하지 않는다.
- `verify-mobile.png`, `verify-ui.txt`: 로컬 intake/검증 응답을 통한 입력 → 항목 선택 → 결과 UI. 실제 PDF 추출이나 모델 호출 시험이 아니다.
- `normal-mobile.png`, `normal-ui.txt`: 정상 완료 데이터에서 부분 실패 안내·위험 행동 오탐 표시가 없는지 확인.
- `case-desktop-a11y.json`: axe 4.12.1, 통과 39·위반 0·미완결 0.

브라우저 DOM에서 모바일 뷰포트와 문서 너비가 각각 390px인 것을 확인했다. 보고된 내부 코드 노출은 없고 인용 오류 설명은 한 번 표시됐다. 브라우저 오류 조회 결과도 비어 있었다. 스크린샷은 당시 로컬 UI 상태이며 원격 배포 확인을 대체하지 않는다.
