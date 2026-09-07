# 실행 Snapshot 기반 적합성 규칙 개발 검증

요구사항: AUTH-006·AUTH-007·AUTH-008·RES-001·PASS-002. Migration 0041의 `profile-policy-v2`와 `finshield-p0-loan-v3`를 추가했다. 이전 정책·Manifest·Passport는 수정하지 않았다.

## 구현한 경계

- DB가 Run에 고정된 Profile Snapshot을 읽어 축 삽입 때 판단한다. 서버가 전달한 적합성 `CONFIRMED`를 신뢰하지 않는다.
- 대출 Case에서 기존 빚 부담 높음, 비상 자금 한 달 미만, 저축·투자 목적 선택을 주의사항으로 표시한다. 이는 서비스의 확인 질문 규칙이며 신용심사·법정 적합성 임계값이 아니다.
- 햇살론15 전용 공식 표 Parser가 명시된 기간·상환방법만 구조화한다. 수수료·정확한 연소득·가입 승인은 추측하지 않는다. 복수 표·불명확한 기간은 제외한다.
- 현재 유효하고 해당 Run의 확정 상품 Claim에 직접 연결된 공식 Evidence만 기간 비교에 쓴다. 종료 고지·다른 상품명·참고·불완전·비신선 자료는 제외한다.
- 월 소득 구간을 연소득으로 환산하지 않는다. 월 상환액·지출·정확한 가입 요건이 없으면 상환 가능·가입 적격·안전을 확정하지 않는다. 확인한 주의사항은 UNCERTAIN, 나머지 정보 부족은 NEED_MORE_INFORMATION이다.
- 정책 버전, Profile ID/해시, 적용 규칙·이유, 상품 조건 Evidence ID·Snapshot ID를 불변 축 Trace에 저장하고 그 해시를 Passport Manifest에 포함한다. 회원 View에서 비교 이유를 복원한다.
- 최초 완료 응답도 DB가 저장한 축을 사용한다. 축 조회만 실패하면 이미 저장된 Run을 실패로 바꾸지 않고 Passport 재조회 안내를 표시한다. 재검증도 동일 SQL 최종화 Trigger를 사용한다.

## 확인 결과

- 실제 격리 PostgreSQL: 41 Migration·SQL 시험 30파일 통과. RLS/FORCE 누락·anon public 권한 잔존 0개다.
- 새 SQL 시험은 실제 Case→입력→Run→합성 Trace→최종화→Passport를 실행했다. 외부 Agent 호출이 있는 시험은 아니다.
- 건너뛰기, 자기신고 확정 거부, 부담·기간·가입 요건 분리, 종료/다른 상품 제외, Profile 변경 뒤 이전 축·Passport 해시 불변, 타인 조회 거부, 축 수정 거부, 이전 Manifest 보존을 확인했다.
- 기본 테스트 575건 통과·선택적 96건 건너뜀. TypeScript·lint·build 통과. 기존 lint 경고 2개는 남아 있다.
- SQL 초기 시험은 UPDATE 거부의 SQLSTATE를 잘못 기대해 실패했다. 기존 `restrict_violation`을 확인하여 시험 기대값만 정정했고 보호 Trigger는 바꾸지 않았다. 초기 TypeScript는 내부 변수 이름 중복 때문에 실패했으며 저장 축 변수 이름을 분리한 뒤 통과했다.
- 공식 원문 `https://www.kinfa.or.kr/financialProduct/hessalLoan.do`를 다시 가져와 2025년 12월 31일 보증 종료 고지를 확인했다. 현재 가입 가능 상품으로 채택하지 않았다.
- 원격 SQL 조회 결과 계정 삭제 0038·알림 0040·프로필 0041은 미적용이며 공용 KB 문서/청크는 0/0이었다. 첫 조회는 실제 테이블 이름을 잘못 적어 실패했고 정확한 `knowledge_documents`/`knowledge_chunks`로 다시 읽었다. 이 조회는 원격 데이터를 바꾸지 않았다.

## 남은 검증

원격 Migration 적용과 보호 Preview의 실제 Profile 변경·Passport 복원·키보드 검증은 별도다. 제품 KB의 새 공식 상품·가입 조건, 월 상환 계획 입력, 판정 품질 평가를 완료한 것이 아니다. 이 기록으로 B-CLAIM-01·B-RETRIEVAL-01·B-SPIKE-01 또는 Release Gate를 통과시키지 않는다. 기능 Draft의 부분 PASS 7/20·Implementation NO-GO·Release NOT-EVALUATED를 유지한다.
