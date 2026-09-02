-- 롤 분리 + RLS
-- 정본: DB 명세서 8장 (권한 요구사항 P-501·502 구현)
--
-- 핵심: 런타임에 정적 자산 쓰기 권한을 주지 않는다.
--       인젝션이 성공해도 코퍼스를 오염시킬 수 없어야 한다.

-- ============================================================
-- 1. RLS 활성 — anon 정책을 만들지 않아 deny-all이 된다 (D-3)
--    브라우저에서 anon 키로는 아무것도 읽을 수 없어야 한다.
-- ============================================================
alter table issue_tags        enable row level security;
alter table cases             enable row level security;
alter table case_issues       enable row level security;
alter table case_traits       enable row level security;
alter table terms_clauses     enable row level security;
alter table glossary_terms    enable row level security;
alter table statute_snapshots enable row level security;
alter table statute_timeline  enable row level security;
alter table risk_patterns     enable row level security;
alter table validation_stats  enable row level security;
alter table statute_cache     enable row level security;
alter table precedent_cache   enable row level security;
alter table error_reports     enable row level security;
alter table usage_counters    enable row level security;

-- ============================================================
-- 2. 롤 생성
--    비밀번호는 실행 전 교체할 것. 배치 자격증명은 배포 환경에 두지 않는다 (P-502).
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime login password 'CHANGE_ME_RUNTIME';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'batch_loader') then
    create role batch_loader login password 'CHANGE_ME_BATCH';
  end if;
end $$;

grant usage on schema public to app_runtime, batch_loader;

-- RLS를 우회해 롤 GRANT로 통제한다 (서버 전용 접근이므로)
alter table cases             force row level security;
create policy runtime_read_cases on cases for select to app_runtime using (true);
create policy runtime_read_issue_tags on issue_tags for select to app_runtime using (true);
create policy runtime_read_case_issues on case_issues for select to app_runtime using (true);
create policy runtime_read_case_traits on case_traits for select to app_runtime using (true);
create policy runtime_read_terms on terms_clauses for select to app_runtime using (true);
create policy runtime_read_glossary on glossary_terms for select to app_runtime using (true);
create policy runtime_read_snapshots on statute_snapshots for select to app_runtime using (true);
create policy runtime_read_timeline on statute_timeline for select to app_runtime using (true);
create policy runtime_read_patterns on risk_patterns for select to app_runtime using (true);
create policy runtime_read_stats on validation_stats for select to app_runtime using (true);
create policy runtime_all_statute_cache on statute_cache for all to app_runtime using (true) with check (true);
create policy runtime_all_precedent_cache on precedent_cache for all to app_runtime using (true) with check (true);
create policy runtime_insert_reports on error_reports for insert to app_runtime with check (true);
create policy runtime_all_counters on usage_counters for all to app_runtime using (true) with check (true);

create policy batch_all_cases on cases for all to batch_loader using (true) with check (true);
create policy batch_all_issue_tags on issue_tags for all to batch_loader using (true) with check (true);
create policy batch_all_case_issues on case_issues for all to batch_loader using (true) with check (true);
create policy batch_all_case_traits on case_traits for all to batch_loader using (true) with check (true);
create policy batch_all_terms on terms_clauses for all to batch_loader using (true) with check (true);
create policy batch_all_glossary on glossary_terms for all to batch_loader using (true) with check (true);
create policy batch_all_snapshots on statute_snapshots for all to batch_loader using (true) with check (true);
create policy batch_all_timeline on statute_timeline for all to batch_loader using (true) with check (true);
create policy batch_all_patterns on risk_patterns for all to batch_loader using (true) with check (true);
create policy batch_all_stats on validation_stats for all to batch_loader using (true) with check (true);

-- ============================================================
-- 3. GRANT — 여기가 실제 방어선
-- ============================================================

-- 런타임: 정적 자산은 SELECT만. 쓰기 권한 없음.
grant select on
  issue_tags, cases, case_issues, case_traits,
  terms_clauses, glossary_terms,
  statute_snapshots, statute_timeline,
  risk_patterns, validation_stats,
  citable_cases, public_corrections
to app_runtime;

-- 런타임: 캐시는 읽기·쓰기 (TTL 관리)
grant select, insert, update on statute_cache, precedent_cache to app_runtime;

-- 런타임: 신고는 INSERT만 (갱신·삭제 불가), 카운터는 증가만
grant insert on error_reports to app_runtime;
grant select, insert, update on usage_counters to app_runtime;

-- 배치: 정적 자산 전체 권한
grant select, insert, update, delete on
  issue_tags, cases, case_issues, case_traits,
  terms_clauses, glossary_terms,
  statute_snapshots, statute_timeline,
  risk_patterns, validation_stats
to batch_loader;

grant usage, select on all sequences in schema public to batch_loader;

-- ============================================================
-- 4. 검증 — 아래가 전부 실패해야 정상
-- ============================================================
-- set role app_runtime;
--   insert into cases (...) values (...);        -- ❌ permission denied 여야 함
--   update validation_stats set value_json='{}'; -- ❌ permission denied 여야 함
--   delete from error_reports;                   -- ❌ permission denied 여야 함
-- reset role;
