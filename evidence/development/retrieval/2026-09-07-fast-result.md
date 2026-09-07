# 승인된 Fast 합성 개발 결과

PR #232를 squash merge한 main `00b192a9dafce97fd2f0e956bc6abb4f10cedade`에서 GitHub run `34128723611`을 첫 attempt로 실행했다. main CI `34128692681`·Production 배포도 성공했다. 이 세 성공은 역할이 다르며 제품 전체 P0 성공이 아니다.

실제 Cohere Embed 23회·Fast 20회, 개발용 4가족 20 Claim을 처리했다. Embed 과금 입력 6,811토큰, Fast 20 search units, 호출별 올림 환산 비용 합계 40,829 microunits(USD 0.040829), 미확정 예약 0이다. 승인 USD 0.05의 잔액은 USD 0.009171이며 남은 한도를 임의로 추가 시험에 쓰지 않는다. Fast Provider P95는 382ms다.

같은 후보를 비교한 개발 Case macro Recall/Precision@5는 기존 결정적 점수 0.95, Fast 1.00이다. `dev_bureau_report_fee`만 0.80에서 1.00으로 바뀌었고 다른 세 가족은 양쪽 모두 1.00이었다. 이 개발 split에는 위험 핵심 표본과 중복 source fingerprint가 없어 해당 품질을 검증하지 못한다. 검색 전체 Gate, 새 독립 holdout, 실제 공식 자료 품질과 Claim 판정 품질은 평가하지 않았다. 기존 Gate 두 차례 실패는 그대로 보존한다.

원본 artifact의 결과 JSON과 호출 전후 JSONL 원장을 `fast-34128723611/`에 복사했다. 본문·키·식별 가능한 사용자 입력은 포함하지 않으며 Provider 요청 ID는 hash다. 개발 시험 비용은 artifact 원장에 있고 원격 운영 비용 표를 수정하지 않았다. 이후 일일 총액을 확인할 때 이 USD 0.040829를 별도로 합산해야 한다. 제품 기본 Rerank는 아직 결정적 점수이며 Fast 자동 채택은 하지 않았다.
