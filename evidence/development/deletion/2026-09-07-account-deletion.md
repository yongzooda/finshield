# 전체 계정 탈퇴 구현과 검증

관련 요구: AUTH-005·AUTH-011·D-014·S-017, DB 6.9·13.3. 기능 Draft #192에서 전체 P0 구현을 먼저 진행하라는 사용자 지시에 따른다. Implementation NO-GO와 Release NOT-EVALUATED는 유지한다.

최근 비밀번호 인증과 같은 Origin에서 탈퇴를 접수한다. 소유자 단위 DB 잠금으로 신규 Case·프로필 Snapshot·Run·입력·OCR·Embedding 생성과 탈퇴 접수를 직렬화한다. 기존 Case와 직접 DB·Storage 회원 접근을 차단한다. 기존 Case 삭제 원장·정리 Lease·물리 객체 부재 검사·Purge를 재사용한다.

처음에는 요청 차단과 7일 유효 HttpOnly 서명 영수증을 돌려주고, 영수증을 받은 브라우저가 같은 확인 절차에서 Workflow 예약을 이어 간다. 첫 응답 유실로 영수증을 잃은 상태에서 Auth가 먼저 사라지지 않게 한다. 로그인 없는 영수증은 해당 탈퇴 요청의 상태 조회와 정리 재예약만 허용한다. 예약 중복은 DB에서 5분 간격으로 제한한다. 불명확한 예약도 즉시 재전송하지 않는다.

Auth 마지막 삭제와 완료 상태·비식별 완료 원장은 하나의 SQL 트랜잭션이다. 0036 Profile Guard는 유지한다. Case·임시물·미완료 요청·Storage 객체가 남으면 완료하지 않는다. 정리가 끝나지 않으면 화면은 처리 중으로 유지한다.

격리 PostgreSQL에서 검증한 항목: 새로운 Case 거부, 프로필 수정 거부, 다른 회원 정상 작업, Case·고아 Storage 잔존 시 완료 거부, Auth 삭제 SQL 오류 주입 뒤 전체 rollback, 정상 재시도와 반복 종결, Profile·Snapshot 부재, 완료 원장 중복 없음, 다른 회원 상태 조회 거부. 첫 SQL 시험은 시험 변수와 Storage 열 이름 충돌로 실패했으며 시험 변수를 정정한 뒤 통과했다.

현재 원격 Migration·배포 Auth/Storage·브라우저 종단 검증은 아직 하지 않았다. 관리형 Auth Cascade 권한, 실제 파일·늦은 TUS 쓰기, 중간 실패·재예약, 다른 기기의 완료 복원은 별도 Live 검증이 필요하다. 이 기록은 정식 Gate 채택 증거가 아니다.

추가 검증: 서로 다른 PostgreSQL 연결에서 Case 생성과 탈퇴 접수를 경합시켰다. 선행 Case commit 전에는 탈퇴 접수가 기다렸고, commit 뒤 그 Case도 차단됐으며 이후 신규 Case는 거부됐다. Case에 연결되지 않은 소유자 prefix의 Storage 객체도 정확한 경로 20개씩 정리한 뒤 부재 검사를 다시 한다. 새 API·영수증 시험 8건을 포함한 전체 기본 시험 558건 통과, 선택적 94건 건너뜀이다. 38개 Migration과 SQL 27파일, TypeScript·Production 빌드를 검증했다. 빌드와 격리 DB 통과를 실제 배포 탈퇴 성공으로 확대하지 않는다.
