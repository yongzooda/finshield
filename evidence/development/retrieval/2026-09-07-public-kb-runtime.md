# 공용 KB 도구와 검색 비용 경계

관련 요구: AI-007·E-002·E-003·E-006·E-009·E-010·E-013·N-OPS-003·SEC-OPS-003. 기존 v5 Gate와 실패 수치는 재측정하거나 변경하지 않았다.

`get_source_snapshot`, `check_documents`, `search_dispute_case`의 빈 구현을 공용 KB 본문 조회로 교체했다. Manifest의 KB Release를 기준으로 문서 유형·적용 기간·철회 상태를 한정한다. Keyword는 실제 PostgreSQL FTS이고 Vector는 같은 Release·모델·버전·1024차원의 Exact KNN이다. 결정적 Rerank와 출처 지문 중복 제거를 연결했다. Vector가 없거나 비용을 예약하지 못하면 Keyword 경로와 누락 이유를 별도로 표시한다.

Snapshot 재조회는 원래 수집 시각·출처 지문·본문 위치를 보존한다. 끝난 적용 기간·미래 적용·철회 문서는 현재 직접 증거로 만들지 않는다. 분쟁과 과거 PreCase 사례는 참고용이다. `analyze_risk_pattern`은 관련 경보·사례 조회로 분리했고 현재 거래의 사기 확률이나 통계 발생률을 만들지 않는다. `check_documents`는 대출 준비 자료의 큐레이션과 관련 원문을 구분하며 실제 소유 여부나 위법을 추정하지 않는다.

Cohere Adapter는 비모델 PII Gate 뒤 호출 전 비용을 예약한다. 실제 billed token 또는 search unit을 정산하고, timeout·5xx·불명확한 사용량은 예약을 보존한다. Fast는 지정된 합성 소유자와 명시적인 개발 설정을 요구한다. 최대 20문서·한 search unit 범위의 입력을 제한한다. 제품의 기본 Rerank를 Fast로 변경하지 않는다.

Migration 0039는 Provider별 한도에 전체 한도를 함께 걸고 같은 예약을 양쪽 Counter에 연결한다. 정산·해제는 기존 함수를 재사용한다. 도입 이전 사용량을 합산하며, 미확정 예약이 남은 Counter의 초기화는 거부한다. 상한 금액은 자동 설정하거나 올리지 않았다. 실제 활성화에는 승인된 전체/Provider 정책과 원격 Migration이 필요하다.

기존 PreCase 저장소는 읽기만 했다. 고정 Commit `12fd89cdac81747a9c3ba7b4b71a408013f8559a`의 corpus와 분류 매핑을 사용했으며 eval_set은 적재하지 않았다. corpus 대출 후보 23건에서 출처 위치 불명 2건과 PII 잔존 1건을 제외하고, 20문서·28청크를 로컬 격리 DB에 적재했다. 원문·라이선스를 다시 확인하지 못했으므로 `UNKNOWN`, 불완전·인용 불가·참고용이다. 금융감독원 원문 URL의 이번 웹 조회는 열리지 않아 재확인 성공으로 기록하지 않는다. 현재 제품 Manifest나 원격 KB에 이 개발 Release를 연결하지 않았다.

실제 격리 DB에서 FTS 검색·Snapshot 본문 복원·다른 Release 거부·없는 검색 결과와 PostgreSQL 취소/연결 복구 2개 통합 시험을 통과했다. Provider 합산 한도 초과와 실패 rollback·정산·미확정 예약·다른 소유자 거부를 SQL로 검증했다. Provider 응답·비용과 참고자료/시점/중복 경계는 단위 시험으로 검증했다. 선택적 통합 시험의 기본 skip을 Live 성공으로 세지 않는다.

Fast와 Embedding의 이 개발 작업 실제 호출은 아직 0건·USD 0이다. 공식 원문·라이선스 보완, 전체 자료 적재·Embedding 생성, 제품 Manifest 연결, 실제 Provider·검색 품질 측정은 남아 있다. B-RETRIEVAL-01이나 개인정보 Gate 채택 증거가 아니다.

실측 뒤 구현 보완: Fast 개발 Adapter도 Keyword 20·Vector 20의 합집합 최대 40개를 받는다. 마스킹 뒤 질의·문서 바이트 경계를 다시 검사해 한 search unit 범위의 제한을 유지한다. 40개 복원과 41개 입력의 예약 전 차단 시험을 추가했다. 제품 기본 Rerank는 변경하지 않았다.
