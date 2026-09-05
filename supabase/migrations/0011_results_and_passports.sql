-- ============================================================
-- 0011 축 결과·행동 가이드·Evidence Passport (명세 6.4, 6.5, 15절 9번 묶음)
--
-- 대상: public.verification_axis_results, public.action_guides,
--       public.action_guide_channels, public.evidence_passports
--
-- 0004 가 FK 없이 남긴 financial_cases.latest_passport_id 에 교차 소유
-- 복합 FK 를 붙인다. 이로써 0004 의 미결 FK 두 개가 모두 닫힌다.
--
-- finalize_verification_run 함수(명세 7.3)는 outbox_events 가 있는 뒤
-- (10·12번 묶음)에 만든다. 여기서는 표·제약·Append-only 와, 함수가
-- 어기면 안 되는 정합성을 Trigger 로 먼저 고정한다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum (명세 4.1)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'result_axis') then
    create type public.result_axis as enum ('AUTHENTICITY', 'TRANSACTION_SALES_RISK', 'SUITABILITY');
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. public.verification_axis_results (명세 6.4)
-- ------------------------------------------------------------
create table if not exists public.verification_axis_results (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null,
  case_id             uuid not null,
  verification_run_id uuid not null,
  axis                public.result_axis not null,
  result_code         text not null,
  summary_masked      text not null,
  limitation_codes    text[] not null,
  content_hash        text not null,
  created_at          timestamptz not null default now(),

  constraint fk_verification_axis_results__run
    foreign key (verification_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,
  constraint uq_verification_axis_results__run_axis unique (verification_run_id, axis),

  constraint ck_verification_axis_results__result_code
    check (result_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_verification_axis_results__summary_len
    check (octet_length(summary_masked) between 1 and 4096),
  constraint ck_verification_axis_results__limitations
    check (array_position(limitation_codes, null) is null),
  constraint ck_verification_axis_results__content_hash
    check (content_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.verification_axis_results is
  '축별 불변 결과. 한 축 결과를 다른 축에 복사해 넣지 않는다 (명세 6.4, RES-001)';

-- ------------------------------------------------------------
-- 3. public.action_guides (명세 6.5)
--    전화번호·URL 문자열을 모델 출력에서 직접 저장하지 않는다. actions 는
--    승인 Registry ID 를 참조하고 채널 Join 이 그 존재를 보증한다.
-- ------------------------------------------------------------
create table if not exists public.action_guides (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null,
  case_id              uuid not null,
  verification_run_id  uuid not null,
  version_no           integer not null,
  status               text not null,
  guide_schema_version text not null,
  actions              jsonb not null,
  limitation_codes     text[] not null,
  content_hash         text not null,
  created_at           timestamptz not null default now(),

  constraint fk_action_guides__run
    foreign key (verification_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,
  constraint uq_action_guides__run_version unique (verification_run_id, version_no),
  constraint uq_action_guides__scope unique (id, owner_id, case_id, verification_run_id),

  constraint ck_action_guides__version_no check (version_no > 0),
  constraint ck_action_guides__status check (status in ('COMPLETED', 'FAILED', 'WITHHELD')),
  constraint ck_action_guides__schema_len check (octet_length(guide_schema_version) between 1 and 32),
  constraint ck_action_guides__actions_array check (jsonb_typeof(actions) = 'array'),
  -- 완료된 Guide 는 행동이 하나 이상이고, 실패·보류는 비어 있어야 한다.
  constraint ck_action_guides__actions_by_status
    check ((status = 'COMPLETED') = (jsonb_array_length(actions) > 0)),
  constraint ck_action_guides__limitations
    check (array_position(limitation_codes, null) is null),
  constraint ck_action_guides__content_hash check (content_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.action_guides is
  'Run 의 행동 가이드 버전. 재생성은 새 버전이다. 채널은 승인 Registry ID 로만 참조한다 (명세 6.5)';

-- actions 안에 원시 전화번호·URL 을 넣지 못하게 한다. 채널은 Join 으로만 온다.
create or replace function private.check_guide_actions() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  serialized text := new.actions::text;
begin
  if serialized ~ 'https?://' then
    raise exception 'Guide actions 에 URL 원문을 넣을 수 없다. 승인 채널 Registry ID 를 참조한다'
      using errcode = 'check_violation';
  end if;
  if serialized ~ '(?<![0-9])(?:0[0-9]{1,2}[- ]?[0-9]{3,4}[- ]?[0-9]{4})(?![0-9])' then
    raise exception 'Guide actions 에 전화번호 원문을 넣을 수 없다. 승인 채널 Registry ID 를 참조한다'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_guide_actions() from public, anon, authenticated;

drop trigger if exists trg_action_guides__no_raw_channels on public.action_guides;
create trigger trg_action_guides__no_raw_channels
  before insert on public.action_guides
  for each row execute function private.check_guide_actions();

-- ------------------------------------------------------------
-- 4. public.action_guide_channels (명세 6.5)
-- ------------------------------------------------------------
create table if not exists public.action_guide_channels (
  owner_id                     uuid not null,
  case_id                      uuid not null,
  verification_run_id          uuid not null,
  action_guide_id              uuid not null,
  official_channel_registry_id uuid not null,
  action_no                    integer not null,
  display_order                integer not null,
  created_at                   timestamptz not null default now(),

  constraint pk_action_guide_channels
    primary key (action_guide_id, official_channel_registry_id, action_no),
  constraint fk_action_guide_channels__guide
    foreign key (action_guide_id, owner_id, case_id, verification_run_id)
    references public.action_guides (id, owner_id, case_id, verification_run_id) on delete cascade,
  constraint fk_action_guide_channels__registry
    foreign key (official_channel_registry_id) references kb.official_channel_registry (id),
  constraint ck_action_guide_channels__orders
    check (action_no > 0 and display_order > 0)
);

-- 참조한 채널이 유효기간 안에 있고 Guide 의 action_no 가 실제로 존재하는지
-- 본다 (명세 6.5 Finalization 검사의 표 수준 부분).
create or replace function private.check_guide_channel() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  valid_from date;
  valid_to date;
  action_count integer;
begin
  select r.valid_from, r.valid_to into valid_from, valid_to
    from kb.official_channel_registry r where r.id = new.official_channel_registry_id;
  if (valid_from is not null and valid_from > current_date)
     or (valid_to is not null and valid_to < current_date) then
    raise exception '유효기간 밖의 공식 채널을 Guide 에 연결할 수 없다'
      using errcode = 'check_violation';
  end if;
  select jsonb_array_length(g.actions) into action_count
    from public.action_guides g where g.id = new.action_guide_id;
  if new.action_no > coalesce(action_count, 0) then
    raise exception 'Guide 에 없는 action_no % 를 채널에 연결할 수 없다', new.action_no
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_guide_channel() from public, anon, authenticated;

drop trigger if exists trg_action_guide_channels__valid on public.action_guide_channels;
create trigger trg_action_guide_channels__valid
  before insert on public.action_guide_channels
  for each row execute function private.check_guide_channel();

-- ------------------------------------------------------------
-- 5. public.evidence_passports (명세 6.5)
-- ------------------------------------------------------------
create table if not exists public.evidence_passports (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null,
  case_id                  uuid not null,
  verification_run_id      uuid not null,
  passport_version_no      integer not null,
  previous_passport_id     uuid,
  profile_version_id       uuid not null,
  execution_manifest_id    uuid not null,
  action_guide_id          uuid,
  overall_result           public.overall_result not null,
  coverage_satisfied       boolean not null,
  passport_schema_version  text not null,
  manifest                 jsonb not null,
  payload_hash             text not null,
  created_at               timestamptz not null default now(),

  constraint fk_evidence_passports__run
    foreign key (verification_run_id, owner_id, case_id)
    references public.verification_runs (id, owner_id, case_id) on delete cascade,
  constraint fk_evidence_passports__previous
    foreign key (previous_passport_id, owner_id, case_id)
    references public.evidence_passports (id, owner_id, case_id) on delete cascade,
  constraint fk_evidence_passports__profile_version
    foreign key (profile_version_id, owner_id)
    references public.financial_profile_versions (id, owner_id) on delete restrict,
  constraint fk_evidence_passports__manifest
    foreign key (execution_manifest_id) references private.execution_manifests (id),
  -- Guide 는 같은 Run 의 것이어야 한다.
  constraint fk_evidence_passports__guide
    foreign key (action_guide_id, owner_id, case_id, verification_run_id)
    references public.action_guides (id, owner_id, case_id, verification_run_id),

  constraint uq_evidence_passports__case_version unique (case_id, passport_version_no),
  constraint uq_evidence_passports__id_owner_case unique (id, owner_id, case_id),

  constraint ck_evidence_passports__version_no check (passport_version_no > 0),
  constraint ck_evidence_passports__no_self_previous
    check (previous_passport_id is null or previous_passport_id <> id),
  constraint ck_evidence_passports__schema_len
    check (octet_length(passport_schema_version) between 1 and 32),
  constraint ck_evidence_passports__manifest_object
    check (jsonb_typeof(manifest) = 'object' and manifest ? 'schema_version'),
  constraint ck_evidence_passports__payload_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  -- 특별한 위험 신호 없음은 Coverage 충족이 전제다 (요구사항 2.2, 명세 6.5).
  constraint ck_evidence_passports__no_risk_requires_coverage
    check (overall_result <> 'NO_SPECIAL_RISK_IN_VERIFIED_SCOPE' or coverage_satisfied)
);

comment on table public.evidence_passports is
  '불변 Passport 버전. is_latest 를 두지 않고 financial_cases.latest_passport_id 를 쓴다 (명세 6.5)';

-- Passport 가 적은 Manifest·Profile Snapshot 은 Run 이 시작할 때 고정한
-- 값과 같아야 한다. 결과가 다른 실행 명세를 가리키는 것을 막는다.
create or replace function private.check_passport_pins() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_manifest uuid;
  run_profile uuid;
begin
  select r.execution_manifest_id, r.profile_version_id into run_manifest, run_profile
    from public.verification_runs r where r.id = new.verification_run_id;
  if run_manifest is distinct from new.execution_manifest_id
     or run_profile is distinct from new.profile_version_id then
    raise exception 'Passport 의 Manifest·Profile Snapshot 이 Run 이 고정한 값과 다르다'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_passport_pins() from public, anon, authenticated;

drop trigger if exists trg_evidence_passports__pins on public.evidence_passports;
create trigger trg_evidence_passports__pins
  before insert on public.evidence_passports
  for each row execute function private.check_passport_pins();

create index if not exists idx_evidence_passports__case_created
  on public.evidence_passports (case_id, created_at desc);

-- ------------------------------------------------------------
-- 6. financial_cases.latest_passport_id 교차 소유 FK (0004 보완)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_financial_cases__latest_passport') then
    alter table public.financial_cases
      add constraint fk_financial_cases__latest_passport
      foreign key (latest_passport_id, owner_id, id)
      references public.evidence_passports (id, owner_id, case_id);
  end if;
end
$$;

-- ------------------------------------------------------------
-- 7. 불변성 Trigger (명세 7.4)
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['verification_axis_results', 'action_guides',
                           'action_guide_channels', 'evidence_passports'] loop
    execute format('drop trigger if exists trg_%s__reject_update on public.%I', t, t);
    execute format('create trigger trg_%s__reject_update before update on public.%I '
                   'for each row execute function private.reject_update()', t, t);
  end loop;
end
$$;

drop trigger if exists trg_verification_axis_results__reject_direct_delete on public.verification_axis_results;
create trigger trg_verification_axis_results__reject_direct_delete before delete on public.verification_axis_results
  for each row execute function private.reject_direct_delete('public', 'verification_runs', 'verification_run_id');
drop trigger if exists trg_action_guides__reject_direct_delete on public.action_guides;
create trigger trg_action_guides__reject_direct_delete before delete on public.action_guides
  for each row execute function private.reject_direct_delete('public', 'verification_runs', 'verification_run_id');
drop trigger if exists trg_action_guide_channels__reject_direct_delete on public.action_guide_channels;
create trigger trg_action_guide_channels__reject_direct_delete before delete on public.action_guide_channels
  for each row execute function private.reject_direct_delete('public', 'action_guides', 'action_guide_id');
-- Passport 삭제권 보존: UPDATE 만 막고 승인된 Case purge 의 Cascade 는 허용한다 (명세 7.1).
drop trigger if exists trg_evidence_passports__reject_direct_delete on public.evidence_passports;
create trigger trg_evidence_passports__reject_direct_delete before delete on public.evidence_passports
  for each row execute function private.reject_direct_delete('public', 'financial_cases', 'case_id');

-- ------------------------------------------------------------
-- 8. RLS 와 Grant (명세 9.1, 9.2)
--    Passport·축 결과·Guide 는 회원 본인 SELECT 를 허용한다. Raw Prompt 나
--    내부 Lease 가 없는 사용자용 결과이기 때문이다. Worker 는 INSERT·SELECT.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['verification_axis_results', 'action_guides',
                           'action_guide_channels', 'evidence_passports'] loop
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
