# B-OCR-01 합성 Parser·OCR 평가

## 2026-09-10 v2 재평가 사전등록

첫 정식 측정 run `34086750192`은 field F1 0.9791666667로 기준 0.98에 미달해 `FAIL`이다. 별도 진단 run `34198597628`에서 `refinance-scanned` 7쪽의 URL이 모두 `example` 대신 `exaimple`로 인식됐고 해당 행 최소 confidence는 0.591, 정상 3쪽은 0.989였다. 그 표본은 이미 노출됐으므로 같은 평가셋을 다시 돌려 유리한 결과를 고르지 않는다.

재평가는 아래를 **측정 전에** 고정한다. 결과를 본 뒤 이 절을 바꾸지 않는다.

- 판정 산식과 합격선은 바꾸지 않는다. `FORMULA_VERSION`은 `ocr-page-field-exact-v1` 그대로이고 숫자·부정 표현 exact 100%, field micro F1 ≥ 0.98, 지원 페이지 ≥ 0.95, 10쪽 P95 ≤ 35초를 유지한다.
- 평가셋만 `ocr-quality-v2`로 바꾼다. 시나리오 가족 8개(`collateral`·`refund`·`credit`·`bridge`·`insurance`·`remote`·`paperwork`·`earlyrepay`)는 v1의 여덟 가족과 하나도 겹치지 않는다. `loadQualityFixtures`가 v1 manifest를 읽어 가족 이름이 하나라도 겹치면 `FIXTURE_FAMILY_EXPOSED`로 거부한다.
- 문서 구조·label·표 배치·150dpi 렌더링·문서 32건·112쪽은 v1과 같게 두어 두 측정을 비교할 수 있게 한다.
- 주소는 RFC 2606 예약 이름만 쓴다. v1과 같은 맨 예약 TLD `https://<slug>.example/loan`을 네 가족에 그대로 남겨 이미 관측된 어려운 경우를 버리지 않고, 나머지 네 가족은 실제 문서에 더 흔한 `https://www.example.com/<slug>` 형태를 쓴다. 이 4대4 비율은 manifest와 계약 시험이 강제한다.
- 두 형태를 섞은 이유는 v1이 여덟 가족 전부를 맨 `.example` TLD로만 구성해 실제 입력에 드문 token 하나에 field 점수가 몰렸기 때문이다. 어려운 경우를 없애는 것이 목적이 아니므로 절반은 그대로 남긴다. 이 선택으로 점수가 오르면 그 원인을 결과에 함께 적는다.

v2는 아직 측정하지 않았다. 저신뢰 핵심 필드를 사용자 확인 전에 확정하지 않는 제품 경계는 Migration 0066과 Claim 확인 화면에서 이미 강제하며, 그 경계는 이 Gate 산식을 대신하지 않는다. GitHub Actions가 과금으로 시작되지 않는 동안에는 정식 main 단일 실행과 별도 Adoption을 수행할 수 없고, 로컬 실행 결과를 `B-OCR-01` 증거로 채택하지 않는다.

## 평가셋 구성

사전 고정 8개 시나리오 가족의 Text·PNG·digital PDF·10쪽 scanned PDF를 각각 한 번씩 측정한다. 32문서·112쪽이며 실사용자 파일이나 실제 상품 사실을 사용하지 않는다. 금융 조건 표, 숫자·금리·금액·기간·보증료율, 부정 표현, 기관·상품·예약 `.example` URL을 포함한다. 같은 가족의 형식 변형은 독립 표본이 아니며 외부 블라인드 평가·일반화 정확도로 표현하지 않는다.

정답은 생성기의 문장과 기관·상품·URL label로 고정한다. 150dpi의 선명한 합성 인쇄 문서가 중심이다. 손글씨·사진 기울어짐·흐림·복잡한 병합 표의 품질을 증명하지 않는다. 112쪽 전체의 존재·개수·형식·파일 SHA-256을 검사한다. PDF text layer는 격리 PDF.js가 읽고 scanned PDF에 text layer가 남았으면 거부한다. PNG·scanned PDF 16건·88쪽만 CLOVA로 실제 전송한다. API 재시도·병렬 호출은 없으며 각 응답 뒤 1.1초를 기다린다.

## 판정 산식

- 공백과 NFC 정규화만 허용한다. 문자의 임의 교정이나 정답을 이용한 행 재정렬은 하지 않는다.
- 위치 좌표로 행·열을 복원한다. 숫자는 행의 label과 결합해 금리와 보증료를 바꾸거나 단위를 바꾼 경우도 오답으로 센다. 숫자·금리·단위 token과 부정 문장 각각의 다중집합에서 누락·추가가 모두 0건이어야 exact 100%다.
- 기관·상품·주소의 명시적 label 뒤 값을 추출한다. 유형과 값이 같은 field만 TP이며 FP·FN을 포함한 micro F1 `2TP / (2TP + FP + FN)`이 0.98 이상이어야 한다. 일부 anchor 존재 여부를 field F1로 부르지 않는다.
- 지원 페이지는 고정 전체 112쪽의 0.95 이상이어야 한다. 실패한 문서는 분모에서 빼지 않는다. 숫자·부정·field 점수는 응답을 얻은 페이지에서 계산하고 실패 페이지 수를 반드시 함께 보고한다. 실패 문서의 일부 페이지만 성공으로 숨기지 않는다.
- 10쪽 scanned PDF 8건의 P95는 nearest-rank 8번째 값이다. Parser 시작부터 실제 OCR 응답·행 복원까지 35초 이하여야 한다. 형식 검사·격리 프로세스 시작·Parser·CLOVA 시간을 포함하며 요청 뒤 pacing만 제외한다. 실패 문서도 지연 표본에서 빼지 않는다.

## 실행과 증거

main 전용 `OCR Evidence`가 같은 SHA의 fixture·Parser·평가기를 사용한다. Linux network namespace·권한 없는 사용자·Node 권한 모델을 사용하며 Parser에는 PATH만 전달한다. Node heap 256MiB·프로세스 30초·읽기 경로 제한, 쓰기·하위 프로세스·worker thread·외부 통신 거부를 유지한다. PDF.js 버전·lockfile은 기존 격리 Parser 기준을 사용한다. macOS의 로컬 개발 진단은 main의 Linux 격리 증거를 대신하지 않는다.

결과에는 원문·OCR 응답 전문·좌표·키·요청 주소를 담지 않는다. 페이지별 token SHA-256 원장을 고정 정답에서 다시 계산해 TP·FP·FN을 구한다. 이는 합성 token의 hash이며 실제 개인정보 익명화 보증이 아니다. 실패 결과도 artifact로 보존하고 별도 Adoption에서 성공한 원본만 채택한다. 표본·합격선·정답을 실측 뒤 바꿔 같은 시험을 통과시키지 않는다. 수정 뒤 평가는 변경 이유와 새 평가셋을 사전 등록해야 한다.

단위 계약 검증과 native PDF 로컬 추출은 구현 점검이다. 실제 CLOVA 측정·main artifact·별도 Adoption 전에는 B-OCR-01·Implementation·Release 상태를 바꾸지 않는다. 서비스의 OCR 동의·원본 삭제·Claim 확인·판정 품질은 별도 조건이다.
