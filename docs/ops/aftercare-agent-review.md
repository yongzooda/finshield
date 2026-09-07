# 가입 후 Agent 검토 연결

사용자가 전체 P0 선구현을 요청한 범위에서 기능 Draft에 연결했다. Gate 상태는 별도로 유지한다. PC-005·PC-007·N-OPS-003의 새 점검은 `precase_review_jobs`에 요청·기준 Passport·마스킹 답변·문구 비교·Manifest를 고정한다. 기존 거래 전 Run에 실행을 덧붙이지 않는다. API는 요청을 접수하고 Vercel Workflow가 Sales Conduct와 Regulation & Dispute의 기존 Runner·Allowlist·Tool을 순차 실행한다. 모델 입력에는 DB ID 대신 Claim 참조와 `aftercare-review-v1` 문맥만 전달한다. 문맥 추가 지시는 `aftercare-context-v1`로 실행 Trace에 보존한다.

동일 key·동일 본문은 같은 Job으로 합류한다. 응답 유실 후 상태 조회와 대기 요청의 재예약을 지원한다. 120초 Deadline·30초 Lease·2초 갱신을 사용하며 취소와 삭제를 모델·조회 경계에 전달한다. 만료 Lease의 Provider 결과를 모르면 새 모델 호출 없이 실패로 종결한다. 완료·부분 점검은 기존 점검 표와 한 트랜잭션으로 연결하고 이전 Passport·점검을 갱신하지 않는다.

모델이 사용자의 계약 문구를 공식 Evidence로 만들지 않으며, 근거는 실제 Tool이 반환한 Snapshot·Fingerprint·Locator와 연결한다. SQL에서도 Agent 순서·Manifest·모델·Tool 목적·Snapshot Hash를 검사한다. Agent 출력이 실패하거나 추가 자료가 필요하면 정상 관리로 높이지 않는다. 위법·사기 확정은 서비스 결론에 사용하지 않고 설명 요청·공식 문의·자료 준비로 연결한다. 기존 설문 결과는 과거 버전으로 보존한다.

모델·Embedding 비용은 별도 점검 문맥으로 예약하고 기존 전체·소유자·Case·실행 상한과 정산 원장을 사용한다. 상한을 올리거나 Provider를 새로 활성화하지 않았다. 신규 표에도 RLS·FORCE RLS·활성 세션·계정 삭제 Guard와 Case 삭제 Cascade를 적용했다.

격리 검증은 Migration 42개·SQL 31파일과 기본 시험 590건이다. 두 공통 Agent Runner 실행·다른 Allowlist Tool·PII/다른 Claim 거부·취소 전 Provider 0회·SQL 소유권·중복/응답 유실·잘못된 Lease·정상/부분 종결·결과 쓰기 실패 rollback·전체 비용 합산·미확정 예약 보존·과거 Passport 불변을 포함한다. 단위 시험의 모델·Tool은 합성이며 실제 Provider 품질 통과가 아니다. TypeScript·lint 오류 0건·빌드를 확인하고 기존 lint 경고 두 건을 유지한다. 선택적 시험 96건은 건너뛰었다.

원격은 0041까지 적용된 상태에서 이 변경을 작성했다. 0042 원격 적용과 보호 Preview의 API·브라우저·실제 Provider 검증을 별도 기록한다. 가입 후 Image/PDF의 동일 Case 연결, 전체 장애 20종, 공식 자료 적재와 판단 품질 Gate는 아직 남았다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다.

2026-09-08 후속: 원격 0042 적용과 실제 Agent 점검의 부분 종결·정산·정리를 확인했다. Sales 인용 오류 및 공식 조회 0건은 실패 이력으로 보존한다. [실측 자료](../../evidence/development/aftercare/2026-09-08-agent-preview.md)를 따른다.
