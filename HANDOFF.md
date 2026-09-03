# FinShield HANDOFF

## 현재 기준

- 저장소: `yongzooda/finshield`
- 기반: PreCase 2026-09-02 `main` 제품 Snapshot
- 요구사항 정본: `docs/02-integrated-requirements.md`
- 상위 기획: `docs/01-product-plan.md`
- DB 구현 기준: `docs/03-database-spec.md`
- 배포: Vercel `finshield` Production 연결 완료 (`https://finshield-gamma.vercel.app`)
- 기존 PreCase 저장소·배포: 유지

## 완료 상태

- [x] 비공개 FinShield 저장소 생성
- [x] PreCase 제품 코드·Agent·Tool·테스트·Supabase Migration 이전
- [x] 과거 측정 원본은 PreCase 저장소를 정본으로 유지
- [x] FinShield 기획서 등록
- [x] README·AGENTS·CLAUDE·HANDOFF 초기화
- [x] 이슈·PR·CI 템플릿 이식
- [x] GitHub 라벨 생성
- [x] main 브랜치 보호와 GitHub Actions `check` 필수 설정
- [x] FinShield 통합 요구사항 명세서와 P0·P1·P2 기준선 확정
- [x] FinShield 목표 데이터베이스 명세와 D-001~D-032 구현 기준선 확정
- [x] Vercel Production 배포 연결 및 `READY` 확인

## 다음 작업 순서

1. P0 Provider·외부 연동·실행 인프라 Spike Gate 확정
2. P0 `docs/04-feature-spec.md`
3. 인증·FinancialCase·Claim·Evidence 수직 구현
4. Image·PDF File Gateway·OCR·PII Gate 구현
5. FinShield Multi-Agent·Hybrid RAG·CoVe·Evidence Policy 구현
6. PreCase 가입 후 보호 모듈 분리·통합
7. 수동 재검증·Evidence Passport·앱 알림
8. 대출 Text·Image·PDF P0 Demo와 평가셋
9. 신뢰센터·보안·배포 Gate 점검

정상 저축·투자/OpenDART 도메인은 P0 대출 수직 흐름을 완료한 뒤 P1로 확장한다.

## 알려진 이관 상태

- Runtime과 환경변수에 PreCase 이름이 남아 있다.
- 기존 화면은 PreCase 기준이며 FinShield UI로 재구현해야 한다.
- 기존 PreCase의 Stateless 저장 금지 정책은 FinShield 계정·기록 정책과 다르다.
- 기존 `LIKELY/UNLIKELY`·자체 신뢰도 1~5는 FinShield 최종 결과로 사용할 수 없다.
- `PRECASE_CI` 등 호환 환경변수는 코드·테스트를 함께 수정하는 PR에서 변경한다.
- 현재 `supabase/migrations/0001~0006`은 이식된 PreCase 기준선이며 FinShield 목표 Schema가 아니다. 전용 Project 확인 뒤 새 Forward-only 기준선으로 전환한다.
- DB 명세가 확정됐다는 사실은 Migration·RLS·Storage Policy가 구현·적용됐거나 P0 기능이 작동한다는 뜻이 아니다.
