-- ============================================================
-- 0009 실행 Manifest·검증 Run·Run 입력 고정 (명세 6.8, 6.4, 6.3, 15절 7번 묶음)
--
-- 대상: private.execution_manifests, private.execution_manifest_agents,
--       private.execution_manifest_tools, private.execution_manifest_events,
--       public.verification_runs, public.verification_run_claims
--
-- 0004 가 FK 없이 남긴 financial_cases.latest_successful_run_id 에 교차
-- 소유 복합 FK 를 붙인다. latest_passport_id 는 9번 묶음에서 붙인다.
-- verification_runs.revalidation_job_id 는 10번 묶음의 revalidation_jobs
-- 가 생길 때 FK 를 붙인다. 후속 Migration 이 반드시 붙인다.
--
-- 상태 전이 함수(create_verification_run, finalize_verification_run)는
-- 예산·Outbox 표가 있는 뒤에 만든다. 여기서는 표·제약·Append-only 만
-- 두고, 직접 UPDATE 권한을 누구에게도 주지 않는다 (명세 7.1).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum (명세 4.1)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'verification_run_kind') then
    create type public.verification_run_kind as enum ('INITIAL', 'REVALIDATION');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_run_status') then
    create type public.verification_run_status as enum (
      'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');
  end if;
  if not exists (select 1 from pg_type where typname = 'overall_result') then
    create type public.overall_result as enum (
      'MATERIAL_RISK_FOUND', 'HIGH_CAUTION', 'INSUFFICIENT_INFORMATION',
      'VERIFY_BEFORE_PROCEEDING', 'NO_SPECIAL_RISK_IN_VERIFIED_SCOPE');
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. kb.kb_releases 에 Manifest 가 참조할 키 추가
--    Manifest 는 Release 의 Embedding 모델·차원을 다시 적는다. 두 값이
--    Release 선언과 어긋나지 않도록 복합 FK 로 묶는다.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_kb_releases__id_model_dimension') then
    alter table kb.kb_releases
      add constraint uq_kb_releases__id_model_dimension
      unique (id, embedding_model, embedding_dimension);
  end if;
end
$$;

-- ------------------------------------------------------------
-- 3. private.execution_manifests (명세 6.8)
--    정책 버전 다섯 개는 policy_versions 의 (policy_type, version) 을
--    복합 FK 로 참조한다. 등록되지 않은 정책 버전을 Manifest 가 적을 수
--    없게 한다. policy_type 은 컬럼이 아니라 FK 의 상수 쪽에서 고정한다.
-- ------------------------------------------------------------
create table if not exists private.execution_manifests (
  id                        uuid primary key default gen_random_uuid(),
  manifest_version          text not null,
  scenario                  public.case_scenario not null,
  scenario_version          text not null,
  model_bundle              jsonb not null,
  prompt_bundle_version     text not null,
  schema_bundle_version     text not null,
  evidence_policy_version   text not null,
  result_matrix_version     text not null,
  coverage_contract_version text not null,
  profile_policy_version    text not null,
  pii_policy_version        text not null,
  kb_release_id             uuid not null,
  embedding_model           text,
  embedding_dimension       integer,
  config_hash               text not null,
  created_at                timestamptz not null default now(),
  -- 정책 유형 상수. FK 의 왼쪽에 상수를 둘 수 없어 생성 컬럼으로 고정한다.
  evidence_policy_type   text generated always as ('EVIDENCE') stored,
  result_matrix_type     text generated always as ('RESULT_MATRIX') stored,
  coverage_policy_type   text generated always as ('COVERAGE') stored,
  profile_policy_type    text generated always as ('PROFILE') stored,
  pii_policy_type        text generated always as ('PII') stored,

  constraint uq_execution_manifests__version unique (manifest_version),

  constraint fk_execution_manifests__kb_release
    foreign key (kb_release_id) references kb.kb_releases (id),
  constraint fk_execution_manifests__embedding
    foreign key (kb_release_id, embedding_model, embedding_dimension)
    references kb.kb_releases (id, embedding_model, embedding_dimension),
  constraint fk_execution_manifests__evidence_policy
    foreign key (evidence_policy_type, evidence_policy_version)
    references private.policy_versions (policy_type, version),
  constraint fk_execution_manifests__result_matrix
    foreign key (result_matrix_type, result_matrix_version)
    references private.policy_versions (policy_type, version),
  constraint fk_execution_manifests__coverage_policy
    foreign key (coverage_policy_type, coverage_contract_version)
    references private.policy_versions (policy_type, version),
  constraint fk_execution_manifests__profile_policy
    foreign key (profile_policy_type, profile_policy_version)
    references private.policy_versions (policy_type, version),
  constraint fk_execution_manifests__pii_policy
    foreign key (pii_policy_type, pii_policy_version)
    references private.policy_versions (policy_type, version),

  constraint ck_execution_manifests__text_len
    check (octet_length(manifest_version) between 1 and 64
           and octet_length(scenario_version) between 1 and 32
           and octet_length(prompt_bundle_version) between 1 and 64
           and octet_length(schema_bundle_version) between 1 and 64),
  constraint ck_execution_manifests__model_bundle_object
    check (jsonb_typeof(model_bundle) = 'object'),
  constraint ck_execution_manifests__model_bundle_schema
    check (model_bundle ? 'schema_version'),
  -- Embedding 설정은 함께 있거나 함께 없다.
  constraint ck_execution_manifests__embedding_pairing
    check ((embedding_model is null) = (embedding_dimension is null)),
  constraint ck_execution_manifests__config_hash
    check (config_hash ~ '^[0-9a-f]{64}$')
);

comment on table private.execution_manifests is
  '한 Run 이 고정하는 실행 명세. UPDATE 하지 않고 새 버전을 추가한다 (명세 6.8)';
comment on column private.execution_manifests.model_bundle is
  'Provider·모델·정확한 버전·Timeout. Secret 을 넣지 않는다';

-- ------------------------------------------------------------
-- 4. Manifest 구성 Join 과 활성화 Event (명세 6.8)
-- ------------------------------------------------------------
create table if not exists private.execution_manifest_agents (
  execution_manifest_id uuid not null,
  agent_definition_id   uuid not null,
  logical_agent_key     text not null,
  required              boolean not null,
  parallel_group        text,
  created_at            timestamptz not null default now(),

  constraint pk_execution_manifest_agents primary key (execution_manifest_id, logical_agent_key),
  constraint fk_execution_manifest_agents__manifest
    foreign key (execution_manifest_id) references private.execution_manifests (id),
  constraint fk_execution_manifest_agents__agent
    foreign key (agent_definition_id) references private.agent_definitions (id),
  constraint uq_execution_manifest_agents__manifest_agent
    unique (execution_manifest_id, agent_definition_id),
  constraint ck_execution_manifest_agents__logical_key
    check (logical_agent_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_execution_manifest_agents__parallel_group_len
    check (parallel_group is null or octet_length(parallel_group) <= 32)
);

create table if not exists private.execution_manifest_tools (
  execution_manifest_id uuid not null,
  tool_definition_id    uuid not null,
  purpose_code          text not null,
  required              boolean not null,
  created_at            timestamptz not null default now(),

  constraint pk_execution_manifest_tools
    primary key (execution_manifest_id, tool_definition_id, purpose_code),
  constraint fk_execution_manifest_tools__manifest
    foreign key (execution_manifest_id) references private.execution_manifests (id),
  constraint fk_execution_manifest_tools__tool
    foreign key (tool_definition_id) references private.tool_definitions (id),
  constraint ck_execution_manifest_tools__purpose_code
    check (purpose_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

create table if not exists private.execution_manifest_events (
  id                    uuid primary key default gen_random_uuid(),
  execution_manifest_id uuid not null,
  event_type            text not null,
  reason_code           text,
  created_at            timestamptz not null default now(),

  constraint fk_execution_manifest_events__manifest
    foreign key (execution_manifest_id) references private.execution_manifests (id),
  constraint ck_execution_manifest_events__event_type
    check (event_type in ('ACTIVATED', 'RETIRED')),
  constraint ck_execution_manifest_events__reason_code_len
    check (reason_code is null or octet_length(reason_code) <= 64)
);

create index if not exists idx_execution_manifest_events__manifest_created
  on private.execution_manifest_events (execution_manifest_id, created_at desc);

comment on table private.execution_manifest_events is
  'ACTIVATED·RETIRED 를 Append-only 로 기록한다. 활성 Run 은 최신 유효 Event 가 ACTIVATED 인 Manifest 만 선택한다 (명세 6.8)';

-- ------------------------------------------------------------
-- 5. public.verification_runs (명세 6.4)
-- ------------------------------------------------------------
create table if not exists public.verification_runs (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null,
  case_id               uuid not null,
  run_no                integer not null,
  kind                  public.verification_run_kind not null,
  status                public.verification_run_status not null default 'QUEUED',
  profile_version_id    uuid not null,
  execution_manifest_id uuid not null,
  parent_run_id         uuid,
  revalidation_job_id   uuid,
  idempotency_key       text not null,
  request_hash          text not null,
  overall_result        public.overall_result,
  coverage_satisfied    boolean,
  partial_reason_codes  text[] not null default '{}',
  correlation_id        uuid not null,
  started_at            timestamptz,
  finished_at           timestamptz,
  deadline_at           timestamptz not null,
  input_tokens          bigint not null default 0,
  output_tokens         bigint not null default 0,
  cost_microunits       bigint not null default 0,
  error_code            text,
  reason_code           text,
  created_at            timestamptz not null default now(),

  constraint fk_verification_runs__financial_cases
    foreign key (case_id, owner_id)
    references public.financial_cases (id, owner_id) on delete cascade,
  constraint fk_verification_runs__profile_version
    foreign key (profile_version_id, owner_id)
    references public.financial_profile_versions (id, owner_id) on delete restrict,
  constraint fk_verification_runs__manifest
    foreign key (execution_manifest_id) references private.execution_manifests (id),
  -- 직전 Run 은 같은 Owner·Case 안에서만 가리킨다.
  constraint fk_verification_runs__parent
    foreign key (parent_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,

  constraint uq_verification_runs__case_run_no unique (case_id, run_no),
  constraint uq_verification_runs__idempotency unique (owner_id, case_id, idempotency_key),
  constraint uq_verification_runs__id_owner_id unique (id, owner_id),
  constraint uq_verification_runs__id_owner_case unique (id, owner_id, case_id),

  constraint ck_verification_runs__run_no check (run_no > 0),
  constraint ck_verification_runs__idempotency_key_len
    check (octet_length(idempotency_key) between 1 and 128),
  constraint ck_verification_runs__request_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_verification_runs__tokens_cost
    check (input_tokens >= 0 and output_tokens >= 0 and cost_microunits >= 0),
  constraint ck_verification_runs__codes_len
    check ((error_code is null or octet_length(error_code) <= 64)
           and (reason_code is null or octet_length(reason_code) <= 64)
           and array_position(partial_reason_codes, null) is null),
  -- Deadline 은 ADR 9.2 운영값 안에 있어야 한다. Text 120초, Image·PDF 180초.
  constraint ck_verification_runs__deadline
    check (deadline_at > created_at and deadline_at <= created_at + interval '180 seconds'),
  -- 재검증은 직전 Run 을 가리킨다.
  constraint ck_verification_runs__revalidation_parent
    check (kind <> 'REVALIDATION' or parent_run_id is not null),
  constraint ck_verification_runs__no_self_parent
    check (parent_run_id is null or parent_run_id <> id),
  -- 종합 결과와 Coverage 판정은 종결 상태에서만 존재한다 (명세 6.4).
  constraint ck_verification_runs__result_only_when_terminal
    check (status in ('COMPLETED', 'PARTIAL')
           or (overall_result is null and coverage_satisfied is null)),
  constraint ck_verification_runs__completed_requires_result
    check (status not in ('COMPLETED', 'PARTIAL')
           or (overall_result is not null and coverage_satisfied is not null)),
  -- 시각 순서. 종결 상태는 finished_at 을 갖는다.
  constraint ck_verification_runs__started_before_finished
    check (started_at is null or finished_at is null or finished_at >= started_at),
  constraint ck_verification_runs__terminal_finished
    check (status in ('QUEUED', 'RUNNING') = (finished_at is null)),
  constraint ck_verification_runs__running_started
    check (status = 'QUEUED' or started_at is not null),
  -- 실패·취소는 Sanitized 이유를 남긴다.
  constraint ck_verification_runs__failure_reason
    check (status not in ('FAILED', 'CANCELLED') or reason_code is not null)
);

comment on table public.verification_runs is
  '한 시점 검증 실행. 시작 시 Profile Snapshot·Manifest·Claim revision 을 고정한다 (명세 6.4)';
comment on column public.verification_runs.revalidation_job_id is
  '재검증이면 Job 참조. FK 는 revalidation_jobs 를 만드는 Migration 에서 추가';

-- Case 당 활성 초기 Run 하나 (명세 7.1)
create unique index if not exists uq_verification_runs__active_initial
  on public.verification_runs (case_id)
  where kind = 'INITIAL' and status in ('QUEUED', 'RUNNING');

create index if not exists idx_verification_runs__case_created
  on public.verification_runs (case_id, created_at desc);
create index if not exists idx_verification_runs__correlation
  on public.verification_runs (correlation_id);

-- ------------------------------------------------------------
-- 6. financial_cases.latest_successful_run_id 교차 소유 FK (0004 보완)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_financial_cases__latest_run') then
    alter table public.financial_cases
      add constraint fk_financial_cases__latest_run
      foreign key (latest_successful_run_id, owner_id, id)
      references public.verification_runs (id, owner_id, case_id);
  end if;
end
$$;

-- ------------------------------------------------------------
-- 7. public.verification_run_claims (명세 6.3)
--    Run 시작 시 고정한 Claim 내용. 시작 뒤 수정하지 않는다.
-- ------------------------------------------------------------
create table if not exists public.verification_run_claims (
  owner_id                  uuid not null,
  case_id                   uuid not null,
  verification_run_id       uuid not null,
  claim_id                  uuid not null,
  claim_revision_id         uuid not null,
  selected_for_verification boolean not null,
  materiality               text not null,
  confirmation_state        text not null,
  coverage_item_code        text,
  exclusion_reason_code     text,
  created_at                timestamptz not null default now(),

  constraint pk_verification_run_claims primary key (verification_run_id, claim_id),
  constraint fk_verification_run_claims__run
    foreign key (verification_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,
  -- Claim identity 와 revision 을 서로 바꿔 끼울 수 없다 (명세 5.1).
  constraint fk_verification_run_claims__revision
    foreign key (claim_revision_id, claim_id, case_id, owner_id)
    references public.claim_revisions (id, claim_id, case_id, owner_id) on delete cascade,

  constraint ck_verification_run_claims__materiality
    check (materiality in ('MATERIAL', 'NON_MATERIAL', 'UNDETERMINED')),
  constraint ck_verification_run_claims__confirmation_state
    check (confirmation_state in ('CONFIRMED', 'EXCLUDED', 'MISSING')),
  constraint ck_verification_run_claims__codes_len
    check ((coverage_item_code is null or octet_length(coverage_item_code) <= 64)
           and (exclusion_reason_code is null or octet_length(exclusion_reason_code) <= 64)),
  -- 제외·누락은 이유가 있어야 한다.
  constraint ck_verification_run_claims__exclusion_reason
    check (confirmation_state = 'CONFIRMED' or exclusion_reason_code is not null),
  -- 검증 대상은 확인된 Claim 만이다.
  constraint ck_verification_run_claims__selected_confirmed
    check (not selected_for_verification or confirmation_state = 'CONFIRMED')
);

comment on table public.verification_run_claims is
  'Run 입력 고정. 선택한 Material Claim 은 사용자 확정 revision 이어야 CONFIRMED 다 (명세 6.3)';

-- 선택한 Material Claim 은 claim_revision.user_confirmed = true 여야 CONFIRMED 가 된다.
-- 다른 행을 봐야 하므로 Trigger 로 강제한다 (명세 6.3, 7.1).
create or replace function private.check_run_claim_confirmation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed boolean;
begin
  if new.confirmation_state = 'CONFIRMED' and new.materiality = 'MATERIAL' then
    select r.user_confirmed into confirmed
      from public.claim_revisions r
     where r.id = new.claim_revision_id;
    if confirmed is distinct from true then
      raise exception '사용자가 확정하지 않은 Material Claim 을 CONFIRMED 로 고정할 수 없다'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.check_run_claim_confirmation() from public, anon, authenticated;

drop trigger if exists trg_verification_run_claims__confirmation on public.verification_run_claims;
create trigger trg_verification_run_claims__confirmation
  before insert on public.verification_run_claims
  for each row execute function private.check_run_claim_confirmation();

-- ------------------------------------------------------------
-- 8. 불변성 Trigger
--    Manifest 와 Join·Event, Run 입력 고정은 Append-only 다.
--    verification_runs 는 상태 전이 함수가 UPDATE 하므로 UPDATE 를
--    막지 않고, 대신 직접 UPDATE Grant 를 누구에게도 주지 않는다.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['execution_manifests', 'execution_manifest_agents',
                           'execution_manifest_tools', 'execution_manifest_events'] loop
    execute format('drop trigger if exists trg_%s__reject_update on private.%I', t, t);
    execute format('create trigger trg_%s__reject_update before update on private.%I '
                   'for each row execute function private.reject_update()', t, t);
    execute format('drop trigger if exists trg_%s__reject_delete on private.%I', t, t);
    execute format('create trigger trg_%s__reject_delete before delete on private.%I '
                   'for each row execute function private.reject_delete()', t, t);
  end loop;
end
$$;

drop trigger if exists trg_verification_run_claims__reject_update on public.verification_run_claims;
create trigger trg_verification_run_claims__reject_update
  before update on public.verification_run_claims
  for each row execute function private.reject_update();
drop trigger if exists trg_verification_run_claims__reject_direct_delete on public.verification_run_claims;
create trigger trg_verification_run_claims__reject_direct_delete
  before delete on public.verification_run_claims
  for each row execute function
    private.reject_direct_delete('public', 'verification_runs', 'verification_run_id');

-- Run 행 자체도 Case Cascade 외에는 지우지 않는다.
drop trigger if exists trg_verification_runs__reject_direct_delete on public.verification_runs;
create trigger trg_verification_runs__reject_direct_delete
  before delete on public.verification_runs
  for each row execute function
    private.reject_direct_delete('public', 'financial_cases', 'case_id');

-- ------------------------------------------------------------
-- 9. RLS 와 Grant (명세 9.1, 9.2)
--    회원은 Run 을 Sanitized View 로만 본다. 정책은 지금 두고 Grant 는
--    View 가 생길 때 View 에 준다. Worker 는 Run·Run Claim 을 INSERT 하고
--    읽는다. 상태 변경은 함수 경로다.
-- ------------------------------------------------------------
alter table public.verification_runs        enable row level security;
alter table public.verification_runs        force  row level security;
alter table public.verification_run_claims  enable row level security;
alter table public.verification_run_claims  force  row level security;

drop policy if exists verification_runs__select_own on public.verification_runs;
create policy verification_runs__select_own on public.verification_runs
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));
drop policy if exists verification_run_claims__select_own on public.verification_run_claims;
create policy verification_run_claims__select_own on public.verification_run_claims
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));

drop policy if exists verification_runs__worker_read on public.verification_runs;
create policy verification_runs__worker_read on public.verification_runs
  for select to finshield_worker using (true);
drop policy if exists verification_runs__worker_insert on public.verification_runs;
create policy verification_runs__worker_insert on public.verification_runs
  for insert to finshield_worker with check (true);
drop policy if exists verification_run_claims__worker_read on public.verification_run_claims;
create policy verification_run_claims__worker_read on public.verification_run_claims
  for select to finshield_worker using (true);
drop policy if exists verification_run_claims__worker_insert on public.verification_run_claims;
create policy verification_run_claims__worker_insert on public.verification_run_claims
  for insert to finshield_worker with check (true);

grant select, insert on public.verification_runs       to finshield_worker;
grant select, insert on public.verification_run_claims to finshield_worker;
revoke all on public.verification_runs       from anon, authenticated;
revoke all on public.verification_run_claims from anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['execution_manifests', 'execution_manifest_agents',
                           'execution_manifest_tools', 'execution_manifest_events'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('alter table private.%I force row level security', t);
    execute format('drop policy if exists %s__worker_read on private.%I', t, t);
    execute format('create policy %s__worker_read on private.%I for select to finshield_worker using (true)', t, t);
    execute format('grant select on private.%I to finshield_worker', t);
    execute format('revoke all on private.%I from anon, authenticated', t);
  end loop;
end
$$;
