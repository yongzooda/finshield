# 가입 후 문서 DB 계약

PC-008·PC-011의 동일 Case 계약 문서 경계를 격리 검증했다. Migration 0043은 입력 목적을 고정하고 가입 후 전용 문구 표를 사용한다. 기존 Case lifecycle·거래 전 Claim·Passport를 바꾸지 않는다.

격리 SQL 43 Migration·32시험 파일에서 타인 접근·목적 변경·미완료 문서 중복·확정 후 변경·점검 출처 위조를 거부했다. 같은 확인의 반복 호출은 같은 결과이며 원본 정리 Job은 한 건이다. 마스킹 인식 문구와 사용자의 확인 문구를 보존한다. 기존 파일 OCR 동의와 TTL·원본 삭제·RLS·계정 탈퇴 경계를 재사용한다.

이 PR은 DB 계약이다. API·화면·실제 Provider/Storage·원격 0043 적용은 기능 Draft와 후속 검증으로 관리한다. 기존 0042의 구조 해시 일치를 0043의 Live 검증으로 재사용하지 않는다. DB 증거는 이미 STALE이며 별도 재채택 전이다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다.
