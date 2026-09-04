# FinShield 문서

| 파일 | 역할 | 상태 |
|---|---|---|
| `01-product-plan.md` | 서비스 정의·범위·PreCase 통합·MVP | 확정 |
| `02-integrated-requirements.md` | 요구사항 정본 | 확정 |
| `03-database-spec.md` | ERD·컬럼·제약·RLS·보존정책 | 확정·DB 구현 기준 |
| `adr/001-p0-provider-stack.md` | P0 Provider·공식 출처·Storage·Job·실패 계약 | Architecture 승인·Implementation Gate `NO-GO` |
| `ops/ci-integrity-preflight.md` | `B-CI-INTEGRITY` 외부 통제 준비 상태·강화 절차 | P0 비차단·제출 후 강화 `DEFERRED` |
| `ops/provider-model-spike.md` | `B-MODEL-01` Sonnet 5 실행·비용·증거 채택 절차 | 두 번 합격·scope 변경으로 채택 무효·재측정 대기 |
| `ops/supabase-project.md` | FinShield 전용 Supabase 프로젝트 사실·Migration 적용·검증 | `0001` 기준선 작성, 적용 전 |
| `04-feature-spec.md` | P0 기능 흐름·예외·완료조건 | `N-QLT-010` Implementation Gate `GO` 후 작성 |

문서와 코드가 충돌하면 `02-integrated-requirements.md`를 최우선 기준으로 사용하고, 그 다음 `01-product-plan.md`, DB·기능명세, 승인 ADR, 개발 규칙, 코드 순으로 판단한다. ADR은 담당 구현 선택을 고정하지만 상위 요구·DB·기능명세의 의미나 우선순위를 바꾸지 않는다.

`03-database-spec.md`는 FinShield 목표 Schema와 Migration·RLS·Storage 구현 기준이다. PreCase 기준선 Migration은 `supabase/precase-baseline/`에 보관하며 FinShield 프로젝트에 적용하지 않는다. FinShield Forward-only 기준선은 `supabase/migrations/`에 있고 아직 업무 테이블을 만들지 않는다.

`adr/001-p0-provider-stack.md`는 구현에 사용할 조합과 Live 검증 계약을 정한다. Architecture 승인, 개발 착수용 Implementation Gate, 출시용 Release Gate는 별개이며 현재 값은 ADR metadata와 위 표를 따른다. Implementation `GO`에는 실제 키·쿼터·평가·RLS·삭제·재시도 증거가 필요하고, 전체 제품 E2E는 구현 뒤 별도 평가한다.

과거 PreCase 요구사항·측정 원본의 정본은 [PreCase 저장소](https://github.com/yongzooda/precase)에 있다. FinShield와 충돌하는 기존 PreCase 문서를 이 저장소의 현재 요구사항으로 해석하지 않는다.
