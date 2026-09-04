# PreCase 기준선 Migration 보관

이 디렉터리의 `0001~0006`은 PreCase에서 이식한 Migration이다. FinShield 목표 Schema가 아니다.

## 적용 금지

**FinShield 전용 Supabase 프로젝트에 적용하지 않는다.** DB 명세 14.2가 `CHANGE_ME_RUNTIME`·`CHANGE_ME_BATCH` Login role을 새 Project에 그대로 만들지 말라고 규정하고, 14.1이 `app_runtime`·`batch_loader` 로그인 역할을 폐기 대상으로 둔다. 이 파일들은 그 역할과 PreCase 업무 테이블을 함께 만든다.

## 보관하는 이유

현재 저장소의 Runtime 코드는 아직 PreCase 기준선이라 `cases`, `usage_counters`, `api_budget`, `statute_cache`, `error_reports` 같은 테이블을 참조한다. 이 파일들을 지우면 그 코드가 어떤 Schema 위에서 동작했는지 확인할 수 없다. FinShield UI와 Runtime이 교체될 때까지 이력으로 남긴다.

## FinShield Migration

FinShield의 Forward-only 기준선은 `supabase/migrations/`에 있고 `0001_finshield_baseline.sql`부터 시작한다. 적용 절차는 [Supabase 프로젝트 운영](../../docs/ops/supabase-project.md)을 따른다.
