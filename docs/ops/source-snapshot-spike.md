# B-SOURCE-02·B-SOURCE-03 공식 출처 Snapshot 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-SOURCE-02`(공공데이터 key·quota·pagination·license label), `B-SOURCE-03`(Demo `햇살론15` 정확 product/institution record)
- 현재 상태: `B-SOURCE-02` `NOT-EVALUATED`, `B-SOURCE-03` `BLOCKED`
- 이 문서는 검토된 harness의 실행 계약이다. workflow 성공만으로 `PASS`가 되지 않는다.
- 두 blocker는 같은 harness의 같은 관측값을 쓴다. dispatch 입력이 결과의 `blocker_id`를 정하고, 채택은 blocker마다 따로 한다.
- 공공데이터 응답은 공개 상품·기관 정보다. 그래도 응답 원문 전체는 저장하지 않고 레코드 필드·개수·Hash만 남긴다. `serviceKey`는 요청에만 쓰고 결과·로그·URL 기록에서 지운다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 산식 버전 | `source-snapshot-two-api-cross-check-v1` |
| 상품 | `햇살론15` |
| 금융위원회 API | `https://apis.data.go.kr/1160100/service/GetSmallLoanFinanceInstituteInfoService/getOrdinaryFinanceInfo`, `resultType=json`, `likeFinPrdNm=햇살론15`, `numOfRows=100`, 최대 20 page. 포털 상세 `https://www.data.go.kr/data/15094787/openapi.do` |
| 서민금융진흥원 API | `https://apis.data.go.kr/B553701/LoanProductHandlingAgencyInfoService/getLoanProductHandlingAgencyInfo`, `type=xml`, `prdNm=햇살론15`, `numOfRows=100`, 최대 20 page. 포털 상세 `https://www.data.go.kr/data/15074508/openapi.do` |
| 공식 페이지 | 상품 안내 `https://www.kinfa.or.kr/financialProduct/hessalLoan.do`(제목에 `햇살론15`, 본문 `1397`), 이용안내 `https://loan.kinfa.or.kr/tot/setupLoanProductsGuideSupri.ke`(`1397`, "수수료를 요구하지 않" 문구) |
| 라이선스 registry | 두 API 모두 포털 표기 `이용허락범위 제한 없음`, 무료, 개발계정 트래픽 10,000회. 확인일 2026-09-05 |
| 요청 | 시작 간격 300ms, timeout 15초, 재시도 없음. 개발계정 하루 10,000회 안에서 한 번 실행에 10회 안팎을 쓴다 |
| Snapshot | `authority`, `source_type`(`PRODUCT`/`INSTITUTION`), `official_id`, `official_url`, `fetched_at`, 공개 레코드 필드, 레코드 canonical JSON SHA-256, `source_fingerprint` |
| 교차 확인 | 금융위 레코드의 취급기관 문자열을 나눠 정규화한 뒤 진흥원 취급기관 목록과 대조. 금융위 레코드에 취급기관이 있으면 하나 이상 일치해야 한다 |

## 합격선

- 두 API 모두 `resultCode` `00`, `totalCount ≥ 1`, 수집 수가 `totalCount`(최대 2,000)와 같다. HTTP 200, content type, 첫 응답 헤더 이름을 기록한다.
- 금융위 API에 `햇살론15`를 담은 상품 레코드가 1건 이상이고 종료 표시(`N`)가 없다. 진흥원 API에 `햇살론15` 취급기관이 1건 이상이다.
- 교차 확인에서 일치 기관이 1건 이상이다. 기관이 일치하지 않는 상태는 성공 Demo가 아니라 차단 사유다.
- 공식 상품 페이지가 200이고 제목에 `햇살론15`가 있으며 `1397`이 보인다. 이용안내 페이지가 200이고 `1397`과 중개수수료 미요구 문구가 있다.
- 모든 Snapshot의 SHA-256·fingerprint가 레코드에서 다시 계산한 값과 같다.
- 결과 파일에 `serviceKey`·이메일·전화번호·주민번호 형태의 값이 없다.

응답 필드 이름은 포털이 Swagger로만 보여 줘 실행 전 확정하지 못했다. harness는 상품명은 `finPrdNm`·`prdNm` 계열, 취급기관은 `hdlInst`·`insttNm` 계열에서 찾고 실제로 쓴 필드 이름과 전체 필드 목록을 결과에 남긴다. 채택 뒤 `kb.source_snapshots` 적재 script는 그 필드 이름을 고정한다.

## 실행

1. GitHub `provider-spike` environment의 `DATA_GO_KR_SERVICE_KEY`가 두 API의 활용신청 승인을 받은 키인지 포털 마이페이지에서 확인한다.
2. `Source Snapshot Evidence` workflow를 main에서 `B-SOURCE-02` 또는 `B-SOURCE-03`으로 dispatch한다.
3. 정책 미달이면 결과 파일을 만들지 않는다. 승인되지 않은 키는 `source-result-code-30`처럼 코드만 로그에 남는다.
4. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

## 채택 뒤

- 채택된 결과의 Snapshot을 `kb.source_snapshots`·`kb.official_channel_registry`(1397)에 적재하는 Seed script는 명세 15절 14번 묶음이다. 적재 시 `content_hash`·`source_fingerprint`는 결과 파일의 값을 그대로 쓴다.
- 갱신 후보 6~24시간(ADR 8.5)의 실제 TTL은 재실행 결과의 `sha256` 변화를 보고 정한다.
