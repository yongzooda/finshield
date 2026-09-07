# 공개 Demo 공식 근거 연결

요구사항: `S-001`, `ROLE-001`, `AI-006`, `AI-007`, `EV-009`, `B-DEMO-01`.

## 발견한 Production 실패

Production `finshield-gamma.vercel.app/live-demo`를 실제 실행하자 약 20~25초 안에 종결됐지만 다섯 Claim이 모두 `UNKNOWN`이었다. 최신 실행 원장을 조회한 결과 Product·Fraud·CoVe·Red Team과 Judge가 `CITATION_INVALID`로 실패했고, 성공으로 기록된 Tool 호출에도 `demo.tool_run_sources` 연결이 0건이었다.

같은 시점의 공용 자료 상태는 Source Snapshot 21건, 공식 채널 2건, Demo Seed 출처 2건이었지만 `knowledge_documents`·`knowledge_chunks`·`knowledge_embeddings`는 모두 0건이었다. 공개 Demo는 `demo.seed_sources`를 읽지 않았고 `Demo Recorder`는 `SourceItem.storedSnapshotId` 대신 존재하지 않는 `locator.snapshot_id`를 찾아 출처 원장을 누락했다. 상품 Tool은 공식 공공데이터 Snapshot 대신 보증 종료가 표시된 현재 상품 페이지를 반복 조회해 `CONTEXT_ONLY`만 반환했다.

## 공식 자료 재확인

main `43c40a00286266e96b00b63857f3a0fcb90d9351`에서 Source Snapshot harness를 다시 실행했다.

- GitHub run: `34156392378`
- B-SOURCE-03 정책·raw validator: 통과
- 금융위원회 최신 기준월: `202602`
- 햇살론15: 고정금리 `15.9%`, 한도 `2000만원`, 상품 존재 `Y`, 관리기한 `상시`
- 서민금융진흥원 사칭 신고센터: HTTP 200, 사칭·상품·1397·중개수수료 표지 확인
- 기존 Snapshot과 내용이 같은 상품 재조회도 새 `UNCHANGED` 사건으로 남기도록 Loader의 request key에 조회시각을 추가했다.

이 실행은 공식 출처 Snapshot의 현재 연결을 다시 확인한 것이며, 실패 상태인 `B-RETRIEVAL-01`의 Recall·Precision 기준을 통과시킨 결과가 아니다.

## 변경 계약

Migration 0047은 기존 Snapshot·Release·Manifest를 수정하지 않는다. 위 실행에서 확인한 두 공식 Snapshot에 대응하는 정규화 본문 Chunk를 가진 `p0-judge-demo-corpus-v1` Release와 `finshield-p0-loan-v4` Manifest를 추가한다. Embedding은 넣지 않고 Metadata → Keyword → Rerank 경로까지만 사용하며 Release metadata에 `retrieval_gate_adopted=false`를 명시한다.

공개 Demo는 Seed가 승인한 Snapshot ID를 읽고, 그 범위와 Manifest Release에 함께 들어 있는 문서만 상품·사칭 안내 Tool에서 조회한다. 승인 출처가 없으면 실행을 시작하지 않는다. 회원 실행에는 이 Seed 제한을 적용하지 않는다.

Demo Recorder는 저장된 Snapshot ID를 직접 연결하고, 법령처럼 실행 중 공식 출처에서 가져온 자료는 기존 `record_source_snapshot` 경계로 Snapshot을 만든 뒤 `demo.tool_run_sources`에 연결한다. 출처 연결 실패를 삼키지 않으므로 원장 없이 성공한 Demo를 만들지 않는다.

## 검증과 남은 경계

- 격리 PostgreSQL: Migration 0047까지 전체 적용, SQL 시험 34파일 통과
- 단위 시험: 승인 Snapshot 범위, 출처 없는 Seed 거부, Demo Tool 출처 원장 연결 확인
- 타입 검사 통과
- Production 적용 전이므로 실제 Agent 결과·Claim별 인용·출처 원장·지연은 병합과 원격 Migration 뒤 다시 확인한다.
- OCR·전체 Retrieval·Workflow 장애 20종·Claim 품질과 Release Gate는 이 변경으로 완료되지 않는다.

## 2026-09-08 Production 재실행

main `b05470d`와 원격 Migration 0047을 적용한 뒤 공개 Demo를 다시 실행했다. 60.933초에 `PARTIAL`로 종결됐고 Product·Regulation·CoVe·Red Team은 성공했다. 공식 상품·사칭 안내를 포함한 Evidence 5건과 Tool-Source 연결도 복원됐다.

다만 Sales는 7초 판단 제한에서 `DEADLINE_EXCEEDED`, Judge는 8초 제한에서 `JUDGE_CALL_FAILED`로 끝났다. 두 호출은 Provider 결과 미확정 예약으로 보존됐다. Judge 결과가 없으므로 화면의 다섯 Claim은 안전하게 모두 `UNKNOWN`이었고, 이를 정상 판정으로 간주하지 않는다. 사칭 안내의 새 조회 사건은 동일 본문의 중복 Snapshot 중 Demo Seed가 고정하지 않은 행에 연결돼 화면에서 `STALE`로 평가됐다.

후속 Migration 0048은 검증된 동일 Hash의 재조회 사건을 Seed Snapshot에 직접 연결하고, v5 Manifest에 모델 시간 제한을 고정한다. 실측 분포를 바탕으로 Domain 선택 4초·판단 9초·단계 15초, Review 선택 5초·판단 8초·단계 15초, Judge 12초를 사용한다. 네 Domain·두 Review·Judge의 순차 단계 상한 합은 102초로 공개 Demo의 110초 안에 8초 여유를 둔다. Judge 실패 시 Domain 결과만으로 최종 결론을 새로 만들지 않는 기존 실패 안전성은 유지한다.

이 후속 변경도 원격 Migration·배포 뒤 실제 Demo를 다시 실행해 Judge 성공, Claim별 상태·인용, 전체 지연과 예약 정산을 확인하기 전에는 `B-DEMO-01` PASS가 아니다.

## 2026-09-08 v5 Production 실측

main `2a86ba4`와 원격 Migration 0048의 Production 공개 Demo는 55.354초에 종결됐다. Product·Fraud·Sales·CoVe·Red Team과 Judge가 성공했고, Claim은 `CONTRADICTED` 4건·`UNKNOWN` 1건으로 반환됐다. 공식 Evidence 5건은 모두 권위 A·`FRESH`·`DIRECT`였으며 Product 1건, Fraud 1건, CoVe 1건, Red Team 2건의 Source 연결을 확인했다. 12개 모델 호출 USD 0.097440은 정산됐다.

Regulation은 4초 도구 선택 제한에서 `DEADLINE_EXCEEDED`였고 판단 결과만 남아 `PARTIAL`로 종결됐다. 해당 호출의 Provider 결과가 불명확해 예약 1건을 해제하지 않고 보존했다. Migration 0049와 v6 Manifest는 Domain 선택을 6초, 전체 Domain 단계를 16초로 조정한다. 단계 상한 합은 106초로 공개 Demo 110초를 넘지 않는다. 처리 화면에는 실제 실측에 맞춰 약 1분 소요와 단계 갱신을 안내한다.

v6의 원격 적용·Production 재실행 전이므로 전체 성공과 `B-DEMO-01` PASS를 기록하지 않는다.

## 2026-09-08 v6 Production 법령 원장 실패

main `82e6cf3`과 원격 Migration 0049를 적용한 뒤 실행한 공개 Demo는 HTTP 200 스트림을 39.884초에 닫았지만 성공하지 않았다. Product·Fraud·Sales와 Regulation의 모델 호출은 모두 성공했고 Regulation도 3개 도구·2개 근거를 만들었으나, 네 번째 Agent 결과를 저장할 때 PostgreSQL `23514`가 발생해 Run은 `FAILED`로 종결됐다. 실패 원본과 Run을 그대로 보존하며 `B-DEMO-01` 성공으로 채택하지 않는다.

원인은 `lookup_statute`가 여러 조문 본문을 한 excerpt로 합치면서 `article_no=null`인 LAW Snapshot을 만들었던 코드와, LAW 근거에 법령명·조문 번호를 모두 요구하는 DB 계약의 불일치다. 후속 수정은 검색어에 명시된 조문을 우선하고 그렇지 않으면 검색어와 가장 많이 겹치는 실제 조문 하나를 선택해 법령명·조문 번호·본문·Locator를 함께 고정한다. 번호나 본문을 확정하지 못하면 제목만으로 LAW 근거를 만들지 않는다. 배포 뒤 전체 Agent·Judge·Claim·근거·비용 원장을 다시 확인하기 전에는 완료로 표시하지 않는다.

로컬 코드에서 실제 법제처 API에 `금융소비자 보호에 관한 법률 제19조`를 조회해 법률과 시행령의 `제19조` 본문을 각각 복원했다. 두 SourceItem은 실제 FinShield DB의 `record_source_snapshot` 함수와 LAW 제약을 트랜잭션 안에서 통과했고, 시험 쓰기는 전체 rollback했다. 조문 번호를 목록 검색어에서는 분리하고 본문 선택에는 유지해 API 0건 오류와 원장 식별자 누락을 함께 막는다. 이는 법령 도구·DB 계약의 연결 확인이며 전체 Demo 성공 증거는 아니다.

## 2026-09-08 v6 수정 후 Production 성공

main `fee233f7`의 Production 배포 `dpl_J5k1UZjDRkQ3WRsPRn5QB5sVMiCu`에서 공개 Demo를 API와 실제 브라우저로 각각 실행했다. API Run `8561b2b4-2dfa-4770-9563-b32c8be6e965`는 HTTP 200 스트림을 59.780초에 닫고 DB에서 58.947초에 `SUCCEEDED`로 종결됐다. 브라우저 Run `38f5a21d-a6e0-4e3c-a577-13b43471d186`도 60.714초에 `SUCCEEDED`로 종결됐다.

두 실행 모두 Product·Fraud·Sales·Regulation·CoVe·Red Team·Evidence Judge 7개가 성공했고 Claim 5건·Evidence 6건을 반환했다. 비용은 각각 USD 0.107026과 USD 0.110488로 전액 정산됐고 미확정 예약은 없었다. 브라우저에서는 처리 중 화면이 유지된 뒤 결과 화면으로 전환됐으며 근거 펼치기와 원문 링크가 동작하고 Console 오류가 없었다.

이 결과는 법령 원장 실패 수정 뒤 공개 Demo의 실제 성공 표본이다. 정식 Release harness와 Adoption 조건을 충족한 `B-DEMO-01` 평가는 아니므로 Implementation Gate `NO-GO`와 Release Gate `NOT-EVALUATED`를 유지한다. 회원 Text·Image·PDF 전체 E2E와 나머지 blocker도 이 표본으로 대체하지 않는다. [심사 전 Production 실측](../../evidence/development/judge-readiness/2026-09-08-production-core-flow.md)에 가입·탈퇴와 화면 확인 범위를 함께 기록했다.
