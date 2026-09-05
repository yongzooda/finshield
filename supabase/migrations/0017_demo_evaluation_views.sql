-- ============================================================
-- 0017 Demo 격리·평가·신뢰센터·안전 View (명세 6.8 평가, 6.10, 9.3, 13.1, 15절 13번 묶음)
--
-- 대상: demo.seed_versions, demo.seed_sources, demo.sessions, demo.runs,
--       demo.agent_runs, demo.tool_runs, demo.tool_run_sources, demo.result_snapshots,
--       kb.evaluation_sets, kb.evaluation_runs, kb.evaluation_metrics, kb.tool_health_snapshots,
--       public.case_list_v, public.case_detail_v, public.run_progress_v, public.passport_v,
--       public.trust_center_metrics_v
--
-- 함수: private.create_demo_session, private.read_demo_session,
--       private.sweep_demo, private.record_tool_health
--
-- 원칙:
--  - Demo 는 demo 스키마만 쓰고 회원 financial_cases 를 만들지 않는다 (D-022).
--  - anon 은 Demo 표를 직접 읽지 않는다. 서버가 짧은 Capability token 으로
--    해당 Session 결과만 돌려준다. token 은 Hash 만 저장한다.
--  - 정적 Fallback 은 is_precomputed=true 와 기준일을 가진 별도 행이다.
--    사전계산 결과를 Live 실행으로 표시할 길을 두지 않는다 (OPS-004, EC-025).
--  - 신뢰센터는 승인된 FinShield 평가 Run 의 산식·표본·버전만 공개한다.
--    PreCase 수치를 FinShield 정확도로 합치지 않는다 (OPS-002).
--  - 회원 View 는 security_invoker 로 기반 RLS 를 따르고 원본 경로·Lease·
--    Raw error 를 노출하지 않는다 (명세 9.3).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Demo Seed (명세 6.10)
-- ------------------------------------------------------------
create table if not exists demo.seed_versions (
  id                      uuid primary key default gen_random_uuid(),
  seed_code               text not null,
  version                 text not null,
  input_type              public.case_input_type not null,
  masked_input            text not null,
  expected_claim_manifest jsonb not null,
  content_hash            text not null,
  created_at              timestamptz not null default now(),

  constraint uq_demo_seed_versions__code_version unique (seed_code, version),
  constraint ck_demo_seed_versions__code check (seed_code ~ '^[a-z][a-z0-9_-]{2,63}$'),
  constraint ck_demo_seed_versions__version_len check (octet_length(version) between 1 and 32),
  constraint ck_demo_seed_versions__input_type check (input_type in ('TEXT', 'IMAGE', 'PDF')),
  constraint ck_demo_seed_versions__masked_input_len check (octet_length(masked_input) between 1 and 65536),
  constraint ck_demo_seed_versions__manifest
    check (jsonb_typeof(expected_claim_manifest) = 'object' and expected_claim_manifest ? 'schema_version'),
  constraint ck_demo_seed_versions__content_hash check (content_hash ~ '^[0-9a-f]{64}$')
);
comment on table demo.seed_versions is '승인된 비식별 합성 Seed. 불변이며 회원 입력을 재사용하지 않는다 (명세 6.10)';

create table if not exists demo.seed_sources (
  seed_version_id    uuid not null,
  source_snapshot_id uuid not null,
  purpose_code       text not null,
  created_at         timestamptz not null default now(),
  primary key (seed_version_id, source_snapshot_id, purpose_code),
  constraint fk_demo_seed_sources__seed foreign key (seed_version_id) references demo.seed_versions (id),
  constraint fk_demo_seed_sources__snapshot foreign key (source_snapshot_id) references kb.source_snapshots (id),
  constraint ck_demo_seed_sources__purpose check (purpose_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

-- ------------------------------------------------------------
-- 2. Demo Session·실행 (명세 6.10, 13.1)
-- ------------------------------------------------------------
create table if not exists demo.sessions (
  id                    uuid primary key default gen_random_uuid(),
  seed_version_id       uuid not null,
  capability_token_hash text not null,
  mode                  text not null,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),

  constraint fk_demo_sessions__seed foreign key (seed_version_id) references demo.seed_versions (id),
  constraint uq_demo_sessions__token unique (capability_token_hash),
  constraint ck_demo_sessions__token check (capability_token_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_demo_sessions__mode check (mode in ('LIVE', 'STATIC_FALLBACK')),
  constraint ck_demo_sessions__expires
    check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
comment on table demo.sessions is '회원 owner 없는 격리 Session. 최대 24시간, Capability token 은 Hash 만 (명세 6.10)';
create index if not exists idx_demo_sessions__expires on demo.sessions (expires_at);

create table if not exists demo.runs (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null,
  execution_manifest_id uuid not null,
  status                public.execution_status not null default 'QUEUED',
  overall_result        public.overall_result,
  started_at            timestamptz,
  finished_at           timestamptz,
  error_code            text,
  created_at            timestamptz not null default now(),

  constraint fk_demo_runs__session foreign key (session_id) references demo.sessions (id) on delete cascade,
  constraint fk_demo_runs__manifest foreign key (execution_manifest_id) references private.execution_manifests (id),
  constraint ck_demo_runs__error_code_len check (error_code is null or octet_length(error_code) <= 64),
  constraint ck_demo_runs__terminal_finished
    check (status in ('QUEUED', 'RUNNING') = (finished_at is null)),
  constraint ck_demo_runs__result_only_when_terminal
    check (status in ('SUCCEEDED', 'PARTIAL') or overall_result is null)
);
create index if not exists idx_demo_runs__session on demo.runs (session_id, created_at desc);

create table if not exists demo.agent_runs (
  id           uuid primary key default gen_random_uuid(),
  demo_run_id  uuid not null,
  agent_code   text not null,
  version      text not null,
  status       public.execution_status not null default 'QUEUED',
  tool_summary jsonb not null default '{}'::jsonb,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),

  constraint fk_demo_agent_runs__run foreign key (demo_run_id) references demo.runs (id) on delete cascade,
  constraint fk_demo_agent_runs__definition
    foreign key (agent_code, version) references private.agent_definitions (agent_code, version),
  constraint ck_demo_agent_runs__tool_summary check (jsonb_typeof(tool_summary) = 'object')
);
create index if not exists idx_demo_agent_runs__run on demo.agent_runs (demo_run_id);

create table if not exists demo.tool_runs (
  id                uuid primary key default gen_random_uuid(),
  demo_agent_run_id uuid not null,
  tool_code         text not null,
  transport         public.tool_transport not null,
  status            public.execution_status not null default 'QUEUED',
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),

  constraint fk_demo_tool_runs__agent_run foreign key (demo_agent_run_id) references demo.agent_runs (id) on delete cascade,
  constraint ck_demo_tool_runs__tool_code check (tool_code ~ '^[a-z][a-z0-9_]{2,63}$')
);
create index if not exists idx_demo_tool_runs__agent_run on demo.tool_runs (demo_agent_run_id);

create table if not exists demo.tool_run_sources (
  demo_tool_run_id   uuid not null,
  source_snapshot_id uuid not null,
  created_at         timestamptz not null default now(),
  primary key (demo_tool_run_id, source_snapshot_id),
  constraint fk_demo_tool_run_sources__tool_run foreign key (demo_tool_run_id) references demo.tool_runs (id) on delete cascade,
  constraint fk_demo_tool_run_sources__snapshot foreign key (source_snapshot_id) references kb.source_snapshots (id)
);

create table if not exists demo.result_snapshots (
  id              uuid primary key default gen_random_uuid(),
  demo_run_id     uuid not null,
  result_manifest jsonb not null,
  computed_at     timestamptz not null,
  basis_date      date not null,
  is_precomputed  boolean not null,
  content_hash    text not null,
  created_at      timestamptz not null default now(),

  constraint fk_demo_result_snapshots__run foreign key (demo_run_id) references demo.runs (id) on delete cascade,
  constraint uq_demo_result_snapshots__run unique (demo_run_id),
  constraint ck_demo_result_snapshots__manifest
    check (jsonb_typeof(result_manifest) = 'object' and result_manifest ? 'schema_version'),
  constraint ck_demo_result_snapshots__content_hash check (content_hash ~ '^[0-9a-f]{64}$')
);
comment on table demo.result_snapshots is 'Demo 결과. 정적 Fallback 은 is_precomputed=true 와 basis_date 를 반드시 가진다 (명세 6.10)';

-- Live Session 의 결과는 사전계산일 수 없고, 정적 Fallback Session 의 결과는 사전계산이어야 한다.
create or replace function private.check_demo_result_mode() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  select s.mode into v_mode from demo.runs r join demo.sessions s on s.id = r.session_id where r.id = new.demo_run_id;
  if v_mode = 'LIVE' and new.is_precomputed then
    raise exception 'LIVE Session 에 사전계산 결과를 넣을 수 없다' using errcode = 'check_violation';
  end if;
  if v_mode = 'STATIC_FALLBACK' and not new.is_precomputed then
    raise exception 'STATIC_FALLBACK Session 의 결과는 사전계산이어야 한다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_demo_result_mode() from public, anon, authenticated;
drop trigger if exists trg_demo_result_snapshots__mode on demo.result_snapshots;
create trigger trg_demo_result_snapshots__mode
  before insert on demo.result_snapshots
  for each row execute function private.check_demo_result_mode();

-- 불변 표
do $$
declare t text;
begin
  foreach t in array array['seed_versions', 'seed_sources', 'tool_run_sources', 'result_snapshots'] loop
    execute format('drop trigger if exists trg_demo_%s__reject_update on demo.%I', t, t);
    execute format('create trigger trg_demo_%s__reject_update before update on demo.%I '
                   'for each row execute function private.reject_update()', t, t);
  end loop;
  execute 'drop trigger if exists trg_demo_seed_versions__reject_delete on demo.seed_versions';
  execute 'create trigger trg_demo_seed_versions__reject_delete before delete on demo.seed_versions '
          'for each row execute function private.reject_delete()';
end
$$;

-- ------------------------------------------------------------
-- 3. Demo 함수: Session 생성·조회·정리 (명세 6.10, 9.2)
--    token 원문은 서버가 만들어 호출자에게만 돌려주고 DB 는 Hash 만 갖는다.
-- ------------------------------------------------------------
create or replace function private.create_demo_session(
  p_seed_code text, p_mode text default 'LIVE', p_ttl interval default interval '2 hours')
returns table (session_id uuid, capability_token text, expires_at timestamptz, seed_version_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed uuid;
  v_token text;
  v_session uuid;
  v_expires timestamptz;
begin
  if p_ttl <= interval '0' or p_ttl > interval '24 hours' then
    raise exception 'Demo Session 은 최대 24시간이다' using errcode = 'check_violation';
  end if;
  select id into v_seed from demo.seed_versions where seed_code = p_seed_code order by created_at desc limit 1;
  if v_seed is null then
    raise exception '승인된 Seed % 가 없다', p_seed_code using errcode = 'no_data_found';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + p_ttl;
  insert into demo.sessions (seed_version_id, capability_token_hash, mode, expires_at)
  values (v_seed, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_mode, v_expires)
  returning id into v_session;
  return query select v_session, v_token, v_expires, v_seed;
end;
$$;
revoke all on function private.create_demo_session(text, text, interval) from public, anon, authenticated;
grant execute on function private.create_demo_session(text, text, interval) to finshield_worker;

-- Capability 로 Session 하나의 상태·결과만 돌려준다. 만료·불일치는 빈 결과다.
create or replace function private.read_demo_session(p_capability_token text)
returns table (
  session_id uuid, mode text, expires_at timestamptz, seed_code text, seed_version text, input_type public.case_input_type,
  run_id uuid, run_status public.execution_status, overall_result public.overall_result,
  result_manifest jsonb, computed_at timestamptz, basis_date date, is_precomputed boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.mode, s.expires_at, v.seed_code, v.version, v.input_type,
         r.id, r.status, r.overall_result, rs.result_manifest, rs.computed_at, rs.basis_date, rs.is_precomputed
    from demo.sessions s
    join demo.seed_versions v on v.id = s.seed_version_id
    left join lateral (select * from demo.runs x where x.session_id = s.id order by x.created_at desc limit 1) r on true
    left join demo.result_snapshots rs on rs.demo_run_id = r.id
   where s.capability_token_hash = encode(extensions.digest(p_capability_token, 'sha256'), 'hex')
     and s.expires_at > now()
$$;
revoke all on function private.read_demo_session(text) from public, anon, authenticated;
grant execute on function private.read_demo_session(text) to finshield_worker;

-- 만료 Session 과 그 실행을 지운다. demo 스키마만 건드린다 (D-022).
create or replace function private.sweep_demo()
returns table (kind text, affected integer)
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  delete from demo.sessions where expires_at <= now();
  get diagnostics n = row_count;
  return query values ('DEMO_SESSION_EXPIRED', n);
end;
$$;
revoke all on function private.sweep_demo() from public, anon, authenticated;
grant execute on function private.sweep_demo() to finshield_worker;

-- ------------------------------------------------------------
-- 4. 평가·신뢰센터 표 (명세 6.8)
-- ------------------------------------------------------------
create table if not exists kb.evaluation_sets (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  version               text not null,
  product_scope         text not null,
  sample_count          integer not null,
  fixture_manifest_hash text not null,
  created_at            timestamptz not null default now(),

  constraint uq_kb_evaluation_sets__name_version unique (name, version),
  constraint ck_kb_evaluation_sets__name check (name ~ '^[a-z][a-z0-9_-]{2,63}$'),
  constraint ck_kb_evaluation_sets__version_len check (octet_length(version) between 1 and 32),
  -- FinShield 전용 범위만. PreCase 수치는 별도 scope 로 남긴다 (명세 14.1).
  constraint ck_kb_evaluation_sets__product_scope check (product_scope in ('FINSHIELD', 'PRECASE_LEGACY')),
  constraint ck_kb_evaluation_sets__sample_count check (sample_count > 0),
  constraint ck_kb_evaluation_sets__hash check (fixture_manifest_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists kb.evaluation_runs (
  id                    uuid primary key default gen_random_uuid(),
  evaluation_set_id     uuid not null,
  execution_manifest_id uuid not null,
  method_variant        text not null,
  status                text not null default 'QUEUED',
  started_at            timestamptz,
  finished_at           timestamptz,
  result_hash           text,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),

  constraint fk_kb_evaluation_runs__set foreign key (evaluation_set_id) references kb.evaluation_sets (id),
  constraint fk_kb_evaluation_runs__manifest foreign key (execution_manifest_id) references private.execution_manifests (id),
  constraint ck_kb_evaluation_runs__variant check (method_variant in ('LLM_ONLY', 'RAG', 'RAG_COVE', 'FULL')),
  constraint ck_kb_evaluation_runs__status check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  constraint ck_kb_evaluation_runs__result_hash check (result_hash is null or result_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_kb_evaluation_runs__completed_hash check (status <> 'COMPLETED' or result_hash is not null),
  -- 완료된 Run 만 공개할 수 있다.
  constraint ck_kb_evaluation_runs__published_completed check (published_at is null or status = 'COMPLETED')
);
create index if not exists idx_kb_evaluation_runs__set on kb.evaluation_runs (evaluation_set_id, created_at desc);

create table if not exists kb.evaluation_metrics (
  id                uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null,
  metric_code       text not null,
  numerator         numeric,
  denominator       numeric,
  value_numeric     numeric,
  unit              text not null,
  formula_version   text not null,
  measured_at       timestamptz not null default now(),

  constraint fk_kb_evaluation_metrics__run foreign key (evaluation_run_id) references kb.evaluation_runs (id) on delete cascade,
  constraint uq_kb_evaluation_metrics__run_code unique (evaluation_run_id, metric_code),
  constraint ck_kb_evaluation_metrics__code check (metric_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_kb_evaluation_metrics__unit check (unit in ('RATIO', 'COUNT', 'MS', 'MICROUNIT', 'SECONDS')),
  constraint ck_kb_evaluation_metrics__formula_len check (octet_length(formula_version) between 1 and 64),
  -- 분모 0 은 N/A 다. 비율은 분자·분모를 보존한다 (N-QLT-004).
  constraint ck_kb_evaluation_metrics__ratio
    check (unit <> 'RATIO' or (numerator is not null and denominator is not null
                               and ((denominator = 0 and value_numeric is null)
                                    or (denominator > 0 and value_numeric = numerator / denominator)))),
  constraint ck_kb_evaluation_metrics__nonnegative
    check (coalesce(numerator, 0) >= 0 and coalesce(denominator, 0) >= 0)
);

create table if not exists kb.tool_health_snapshots (
  id          uuid primary key default gen_random_uuid(),
  tool_code   text not null,
  status      text not null,
  checked_at  timestamptz not null default now(),
  fresh_until timestamptz not null,
  latency_ms  integer,
  error_code  text,

  constraint ck_kb_tool_health__tool_code check (tool_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint ck_kb_tool_health__status check (status in ('UP', 'DEGRADED', 'DOWN', 'UNCONFIGURED', 'UNKNOWN')),
  constraint ck_kb_tool_health__fresh check (fresh_until > checked_at),
  constraint ck_kb_tool_health__latency check (latency_ms is null or latency_ms >= 0),
  -- 원문 오류 금지: Code 만 (명세 6.8).
  constraint ck_kb_tool_health__error_code check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
create index if not exists idx_kb_tool_health__tool_checked on kb.tool_health_snapshots (tool_code, checked_at desc);

-- 평가·상태 표는 Append-only 다. 공개 전환만 UPDATE 로 허용한다.
do $$
declare t text;
begin
  foreach t in array array['evaluation_sets', 'evaluation_metrics', 'tool_health_snapshots'] loop
    execute format('drop trigger if exists trg_kb_%s__reject_update on kb.%I', t, t);
    execute format('create trigger trg_kb_%s__reject_update before update on kb.%I '
                   'for each row execute function private.reject_update()', t, t);
  end loop;
end
$$;

create or replace function private.record_tool_health(
  p_tool_code text, p_status text, p_fresh_seconds integer default 300, p_latency_ms integer default null, p_error_code text default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into kb.tool_health_snapshots (tool_code, status, fresh_until, latency_ms, error_code)
  values (p_tool_code, p_status, now() + make_interval(secs => p_fresh_seconds), p_latency_ms, p_error_code)
  returning id
$$;
revoke all on function private.record_tool_health(text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function private.record_tool_health(text, text, integer, integer, text) to finshield_worker;

-- ------------------------------------------------------------
-- 5. 회원 안전 View (명세 9.3). security_invoker 로 기반 RLS 를 따른다.
--    승인 채널 표시값은 kb 스키마에 있어 회원이 직접 읽지 못하므로, 본인 Guide 에
--    한해 표시값만 돌려주는 정의자 Helper 를 둔다. kb 스키마 USAGE 는 주지 않는다.
-- ------------------------------------------------------------
create or replace function public.guide_channels_json(p_action_guide_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.action_guides g where g.id = p_action_guide_id and g.owner_id = (select auth.uid()))
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
                     'action_no', ch.action_no, 'display_order', ch.display_order,
                     'institution_code', reg.institution_code, 'channel_type', reg.channel_type,
                     'display_value', reg.display_value, 'valid_from', reg.valid_from, 'valid_to', reg.valid_to)
                     order by ch.display_order)
                     from public.action_guide_channels ch
                     join kb.official_channel_registry reg on reg.id = ch.official_channel_registry_id
                    where ch.action_guide_id = p_action_guide_id), '[]'::jsonb)
  end
$$;
revoke all on function public.guide_channels_json(uuid) from public, anon;
grant execute on function public.guide_channels_json(uuid) to authenticated, finshield_worker;

-- Run·Agent·Tool·Evidence 표는 회원 SELECT 를 주지 않는다(명세 9.2). 본인 Case 에 한해
-- Sanitized 요약만 돌려주는 정의자 Helper 로 View 를 채운다. Digest·Lease·Raw error 는 빼놓는다.
create or replace function public.case_runs_json(p_case_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.financial_cases c
                      where c.id = p_case_id and c.owner_id = (select auth.uid()) and c.deleted_at is null)
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
                     'run_id', r.id, 'run_no', r.run_no, 'kind', r.kind, 'status', r.status,
                     'overall_result', r.overall_result, 'coverage_satisfied', r.coverage_satisfied,
                     'partial_reason_codes', r.partial_reason_codes, 'reason_code', r.reason_code,
                     'deadline_at', r.deadline_at, 'started_at', r.started_at, 'finished_at', r.finished_at) order by r.run_no)
                     from public.verification_runs r where r.case_id = p_case_id), '[]'::jsonb)
  end
$$;
revoke all on function public.case_runs_json(uuid) from public, anon;
grant execute on function public.case_runs_json(uuid) to authenticated, finshield_worker;

create or replace function public.passport_claims_json(p_passport_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.evidence_passports p join public.financial_cases c on c.id = p.case_id
                      where p.id = p_passport_id and p.owner_id = (select auth.uid()) and c.deleted_at is null)
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
                     'claim_id', f.claim_id, 'status', f.status, 'reason_code', f.reason_code, 'is_material', f.is_material,
                     'cove_status', f.cove_status, 'red_team_status', f.red_team_status,
                     'decision_summary_masked', f.decision_summary_masked, 'statement_masked', rv.statement_masked,
                     'evidences', (select coalesce(jsonb_agg(jsonb_build_object(
                                             'evidence_id', e.id, 'relation', ce.relation, 'is_independent', ce.is_independent,
                                             'directness', e.directness, 'citable', e.citable, 'reference_only', e.reference_only,
                                             'incomplete', e.incomplete, 'freshness_at_use', e.freshness_at_use,
                                             'target_match', e.target_match, 'source_locator', e.source_locator,
                                             'excerpt_masked', e.excerpt_masked, 'kb_snapshot_id', e.kb_snapshot_id) order by e.created_at), '[]'::jsonb)
                                     from public.claim_evidences ce join public.evidences e on e.id = ce.evidence_id
                                    where ce.final_claim_version_id = f.id)) order by f.is_material desc, f.claim_id)
                     from public.evidence_passports p
                     join public.final_claim_versions f on f.verification_run_id = p.verification_run_id
                     join public.claim_revisions rv on rv.id = f.claim_revision_id
                    where p.id = p_passport_id), '[]'::jsonb)
  end
$$;
revoke all on function public.passport_claims_json(uuid) from public, anon;
grant execute on function public.passport_claims_json(uuid) to authenticated, finshield_worker;

create or replace view public.case_list_v with (security_invoker = true) as
  select c.id, c.owner_id, c.scenario, c.title_masked, c.lifecycle, c.journey_stage, c.aftercare_status,
         c.deletion_status, c.updated_at, c.created_at,
         p.id as latest_passport_id, p.overall_result, p.created_at as latest_passport_at,
         (select count(*) from public.notifications n where n.case_id = c.id and n.read_at is null) as unread_notifications
    from public.financial_cases c
    left join public.evidence_passports p on p.id = c.latest_passport_id
   where c.deleted_at is null;

create or replace view public.case_detail_v with (security_invoker = true) as
  select c.id, c.owner_id, c.scenario, c.title_masked, c.lifecycle, c.resume_state, c.journey_stage,
         c.enrollment_confirmed_at, c.aftercare_status, c.deletion_status, c.created_at, c.updated_at,
         c.initial_profile_version_id, c.latest_successful_run_id, c.latest_passport_id,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', i.id, 'input_type', i.input_type, 'input_stage', i.input_stage, 'input_outcome', i.input_outcome,
                   'raw_delete_status', i.raw_delete_status, 'page_count', i.page_count, 'size_bytes', i.size_bytes,
                   'pii_scan_status', i.pii_scan_status, 'claim_confirmed_at', i.claim_confirmed_at,
                   'raw_deleted_at', i.raw_deleted_at, 'created_at', i.created_at) order by i.created_at), '[]'::jsonb)
            from public.case_inputs i where i.case_id = c.id) as inputs,
         public.case_runs_json(c.id) as runs,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'passport_id', p.id, 'version_no', p.passport_version_no, 'overall_result', p.overall_result,
                   'created_at', p.created_at, 'is_latest', p.id = c.latest_passport_id) order by p.passport_version_no), '[]'::jsonb)
            from public.evidence_passports p where p.case_id = c.id) as passports,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'event_no', e.event_no, 'event_type', e.event_type, 'actor_type', e.actor_type,
                   'from_state', e.from_state, 'to_state', e.to_state, 'created_at', e.created_at) order by e.event_no), '[]'::jsonb)
            from public.case_events e where e.case_id = c.id) as timeline
    from public.financial_cases c
   where c.deleted_at is null;

-- Run·Agent·Tool 표는 회원 SELECT 가 없으므로 이 View 만 정의자로 두고 소유자 조건을 직접 건다.
create or replace view public.run_progress_v with (security_invoker = false) as
  select r.id as run_id, r.owner_id, r.case_id, r.run_no, r.kind, r.status, r.deadline_at, r.started_at, r.finished_at,
         r.partial_reason_codes, r.reason_code,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'logical_agent_key', a.logical_agent_key, 'agent_code', a.agent_code, 'agent_version', a.agent_version,
                   'attempt_no', a.attempt_no, 'status', a.status, 'reason_code', a.reason_code,
                   'started_at', a.started_at, 'finished_at', a.finished_at,
                   'tools', (select coalesce(jsonb_agg(jsonb_build_object(
                                       'logical_tool_key', t.logical_tool_key, 'tool_code', t.tool_code, 'transport', t.transport,
                                       'status', t.status, 'candidate_count', t.candidate_count, 'selected_count', t.selected_count,
                                       'provenance_complete', t.provenance_complete, 'reason_code', t.reason_code) order by t.created_at), '[]'::jsonb)
                               from public.tool_runs t where t.agent_run_id = a.id)) order by a.created_at), '[]'::jsonb)
            from public.agent_runs a where a.verification_run_id = r.id) as agents
    from public.verification_runs r
    join public.financial_cases c on c.id = r.case_id
   where c.deleted_at is null
     and r.owner_id = (select auth.uid());

create or replace view public.passport_v with (security_invoker = true) as
  select p.id as passport_id, p.owner_id, p.case_id, p.verification_run_id, p.passport_version_no, p.previous_passport_id,
         p.overall_result, p.coverage_satisfied, p.passport_schema_version, p.manifest, p.payload_hash, p.created_at,
         p.id = c.latest_passport_id as is_latest,
         p.profile_version_id, p.execution_manifest_id,
         (select coalesce(jsonb_agg(jsonb_build_object('axis', a.axis, 'result_code', a.result_code, 'summary_masked', a.summary_masked,
                                                       'limitation_codes', a.limitation_codes) order by a.axis), '[]'::jsonb)
            from public.verification_axis_results a where a.verification_run_id = p.verification_run_id) as axis_results,
         (select jsonb_build_object('status', g.status, 'actions', g.actions, 'limitation_codes', g.limitation_codes,
                                    'channels', public.guide_channels_json(g.id))
            from public.action_guides g where g.id = p.action_guide_id) as guide,
         public.passport_claims_json(p.id) as claims
    from public.evidence_passports p
    join public.financial_cases c on c.id = p.case_id
   where c.deleted_at is null;

grant select on public.case_list_v, public.case_detail_v, public.run_progress_v, public.passport_v to authenticated;
revoke all on public.case_list_v, public.case_detail_v, public.run_progress_v, public.passport_v from anon;

-- ------------------------------------------------------------
-- 6. 신뢰센터 View (명세 9.3, OPS-001~003). 공개된 FinShield 평가와 최신 Tool 상태만.
--    기반 표는 회원·익명이 읽지 못하므로 정의자 View 로 두되 공개 행만 담는다.
-- ------------------------------------------------------------
create or replace view public.trust_center_metrics_v with (security_invoker = false) as
  select s.name as evaluation_set, s.version as evaluation_set_version, s.sample_count, s.fixture_manifest_hash,
         r.id as evaluation_run_id, r.method_variant, r.finished_at as evaluated_at, r.published_at,
         m.manifest_version, m.model_bundle ->> 'model' as model,
         mt.metric_code, mt.numerator, mt.denominator, mt.value_numeric, mt.unit, mt.formula_version, mt.measured_at
    from kb.evaluation_runs r
    join kb.evaluation_sets s on s.id = r.evaluation_set_id and s.product_scope = 'FINSHIELD'
    join private.execution_manifests m on m.id = r.execution_manifest_id
    join kb.evaluation_metrics mt on mt.evaluation_run_id = r.id
   where r.status = 'COMPLETED' and r.published_at is not null;

create or replace view public.tool_health_v with (security_invoker = false) as
  select distinct on (h.tool_code) h.tool_code, h.status, h.checked_at, h.fresh_until,
         h.fresh_until > now() as is_fresh, h.latency_ms, h.error_code
    from kb.tool_health_snapshots h
   order by h.tool_code, h.checked_at desc;

grant select on public.trust_center_metrics_v, public.tool_health_v to anon, authenticated;

-- ------------------------------------------------------------
-- 7. RLS 와 Grant (명세 9.2)
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['seed_versions', 'seed_sources', 'sessions', 'runs', 'agent_runs', 'tool_runs',
                           'tool_run_sources', 'result_snapshots'] loop
    execute format('alter table demo.%I enable row level security', t);
    execute format('alter table demo.%I force row level security', t);
    execute format('drop policy if exists demo_%s__worker_read on demo.%I', t, t);
    execute format('create policy demo_%s__worker_read on demo.%I for select to finshield_worker using (true)', t, t);
    execute format('grant select on demo.%I to finshield_worker', t);
    execute format('revoke all on demo.%I from anon, authenticated', t);
  end loop;
  -- 실행 Trace 는 Worker 가 직접 쓴다. Seed 와 결과 Snapshot 은 승인 Script·함수만 쓴다.
  foreach t in array array['runs', 'agent_runs', 'tool_runs', 'tool_run_sources', 'result_snapshots'] loop
    execute format('drop policy if exists demo_%s__worker_insert on demo.%I', t, t);
    execute format('create policy demo_%s__worker_insert on demo.%I for insert to finshield_worker with check (true)', t, t);
    execute format('grant insert on demo.%I to finshield_worker', t);
  end loop;
  foreach t in array array['runs', 'agent_runs', 'tool_runs'] loop
    execute format('drop policy if exists demo_%s__worker_update on demo.%I', t, t);
    execute format('create policy demo_%s__worker_update on demo.%I for update to finshield_worker using (true) with check (true)', t, t);
    execute format('grant update on demo.%I to finshield_worker', t);
  end loop;
  foreach t in array array['evaluation_sets', 'evaluation_runs', 'evaluation_metrics', 'tool_health_snapshots'] loop
    execute format('alter table kb.%I enable row level security', t);
    execute format('alter table kb.%I force row level security', t);
    execute format('drop policy if exists kb_%s__worker_read on kb.%I', t, t);
    execute format('create policy kb_%s__worker_read on kb.%I for select to finshield_worker using (true)', t, t);
    execute format('grant select on kb.%I to finshield_worker', t);
    execute format('revoke all on kb.%I from anon, authenticated', t);
  end loop;
  foreach t in array array['evaluation_runs', 'evaluation_metrics'] loop
    execute format('drop policy if exists kb_%s__worker_insert on kb.%I', t, t);
    execute format('create policy kb_%s__worker_insert on kb.%I for insert to finshield_worker with check (true)', t, t);
    execute format('grant insert on kb.%I to finshield_worker', t);
  end loop;
  execute 'drop policy if exists kb_evaluation_runs__worker_update on kb.evaluation_runs';
  execute 'create policy kb_evaluation_runs__worker_update on kb.evaluation_runs for update to finshield_worker using (true) with check (true)';
  execute 'grant update on kb.evaluation_runs to finshield_worker';
end
$$;
