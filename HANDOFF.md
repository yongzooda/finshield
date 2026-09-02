# FinShield HANDOFF

## 현재 기준

- 저장소: `yongzooda/finshield`
- 기반: PreCase 2026-09-02 `main` 제품 Snapshot
- 기획 정본: `docs/01-product-plan.md`
- 배포: 아직 FinShield Production을 연결하지 않음
- 기존 PreCase 저장소·배포: 유지

## 1단계 진행

- [x] 비공개 FinShield 저장소 생성
- [x] PreCase 제품 코드·Agent·Tool·테스트·Supabase Migration 이전
- [x] 과거 측정 원본은 PreCase 저장소를 정본으로 유지
- [x] FinShield 기획서 등록
- [x] README·AGENTS·CLAUDE·HANDOFF 초기화
- [x] 이슈·PR·CI 템플릿 이식
- [ ] GitHub 라벨 생성
- [ ] main 브랜치 보호와 필수 Check 설정
- [ ] FinShield 통합 요구사항 명세서 작성

## 다음 작업 순서

1. `docs/02-integrated-requirements.md`
2. P0 범위 확정
3. `docs/03-database-spec.md`
4. P0 `docs/04-feature-spec.md`
5. 인증·FinancialCase·Claim·Evidence 수직 구현
6. PreCase 가입 후 보호 모듈 분리
7. 재검증·Evidence Passport
8. 투자 PDF·정상 저축 Demo
9. 평가셋·신뢰센터·배포 점검

## 알려진 이관 상태

- Runtime과 환경변수에 PreCase 이름이 남아 있다.
- 기존 화면은 PreCase 기준이며 FinShield UI로 재구현해야 한다.
- 기존 PreCase의 Stateless 저장 금지 정책은 FinShield 계정·기록 정책과 다르다.
- 따라서 기존 `CLAUDE.md`와 요구사항 문서는 FinShield 기준으로 교체했다.
- `PRECASE_CI` 등 호환 환경변수는 코드·테스트를 함께 수정하는 PR에서 변경한다.
