# OCR URL 실패 개발 진단

## 목적

첫 `B-OCR-01` 측정의 필드 오류 7건은 `refinance-scanned`의 URL에만 모였다. 기존 실패 artifact는 원문이나 좌표를 저장하지 않아 Provider 인식과 행 복원 중 어느 경계가 원인인지 알 수 없다. 이 진단은 이미 실패가 확인된 합성 가족 한 건만 한 번 호출해 원인을 나눈다.

이 실행은 `DEVELOPMENT_DIAGNOSTIC`이며 `gate_evidence=false`다. 같은 Gate를 반복 측정하거나 좋은 결과를 골라 채택하지 않는다. 첫 실패 결과와 0.98 합격선은 그대로 유지한다.

## 사전 고정 범위

- 입력은 SHA-256 `718307af79cbf15a6bc49bafcba9790efb05a16ed5e457d392f08fd960f29472`인 `refinance-scanned.pdf` 한 건이다.
- CLOVA General OCR에 PDF 10쪽을 한 요청으로 보내며 `lang=ko`, 표 감지 Off, 재시도 Off를 사용한다.
- 주소 행의 안전한 합성 ASCII 문자열, 추출 문자열, 첫 불일치 code point, 길이, 주소 행 최소 confidence만 보존한다.
- 전체 OCR 응답·다른 행·좌표·요청 ID·Endpoint·키는 저장하지 않는다.
- `@`, query, fragment, percent가 섞인 값이나 허용 문자 밖의 값은 원문 대신 `null`로 남긴다.

## 판정

주소 행의 인식값이 정답과 다르면 인식·입력 품질 문제다. 인식값은 같지만 기존 field extractor 값이 다르면 행 복원·필드 파싱 문제다. 둘 다 같으면 Provider의 비결정성 가능성을 기록하되 이 재실행을 Gate PASS로 사용하지 않는다.

진단 뒤 수정안은 정답 URL 치환이 아닌 일반 입력 전처리, Provider 옵션, 좌표 행 복원 또는 보수적 URL 추출 중에서 고른다. 수정과 별개로 새 시나리오 가족·문서·URL을 사전 등록한 다음 정식 재평가한다.
