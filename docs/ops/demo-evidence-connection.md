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
