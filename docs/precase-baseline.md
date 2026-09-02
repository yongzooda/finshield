# PreCase 기준선

FinShield는 PreCase의 제품 코드와 다음 자산을 재사용한다.

- Sales Conduct Agent
- Regulation & Dispute Agent
- 법령·분쟁조정·약관·위험 패턴 데이터
- `lookup_statute`, `search_precedent`, `search_case`, `check_documents`, `analyze_risk_pattern`
- PII·Prompt Injection·Citation·Rate Limit·Budget·Health 안전장치
- 테스트와 Supabase Migration

과거 기획·요구사항·실험·측정 원본은 [yongzooda/precase](https://github.com/yongzooda/precase)가 정본이다. 기존 PreCase의 Stateless 정책, 로그인·업로드 금지, 자체 신뢰도 1~5 정책은 FinShield의 확정 요구사항으로 승계하지 않는다.
