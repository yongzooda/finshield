# FinShield 문서

| 파일 | 역할 | 상태 |
|---|---|---|
| `01-product-plan.md` | 서비스 정의·범위·PreCase 통합·MVP | 확정 |
| `02-integrated-requirements.md` | 요구사항 정본 | 확정 |
| `03-database-spec.md` | ERD·컬럼·제약·RLS·보존정책 | 확정·DB 구현 기준 |
| `adr/001-p0-provider-stack.md` | P0 Provider·공식 출처·Storage·Job·실패 계약 | Architecture 승인·Implementation Gate `NO-GO` |
| `ops/ci-integrity-preflight.md` | `B-CI-INTEGRITY` 외부 통제 준비 상태·강화 절차 | P0 비차단·제출 후 강화 `DEFERRED` |
| `ops/provider-model-spike.md` | `B-MODEL-01` Sonnet 5 실행·비용·증거 채택 절차 | 실행 의존성 변경 뒤 최신 main 재측정·별도 채택 |
| `ops/supabase-project.md` | FinShield 전용 Supabase 프로젝트 사실·Migration 적용·검증 | `0001`~`0019` 작성, 운영 적용 `0001`~`0018`, `0019` 적용 대기 |
| `ops/supabase-evidence.md` | `B-SUPABASE-01` Migration digest·RLS 행렬 증거 harness 계약| Migration 0035·run `34080993706` 재채택 |
| `ops/source-snapshot-spike.md` | `B-SOURCE-02`·`B-SOURCE-03` 햇살론15 상품·취급기관 Snapshot harness 계약 | run `33981161310`·`33981225371` 채택 완료 |
| `ops/file-safety-spike.md` | `B-FILE-SAFETY` Parser 이전 검사·격리 실행 증거 harness 계약 | run `34027891135` 채택 완료 |
| `ops/retrieval-spike.md` | `B-RETRIEVAL-01` 종단 Filter·Keyword·Vector·Rerank 증거 harness 계약 | gate 두 번 측정, 두 번 다 미달 |
| `ops/rate-budget-spike.md` | `B-RATE-01` 예산·Rate·Provider 직렬화 원장 증거 harness 계약| run `34032841560` 채택 완료 |
| `ops/consent-isolation-spike.md` | `B-CONSENT-01` 동의 격리·원본 전송 경계 증거 harness 계약| run `34033055193` 채택 완료 |
| `ops/storage-spike.md` | `B-STORAGE-01` 인증 사용자 Storage 권한·발급 token 재사용 증거 harness 계약| run `34034102812` 채택 완료 |
| `ops/adr-correction-backlog.md` | ADR 본문 정정 대기 목록과 재측정 비용 | 대기 1건 |
| `ops/provider-ocr-spike.md` | CLOVA OCR 도메인·요금·한도와 쪽수 상한 결정 근거 | 사실 기록, 측정 전 |
| `04-feature-spec.md` | P0 기능 흐름·예외·완료조건 | `N-QLT-010` Implementation Gate `GO` 후 작성 |

문서와 코드가 충돌하면 `02-integrated-requirements.md`를 최우선 기준으로 사용하고, 그 다음 `01-product-plan.md`, DB·기능명세, 승인 ADR, 개발 규칙, 코드 순으로 판단한다. ADR은 담당 구현 선택을 고정하지만 상위 요구·DB·기능명세의 의미나 우선순위를 바꾸지 않는다.

`03-database-spec.md`는 FinShield 목표 Schema와 Migration·RLS·Storage 구현 기준이다. PreCase 기준선 Migration은 `supabase/precase-baseline/`에 보관하며 FinShield 프로젝트에 적용하지 않는다. FinShield Forward-only Migration `0001`~`0017`이 `supabase/migrations/`에 있으며 명세 6절의 표(P1 예약 표 제외)와 7.2의 서버 함수, 9.3의 안전 View를 만든다. 운영 프로젝트 적용 상태는 `ops/supabase-project.md`의 적용 이력을 따른다.

`adr/001-p0-provider-stack.md`는 구현에 사용할 조합과 Live 검증 계약을 정한다. Architecture 승인, 개발 착수용 Implementation Gate, 출시용 Release Gate는 별개이며 현재 값은 ADR metadata와 위 표를 따른다. Implementation `GO`에는 실제 키·쿼터·평가·RLS·삭제·재시도 증거가 필요하고, 전체 제품 E2E는 구현 뒤 별도 평가한다.

과거 PreCase 요구사항·측정 원본의 정본은 [PreCase 저장소](https://github.com/yongzooda/precase)에 있다. FinShield와 충돌하는 기존 PreCase 문서를 이 저장소의 현재 요구사항으로 해석하지 않는다.

- [저비용 Health 인프라와 증거 절차](ops/health-status-spike.md)

- [계정 삭제 선행 정리 Guard](ops/account-deletion-guard.md)

- [OCR 합성 품질 평가와 증거 절차](ops/ocr-quality-spike.md)
