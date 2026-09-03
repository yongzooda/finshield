# FinShield 문서

| 파일 | 역할 | 상태 |
|---|---|---|
| `01-product-plan.md` | 서비스 정의·범위·PreCase 통합·MVP | 확정 |
| `02-integrated-requirements.md` | 요구사항 정본 | 확정 |
| `03-database-spec.md` | ERD·컬럼·제약·RLS·보존정책 | 확정·DB 구현 기준 |
| `04-feature-spec.md` | P0 기능 흐름·예외·완료조건 | P0 Provider·인프라 Spike 후 작성 |

문서와 코드가 충돌하면 `02-integrated-requirements.md`를 최우선 기준으로 사용하고, 그 다음 `01-product-plan.md`, DB·기능명세, 개발 규칙, 코드 순으로 판단한다.

`03-database-spec.md`는 FinShield 목표 Schema와 Migration·RLS·Storage 구현 기준이다. 문서 확정만으로 현재 `supabase/migrations/0001~0006`이 목표 Schema에 맞게 전환됐거나 어떤 환경에 적용됐다고 해석하지 않는다.

과거 PreCase 요구사항·측정 원본의 정본은 [PreCase 저장소](https://github.com/yongzooda/precase)에 있다. FinShield와 충돌하는 기존 PreCase 문서를 이 저장소의 현재 요구사항으로 해석하지 않는다.
