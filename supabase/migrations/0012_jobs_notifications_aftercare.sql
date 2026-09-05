-- ============================================================
-- 0012 재검증 Job·Diff·알림·PreCase 가입 후 보호 (명세 6.6, 6.7, 15절 10번 묶음)
--
-- 대상: public.revalidation_jobs, private.revalidation_job_runtime,
--       public.revalidation_events, public.passport_diffs,
--       public.notifications, public.notification_preferences,
--       public.precase_assessments, public.precase_answers,
--       public.action_checklists
--
-- 0009 가 FK 없이 남긴 verification_runs.revalidation_job_id 에 교차 소유
-- 복합 FK 를 붙인다. 이로써 표에 남은 미결 FK 는 없다.
--
-- Job Claim·Lease·최종화 함수(명세 7.2)는 Outbox 가 있는 12번 묶음 뒤에
-- 만든다. 여기서는 표·제약과, 종결 Job 이 Diff·Run·Passport 를 정확히
-- 하나씩 같은 Owner·Case 로 가리켜야 한다는 정합성을 Deferred Constraint
-- Trigger 로 먼저 고정한다 (명세 6.6).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum (명세 4.1)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'revalidation_job_status') then
    create type public.revalidation_job_status as enum ('QUEUED', 'RUNNING', 'NO_CHANGE', 'CHANGED', 'FAILED');
  end if;
  if not exists (select 1 from pg_type where typname = 'notification_channel') then
    create type public.notification_channel as enum ('IN_APP', 'EMAIL');
  end if;
  if not exists (select 1 from pg_type where typname = 'aftercare_result') then
    create type public.aftercare_result as enum (
      'NORMAL_MANAGEMENT', 'ADDITIONAL_EXPLANATION', 'CORRECTION_OR_INQUIRY', 'DISPUTE_PREPARATION');
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. public.revalidation_jobs (명세 6.6)
-- ------------------------------------------------------------
create table if not exists public.revalidation_jobs (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null,
  case_id             uuid not null,
  base_passport_id    uuid not null,
  status              public.revalidation_job_status not null default 'QUEUED',
  trigger_type        text not null,
  idempotency_key     text not null,
  request_hash        text not null,
  cancel_requested_at timestamptz,
  result_run_id       uuid,
  result_passport_id  uuid,
  reason_code         text,
  error_code          text,
  queued_at           timestamptz,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),

  constraint fk_revalidation_jobs__case
    foreign key (case_id, owner_id) references public.financial_cases (id, owner_id) on delete cascade,
  constraint fk_revalidation_jobs__base_passport
    foreign key (base_passport_id, owner_id, case_id)
    references public.evidence_passports (id, owner_id, case_id) on delete cascade,
  constraint fk_revalidation_jobs__result_run
    foreign key (result_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,
  constraint fk_revalidation_jobs__result_passport
    foreign key (result_passport_id, owner_id, case_id)
    references public.evidence_passports (id, owner_id, case_id) on delete cascade,

  constraint uq_revalidation_jobs__idempotency unique (owner_id, case_id, idempotency_key),
  constraint uq_revalidation_jobs__id_owner_case unique (id, owner_id, case_id),

  -- P0 는 사용자가 시작한 수동 재검증만이다 (명세 6.6).
  constraint ck_revalidation_jobs__trigger_type
    check (trigger_type in ('MANUAL', 'SCHEDULE', 'SOURCE_EVENT')),
  constraint ck_revalidation_jobs__idempotency_len check (octet_length(idempotency_key) between 1 and 128),
  constraint ck_revalidation_jobs__request_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_revalidation_jobs__codes_len
    check ((reason_code is null or octet_length(reason_code) <= 64)
           and (error_code is null or octet_length(error_code) <= 64)),
  -- 성공 종결에는 결과 Run·Passport 가 있고, FAILED 에는 둘 수 없다.
  constraint ck_revalidation_jobs__success_pointers
    check (status not in ('NO_CHANGE', 'CHANGED')
           or (result_run_id is not null and result_passport_id is not null)),
  constraint ck_revalidation_jobs__failed_no_pointers
    check (status <> 'FAILED' or (result_run_id is null and result_passport_id is null)),
  constraint ck_revalidation_jobs__failed_reason
    check (status <> 'FAILED' or reason_code is not null),
  constraint ck_revalidation_jobs__terminal_finished
    check (status in ('QUEUED', 'RUNNING') = (finished_at is null)),
  constraint ck_revalidation_jobs__running_started
    check (status = 'QUEUED' or started_at is not null)
);

comment on table public.revalidation_jobs is
  '내구성 있는 재검증 Job. 취소는 FAILED 와 USER_CANCELLED reason 으로 표현한다 (명세 6.6)';

-- Case 당 활성 재검증 Job 하나 (명세 7.1)
create unique index if not exists uq_revalidation_jobs__active
  on public.revalidation_jobs (case_id)
  where status in ('QUEUED', 'RUNNING');

create index if not exists idx_revalidation_jobs__owner_case_created
  on public.revalidation_jobs (owner_id, case_id, created_at desc);
-- Worker Claim (명세 8.2)
create index if not exists idx_revalidation_jobs__status_queued
  on public.revalidation_jobs (status, queued_at);

-- 0009 보완: 재검증 Run 은 같은 Owner·Case 의 Job 을 가리킨다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_verification_runs__revalidation_job') then
    alter table public.verification_runs
      add constraint fk_verification_runs__revalidation_job
      foreign key (revalidation_job_id, owner_id, case_id)
      references public.revalidation_jobs (id, owner_id, case_id) on delete cascade;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 3. private.revalidation_job_runtime (명세 6.6, 12.2)
-- ------------------------------------------------------------
create table if not exists private.revalidation_job_runtime (
  job_id       uuid primary key,
  lease_owner  text,
  lease_token  uuid,
  leased_until timestamptz,
  heartbeat_at timestamptz,
  attempt_no   integer not null default 0,
  max_attempts integer not null,
  available_at timestamptz not null,
  updated_at   timestamptz not null default now(),

  constraint fk_revalidation_job_runtime__job
    foreign key (job_id) references public.revalidation_jobs (id) on delete cascade,
  constraint ck_revalidation_job_runtime__attempts
    check (attempt_no >= 0 and max_attempts between 1 and 10 and attempt_no <= max_attempts),
  constraint ck_revalidation_job_runtime__lease_owner_len
    check (lease_owner is null or octet_length(lease_owner) <= 128),
  -- Lease 세 값은 함께 있거나 함께 없다. 반쪽 Lease 는 Fencing 을 깬다.
  constraint ck_revalidation_job_runtime__lease_pairing
    check ((lease_owner is null) = (lease_token is null)
           and (lease_owner is null) = (leased_until is null))
);

comment on table private.revalidation_job_runtime is
  'Worker Lease·Heartbeat·Fencing token. 최종화는 현재 lease_token 이 일치할 때만 성공한다 (명세 6.6, 12.2)';

create index if not exists idx_revalidation_job_runtime__available_leased
  on private.revalidation_job_runtime (available_at, leased_until);

drop trigger if exists trg_revalidation_job_runtime__updated_at on private.revalidation_job_runtime;
create trigger trg_revalidation_job_runtime__updated_at
  before update on private.revalidation_job_runtime
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------
-- 4. public.revalidation_events (명세 6.6)
-- ------------------------------------------------------------
create table if not exists public.revalidation_events (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null,
  case_id                   uuid not null,
  revalidation_job_id       uuid not null,
  event_no                  integer not null,
  event_type                text not null,
  source_snapshot_before_id uuid,
  source_snapshot_after_id  uuid,
  source_fetch_event_id     uuid,
  payload                   jsonb not null,
  created_at                timestamptz not null default now(),

  constraint fk_revalidation_events__job
    foreign key (revalidation_job_id, owner_id, case_id)
    references public.revalidation_jobs (id, owner_id, case_id) on delete cascade,
  constraint fk_revalidation_events__before
    foreign key (source_snapshot_before_id) references kb.source_snapshots (id),
  constraint fk_revalidation_events__after
    foreign key (source_snapshot_after_id) references kb.source_snapshots (id),
  constraint fk_revalidation_events__fetch
    foreign key (source_fetch_event_id) references kb.source_fetch_events (id),

  constraint uq_revalidation_events__job_event_no unique (revalidation_job_id, event_no),

  constraint ck_revalidation_events__event_no check (event_no > 0),
  constraint ck_revalidation_events__event_type
    check (event_type ~ '^(QUEUED|LEASED|HEARTBEAT|SOURCE_FETCHED|SOURCE_CHANGED|SOURCE_UNCHANGED|FAILED|COMPLETED|CANCELLED)(_[A-Z0-9_]{1,40})?$'),
  constraint ck_revalidation_events__payload_object
    check (jsonb_typeof(payload) = 'object' and payload ? 'schema_version'),
  -- Source 재조회 사건은 실제 Fetch Event 를 가리켜야 한다 (P0 임의 감시 금지).
  constraint ck_revalidation_events__fetch_required
    check (event_type not like 'SOURCE_%' or source_fetch_event_id is not null),
  constraint ck_revalidation_events__changed_pair
    check (event_type not like 'SOURCE_CHANGED%'
           or (source_snapshot_before_id is not null and source_snapshot_after_id is not null
               and source_snapshot_before_id <> source_snapshot_after_id))
);

comment on table public.revalidation_events is
  'Append-only Job Event. 사용자가 시작한 Job 의 추적 가능한 Source 재조회만 기록한다 (명세 6.6)';

-- ------------------------------------------------------------
-- 5. public.passport_diffs (명세 6.6)
-- ------------------------------------------------------------
create table if not exists public.passport_diffs (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null,
  case_id             uuid not null,
  revalidation_job_id uuid not null,
  before_passport_id  uuid not null,
  after_passport_id   uuid not null,
  material_change     boolean not null,
  claim_changes       jsonb not null,
  evidence_changes    jsonb not null,
  result_changes      jsonb not null,
  action_changes      jsonb not null,
  diff_schema_version text not null,
  content_hash        text not null,
  created_at          timestamptz not null default now(),

  constraint fk_passport_diffs__job
    foreign key (revalidation_job_id, owner_id, case_id)
    references public.revalidation_jobs (id, owner_id, case_id) on delete cascade,
  constraint fk_passport_diffs__before
    foreign key (before_passport_id, owner_id, case_id)
    references public.evidence_passports (id, owner_id, case_id) on delete cascade,
  constraint fk_passport_diffs__after
    foreign key (after_passport_id, owner_id, case_id)
    references public.evidence_passports (id, owner_id, case_id) on delete cascade,

  -- Job 당 Diff 하나
  constraint uq_passport_diffs__job unique (revalidation_job_id),
  constraint uq_passport_diffs__id_owner_case unique (id, owner_id, case_id),

  constraint ck_passport_diffs__distinct_passports check (before_passport_id <> after_passport_id),
  constraint ck_passport_diffs__changes_shape
    check (jsonb_typeof(claim_changes) in ('array', 'object')
           and jsonb_typeof(evidence_changes) in ('array', 'object')
           and jsonb_typeof(result_changes) in ('array', 'object')
           and jsonb_typeof(action_changes) in ('array', 'object')),
  constraint ck_passport_diffs__schema_len check (octet_length(diff_schema_version) between 1 and 32),
  constraint ck_passport_diffs__content_hash check (content_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.passport_diffs is
  '불변 Passport 비교. NO_CHANGE 도 빈 Change 목록과 material_change=false 행을 만든다 (명세 6.6)';

-- 종결 Job 정합성 (명세 6.6): NO_CHANGE|CHANGED 는 정확히 한 Diff 가 있고
-- Diff 의 before=base, after=result 여야 하며 결과 Run 은 이 Job 을 가리켜야 한다.
-- Diff 가 Job 뒤에 같은 Transaction 에서 들어오므로 Commit 시점에 검사한다.
create or replace function private.check_revalidation_terminal() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.revalidation_jobs%rowtype;
  diff_count integer;
  diff_ok boolean;
  run_ok boolean;
begin
  select * into job from public.revalidation_jobs j where j.id = new.id;
  if job.status not in ('NO_CHANGE', 'CHANGED') then
    return null;
  end if;
  select count(*) into diff_count from public.passport_diffs d where d.revalidation_job_id = job.id;
  if diff_count <> 1 then
    raise exception '종결 Job 에는 정확히 한 Diff 가 있어야 한다 (%)', diff_count
      using errcode = 'check_violation';
  end if;
  select (d.before_passport_id = job.base_passport_id and d.after_passport_id = job.result_passport_id
          and (job.status <> 'NO_CHANGE' or not d.material_change))
    into diff_ok
    from public.passport_diffs d where d.revalidation_job_id = job.id;
  if not diff_ok then
    raise exception 'Diff 의 before·after 가 Job 의 base·result Passport 와 다르거나 NO_CHANGE 에 중대 변경이 있다'
      using errcode = 'check_violation';
  end if;
  select exists (select 1 from public.verification_runs r
                  where r.id = job.result_run_id and r.revalidation_job_id = job.id
                    and r.kind = 'REVALIDATION') into run_ok;
  if not run_ok then
    raise exception '결과 Run 이 이 Job 을 가리키는 REVALIDATION Run 이 아니다'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke all on function private.check_revalidation_terminal() from public, anon, authenticated;

drop trigger if exists trg_revalidation_jobs__terminal on public.revalidation_jobs;
create constraint trigger trg_revalidation_jobs__terminal
  after insert or update of status on public.revalidation_jobs
  deferrable initially deferred
  for each row execute function private.check_revalidation_terminal();

-- ------------------------------------------------------------
-- 6. public.notifications, public.notification_preferences (명세 6.6)
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null,
  case_id             uuid not null,
  notification_type   text not null,
  channel             public.notification_channel not null default 'IN_APP',
  revalidation_job_id uuid,
  passport_diff_id    uuid,
  passport_id         uuid,
  deduplication_key   text not null,
  title               text not null,
  body_masked         text not null,
  read_at             timestamptz,
  delivery_status     text not null default 'PENDING',
  created_at          timestamptz not null default now(),

  constraint fk_notifications__case
    foreign key (case_id, owner_id) references public.financial_cases (id, owner_id) on delete cascade,
  constraint fk_notifications__job
    foreign key (revalidation_job_id, owner_id, case_id)
    references public.revalidation_jobs (id, owner_id, case_id) on delete cascade,
  constraint fk_notifications__diff
    foreign key (passport_diff_id, owner_id, case_id)
    references public.passport_diffs (id, owner_id, case_id) on delete cascade,
  constraint fk_notifications__passport
    foreign key (passport_id, owner_id, case_id)
    references public.evidence_passports (id, owner_id, case_id) on delete cascade,

  constraint uq_notifications__dedup unique (owner_id, channel, deduplication_key),

  constraint ck_notifications__type check (notification_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_notifications__dedup_len check (octet_length(deduplication_key) between 1 and 128),
  constraint ck_notifications__text_len
    check (octet_length(title) between 1 and 256 and octet_length(body_masked) between 1 and 4096),
  constraint ck_notifications__delivery_status
    check (delivery_status in ('PENDING', 'DELIVERED', 'FAILED')),
  -- P0 는 앱 내 알림만이다. EMAIL 은 P1 Feature Gate 뒤에 Migration 으로 연다.
  constraint ck_notifications__channel_p0 check (channel = 'IN_APP')
);

comment on table public.notifications is
  '사용자 알림. Finalization 은 Outbox 를 남기고 Dispatcher 가 만든다. NO_CHANGE 는 위험 알림을 만들지 않는다 (명세 6.6)';

-- 알림 목록 (명세 8.1)
create index if not exists idx_notifications__owner_list
  on public.notifications (owner_id, read_at nulls first, created_at desc, id desc);

-- NO_CHANGE Job 에는 위험·중대 변경 알림을 만들 수 없다 (명세 6.6).
create or replace function private.check_notification_job() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_status public.revalidation_job_status;
begin
  if new.revalidation_job_id is null then return new; end if;
  select j.status into job_status from public.revalidation_jobs j where j.id = new.revalidation_job_id;
  if job_status = 'NO_CHANGE' and new.notification_type !~ '^(REVALIDATION_COMPLETED|REVALIDATION_NO_CHANGE)$' then
    raise exception 'NO_CHANGE Job 에는 조용한 완료 알림만 허용한다: %', new.notification_type
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_notification_job() from public, anon, authenticated;

drop trigger if exists trg_notifications__job on public.notifications;
create trigger trg_notifications__job
  before insert on public.notifications
  for each row execute function private.check_notification_job();

create table if not exists public.notification_preferences (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null,
  scope_type     text not null,
  case_id        uuid,
  in_app_enabled boolean not null default true,
  email_enabled  boolean not null default false,
  digest_enabled boolean not null default false,
  updated_at     timestamptz not null default now(),

  constraint fk_notification_preferences__owner
    foreign key (owner_id) references public.profiles (id) on delete cascade,
  constraint fk_notification_preferences__case
    foreign key (case_id, owner_id) references public.financial_cases (id, owner_id) on delete cascade,

  constraint ck_notification_preferences__scope
    check ((scope_type = 'ACCOUNT' and case_id is null) or (scope_type = 'CASE' and case_id is not null)),
  -- P1 Feature Gate 전에는 켤 수 없다.
  constraint ck_notification_preferences__p1_off
    check (not email_enabled and not digest_enabled)
);

create unique index if not exists uq_notification_preferences__account
  on public.notification_preferences (owner_id) where scope_type = 'ACCOUNT';
create unique index if not exists uq_notification_preferences__case
  on public.notification_preferences (owner_id, case_id) where scope_type = 'CASE';

drop trigger if exists trg_notification_preferences__updated_at on public.notification_preferences;
create trigger trg_notification_preferences__updated_at
  before update on public.notification_preferences
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------
-- 7. public.precase_assessments (명세 6.7)
-- ------------------------------------------------------------
create table if not exists public.precase_assessments (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null,
  case_id                   uuid not null,
  assessment_no             integer not null,
  base_passport_id          uuid not null,
  profile_version_id        uuid not null,
  status                    text not null default 'DRAFT',
  result                    public.aftercare_result,
  assessment_schema_version text not null,
  execution_manifest_id     uuid not null,
  summary_masked            text,
  started_at                timestamptz,
  finished_at               timestamptz,
  created_at                timestamptz not null default now(),
  error_code                text,
  reason_code               text,

  constraint fk_precase_assessments__case
    foreign key (case_id, owner_id) references public.financial_cases (id, owner_id) on delete cascade,
  constraint fk_precase_assessments__passport
    foreign key (base_passport_id, owner_id, case_id)
    references public.evidence_passports (id, owner_id, case_id) on delete cascade,
  constraint fk_precase_assessments__profile
    foreign key (profile_version_id, owner_id)
    references public.financial_profile_versions (id, owner_id) on delete restrict,
  constraint fk_precase_assessments__manifest
    foreign key (execution_manifest_id) references private.execution_manifests (id),

  constraint uq_precase_assessments__case_no unique (case_id, assessment_no),
  constraint uq_precase_assessments__id_owner_case unique (id, owner_id, case_id),

  constraint ck_precase_assessments__no check (assessment_no > 0),
  constraint ck_precase_assessments__status
    check (status in ('DRAFT', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED')),
  constraint ck_precase_assessments__schema_len
    check (octet_length(assessment_schema_version) between 1 and 32),
  constraint ck_precase_assessments__summary_len
    check (summary_masked is null or octet_length(summary_masked) <= 4096),
  constraint ck_precase_assessments__codes_len
    check ((error_code is null or octet_length(error_code) <= 64)
           and (reason_code is null or octet_length(reason_code) <= 64)),
  -- 결과는 종결 상태에서만 존재하고 완료에는 필수다.
  constraint ck_precase_assessments__result_terminal
    check (status in ('COMPLETED', 'PARTIAL') or result is null),
  constraint ck_precase_assessments__completed_result
    check (status <> 'COMPLETED' or result is not null),
  constraint ck_precase_assessments__terminal_finished
    check (status in ('DRAFT', 'RUNNING') = (finished_at is null)),
  constraint ck_precase_assessments__failure_reason
    check (status not in ('FAILED', 'CANCELLED') or reason_code is not null)
);

comment on table public.precase_assessments is
  '가입 후 점검 실행. 가입 확인 Event 없이 시작할 수 없다 (명세 6.7)';

-- 가입 확인이 있어야 시작할 수 있다. 피해 의심만으로는 가입으로 보지 않는다 (명세 6.7).
create or replace function private.check_assessment_enrollment() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed_at timestamptz;
  has_event boolean;
begin
  select c.enrollment_confirmed_at into confirmed_at
    from public.financial_cases c where c.id = new.case_id;
  select exists (select 1 from public.case_events e
                  where e.case_id = new.case_id and e.event_type = 'JOURNEY_ENROLLED') into has_event;
  if confirmed_at is null or not has_event then
    raise exception '가입 확인 Event 와 확인 시각 없이 가입 후 점검을 시작할 수 없다'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_assessment_enrollment() from public, anon, authenticated;

drop trigger if exists trg_precase_assessments__enrollment on public.precase_assessments;
create trigger trg_precase_assessments__enrollment
  before insert on public.precase_assessments
  for each row execute function private.check_assessment_enrollment();

-- ------------------------------------------------------------
-- 8. public.precase_answers, public.action_checklists (명세 6.7)
-- ------------------------------------------------------------
create table if not exists public.precase_answers (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null,
  case_id                   uuid not null,
  precase_assessment_id     uuid not null,
  question_code             text not null,
  question_version          text not null,
  answer_version_no         integer not null,
  answer_code               text,
  answer_text_masked        text,
  source_claim_revision_id  uuid,
  source_input_id           uuid,
  supersedes_answer_id      uuid,
  created_at                timestamptz not null default now(),

  constraint fk_precase_answers__assessment
    foreign key (precase_assessment_id, owner_id, case_id)
    references public.precase_assessments (id, owner_id, case_id) on delete cascade,
  constraint fk_precase_answers__claim_revision
    foreign key (source_claim_revision_id, owner_id)
    references public.claim_revisions (id, owner_id) on delete cascade,
  constraint fk_precase_answers__input
    foreign key (source_input_id, owner_id, case_id)
    references public.case_inputs (id, owner_id, case_id) on delete cascade,
  constraint fk_precase_answers__supersedes
    foreign key (supersedes_answer_id, owner_id, case_id)
    references public.precase_answers (id, owner_id, case_id) on delete cascade,

  constraint uq_precase_answers__question_version
    unique (precase_assessment_id, question_code, answer_version_no),
  constraint uq_precase_answers__id_owner_case unique (id, owner_id, case_id),

  constraint ck_precase_answers__question_code check (question_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_precase_answers__question_version_len check (octet_length(question_version) between 1 and 32),
  constraint ck_precase_answers__version_no check (answer_version_no > 0),
  constraint ck_precase_answers__answer_present
    check (answer_code is not null or answer_text_masked is not null),
  constraint ck_precase_answers__text_len
    check ((answer_code is null or octet_length(answer_code) <= 64)
           and (answer_text_masked is null or octet_length(answer_text_masked) <= 4096)),
  constraint ck_precase_answers__no_self_supersede
    check (supersedes_answer_id is null or supersedes_answer_id <> id),
  -- 정정 버전은 직전 답변을 가리킨다.
  constraint ck_precase_answers__revision_supersedes
    check (answer_version_no = 1 or supersedes_answer_id is not null)
);

comment on table public.precase_answers is
  'Append-only 답변 버전. 원본 녹취·계약 문서를 저장하지 않고 마스킹 Claim·Locator 만 연결한다 (명세 6.7)';

-- evidences 의 (id, owner_id, case_id) 참조 키
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_evidences__id_owner_case') then
    alter table public.evidences add constraint uq_evidences__id_owner_case unique (id, owner_id, case_id);
  end if;
end
$$;

create table if not exists public.action_checklists (
  id                           uuid primary key default gen_random_uuid(),
  owner_id                     uuid not null,
  case_id                      uuid not null,
  precase_assessment_id        uuid not null,
  action_code                  text not null,
  source_evidence_id           uuid,
  official_channel_registry_id uuid,
  status                       text not null default 'PENDING',
  required_material_codes      text[] not null default '{}',
  completed_at                 timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint fk_action_checklists__assessment
    foreign key (precase_assessment_id, owner_id, case_id)
    references public.precase_assessments (id, owner_id, case_id) on delete cascade,
  constraint fk_action_checklists__evidence
    foreign key (source_evidence_id, owner_id, case_id)
    references public.evidences (id, owner_id, case_id) on delete cascade,
  constraint fk_action_checklists__channel
    foreign key (official_channel_registry_id) references kb.official_channel_registry (id),

  constraint ck_action_checklists__action_code check (action_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_action_checklists__status check (status in ('PENDING', 'DONE', 'SKIPPED')),
  constraint ck_action_checklists__materials check (array_position(required_material_codes, null) is null),
  constraint ck_action_checklists__completed_pairing
    check ((status = 'DONE') = (completed_at is not null))
);

comment on table public.action_checklists is
  '사용자가 상태를 바꿀 수 있는 운영 Projection. 결과 근거 자체는 수정하지 않는다 (명세 6.7)';

drop trigger if exists trg_action_checklists__updated_at on public.action_checklists;
create trigger trg_action_checklists__updated_at
  before update on public.action_checklists
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------
-- 8.1 FK 자식 컬럼 색인 (명세 8.2)
-- ------------------------------------------------------------
create index if not exists idx_verification_runs__revalidation_job on public.verification_runs (revalidation_job_id);
create index if not exists idx_revalidation_jobs__base_passport on public.revalidation_jobs (base_passport_id);
create index if not exists idx_revalidation_jobs__result_run on public.revalidation_jobs (result_run_id);
create index if not exists idx_revalidation_jobs__result_passport on public.revalidation_jobs (result_passport_id);
create index if not exists idx_revalidation_events__fetch on public.revalidation_events (source_fetch_event_id);
create index if not exists idx_revalidation_events__before on public.revalidation_events (source_snapshot_before_id);
create index if not exists idx_revalidation_events__after on public.revalidation_events (source_snapshot_after_id);
create index if not exists idx_passport_diffs__before on public.passport_diffs (before_passport_id);
create index if not exists idx_passport_diffs__after on public.passport_diffs (after_passport_id);
create index if not exists idx_notifications__job on public.notifications (revalidation_job_id);
create index if not exists idx_notifications__diff on public.notifications (passport_diff_id);
create index if not exists idx_notifications__passport on public.notifications (passport_id);
create index if not exists idx_notification_preferences__case on public.notification_preferences (case_id);
create index if not exists idx_precase_assessments__owner_case_no
  on public.precase_assessments (owner_id, case_id, assessment_no desc);
create index if not exists idx_precase_assessments__base_passport on public.precase_assessments (base_passport_id);
create index if not exists idx_precase_assessments__profile on public.precase_assessments (profile_version_id);
create index if not exists idx_precase_assessments__manifest on public.precase_assessments (execution_manifest_id);
create index if not exists idx_precase_answers__assessment on public.precase_answers (precase_assessment_id);
create index if not exists idx_precase_answers__claim_revision on public.precase_answers (source_claim_revision_id);
create index if not exists idx_precase_answers__input on public.precase_answers (source_input_id);
create index if not exists idx_precase_answers__supersedes on public.precase_answers (supersedes_answer_id);
create index if not exists idx_action_checklists__assessment on public.action_checklists (precase_assessment_id);
create index if not exists idx_action_checklists__evidence on public.action_checklists (source_evidence_id);
create index if not exists idx_action_checklists__channel on public.action_checklists (official_channel_registry_id);

-- ------------------------------------------------------------
-- 9. 불변성 Trigger (명세 7.4)
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['revalidation_events', 'passport_diffs', 'precase_answers'] loop
    execute format('drop trigger if exists trg_%s__reject_update on public.%I', t, t);
    execute format('create trigger trg_%s__reject_update before update on public.%I '
                   'for each row execute function private.reject_update()', t, t);
  end loop;
end
$$;

drop trigger if exists trg_revalidation_jobs__reject_direct_delete on public.revalidation_jobs;
create trigger trg_revalidation_jobs__reject_direct_delete before delete on public.revalidation_jobs
  for each row execute function private.reject_direct_delete('public', 'financial_cases', 'case_id');
drop trigger if exists trg_revalidation_events__reject_direct_delete on public.revalidation_events;
create trigger trg_revalidation_events__reject_direct_delete before delete on public.revalidation_events
  for each row execute function private.reject_direct_delete('public', 'revalidation_jobs', 'revalidation_job_id');
drop trigger if exists trg_passport_diffs__reject_direct_delete on public.passport_diffs;
create trigger trg_passport_diffs__reject_direct_delete before delete on public.passport_diffs
  for each row execute function private.reject_direct_delete('public', 'revalidation_jobs', 'revalidation_job_id');
drop trigger if exists trg_precase_assessments__reject_direct_delete on public.precase_assessments;
create trigger trg_precase_assessments__reject_direct_delete before delete on public.precase_assessments
  for each row execute function private.reject_direct_delete('public', 'financial_cases', 'case_id');
drop trigger if exists trg_precase_answers__reject_direct_delete on public.precase_answers;
create trigger trg_precase_answers__reject_direct_delete before delete on public.precase_answers
  for each row execute function private.reject_direct_delete('public', 'precase_assessments', 'precase_assessment_id');

-- ------------------------------------------------------------
-- 10. RLS 와 Grant (명세 9.1, 9.2)
--     회원: Diff·알림·점검 결과 본인 SELECT. 알림 읽음과 Checklist 상태,
--     알림 설정은 제한 RPC 가 담당하므로 직접 UPDATE 권한은 주지 않는다.
--     Worker: SELECT·INSERT. Job·Runtime 상태 변경은 함수 경로다.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['revalidation_jobs', 'revalidation_events', 'passport_diffs',
                           'notifications', 'precase_assessments', 'precase_answers',
                           'action_checklists'] loop
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
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert on public.%I to finshield_worker', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- 알림 설정은 계정 소유자 본인만 읽고, 쓰기는 제한 RPC 가 한다.
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force  row level security;
drop policy if exists notification_preferences__select_own on public.notification_preferences;
create policy notification_preferences__select_own on public.notification_preferences
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists notification_preferences__worker_read on public.notification_preferences;
create policy notification_preferences__worker_read on public.notification_preferences
  for select to finshield_worker using (true);
grant select on public.notification_preferences to authenticated;
grant select on public.notification_preferences to finshield_worker;
revoke all on public.notification_preferences from anon;

-- Runtime 은 Worker 전용이다.
alter table private.revalidation_job_runtime enable row level security;
alter table private.revalidation_job_runtime force  row level security;
drop policy if exists revalidation_job_runtime__worker on private.revalidation_job_runtime;
create policy revalidation_job_runtime__worker on private.revalidation_job_runtime
  for all to finshield_worker using (true) with check (true);
grant select, insert, update on private.revalidation_job_runtime to finshield_worker;
revoke all on private.revalidation_job_runtime from anon, authenticated;
