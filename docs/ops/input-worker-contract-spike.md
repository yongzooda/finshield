# 입력·Worker DB 계약 Spike

요구사항: `N-QLT-010`, `CLM-003`, `INP-013`, `REV-001`, `SEC-FILE-006`, `N-OPS-003`.

이 변경은 격리 검증된 Migration 0026~0035와 SQL 불변식 시험 19~24를 등록한다. UI·Provider 호출·Workflow 배포 또는 서비스 활성화는 포함하지 않는다. 기존 v1 Manifest를 바꾸지 않고 v2를 추가한다. Runtime은 버전으로 선택하므로 새 행이 있다는 사실만으로 기존 실행을 전환하지 않는다.

| 범위 | 계약 |
|---|---|
| Passport 표시 | 본인 Passport에 연결된 근거 표시값만 반환 |
| Claim 수정·선택 | 본인 Case·Revision 충돌 확인 후 원자 확정, 실행은 고정 Revision을 조회 |
| 재검증 | Case에 묶인 Job 임대·소유자 상태 조회·중복 방지·취소·종결 복원 |
| 파일 처리 | 본인 입력·저장된 OCR 동의·마스킹 페이지·원문 위치 검사 |
| 삭제·만료 | 정확 객체 경로에 묶인 cleanup 임대, Storage 부재 확인 뒤 종결 |
| 모델 예산 | 회원 Run·마스킹 입력·Demo 문맥 중 하나로 예약, 기존 네 범위 counter 유지 |
| 중단 | 중단 또는 마스킹 전 입력에 늦은 Claim 저장·모델 예약 거부 |

새 PostgreSQL 17 격리 컨테이너에 Migration 0001~0035를 순서대로 적용하고 SQL 시험 01~24를 통과했다. public 테이블의 RLS·FORCE RLS 누락과 anon 잔여 권한은 0건이었다. Mock Storage 객체를 포함한 DB 계약 시험이며 실제 파일 삭제·24시간 보존·CLOVA·Workflow 성공 증거가 아니다.

운영 적용 전에는 Supabase Migration ledger와 함수 정의를 비교한다. 제출 준비 중 SQL Editor로 실행된 0026~0028 상당 함수의 존재를 Migration 전체 적용 완료로 해석하지 않는다. main 병합 뒤 적용·원격 preflight·각 blocker 재측정을 별도로 기록한다. Implementation NO-GO와 Release NOT-EVALUATED는 유지한다.
