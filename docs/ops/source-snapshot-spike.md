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
| 산식 버전 | `source-snapshot-two-api-cross-check-v6` |
| 상품 | `햇살론15` |
| 금융위원회 API | `https://apis.data.go.kr/1160100/service/GetSmallLoanFinanceInstituteInfoService/getOrdinaryFinanceInfo`, `resultType=json`, `likeFinPrdNm=햇살론15`, `numOfRows=100`, 최대 20 page. 포털 상세 `https://www.data.go.kr/data/15094787/openapi.do` |
| 서민금융진흥원 API | `https://apis.data.go.kr/B553701/LoanProductHandlingAgencyInfoService/getLoanProductHandlingAgencyInfo`, `type=xml`, `prdNm=햇살론15`, `numOfRows=100`, 최대 20 page. 포털 상세 `https://www.data.go.kr/data/15074508/openapi.do` |
| 공식 페이지 | 상품 안내 `https://www.kinfa.or.kr/financialProduct/hessalLoan.do`(제목에 `햇살론15`, 본문 `1397`), 사칭 신고센터 `https://www.kinfa.or.kr/cyber/customerServiceCenter/customerDeclareCenter.do`(`1397`·`사칭`·`중개수수료`), 이용안내 `https://loan.kinfa.or.kr/tot/setupLoanProductsGuideSupri.ke`(`1397`, "수수료를 요구하지 않" 문구; 실행 환경에서 닿을 때만 판정) |
| 라이선스 registry | 두 API 모두 포털 표기 `이용허락범위 제한 없음`, 무료, 개발계정 트래픽 10,000회. 확인일 2026-09-05 |
| 요청 | 시작 간격 300ms, 요청 timeout 30초. 응답을 받기 전의 연결 계층 오류(connect timeout·reset·DNS)와 요청 timeout 만 최대 3회 시도(3초·6초 뒤)하고 재시도 수를 관측에 남긴다. HTTP 오류·결과 코드·본문 오류는 재시도하지 않는다. 개발계정 하루 10,000회 안에서 한 번 실행에 10회 안팎을 쓴다 |
| Snapshot | `authority`, `source_type`(`PRODUCT`/`INSTITUTION`), `official_id`, `official_url`, `fetched_at`, 공개 레코드 필드, 레코드 canonical JSON SHA-256, `source_fingerprint`. 진흥원 `official_id`는 `data.go.kr:15074508:<idNo>:<법인번호 SHA-256 앞 12자리>`이며 법인번호 원문은 레코드 필드에만 둔다 |
| 교차 확인 | 금융위 현재 레코드(최신 `basYm`)의 취급기관 상세는 "서민금융통합지원센터 47개 (직접보증), 대출협약은행 12개(위탁보증)"처럼 분류와 수만 적고 은행 이름은 없다. 그래서 (1) 진흥원 취급기관 레코드 전부가 상품명 `햇살론15`로 join되고, (2) 금융위 상세가 은행 취급을 말하며 진흥원 목록에 은행이 1개 이상 있고, (3) 금융위가 적은 협약은행 수와 진흥원 은행 수를 함께 기록한다. 이름 단위 일치(`matched`)는 참고값이다 |

## 합격선

- 두 API 모두 `resultCode` `00`, `totalCount ≥ 1`, 수집 수가 `totalCount`(최대 2,000)와 같다. HTTP 200, content type, 첫 응답 헤더 이름을 기록한다.
- 금융위 API에 `햇살론15`를 담은 상품 레코드가 1건 이상이고, 최신 기준월 레코드에 종료 표시(`N`)가 없다. 과거 기준월 레코드는 이력 Snapshot으로 남긴다. 진흥원 API에 `햇살론15` 취급기관이 1건 이상이다.
- 교차 확인에서 진흥원 레코드 전부가 같은 상품명이고(`joined_count` = 취급기관 수), 금융위 상세가 은행 취급을 말하며 진흥원 목록에 은행이 있다. 상품명이 다르거나 은행 취급이 확인되지 않으면 차단 사유다.
- 공식 상품 페이지가 200이고 제목에 `햇살론15`가 있으며 `1397`이 보인다. 사칭 신고센터 페이지가 200이고 `1397`·`사칭`·`중개수수료`가 보인다. 이용안내 페이지는 실행 환경에서 닿았을 때(`reachable`) `1397`과 중개수수료 미요구 문구가 있어야 한다.
- 모든 Snapshot의 SHA-256·fingerprint가 레코드에서 다시 계산한 값과 같다.
- 결과 파일에 `serviceKey`·이메일·전화번호·주민번호 형태의 값이 없다. 공개 레코드의 법인번호(`corpNo`), 기관 연락처(`cnpl`·`rfrcCnpl`·`mgmDln`), 관련 사이트(`rltSite`), 기관 주소(`fninstAdr`)는 공공기관이 공개한 기관 정보이지 직접식별자가 아니므로 이 검사에서 뺀다. 검사에 걸리면 값이 아니라 JSON 경로만 로그에 남긴다. run `33970834208`에서 13자리 법인번호가 주민번호 형태 검사에 걸려 validate 단계가 실패했다.

## 첫 main 실행(run `33969238278`)에서 확인한 사실

- 금융위 API는 `햇살론15` 레코드 19건을 돌려줬다(기준년월별 이력). 응답 필드는 `basYm`, `finPrdNm`, `hdlInst`(분류: "대출협약은행 (14개)"), `hdlInstDtlVw`(기관 목록), `prdExisYn`, `irt`, `lnLmt`, `trgt`, `usge`, `rdptMthd` 등 47개다. v1은 `hdlInst`를 기관 목록으로 읽어 교차 확인에 실패했다. v2는 최신 기준월 레코드의 `hdlInstDtlVw`를 쓴다.
- 진흥원 API는 취급기관 16개(SC제일·경남·광주·국민·기업·농협·대구·부산·수협·신한·씨티·우리·전북·제주·카카오뱅크·하나)를 돌려줬다.
- 여덟·아홉 번째 실행(run `33980899425`, `33980959720`)은 관측·정책·결과 파일까지 통과했고 validate 가 진흥원 Snapshot 의 `official_id` 에 든 13자리 법인번호를 주민번호 형태로 잡았다. v6 은 ID 에 법인번호 대신 그 Hash 앞 12자리를 쓴다.
- 여섯 번째 실행(run `33970777514`)은 첫 요청이 15초 요청 timeout 으로 끝났고, 일곱 번째(run `33970834208`, `B-SOURCE-02`)는 관측·정책을 모두 통과한 뒤 validate 단계의 직접식별자 검사가 법인번호를 잡아 실패했다. v5 는 요청 timeout 을 30초로 늘리고 응답 전 timeout 도 제한 재시도하며, 법인번호·기관 연락처 필드는 식별자 검사에서 뺀다.
- 네 번째·다섯 번째 실행(run `33970360398`, `33970408558`)은 첫 요청이 `UND_ERR_CONNECT_TIMEOUT`(연결 계층)으로 끝났다. 실행 환경에서 `apis.data.go.kr` 연결이 간헐적으로 실패하므로 v4는 연결 계층 오류만 제한 재시도한다. 지연 합격선이 없어 측정을 왜곡하지 않는다.
- 두 번째·세 번째 실행(run `33969726695`, `33969998047`): 하나는 첫 요청에서 네트워크 계층 오류로 끝나 원인 종류를 로그에 남기도록 고쳤고, 다른 하나에서 금융위 현재 레코드의 `hdlInstDtlVw`가 "서민금융통합지원센터 47개 (직접보증), 대출협약은행 12개(위탁보증)"임을 확인했다. 은행 이름 목록은 진흥원 API에만 있으므로 v3은 이름 일치 대신 상품명 join·은행 취급 일관성·수 기록으로 교차 확인한다. 금융위가 적은 협약은행 12개와 진흥원 16개의 차이는 기준월 차이일 수 있어 결과에 그대로 남긴다.
- 이용안내 페이지 `loan.kinfa.or.kr`는 GitHub-hosted 실행 환경에서 제목 `Basic Sample`인 기본 틀만 돌려준다(국내에서는 본문이 온다). 수수료 미요구 문구 Snapshot은 실행 환경에서 닿을 때만 판정하고, 닿지 않은 사실을 결과에 남긴다. 사칭 신고센터 페이지(`www.kinfa.or.kr`)는 실행 환경에서도 본문을 돌려주며 `1397`·`사칭`·`중개수수료`를 담는다. 문구 Snapshot을 국내 vantage에서 채택하는 절차는 아직 없다.

## 실행

1. GitHub `provider-spike` environment의 `DATA_GO_KR_SERVICE_KEY`가 두 API의 활용신청 승인을 받은 키인지 포털 마이페이지에서 확인한다.
2. `Source Snapshot Evidence` workflow를 main에서 `B-SOURCE-02` 또는 `B-SOURCE-03`으로 dispatch한다.
3. 정책 미달이면 결과 파일을 만들지 않는다. 승인되지 않은 키는 `source-result-code-30`처럼 코드만 로그에 남는다.
4. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

## 채택 뒤

- 채택된 결과의 Snapshot은 `scripts/kb/load-source-snapshots.mjs` 로 `kb.source_snapshots`·`kb.source_fetch_events`·`kb.official_channel_registry`(1397, 사칭 신고센터)에 적재한다. API를 다시 부르지 않고 결과 파일만 읽으며 `content_hash`·`source_fingerprint`는 결과 파일의 값을 그대로 쓴다. `--emit-sql`은 statement만 출력하고 `--apply`는 `DATABASE_URL`의 `finshield_worker`로 실행한다. 같은 identity는 새 행을 만들지 않고 Fetch Event를 `UNCHANGED`로 남기며, 실행 환경에서 닿지 않은 페이지는 적재하지 않는다.
- 최신 기준월(`basYm`) 상품 레코드만 현재 상품으로 적재한다. 과거 기준월은 결과 파일에 이력으로만 남는다. JS로 그려지는 상품 페이지는 `is_complete=false`·`is_citable=false`로 적재한다.
- 갱신 후보 6~24시간(ADR 8.5)의 실제 TTL은 재실행 결과의 `sha256` 변화를 보고 정한다.
