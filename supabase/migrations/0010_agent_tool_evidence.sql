-- ============================================================
-- 0010 Agent·Tool 실행 Trace·Retrieval 단계·Evidence·관계 (명세 6.4, 6.5, 15절 8번 묶음)
--
-- 대상: public.agent_runs, public.agent_run_claims, public.tool_runs,
--       public.tool_run_claims, public.retrieval_steps,
--       public.case_source_snapshots, public.evidences,
--       public.final_claim_versions, public.claim_evidences
--
-- final_claim_versions 는 9번 묶음의 결과 표지만 claim_evidences 가
-- 참조하므로 여기서 만든다. 축 결과·Guide·Passport 는 9번에서 만든다.
--
-- 이 묶음의 핵심은 규칙 1·2 를 DB 가 직접 강제하는 것이다.
--   - Agent 는 Run 의 Manifest 에 고정된 정의만 실행할 수 있다
--   - Tool 은 Manifest 에 고정되고 그 Agent 의 Allowlist 에 있어야 한다
--   - Provenance 가 완전한 Tool 결과만 Evidence 가 된다
--   - VERIFIED·CONTRADICTED 는 직접·인용 가능·최신·대상 일치 Evidence
--     관계 없이는 Commit 될 수 없다 (Deferred Constraint Trigger)
--
-- Agent·Tool 의 상태 전이는 함수 경로다. 직접 UPDATE 권한은 누구에게도
-- 주지 않고, Terminal 행은 Trigger 가 수정을 막는다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum (명세 4.1)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'execution_status') then
    create type public.execution_status as enum (
      'QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'BLOCKED', 'CANCELLED');
  end if;
  if not exists (select 1 from pg_type where typname = 'claim_status') then
    create type public.claim_status as enum (
      'VERIFIED', 'CONTRADICTED', 'CONFLICT', 'UNKNOWN', 'NEED_MORE_INFORMATION', 'WITHHELD');
  end if;
  if not exists (select 1 from pg_type where typname = 'claim_evidence_relation') then
    create type public.claim_evidence_relation as enum ('SUPPORT', 'CONTRADICT', 'CONTEXT');
  end if;
  if not exists (select 1 from pg_type where typname = 'evidence_directness') then
    create type public.evidence_directness as enum ('DIRECT', 'INDIRECT', 'CONTEXT_ONLY');
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. 공용 Trigger 함수: Terminal 행 수정 금지
--    QUEUED·RUNNING 인 동안만 상태를 바꿀 수 있다. 종결된 행은 불변이다.
-- ------------------------------------------------------------
create or replace function private.reject_terminal_update() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status not in ('QUEUED', 'RUNNING') then
    raise exception '%.% 의 종결된 행은 수정할 수 없다', tg_table_schema, tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_terminal_update() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. public.agent_runs (명세 6.4)
-- ------------------------------------------------------------
create table if not exists public.agent_runs (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null,
  case_id               uuid not null,
  verification_run_id   uuid not null,
  logical_agent_key     text not null,
  agent_code            text not null,
  agent_version         text not null,
  attempt_no            integer not null,
  status                public.execution_status not null default 'QUEUED',
  input_schema_version  text not null,
  output_schema_version text not null,
  prompt_version        text not null,
  model_provider        text,
  model_id              text,
  model_version         text,
  input_digest          text,
  output_digest         text,
  sanitized_summary     jsonb,
  input_tokens          bigint not null default 0,
  output_tokens         bigint not null default 0,
  cost_microunits       bigint not null default 0,
  started_at            timestamptz,
  finished_at           timestamptz,
  latency_ms            integer,
  error_code            text,
  reason_code           text,
  created_at            timestamptz not null default now(),

  constraint fk_agent_runs__run
    foreign key (verification_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,
  -- Registry 에 없는 Agent 버전은 실행 기록이 될 수 없다.
  constraint fk_agent_runs__definition
    foreign key (agent_code, agent_version)
    references private.agent_definitions (agent_code, version),

  constraint uq_agent_runs__run_key_attempt unique (verification_run_id, logical_agent_key, attempt_no),
  constraint uq_agent_runs__scope unique (id, owner_id, case_id, verification_run_id),
  constraint uq_agent_runs__id_owner_case unique (id, owner_id, case_id),

  constraint ck_agent_runs__logical_key check (logical_agent_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_agent_runs__attempt_no check (attempt_no > 0),
  constraint ck_agent_runs__text_len
    check (octet_length(input_schema_version) between 1 and 32
           and octet_length(output_schema_version) between 1 and 32
           and octet_length(prompt_version) between 1 and 64
           and (model_provider is null or octet_length(model_provider) <= 64)
           and (model_id is null or octet_length(model_id) <= 128)
           and (model_version is null or octet_length(model_version) <= 64)
           and (error_code is null or octet_length(error_code) <= 64)
           and (reason_code is null or octet_length(reason_code) <= 64)),
  constraint ck_agent_runs__digests
    check ((input_digest is null or input_digest ~ '^[0-9a-f]{64}$')
           and (output_digest is null or output_digest ~ '^[0-9a-f]{64}$')),
  constraint ck_agent_runs__summary_object
    check (sanitized_summary is null or jsonb_typeof(sanitized_summary) = 'object'),
  constraint ck_agent_runs__counters
    check (input_tokens >= 0 and output_tokens >= 0 and cost_microunits >= 0
           and (latency_ms is null or latency_ms >= 0)),
  -- 모델 식별은 함께 있거나 함께 없다.
  constraint ck_agent_runs__model_pairing
    check ((model_provider is null) = (model_id is null)),
  constraint ck_agent_runs__terminal_finished
    check (status in ('QUEUED', 'RUNNING') = (finished_at is null)),
  constraint ck_agent_runs__running_started
    check (status = 'QUEUED' or started_at is not null),
  constraint ck_agent_runs__failure_reason
    check (status not in ('FAILED', 'BLOCKED', 'CANCELLED') or reason_code is not null)
);

comment on table public.agent_runs is
  '실제 Agent attempt. Raw Prompt·CoT 를 넣지 않고 버전과 Digest 만 남긴다 (명세 6.4)';

create index if not exists idx_agent_runs__run_created
  on public.agent_runs (verification_run_id, created_at);

-- Agent 는 Run 의 Manifest 에 고정된 정의여야 한다 (규칙 2, 명세 6.8).
create or replace function private.check_agent_in_manifest() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  manifest uuid;
  allowed boolean;
begin
  select r.execution_manifest_id into manifest
    from public.verification_runs r where r.id = new.verification_run_id;
  select exists (
    select 1
      from private.execution_manifest_agents ma
      join private.agent_definitions d on d.id = ma.agent_definition_id
     where ma.execution_manifest_id = manifest
       and ma.logical_agent_key = new.logical_agent_key
       and d.agent_code = new.agent_code
       and d.version = new.agent_version) into allowed;
  if not allowed then
    raise exception 'Run 의 Manifest 에 고정되지 않은 Agent 다: % % %',
      new.logical_agent_key, new.agent_code, new.agent_version
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_agent_in_manifest() from public, anon, authenticated;

drop trigger if exists trg_agent_runs__manifest on public.agent_runs;
create trigger trg_agent_runs__manifest
  before insert on public.agent_runs
  for each row execute function private.check_agent_in_manifest();

-- ------------------------------------------------------------
-- 4. public.agent_run_claims (명세 6.4)
-- ------------------------------------------------------------
create table if not exists public.agent_run_claims (
  owner_id     uuid not null,
  case_id      uuid not null,
  agent_run_id uuid not null,
  claim_id     uuid not null,
  relation     text not null,
  created_at   timestamptz not null default now(),

  constraint pk_agent_run_claims primary key (agent_run_id, claim_id, relation),
  constraint fk_agent_run_claims__agent_run
    foreign key (agent_run_id, owner_id, case_id)
    references public.agent_runs (id, owner_id, case_id) on delete cascade,
  constraint fk_agent_run_claims__claim
    foreign key (claim_id, owner_id, case_id)
    references public.claims (id, owner_id, case_id) on delete cascade,
  constraint ck_agent_run_claims__relation
    check (relation in ('INPUT', 'OUTPUT', 'COVE_TARGET', 'RED_TEAM_TARGET'))
);

-- ------------------------------------------------------------
-- 5. public.tool_runs (명세 6.4)
-- ------------------------------------------------------------
create table if not exists public.tool_runs (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null,
  case_id               uuid not null,
  verification_run_id   uuid not null,
  agent_run_id          uuid not null,
  logical_tool_key      text not null,
  tool_code             text not null,
  tool_version          text not null,
  transport             public.tool_transport not null,
  attempt_no            integer not null,
  status                public.execution_status not null default 'QUEUED',
  input_schema_version  text not null,
  output_schema_version text not null,
  request_hash          text,
  result_digest         text,
  sanitized_scope       jsonb not null,
  provenance_complete   boolean not null default false,
  candidate_count       integer not null default 0,
  selected_count        integer not null default 0,
  started_at            timestamptz,
  finished_at           timestamptz,
  retry_after_at        timestamptz,
  latency_ms            integer,
  cost_microunits       bigint not null default 0,
  error_code            text,
  reason_code           text,
  created_at            timestamptz not null default now(),

  constraint fk_tool_runs__agent_run
    foreign key (agent_run_id, owner_id, case_id, verification_run_id)
    references public.agent_runs (id, owner_id, case_id, verification_run_id) on delete cascade,
  constraint fk_tool_runs__definition
    foreign key (tool_code, tool_version)
    references private.tool_definitions (tool_code, version),

  constraint uq_tool_runs__agent_key_attempt unique (agent_run_id, logical_tool_key, attempt_no),
  constraint uq_tool_runs__scope unique (id, owner_id, case_id, verification_run_id),
  constraint uq_tool_runs__id_owner_case unique (id, owner_id, case_id),

  constraint ck_tool_runs__logical_key check (logical_tool_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint ck_tool_runs__attempt_no check (attempt_no > 0),
  constraint ck_tool_runs__text_len
    check (octet_length(input_schema_version) between 1 and 32
           and octet_length(output_schema_version) between 1 and 32
           and (error_code is null or octet_length(error_code) <= 64)
           and (reason_code is null or octet_length(reason_code) <= 64)),
  constraint ck_tool_runs__digests
    check ((request_hash is null or request_hash ~ '^[0-9a-f]{64}$')
           and (result_digest is null or result_digest ~ '^[0-9a-f]{64}$')),
  constraint ck_tool_runs__scope_object
    check (jsonb_typeof(sanitized_scope) = 'object' and sanitized_scope ? 'schema_version'),
  constraint ck_tool_runs__counts
    check (candidate_count >= 0 and selected_count >= 0 and selected_count <= candidate_count
           and cost_microunits >= 0 and (latency_ms is null or latency_ms >= 0)),
  -- Provenance 완전 표시는 성공한 호출에만 가능하다.
  constraint ck_tool_runs__provenance_requires_success
    check (not provenance_complete or status in ('SUCCEEDED', 'PARTIAL')),
  constraint ck_tool_runs__terminal_finished
    check (status in ('QUEUED', 'RUNNING') = (finished_at is null)),
  constraint ck_tool_runs__running_started
    check (status = 'QUEUED' or started_at is not null),
  constraint ck_tool_runs__failure_reason
    check (status not in ('FAILED', 'BLOCKED', 'CANCELLED') or reason_code is not null)
);

comment on table public.tool_runs is
  '실제 Tool call attempt. 외부 오류 원문·Stack·Secret·전체 본문을 저장하지 않는다 (명세 6.4)';

create index if not exists idx_tool_runs__agent_run_created
  on public.tool_runs (agent_run_id, created_at);

-- Tool 은 Manifest 에 고정되고 그 Agent 의 Allowlist 에 있어야 한다 (규칙 2).
create or replace function private.check_tool_allowed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  manifest uuid;
  agent_def uuid;
  tool_def uuid;
  in_manifest boolean;
  in_allowlist boolean;
begin
  select r.execution_manifest_id into manifest
    from public.verification_runs r where r.id = new.verification_run_id;
  select d.id into agent_def
    from public.agent_runs a
    join private.agent_definitions d on d.agent_code = a.agent_code and d.version = a.agent_version
   where a.id = new.agent_run_id;
  select t.id into tool_def
    from private.tool_definitions t
   where t.tool_code = new.tool_code and t.version = new.tool_version;
  select exists (select 1 from private.execution_manifest_tools mt
                  where mt.execution_manifest_id = manifest and mt.tool_definition_id = tool_def)
    into in_manifest;
  select exists (select 1 from private.agent_tool_allowlists al
                  where al.agent_definition_id = agent_def and al.tool_definition_id = tool_def)
    into in_allowlist;
  if not in_manifest then
    raise exception 'Run 의 Manifest 에 고정되지 않은 Tool 이다: % %', new.tool_code, new.tool_version
      using errcode = 'check_violation';
  end if;
  if not in_allowlist then
    raise exception 'Agent 의 Allowlist 에 없는 Tool 이다: % %', new.tool_code, new.tool_version
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_tool_allowed() from public, anon, authenticated;

drop trigger if exists trg_tool_runs__allowlist on public.tool_runs;
create trigger trg_tool_runs__allowlist
  before insert on public.tool_runs
  for each row execute function private.check_tool_allowed();

-- ------------------------------------------------------------
-- 6. public.tool_run_claims, public.retrieval_steps (명세 6.4)
-- ------------------------------------------------------------
create table if not exists public.tool_run_claims (
  owner_id    uuid not null,
  case_id     uuid not null,
  tool_run_id uuid not null,
  claim_id    uuid not null,
  purpose     text not null,
  created_at  timestamptz not null default now(),

  constraint pk_tool_run_claims primary key (tool_run_id, claim_id, purpose),
  constraint fk_tool_run_claims__tool_run
    foreign key (tool_run_id, owner_id, case_id)
    references public.tool_runs (id, owner_id, case_id) on delete cascade,
  constraint fk_tool_run_claims__claim
    foreign key (claim_id, owner_id, case_id)
    references public.claims (id, owner_id, case_id) on delete cascade,
  constraint ck_tool_run_claims__purpose
    check (purpose in ('PRIMARY', 'COVE', 'RED_TEAM', 'CONTEXT'))
);

create table if not exists public.retrieval_steps (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  case_id         uuid not null,
  tool_run_id     uuid not null,
  step_no         smallint not null,
  stage           text not null,
  query_digest    text not null,
  candidate_count integer not null,
  cutoff_config   jsonb not null,
  duration_ms     integer not null,
  created_at      timestamptz not null default now(),

  constraint fk_retrieval_steps__tool_run
    foreign key (tool_run_id, owner_id, case_id)
    references public.tool_runs (id, owner_id, case_id) on delete cascade,
  constraint uq_retrieval_steps__tool_step unique (tool_run_id, step_no),

  constraint ck_retrieval_steps__step_no check (step_no between 1 and 4),
  -- AI-007 의 순서를 고정한다. 단계 이름과 순번이 어긋날 수 없다.
  constraint ck_retrieval_steps__stage_order
    check ((step_no, stage) in ((1, 'METADATA_FILTER'), (2, 'KEYWORD'), (3, 'VECTOR'), (4, 'RERANK'))),
  constraint ck_retrieval_steps__query_digest check (query_digest ~ '^[0-9a-f]{64}$'),
  constraint ck_retrieval_steps__counts check (candidate_count >= 0 and duration_ms >= 0),
  constraint ck_retrieval_steps__cutoff_object
    check (jsonb_typeof(cutoff_config) = 'object' and cutoff_config ? 'schema_version')
);

comment on table public.retrieval_steps is
  'Hybrid RAG 단계 Trace. Vector 값과 사용자 원문 Query 는 저장하지 않는다 (명세 6.4, AI-007)';

-- ------------------------------------------------------------
-- 7. public.case_source_snapshots (명세 6.5)
-- ------------------------------------------------------------
create table if not exists public.case_source_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null,
  case_id             uuid not null,
  case_input_id       uuid,
  source_type         text not null,
  source_title_masked text not null,
  locator             jsonb not null,
  excerpt_masked      text not null,
  retrieved_at        timestamptz not null,
  content_hash        text not null,
  is_citable          boolean not null default false,
  created_at          timestamptz not null default now(),

  constraint fk_case_source_snapshots__case
    foreign key (case_id, owner_id)
    references public.financial_cases (id, owner_id) on delete cascade,
  constraint fk_case_source_snapshots__input
    foreign key (case_input_id, owner_id, case_id)
    references public.case_inputs (id, owner_id, case_id) on delete cascade,
  constraint uq_case_source_snapshots__id_owner_case unique (id, owner_id, case_id),

  constraint ck_case_source_snapshots__source_type
    check (source_type in ('USER_DOCUMENT', 'USER_STATEMENT', 'CONTRACT_EXCERPT')),
  constraint ck_case_source_snapshots__title_len
    check (octet_length(source_title_masked) between 1 and 512),
  constraint ck_case_source_snapshots__locator_object
    check (jsonb_typeof(locator) = 'object' and locator ? 'schema_version'),
  constraint ck_case_source_snapshots__excerpt_len
    check (octet_length(excerpt_masked) between 1 and 16384),
  constraint ck_case_source_snapshots__content_hash check (content_hash ~ '^[0-9a-f]{64}$'),
  -- 사용자 문서 유래는 입력을 가리켜야 한다.
  constraint ck_case_source_snapshots__document_requires_input
    check (source_type <> 'USER_DOCUMENT' or case_input_id is not null)
);

comment on table public.case_source_snapshots is
  'Case 전용 마스킹 Source. 사용자 문서는 공식 외부 사실 확정 근거가 아니다 (명세 6.5)';

-- ------------------------------------------------------------
-- 8. public.evidences (명세 6.5)
-- ------------------------------------------------------------
create table if not exists public.evidences (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null,
  case_id                 uuid not null,
  verification_run_id     uuid not null,
  kb_snapshot_id          uuid,
  case_snapshot_id        uuid,
  produced_by_tool_run_id uuid,
  source_locator          jsonb not null,
  excerpt_masked          text,
  directness              public.evidence_directness not null,
  citable                 boolean not null,
  reference_only          boolean not null,
  incomplete              boolean not null,
  freshness_at_use        public.freshness_status not null,
  target_match            boolean not null,
  independence_key        text not null,
  selection_reason_code   text not null,
  content_hash            text not null,
  created_at              timestamptz not null default now(),

  constraint fk_evidences__run
    foreign key (verification_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,
  constraint fk_evidences__kb_snapshot
    foreign key (kb_snapshot_id) references kb.source_snapshots (id),
  constraint fk_evidences__case_snapshot
    foreign key (case_snapshot_id, owner_id, case_id)
    references public.case_source_snapshots (id, owner_id, case_id) on delete cascade,
  constraint fk_evidences__tool_run
    foreign key (produced_by_tool_run_id, owner_id, case_id, verification_run_id)
    references public.tool_runs (id, owner_id, case_id, verification_run_id) on delete cascade,

  constraint uq_evidences__scope unique (id, owner_id, case_id, verification_run_id),
  constraint uq_evidences__id_independence unique (id, independence_key),

  -- Source 는 정확히 한 종류다 (명세 7.1).
  constraint ck_evidences__single_source
    check (num_nonnulls(kb_snapshot_id, case_snapshot_id) = 1),
  constraint ck_evidences__locator_object
    check (jsonb_typeof(source_locator) = 'object' and source_locator ? 'schema_version'),
  constraint ck_evidences__excerpt_len
    check (excerpt_masked is null or octet_length(excerpt_masked) <= 16384),
  constraint ck_evidences__independence_key
    check (octet_length(independence_key) between 1 and 128),
  constraint ck_evidences__selection_reason_len
    check (octet_length(selection_reason_code) between 1 and 64),
  constraint ck_evidences__content_hash check (content_hash ~ '^[0-9a-f]{64}$'),
  -- 불완전하거나 참고용인 근거는 인용 가능일 수 없다 (명세 6.5).
  constraint ck_evidences__citable_flags
    check (not (citable and (incomplete or reference_only)))
);

comment on table public.evidences is
  'Run 에서 선택된 Evidence 단위. UPDATE 하지 않는다. A/B 권위만으로 citable 이 되지 않는다 (명세 6.5)';

create index if not exists idx_evidences__run_created
  on public.evidences (verification_run_id, created_at);

-- Provenance 가 완전한 Tool 결과만 Evidence 가 되고, 공용 Snapshot 이 인용
-- 불가면 Evidence 도 인용 가능일 수 없다 (명세 11.1 6번, 6.5).
create or replace function private.check_evidence_provenance() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  complete boolean;
  snapshot_citable boolean;
begin
  if new.produced_by_tool_run_id is not null then
    select t.provenance_complete into complete
      from public.tool_runs t where t.id = new.produced_by_tool_run_id;
    if complete is distinct from true then
      raise exception 'Provenance 가 완전하지 않은 Tool 결과는 Evidence 가 될 수 없다'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.kb_snapshot_id is not null and new.citable then
    select s.is_citable into snapshot_citable
      from kb.source_snapshots s where s.id = new.kb_snapshot_id;
    if snapshot_citable is distinct from true then
      raise exception '인용 불가 Snapshot 을 인용 가능 Evidence 로 표시할 수 없다'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.check_evidence_provenance() from public, anon, authenticated;

drop trigger if exists trg_evidences__provenance on public.evidences;
create trigger trg_evidences__provenance
  before insert on public.evidences
  for each row execute function private.check_evidence_provenance();

-- ------------------------------------------------------------
-- 9. public.final_claim_versions (명세 6.5)
--    정책 버전은 policy_versions 를 복합 FK 로 참조한다 (0009 와 같은 방식).
-- ------------------------------------------------------------
create table if not exists public.final_claim_versions (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null,
  case_id                   uuid not null,
  verification_run_id       uuid not null,
  claim_id                  uuid not null,
  claim_revision_id         uuid not null,
  status                    public.claim_status not null,
  reason_code               text not null,
  policy_version            text not null,
  coverage_contract_version text not null,
  cove_status               text not null,
  red_team_status           text not null,
  is_material               boolean not null,
  decision_summary_masked   text not null,
  content_hash              text not null,
  created_at                timestamptz not null default now(),
  evidence_policy_type text generated always as ('EVIDENCE') stored,
  coverage_policy_type text generated always as ('COVERAGE') stored,

  constraint fk_final_claim_versions__run
    foreign key (verification_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,
  constraint fk_final_claim_versions__revision
    foreign key (claim_revision_id, claim_id, case_id, owner_id)
    references public.claim_revisions (id, claim_id, case_id, owner_id) on delete cascade,
  constraint fk_final_claim_versions__evidence_policy
    foreign key (evidence_policy_type, policy_version)
    references private.policy_versions (policy_type, version),
  constraint fk_final_claim_versions__coverage_policy
    foreign key (coverage_policy_type, coverage_contract_version)
    references private.policy_versions (policy_type, version),

  constraint uq_final_claim_versions__run_claim unique (verification_run_id, claim_id),
  constraint uq_final_claim_versions__scope unique (id, owner_id, case_id, verification_run_id),

  constraint ck_final_claim_versions__reason_len check (octet_length(reason_code) between 1 and 64),
  constraint ck_final_claim_versions__cove_status
    check (cove_status in ('NOT_REQUIRED', 'CONFIRMED', 'CHALLENGED', 'UNRESOLVED', 'FAILED')),
  constraint ck_final_claim_versions__red_team_status
    check (red_team_status in ('NOT_REQUIRED', 'SUPPORTED_INITIAL', 'COUNTER_EVIDENCE', 'UNRESOLVED', 'FAILED')),
  constraint ck_final_claim_versions__summary_len
    check (octet_length(decision_summary_masked) between 1 and 4096),
  constraint ck_final_claim_versions__content_hash check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Material Claim 은 CoVe 를 거친다 (요구사항 4절 7번). 미요구는 비 Material 만 가능하다.
  constraint ck_final_claim_versions__material_cove
    check (not is_material or cove_status <> 'NOT_REQUIRED')
);

comment on table public.final_claim_versions is
  'Run 별 Claim 최종 상태. VERIFIED·CONTRADICTED 는 Evidence 관계 검증 뒤에만 Commit 된다 (명세 6.5, 규칙 1)';

-- ------------------------------------------------------------
-- 10. public.claim_evidences (명세 6.5)
--     independence_key 를 Evidence 에서 복합 FK 로 가져와 같은 그룹의
--     독립 대표가 하나뿐임을 Partial Unique 로 강제한다.
-- ------------------------------------------------------------
create table if not exists public.claim_evidences (
  owner_id               uuid not null,
  case_id                uuid not null,
  verification_run_id    uuid not null,
  final_claim_version_id uuid not null,
  evidence_id            uuid not null,
  independence_key       text not null,
  relation               public.claim_evidence_relation not null,
  is_independent         boolean not null,
  policy_reason_code     text not null,
  created_at             timestamptz not null default now(),

  constraint pk_claim_evidences primary key (final_claim_version_id, evidence_id, relation),
  constraint fk_claim_evidences__final_claim
    foreign key (final_claim_version_id, owner_id, case_id, verification_run_id)
    references public.final_claim_versions (id, owner_id, case_id, verification_run_id) on delete cascade,
  constraint fk_claim_evidences__evidence
    foreign key (evidence_id, owner_id, case_id, verification_run_id)
    references public.evidences (id, owner_id, case_id, verification_run_id) on delete cascade,
  constraint fk_claim_evidences__independence
    foreign key (evidence_id, independence_key)
    references public.evidences (id, independence_key),
  constraint ck_claim_evidences__policy_reason_len
    check (octet_length(policy_reason_code) between 1 and 64)
);

-- 같은 independence_key 안에서 독립 대표는 하나다 (명세 6.5, 규칙 3).
create unique index if not exists uq_claim_evidences__independent_representative
  on public.claim_evidences (final_claim_version_id, independence_key)
  where is_independent;

comment on table public.claim_evidences is
  'Claim 결과와 Evidence 의 관계. 복제 출처는 독립 근거 수를 늘리지 못한다 (명세 6.5)';

-- ------------------------------------------------------------
-- 11. Evidence Policy Validator (명세 6.5, 7.1, 규칙 1)
--     VERIFIED 는 직접·인용 가능·완전·최신·대상 일치 SUPPORT 근거가,
--     CONTRADICTED 는 같은 조건의 CONTRADICT 근거가 있어야 한다. 관계는
--     같은 Transaction 에서 뒤에 들어오므로 Commit 시점에 검사한다.
-- ------------------------------------------------------------
create or replace function private.check_final_claim_evidence() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  needed public.claim_evidence_relation;
  found boolean;
begin
  if new.status = 'VERIFIED' then needed := 'SUPPORT';
  elsif new.status = 'CONTRADICTED' then needed := 'CONTRADICT';
  else return null;
  end if;
  select exists (
    select 1
      from public.claim_evidences ce
      join public.evidences e on e.id = ce.evidence_id
     where ce.final_claim_version_id = new.id
       and ce.relation = needed
       and ce.is_independent
       and e.directness = 'DIRECT'
       and e.citable
       and not e.incomplete
       and not e.reference_only
       and e.target_match
       and e.freshness_at_use = 'FRESH') into found;
  if not found then
    raise exception '% 상태는 직접·인용 가능·최신·대상 일치 % 근거 없이 확정할 수 없다', new.status, needed
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke all on function private.check_final_claim_evidence() from public, anon, authenticated;

drop trigger if exists trg_final_claim_versions__evidence_policy on public.final_claim_versions;
create constraint trigger trg_final_claim_versions__evidence_policy
  after insert on public.final_claim_versions
  deferrable initially deferred
  for each row execute function private.check_final_claim_evidence();

-- ------------------------------------------------------------
-- 12. 불변성 Trigger
-- ------------------------------------------------------------
-- 종결된 Agent·Tool 행은 수정 금지. 종결 전 상태 변경은 함수 경로다.
drop trigger if exists trg_agent_runs__terminal on public.agent_runs;
create trigger trg_agent_runs__terminal before update on public.agent_runs
  for each row execute function private.reject_terminal_update();
drop trigger if exists trg_tool_runs__terminal on public.tool_runs;
create trigger trg_tool_runs__terminal before update on public.tool_runs
  for each row execute function private.reject_terminal_update();

-- Append-only 표
do $$
declare
  t text;
begin
  foreach t in array array['agent_run_claims', 'tool_run_claims', 'retrieval_steps',
                           'case_source_snapshots', 'evidences', 'final_claim_versions',
                           'claim_evidences'] loop
    execute format('drop trigger if exists trg_%s__reject_update on public.%I', t, t);
    execute format('create trigger trg_%s__reject_update before update on public.%I '
                   'for each row execute function private.reject_update()', t, t);
  end loop;
end
$$;

-- 직접 DELETE 차단. 부모 Cascade 만 허용한다.
drop trigger if exists trg_agent_runs__reject_direct_delete on public.agent_runs;
create trigger trg_agent_runs__reject_direct_delete before delete on public.agent_runs
  for each row execute function private.reject_direct_delete('public', 'verification_runs', 'verification_run_id');
drop trigger if exists trg_tool_runs__reject_direct_delete on public.tool_runs;
create trigger trg_tool_runs__reject_direct_delete before delete on public.tool_runs
  for each row execute function private.reject_direct_delete('public', 'agent_runs', 'agent_run_id');
drop trigger if exists trg_evidences__reject_direct_delete on public.evidences;
create trigger trg_evidences__reject_direct_delete before delete on public.evidences
  for each row execute function private.reject_direct_delete('public', 'verification_runs', 'verification_run_id');
drop trigger if exists trg_final_claim_versions__reject_direct_delete on public.final_claim_versions;
create trigger trg_final_claim_versions__reject_direct_delete before delete on public.final_claim_versions
  for each row execute function private.reject_direct_delete('public', 'verification_runs', 'verification_run_id');
drop trigger if exists trg_claim_evidences__reject_direct_delete on public.claim_evidences;
create trigger trg_claim_evidences__reject_direct_delete before delete on public.claim_evidences
  for each row execute function private.reject_direct_delete('public', 'final_claim_versions', 'final_claim_version_id');
drop trigger if exists trg_case_source_snapshots__reject_direct_delete on public.case_source_snapshots;
create trigger trg_case_source_snapshots__reject_direct_delete before delete on public.case_source_snapshots
  for each row execute function private.reject_direct_delete('public', 'financial_cases', 'case_id');

-- ------------------------------------------------------------
-- 13. RLS 와 Grant (명세 9.1, 9.2)
--     회원은 Sanitized View 로만 본다. Worker 는 INSERT·SELECT 만이다.
--     상태 변경은 함수 경로라 UPDATE 권한을 주지 않는다.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['agent_runs', 'agent_run_claims', 'tool_runs', 'tool_run_claims',
                           'retrieval_steps', 'case_source_snapshots', 'evidences',
                           'final_claim_versions', 'claim_evidences'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %s__select_own on public.%I', t, t);
    execute format('create policy %s__select_own on public.%I for select to authenticated '
                   'using (owner_id = (select auth.uid()) and exists (select 1 from public.financial_cases c '
                   'where c.id = case_id and c.owner_id = (select auth.uid()) and c.deleted_at is null))', t, t);
    execute format('drop policy if exists %s__worker_read on public.%I', t, t);
    execute format('create policy %s__worker_read on public.%I for select to finshield_worker using (true)', t, t);
    execute format('drop policy if exists %s__worker_insert on public.%I', t, t);
    execute format('create policy %s__worker_insert on public.%I for insert to finshield_worker with check (true)', t, t);
    execute format('grant select, insert on public.%I to finshield_worker', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
