-- ============================================================
-- 0013 Storage·Cleanup·Outbox·삭제 (명세 6.9, 10, 12, 13, 15절 11번 묶음)
--
-- 대상: storage.buckets 행, storage.objects 정책, private.input_objects
--       Forward-fix, private.file_cleanup_jobs, private.outbox_events,
--       private.idempotency_records, public.deletion_requests,
--       private.deletion_ledger, private.case_embeddings
--
-- 함수: Upload slot 판정, Signed URL 발급 전 확인, Cleanup enqueue·claim·
--       finish, TTL·고아 Sweeper, Case 삭제 요청·Purge, 알림 읽음,
--       Idempotency claim·complete, Outbox claim·finish, 운영 Retention
--
-- 원칙: 원본 삭제 성공은 storage.objects 부재를 다시 조회한 뒤에만 기록한다.
--       접근 차단(access_blocked_at)은 Cleanup enqueue 와 같은 Transaction
--       에서 먼저 일어난다. 삭제 실패는 제한 Retry 뒤 Outbox 경보를 남긴다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Private Bucket (명세 10.1). exports 는 P1 에서 만든다.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finshield-quarantine', 'finshield-quarantine', false, 10485760,
        array['image/jpeg', 'image/png', 'application/pdf']),
       ('finshield-kb', 'finshield-kb', false, null, null)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------
-- 2. private.input_objects Forward-fix (명세 6.2, 10.2, ADR 6.1)
--    경로 구성이 확정됐으므로 <owner>/<case>/<input>/<uuid>.<safe_ext> 를
--    강제하고, one-use upload slot 상태를 둔다.
-- ------------------------------------------------------------
alter table private.input_objects
  add column if not exists slot_state  text not null default 'OPEN',
  add column if not exists uploaded_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_input_objects__object_path_layout') then
    alter table private.input_objects add constraint ck_input_objects__object_path_layout
      check (object_path ~ ('^' || owner_id::text || '/' || case_id::text || '/' || case_input_id::text
                            || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.'
                            || safe_extension || '$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_input_objects__slot_state') then
    alter table private.input_objects add constraint ck_input_objects__slot_state
      check (slot_state in ('OPEN', 'UPLOADED', 'CLOSED'));
  end if;
  -- OPEN 은 업로드 전, UPLOADED 는 서버가 객체를 확인한 뒤, CLOSED 는 업로드 없이 닫힌 slot.
  if not exists (select 1 from pg_constraint where conname = 'ck_input_objects__slot_upload_pairing') then
    alter table private.input_objects add constraint ck_input_objects__slot_upload_pairing
      check ((slot_state <> 'OPEN' or uploaded_at is null)
             and (slot_state <> 'UPLOADED' or uploaded_at is not null));
  end if;
  -- 부재 확인은 접근 차단 뒤에만 온다.
  if not exists (select 1 from pg_constraint where conname = 'ck_input_objects__deleted_after_block') then
    alter table private.input_objects add constraint ck_input_objects__deleted_after_block
      check (deleted_at is null or access_blocked_at is not null);
  end if;
end
$$;

comment on column private.input_objects.slot_state is
  'one-use upload slot. OPEN 상태의 본인 slot 경로에만 storage.objects INSERT 를 허용한다 (ADR 6.1)';

-- ------------------------------------------------------------
-- 3. Upload slot 판정과 storage.objects 정책 (명세 10.2)
--    정책은 authenticated 로 평가되므로 private 을 읽는 SECURITY DEFINER
--    Helper 가 필요하다. private 스키마 USAGE 를 회원에게 주지 않기 위해
--    Helper 만 public 에 두고 본인 slot 여부만 돌려준다.
-- ------------------------------------------------------------
create or replace function public.storage_slot_is_open(p_bucket_id text, p_object_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from private.input_objects o
      join public.financial_cases c on c.id = o.case_id and c.owner_id = o.owner_id
     where o.bucket_id = p_bucket_id
       and o.object_path = p_object_name
       and o.owner_id = (select auth.uid())
       and o.slot_state = 'OPEN'
       and o.access_blocked_at is null
       and o.deleted_at is null
       and o.expires_at > now()
       and c.deleted_at is null
  )
$$;
revoke all on function public.storage_slot_is_open(text, text) from public, anon;
grant execute on function public.storage_slot_is_open(text, text) to authenticated;
comment on function public.storage_slot_is_open(text, text) is
  'storage.objects INSERT 정책용. 호출자 본인의 열린 upload slot 경로인지만 돌려준다';

-- 회원은 본인의 열린 slot 경로에만 객체를 만들 수 있다. SELECT·UPDATE·DELETE
-- 정책은 두지 않으므로 거부된다. 열람은 서버가 발급하는 짧은 Signed URL 이다.
drop policy if exists finshield_quarantine__insert_open_slot on storage.objects;
create policy finshield_quarantine__insert_open_slot on storage.objects
  for insert to authenticated
  with check (bucket_id = 'finshield-quarantine'
              and public.storage_slot_is_open(bucket_id, name));

-- ------------------------------------------------------------
-- 4. private.file_cleanup_jobs (명세 6.9)
-- ------------------------------------------------------------
create table if not exists private.file_cleanup_jobs (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  case_id         uuid not null,
  case_input_id   uuid,
  target_type     text not null,
  target_id       uuid not null,
  reason_code     text not null,
  status          text not null default 'QUEUED',
  idempotency_key text not null,
  lease_token     uuid,
  leased_until    timestamptz,
  heartbeat_at    timestamptz,
  attempt_no      integer not null default 0,
  max_attempts    integer not null default 5,
  available_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  error_code      text,

  constraint fk_file_cleanup_jobs__case
    foreign key (case_id, owner_id) references public.financial_cases (id, owner_id) on delete cascade,
  constraint fk_file_cleanup_jobs__input
    foreign key (case_input_id, owner_id, case_id)
    references public.case_inputs (id, owner_id, case_id) on delete cascade,

  constraint uq_file_cleanup_jobs__idempotency unique (idempotency_key),
  constraint uq_file_cleanup_jobs__target unique (target_type, target_id, reason_code),

  constraint ck_file_cleanup_jobs__target_type
    check (target_type in ('INPUT_OBJECT', 'OCR_ARTIFACT', 'CASE_EMBEDDING')),
  -- OBJECT_MISSING: Sweeper 가 메타데이터만 있고 객체가 없는 경우를 발견해 부재를 기록한다.
  constraint ck_file_cleanup_jobs__reason_code
    check (reason_code in ('CLAIM_CONFIRMED', 'USER_STOPPED', 'CASE_DELETED', 'TTL_EXPIRED', 'OBJECT_MISSING')),
  constraint ck_file_cleanup_jobs__status
    check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  constraint ck_file_cleanup_jobs__attempts
    check (attempt_no >= 0 and max_attempts between 1 and 10 and attempt_no <= max_attempts),
  constraint ck_file_cleanup_jobs__lease_pairing
    check ((lease_token is null) = (leased_until is null)),
  constraint ck_file_cleanup_jobs__running_leased
    check (status <> 'RUNNING' or lease_token is not null),
  constraint ck_file_cleanup_jobs__succeeded_finished
    check (status <> 'SUCCEEDED' or finished_at is not null),
  constraint ck_file_cleanup_jobs__error_code_len
    check (error_code is null or octet_length(error_code) <= 64)
);

comment on table private.file_cleanup_jobs is
  '원본·OCR·Embedding Cleanup 작업. 성공은 storage.objects 부재를 다시 조회한 뒤 기록한다 (명세 6.9, 10.4)';

create index if not exists idx_file_cleanup_jobs__claim
  on private.file_cleanup_jobs (status, available_at) where status in ('QUEUED', 'FAILED');
create index if not exists idx_file_cleanup_jobs__case on private.file_cleanup_jobs (case_id);
create index if not exists idx_file_cleanup_jobs__input on private.file_cleanup_jobs (case_input_id);

-- ------------------------------------------------------------
-- 5. private.outbox_events (명세 6.9, 12.3)
-- ------------------------------------------------------------
create table if not exists private.outbox_events (
  id                uuid primary key default gen_random_uuid(),
  aggregate_type    text not null,
  aggregate_id      uuid not null,
  event_type        text not null,
  deduplication_key text not null,
  payload           jsonb not null,
  status            text not null default 'PENDING',
  attempt_no        integer not null default 0,
  max_attempts      integer not null default 5,
  available_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  delivered_at      timestamptz,
  error_code        text,

  constraint uq_outbox_events__dedup unique (deduplication_key),
  constraint ck_outbox_events__aggregate_type check (aggregate_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_outbox_events__event_type check (event_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_outbox_events__dedup_len check (octet_length(deduplication_key) between 1 and 256),
  constraint ck_outbox_events__payload_object
    check (jsonb_typeof(payload) = 'object' and payload ? 'schema_version'),
  constraint ck_outbox_events__status
    check (status in ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED')),
  constraint ck_outbox_events__attempts
    check (attempt_no >= 0 and max_attempts between 1 and 20 and attempt_no <= max_attempts),
  constraint ck_outbox_events__delivered_pairing
    check ((status = 'DELIVERED') = (delivered_at is not null)),
  constraint ck_outbox_events__error_code_len
    check (error_code is null or octet_length(error_code) <= 64)
);

comment on table private.outbox_events is
  'Transactional Outbox. Passport·Cleanup Commit 과 같은 Transaction 에 들어가고 Dispatcher 실패가 원 결과를 되돌리지 않는다 (명세 12.3)';

create index if not exists idx_outbox_events__dispatch
  on private.outbox_events (status, available_at, created_at) where status in ('PENDING', 'FAILED');

-- ------------------------------------------------------------
-- 6. private.idempotency_records (명세 6.9, 12.1)
-- ------------------------------------------------------------
create table if not exists private.idempotency_records (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid,
  case_id         uuid,
  operation       text not null,
  idempotency_key text not null,
  request_hash    text not null,
  status          text not null default 'PROCESSING',
  resource_type   text,
  resource_id     uuid,
  response_digest text,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_idempotency_records__scope
    unique nulls not distinct (owner_id, operation, case_id, idempotency_key),
  constraint ck_idempotency_records__operation check (operation ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_idempotency_records__key_len check (octet_length(idempotency_key) between 1 and 128),
  constraint ck_idempotency_records__request_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_idempotency_records__status check (status in ('PROCESSING', 'SUCCEEDED', 'FAILED')),
  constraint ck_idempotency_records__resource_pairing
    check ((resource_type is null) = (resource_id is null)),
  constraint ck_idempotency_records__response_digest
    check (response_digest is null or response_digest ~ '^[0-9a-f]{64}$'),
  constraint ck_idempotency_records__expires check (expires_at > created_at)
);

drop trigger if exists trg_idempotency_records__updated_at on private.idempotency_records;
create trigger trg_idempotency_records__updated_at
  before update on private.idempotency_records
  for each row execute function private.set_updated_at();

create index if not exists idx_idempotency_records__expires on private.idempotency_records (expires_at);

-- ------------------------------------------------------------
-- 7. public.deletion_requests, private.deletion_ledger (명세 6.9, 13)
-- ------------------------------------------------------------
create table if not exists public.deletion_requests (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  target_type     text not null,
  target_id       uuid not null,
  status          text not null default 'REQUESTED',
  idempotency_key text not null,
  request_hash    text not null,
  requested_at    timestamptz not null default now(),
  completed_at    timestamptz,
  error_code      text,

  constraint uq_deletion_requests__idempotency unique (owner_id, target_type, idempotency_key),
  constraint ck_deletion_requests__target_type check (target_type in ('CASE', 'ACCOUNT')),
  constraint ck_deletion_requests__status
    check (status in ('REQUESTED', 'ACCESS_BLOCKED', 'CLEANING', 'COMPLETED', 'FAILED')),
  constraint ck_deletion_requests__key_len check (octet_length(idempotency_key) between 1 and 128),
  constraint ck_deletion_requests__request_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_deletion_requests__completed_pairing
    check ((status = 'COMPLETED') = (completed_at is not null)),
  constraint ck_deletion_requests__error_code_len
    check (error_code is null or octet_length(error_code) <= 64)
);

comment on table public.deletion_requests is
  '사용자에게 보이는 삭제 요청. owner_id 는 삭제 뒤에도 남기는 의도적 FK 예외다 (명세 6.9)';

create index if not exists idx_deletion_requests__owner on public.deletion_requests (owner_id, requested_at desc);
create index if not exists idx_deletion_requests__target on public.deletion_requests (target_type, target_id);

create table if not exists private.deletion_ledger (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null,
  target_type         text not null,
  target_hmac         text not null,
  key_version         text not null,
  policy_version      text not null,
  deletion_request_id uuid,
  event_at            timestamptz not null default now(),
  backup_cutoff_at    timestamptz not null,
  retain_until        timestamptz not null,
  deletion_verified_at timestamptz,
  verification_hash   text not null,
  created_at          timestamptz not null default now(),

  constraint uq_deletion_ledger__event
    unique nulls not distinct (deletion_request_id, event_type, target_type, target_hmac),
  constraint ck_deletion_ledger__event_type check (event_type in ('REQUESTED', 'COMPLETED')),
  constraint ck_deletion_ledger__target_type check (target_type in ('CASE', 'ACCOUNT', 'STORAGE_OBJECT')),
  constraint ck_deletion_ledger__target_hmac check (target_hmac ~ '^[0-9a-f]{64}$'),
  constraint ck_deletion_ledger__versions_len
    check (octet_length(key_version) between 1 and 64 and octet_length(policy_version) between 1 and 64),
  constraint ck_deletion_ledger__verified_pairing
    check ((event_type = 'COMPLETED') = (deletion_verified_at is not null)),
  constraint ck_deletion_ledger__verification_hash check (verification_hash ~ '^[0-9a-f]{64}$'),
  -- Backup 최장 보존기간보다 30일 이상 길고 최소 90일이다 (명세 13.1).
  constraint ck_deletion_ledger__retention
    check (retain_until >= backup_cutoff_at + interval '90 days')
);

comment on table private.deletion_ledger is
  'Backup 복원 시 재삭제할 비식별 Tombstone. 원값 대신 환경별 HMAC 만 저장한다 (명세 6.9, 13.4)';

drop trigger if exists trg_deletion_ledger__reject_update on private.deletion_ledger;
create trigger trg_deletion_ledger__reject_update before update on private.deletion_ledger
  for each row execute function private.reject_update();
drop trigger if exists trg_deletion_ledger__reject_delete on private.deletion_ledger;
create trigger trg_deletion_ledger__reject_delete before delete on private.deletion_ledger
  for each row execute function private.reject_delete();

create index if not exists idx_deletion_ledger__hmac on private.deletion_ledger (target_hmac);
create index if not exists idx_deletion_ledger__retain on private.deletion_ledger (retain_until);

-- ------------------------------------------------------------
-- 8. private.case_embeddings (명세 6.9, 11.2)
-- ------------------------------------------------------------
create table if not exists private.case_embeddings (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null,
  case_id             uuid not null,
  case_input_id       uuid not null,
  page_id             uuid,
  model_id            text not null,
  model_version       text not null,
  dimensions          integer not null,
  distance_metric     text not null default 'cosine',
  embedding           extensions.vector(1024) not null,
  masked_content_hash text not null,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),

  constraint fk_case_embeddings__input
    foreign key (case_input_id, owner_id, case_id)
    references public.case_inputs (id, owner_id, case_id) on delete cascade,
  constraint fk_case_embeddings__page
    foreign key (page_id, owner_id, case_id, case_input_id)
    references public.case_input_pages (id, owner_id, case_id, case_input_id) on delete cascade,

  constraint ck_case_embeddings__model_len
    check (octet_length(model_id) between 1 and 64 and octet_length(model_version) between 1 and 64),
  constraint ck_case_embeddings__dimensions check (dimensions = 1024),
  constraint ck_case_embeddings__metric check (distance_metric = 'cosine'),
  constraint ck_case_embeddings__hash check (masked_content_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_case_embeddings__expires
    check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);

comment on table private.case_embeddings is
  '사용자 Case 전용 임시 Vector. 공용 KB 와 물리 분리하고 최대 24시간 뒤 제거한다 (명세 6.9)';

create index if not exists idx_case_embeddings__case on private.case_embeddings (owner_id, case_id);
create index if not exists idx_case_embeddings__expires on private.case_embeddings (expires_at);

-- ------------------------------------------------------------
-- 9. 함수 공통: 부재 확인은 storage.objects 를 RLS 없이 볼 수 있어야
--    의미가 있다. 볼 수 없으면 성공을 기록하지 않고 실패한다 (fail-closed).
-- ------------------------------------------------------------
create or replace function private.assert_can_see_storage_objects() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
                  where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'storage.objects 부재 확인에는 RLS 우회 권한이 필요하다 (현재 %)', current_user
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function private.assert_can_see_storage_objects() from public, anon, authenticated;

-- Preflight 용. Worker 는 storage 스키마를 직접 읽지 않으므로 Bucket 공개 여부만 돌려준다.
create or replace function private.storage_preflight()
returns table (bucket_id text, is_public boolean, file_size_limit bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select b.id, b.public, b.file_size_limit from storage.buckets b where b.id like 'finshield-%' order by b.id
$$;
revoke all on function private.storage_preflight() from public, anon, authenticated;
grant execute on function private.storage_preflight() to finshield_worker;

-- ------------------------------------------------------------
-- 10. Cleanup enqueue (명세 10.4, 12.3)
--     대상 행을 잠그고 접근을 차단한 뒤 Job 과 RAW_DELETE_REQUESTED Outbox 를
--     같은 Transaction 에 남긴다. 같은 대상·이유는 기존 Job 을 돌려준다.
-- ------------------------------------------------------------
create or replace function private.enqueue_file_cleanup(
  p_target_type text, p_target_id uuid, p_reason_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_case  uuid;
  v_input uuid;
  v_job   uuid;
begin
  if p_target_type = 'INPUT_OBJECT' then
    select owner_id, case_id, case_input_id into v_owner, v_case, v_input
      from private.input_objects where id = p_target_id for update;
    if not found then
      raise exception 'INPUT_OBJECT % 가 없다', p_target_id using errcode = 'no_data_found';
    end if;
    update private.input_objects
       set access_blocked_at = coalesce(access_blocked_at, now()),
           slot_state = case when slot_state = 'OPEN' then 'CLOSED' else slot_state end
     where id = p_target_id;
    update public.case_inputs
       set raw_delete_requested_at = coalesce(raw_delete_requested_at, now())
     where id = v_input;
  elsif p_target_type = 'OCR_ARTIFACT' then
    select owner_id, case_id, case_input_id into v_owner, v_case, v_input
      from private.ocr_artifacts where id = p_target_id for update;
    if not found then
      raise exception 'OCR_ARTIFACT % 가 없다', p_target_id using errcode = 'no_data_found';
    end if;
    update private.ocr_artifacts
       set access_blocked_at = coalesce(access_blocked_at, now()),
           status = case when status = 'DELETED' then status else 'DELETE_REQUESTED' end
     where id = p_target_id;
  elsif p_target_type = 'CASE_EMBEDDING' then
    select owner_id, case_id, case_input_id into v_owner, v_case, v_input
      from private.case_embeddings where id = p_target_id for update;
    if not found then
      raise exception 'CASE_EMBEDDING % 가 없다', p_target_id using errcode = 'no_data_found';
    end if;
  else
    raise exception '알 수 없는 target_type %', p_target_type using errcode = 'check_violation';
  end if;

  insert into private.file_cleanup_jobs
    (owner_id, case_id, case_input_id, target_type, target_id, reason_code, idempotency_key)
  values (v_owner, v_case, v_input, p_target_type, p_target_id, p_reason_code,
          p_target_type || ':' || p_target_id::text || ':' || p_reason_code)
  on conflict (target_type, target_id, reason_code) do nothing
  returning id into v_job;
  if v_job is null then
    select id into v_job from private.file_cleanup_jobs
     where target_type = p_target_type and target_id = p_target_id and reason_code = p_reason_code;
    return v_job;
  end if;

  insert into private.outbox_events
    (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
  values ('FILE_CLEANUP_JOB', v_job, 'RAW_DELETE_REQUESTED', 'raw-delete:' || v_job::text,
          jsonb_build_object('schema_version', '1', 'job_id', v_job,
                             'target_type', p_target_type, 'reason_code', p_reason_code))
  on conflict (deduplication_key) do nothing;
  return v_job;
end;
$$;
revoke all on function private.enqueue_file_cleanup(text, uuid, text) from public, anon, authenticated;
grant execute on function private.enqueue_file_cleanup(text, uuid, text) to finshield_worker;

-- ------------------------------------------------------------
-- 11. Cleanup claim·finish (명세 12.2)
-- ------------------------------------------------------------
create or replace function private.claim_file_cleanup_jobs(
  p_limit integer default 10, p_lease_seconds integer default 120)
returns setof private.file_cleanup_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 10 and 600 then
    raise exception 'claim 인자 범위 위반' using errcode = 'check_violation';
  end if;
  return query
    with picked as (
      select j.id
        from private.file_cleanup_jobs j
       where j.status in ('QUEUED', 'FAILED')
         and j.available_at <= now()
         and j.attempt_no < j.max_attempts
         and (j.leased_until is null or j.leased_until < now())
       order by j.available_at
       limit p_limit
       for update skip locked),
    leased as (
      update private.file_cleanup_jobs j
         set status = 'RUNNING',
             lease_token = gen_random_uuid(),
             leased_until = now() + make_interval(secs => p_lease_seconds),
             heartbeat_at = now(),
             attempt_no = j.attempt_no + 1,
             error_code = null
        from picked
       where j.id = picked.id
      returning j.*)
    select * from leased;
  update public.case_inputs i
     set raw_delete_status = 'RUNNING'
   where i.raw_delete_status = 'PENDING'
     and exists (select 1 from private.file_cleanup_jobs j
                  where j.case_input_id = i.id and j.target_type = 'INPUT_OBJECT' and j.status = 'RUNNING');
end;
$$;
revoke all on function private.claim_file_cleanup_jobs(integer, integer) from public, anon, authenticated;
grant execute on function private.claim_file_cleanup_jobs(integer, integer) to finshield_worker;

create or replace function private.finish_file_cleanup_job(
  p_job_id uuid, p_lease_token uuid, p_error_code text default null)
returns private.file_cleanup_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j        private.file_cleanup_jobs%rowtype;
  v_bucket text;
  v_path   text;
  v_input  uuid;
  v_left   integer;
begin
  select * into j from private.file_cleanup_jobs where id = p_job_id for update;
  if not found or j.status <> 'RUNNING' or j.lease_token is distinct from p_lease_token then
    raise exception 'Job % 의 Lease 가 일치하지 않거나 RUNNING 이 아니다', p_job_id
      using errcode = 'lock_not_available';
  end if;

  if p_error_code is null then
    perform private.assert_can_see_storage_objects();
    if j.target_type = 'INPUT_OBJECT' then
      select bucket_id, object_path, case_input_id into v_bucket, v_path, v_input
        from private.input_objects where id = j.target_id for update;
      if exists (select 1 from storage.objects o where o.bucket_id = v_bucket and o.name = v_path) then
        raise exception 'Storage 객체 % 가 아직 있어 삭제 성공을 기록할 수 없다', j.target_id
          using errcode = 'check_violation';
      end if;
      update private.input_objects
         set deleted_at = coalesce(deleted_at, now()),
             slot_state = case when slot_state = 'OPEN' then 'CLOSED' else slot_state end
       where id = j.target_id;
    elsif j.target_type = 'OCR_ARTIFACT' then
      select storage_object_path, case_input_id into v_path, v_input
        from private.ocr_artifacts where id = j.target_id for update;
      if v_path is not null and exists (
           select 1 from storage.objects o where o.bucket_id = 'finshield-quarantine' and o.name = v_path) then
        raise exception 'OCR 임시 객체 % 가 아직 있어 삭제 성공을 기록할 수 없다', j.target_id
          using errcode = 'check_violation';
      end if;
      update private.ocr_artifacts
         set status = 'DELETED', deleted_at = coalesce(deleted_at, now())
       where id = j.target_id;
    else
      delete from private.case_embeddings where id = j.target_id;
      v_input := j.case_input_id;
    end if;

    update private.file_cleanup_jobs
       set status = 'SUCCEEDED', finished_at = now(), lease_token = null, leased_until = null
     where id = j.id;

    -- 입력의 원본·중간물·Embedding 이 모두 사라졌을 때만 원본 삭제 축을 종결한다.
    if v_input is not null then
      select (select count(*) from private.input_objects where case_input_id = v_input and deleted_at is null)
           + (select count(*) from private.ocr_artifacts where case_input_id = v_input and deleted_at is null)
           + (select count(*) from private.case_embeddings where case_input_id = v_input)
        into v_left;
      if v_left = 0 then
        update public.case_inputs
           set raw_delete_status = 'SUCCEEDED',
               raw_deleted_at = coalesce(raw_deleted_at, now()),
               input_stage = case when input_outcome = 'ACTIVE' and claim_confirmed_at is not null
                                  then 'RAW_DELETED'::public.input_stage else input_stage end
         where id = v_input and raw_delete_status <> 'SUCCEEDED';
      end if;
    end if;
  else
    if j.attempt_no >= j.max_attempts then
      update private.file_cleanup_jobs
         set status = 'FAILED', finished_at = now(), error_code = p_error_code,
             lease_token = null, leased_until = null
       where id = j.id;
      -- 접근은 계속 차단된 채다. 운영 경보를 Outbox 로 남긴다 (명세 10.4).
      insert into private.outbox_events
        (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
      values ('FILE_CLEANUP_JOB', j.id, 'RAW_DELETE_EXHAUSTED', 'raw-delete-exhausted:' || j.id::text,
              jsonb_build_object('schema_version', '1', 'job_id', j.id, 'target_type', j.target_type,
                                 'error_code', p_error_code))
      on conflict (deduplication_key) do nothing;
      if j.case_input_id is not null then
        update public.case_inputs set raw_delete_status = 'FAILED'
         where id = j.case_input_id and raw_delete_status in ('PENDING', 'RUNNING');
      end if;
    else
      update private.file_cleanup_jobs
         set status = 'FAILED', error_code = p_error_code, lease_token = null, leased_until = null,
             available_at = now() + make_interval(mins => power(2, j.attempt_no)::integer)
       where id = j.id;
    end if;
  end if;

  select * into j from private.file_cleanup_jobs where id = j.id;
  return j;
end;
$$;
revoke all on function private.finish_file_cleanup_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.finish_file_cleanup_job(uuid, uuid, text) to finshield_worker;

-- ------------------------------------------------------------
-- 12. TTL·고아 Sweeper (명세 10.4)
-- ------------------------------------------------------------
create or replace function private.sweep_expired_raw_objects()
returns table (kind text, affected integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n_input integer := 0;
  n_ocr integer := 0;
  n_embed integer := 0;
  n_orphan integer := 0;
  n_missing integer := 0;
begin
  perform private.assert_can_see_storage_objects();

  for r in select id from private.input_objects where expires_at <= now() and deleted_at is null loop
    perform private.enqueue_file_cleanup('INPUT_OBJECT', r.id, 'TTL_EXPIRED');
    n_input := n_input + 1;
  end loop;
  for r in select id from private.ocr_artifacts where expires_at <= now() and deleted_at is null loop
    perform private.enqueue_file_cleanup('OCR_ARTIFACT', r.id, 'TTL_EXPIRED');
    n_ocr := n_ocr + 1;
  end loop;
  for r in select id from private.case_embeddings where expires_at <= now() loop
    perform private.enqueue_file_cleanup('CASE_EMBEDDING', r.id, 'TTL_EXPIRED');
    n_embed := n_embed + 1;
  end loop;

  -- 객체만 있고 메타데이터가 없는 고아 객체는 경보로 남긴다. 경로에는 UUID 만 있다.
  for r in
    select o.id, o.name
      from storage.objects o
     where o.bucket_id = 'finshield-quarantine'
       and not exists (select 1 from private.input_objects i where i.object_path = o.name)
       and not exists (select 1 from private.ocr_artifacts a where a.storage_object_path = o.name)
  loop
    insert into private.outbox_events (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
    values ('STORAGE_OBJECT', r.id, 'ORPHAN_OBJECT_DETECTED', 'orphan-object:' || r.id::text,
            jsonb_build_object('schema_version', '1', 'bucket_id', 'finshield-quarantine', 'object_path', r.name))
    on conflict (deduplication_key) do nothing;
    n_orphan := n_orphan + 1;
  end loop;

  -- 메타데이터만 있고 객체가 없는 경우는 부재를 기록하는 Cleanup 을 만든다.
  for r in
    select i.id
      from private.input_objects i
     where i.slot_state = 'UPLOADED' and i.deleted_at is null
       and not exists (select 1 from storage.objects o where o.bucket_id = i.bucket_id and o.name = i.object_path)
  loop
    perform private.enqueue_file_cleanup('INPUT_OBJECT', r.id, 'OBJECT_MISSING');
    n_missing := n_missing + 1;
  end loop;

  return query values ('INPUT_OBJECT_TTL', n_input), ('OCR_ARTIFACT_TTL', n_ocr),
                      ('CASE_EMBEDDING_TTL', n_embed), ('ORPHAN_OBJECT', n_orphan),
                      ('OBJECT_MISSING', n_missing);
end;
$$;
revoke all on function private.sweep_expired_raw_objects() from public, anon, authenticated;
grant execute on function private.sweep_expired_raw_objects() to finshield_worker;

-- ------------------------------------------------------------
-- 13. Signed URL 발급 전 확인 (명세 10.3)
--     서버는 이 함수가 돌려준 경로에만 최대 60초 Signed URL 을 만든다.
-- ------------------------------------------------------------
create or replace function private.authorize_input_object_read(p_owner_id uuid, p_input_object_id uuid)
returns table (bucket_id text, object_path text, ttl_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  o private.input_objects%rowtype;
  c public.financial_cases%rowtype;
begin
  perform private.assert_can_see_storage_objects();
  select * into o from private.input_objects where id = p_input_object_id;
  if not found or o.owner_id is distinct from p_owner_id then
    raise exception '객체가 없거나 소유자가 다르다' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.financial_cases where id = o.case_id and owner_id = p_owner_id;
  if not found or c.deleted_at is not null then
    raise exception 'Case 가 없거나 삭제 중이다' using errcode = 'insufficient_privilege';
  end if;
  if o.access_blocked_at is not null or o.deleted_at is not null or o.expires_at <= now()
     or o.slot_state <> 'UPLOADED' then
    raise exception '접근이 차단됐거나 만료·미업로드 객체다' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from storage.objects s where s.bucket_id = o.bucket_id and s.name = o.object_path) then
    raise exception 'Storage 객체가 없다' using errcode = 'no_data_found';
  end if;
  return query select o.bucket_id, o.object_path, 60;
end;
$$;
revoke all on function private.authorize_input_object_read(uuid, uuid) from public, anon, authenticated;
grant execute on function private.authorize_input_object_read(uuid, uuid) to finshield_worker;

-- ------------------------------------------------------------
-- 14. Case 삭제 요청 (명세 13.2 의 1~4단계)
--     HMAC 은 서버가 계산해 넘긴다. Key 는 DB 에 두지 않는다.
-- ------------------------------------------------------------
create or replace function private.request_case_deletion(
  p_owner_id uuid, p_case_id uuid, p_idempotency_key text, p_request_hash text,
  p_target_hmac text, p_key_version text, p_policy_version text,
  p_retain_until timestamptz default now() + interval '120 days')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req   uuid;
  v_hash  text;
  c       public.financial_cases%rowtype;
  r       record;
  n_jobs  integer := 0;
begin
  insert into public.deletion_requests
    (owner_id, target_type, target_id, status, idempotency_key, request_hash)
  values (p_owner_id, 'CASE', p_case_id, 'REQUESTED', p_idempotency_key, p_request_hash)
  on conflict (owner_id, target_type, idempotency_key) do nothing
  returning id into v_req;
  if v_req is null then
    select id, request_hash into v_req, v_hash from public.deletion_requests
     where owner_id = p_owner_id and target_type = 'CASE' and idempotency_key = p_idempotency_key;
    if v_hash <> p_request_hash then
      raise exception '같은 Idempotency Key 에 다른 Payload 가 왔다' using errcode = 'unique_violation';
    end if;
    return v_req;
  end if;

  select * into c from public.financial_cases where id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Case 가 없거나 소유자가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if c.deletion_status = 'ACTIVE' then
    update public.financial_cases set deletion_status = 'PENDING', deleted_at = now() where id = c.id;
  end if;

  update public.verification_runs
     set status = 'CANCELLED', finished_at = now(), reason_code = 'CASE_DELETED',
         started_at = coalesce(started_at, now())
   where case_id = c.id and status in ('QUEUED', 'RUNNING');
  update public.revalidation_jobs
     set cancel_requested_at = coalesce(cancel_requested_at, now())
   where case_id = c.id and status in ('QUEUED', 'RUNNING');
  update public.precase_assessments
     set status = 'CANCELLED', finished_at = now(), reason_code = 'CASE_DELETED'
   where case_id = c.id and status in ('DRAFT', 'RUNNING');

  for r in select id from private.input_objects where case_id = c.id and deleted_at is null loop
    perform private.enqueue_file_cleanup('INPUT_OBJECT', r.id, 'CASE_DELETED'); n_jobs := n_jobs + 1;
  end loop;
  for r in select id from private.ocr_artifacts where case_id = c.id and deleted_at is null loop
    perform private.enqueue_file_cleanup('OCR_ARTIFACT', r.id, 'CASE_DELETED'); n_jobs := n_jobs + 1;
  end loop;
  for r in select id from private.case_embeddings where case_id = c.id loop
    perform private.enqueue_file_cleanup('CASE_EMBEDDING', r.id, 'CASE_DELETED'); n_jobs := n_jobs + 1;
  end loop;

  insert into public.case_events
    (owner_id, case_id, event_no, event_type, actor_type, from_state, to_state, payload, idempotency_key)
  values (p_owner_id, c.id,
          (select coalesce(max(event_no), 0) + 1 from public.case_events where case_id = c.id),
          'CASE_DELETION_REQUESTED', 'USER', c.deletion_status, 'PENDING',
          jsonb_build_object('schema_version', '1', 'deletion_request_id', v_req, 'cleanup_jobs', n_jobs),
          'deletion:' || v_req::text);

  insert into private.deletion_ledger
    (event_type, target_type, target_hmac, key_version, policy_version, deletion_request_id,
     backup_cutoff_at, retain_until, verification_hash)
  values ('REQUESTED', 'CASE', p_target_hmac, p_key_version, p_policy_version, v_req,
          now(), p_retain_until,
          encode(extensions.digest('CASE:' || p_target_hmac || ':REQUESTED:' || p_policy_version
                                   || ':' || n_jobs::text, 'sha256'), 'hex'));

  update public.deletion_requests set status = 'ACCESS_BLOCKED' where id = v_req;
  return v_req;
end;
$$;
revoke all on function private.request_case_deletion(uuid, uuid, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function private.request_case_deletion(uuid, uuid, text, text, text, text, text, timestamptz)
  to finshield_worker;

-- ------------------------------------------------------------
-- 15. Case Purge (명세 13.2 의 5~7단계)
--     객체·중간물·Embedding 부재와 Cleanup 완료를 확인한 뒤에만 관계형
--     자식을 Cascade 삭제한다. 준비가 안 됐으면 false 를 돌려준다.
-- ------------------------------------------------------------
create or replace function private.purge_case(p_deletion_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  req  public.deletion_requests%rowtype;
  c    public.financial_cases%rowtype;
  led  private.deletion_ledger%rowtype;
  n_left integer;
begin
  perform private.assert_can_see_storage_objects();
  select * into req from public.deletion_requests where id = p_deletion_request_id for update;
  if not found or req.target_type <> 'CASE' or req.status not in ('ACCESS_BLOCKED', 'CLEANING', 'FAILED') then
    raise exception '삭제 요청 % 는 Purge 할 상태가 아니다', p_deletion_request_id using errcode = 'check_violation';
  end if;
  select * into c from public.financial_cases where id = req.target_id and owner_id = req.owner_id for update;
  if not found then
    raise exception 'Case 가 이미 없다' using errcode = 'no_data_found';
  end if;
  if c.deletion_status = 'ACTIVE' then
    raise exception '접근 차단 전 Case 는 Purge 할 수 없다' using errcode = 'check_violation';
  end if;

  select (select count(*) from private.input_objects where case_id = c.id and deleted_at is null)
       + (select count(*) from private.ocr_artifacts where case_id = c.id and deleted_at is null)
       + (select count(*) from private.case_embeddings where case_id = c.id)
       -- 재시도가 남은 Job 만 막는다. 소진된 FAILED Job 은 대상 부재 조건이 따로 확인한다.
       + (select count(*) from private.file_cleanup_jobs
           where case_id = c.id
             and (status in ('QUEUED', 'RUNNING') or (status = 'FAILED' and attempt_no < max_attempts)))
       + (select count(*) from storage.objects o
           where o.bucket_id = 'finshield-quarantine'
             and o.name like c.owner_id::text || '/' || c.id::text || '/%')
    into n_left;
  if n_left > 0 then
    update public.deletion_requests set status = 'CLEANING' where id = req.id;
    return false;
  end if;

  update public.financial_cases set deletion_status = 'PURGING' where id = c.id;
  delete from public.financial_cases where id = c.id;

  select * into led from private.deletion_ledger
   where deletion_request_id = req.id and event_type = 'REQUESTED' and target_type = 'CASE';
  if not found then
    raise exception 'REQUESTED Ledger 가 없어 COMPLETED 를 남길 수 없다' using errcode = 'check_violation';
  end if;
  insert into private.deletion_ledger
    (event_type, target_type, target_hmac, key_version, policy_version, deletion_request_id,
     backup_cutoff_at, retain_until, deletion_verified_at, verification_hash)
  values ('COMPLETED', 'CASE', led.target_hmac, led.key_version, led.policy_version, req.id,
          led.backup_cutoff_at, led.retain_until, now(),
          encode(extensions.digest('CASE:' || led.target_hmac || ':COMPLETED:' || led.policy_version, 'sha256'), 'hex'));

  update public.deletion_requests set status = 'COMPLETED', completed_at = now() where id = req.id;
  return true;
end;
$$;
revoke all on function private.purge_case(uuid) from public, anon, authenticated;
grant execute on function private.purge_case(uuid) to finshield_worker;

-- ------------------------------------------------------------
-- 16. 알림 읽음 (명세 7.2)
-- ------------------------------------------------------------
create or replace function private.mark_notification_read(p_owner_id uuid, p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_notification_id and owner_id = p_owner_id;
  return found;
end;
$$;
revoke all on function private.mark_notification_read(uuid, uuid) from public, anon, authenticated;
grant execute on function private.mark_notification_read(uuid, uuid) to finshield_worker;

-- ------------------------------------------------------------
-- 17. Idempotency claim·complete (명세 12.1)
-- ------------------------------------------------------------
create or replace function private.claim_idempotency(
  p_owner_id uuid, p_case_id uuid, p_operation text, p_idempotency_key text, p_request_hash text,
  p_ttl interval default interval '7 days')
returns table (record_id uuid, is_new boolean, status text, resource_type text, resource_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec private.idempotency_records%rowtype;
begin
  insert into private.idempotency_records
    (owner_id, case_id, operation, idempotency_key, request_hash, expires_at)
  values (p_owner_id, p_case_id, p_operation, p_idempotency_key, p_request_hash, now() + p_ttl)
  on conflict (owner_id, operation, case_id, idempotency_key) do nothing
  returning * into rec;
  if rec.id is not null then
    return query select rec.id, true, rec.status, rec.resource_type, rec.resource_id;
    return;
  end if;
  select * into rec from private.idempotency_records
   where owner_id is not distinct from p_owner_id and operation = p_operation
     and case_id is not distinct from p_case_id and idempotency_key = p_idempotency_key;
  if rec.request_hash <> p_request_hash then
    raise exception '같은 Idempotency Key 에 다른 Payload 가 왔다' using errcode = 'unique_violation';
  end if;
  return query select rec.id, false, rec.status, rec.resource_type, rec.resource_id;
end;
$$;
revoke all on function private.claim_idempotency(uuid, uuid, text, text, text, interval) from public, anon, authenticated;
grant execute on function private.claim_idempotency(uuid, uuid, text, text, text, interval) to finshield_worker;

create or replace function private.complete_idempotency(
  p_record_id uuid, p_status text, p_resource_type text default null, p_resource_id uuid default null,
  p_response_digest text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('SUCCEEDED', 'FAILED') then
    raise exception '종결 상태만 기록한다: %', p_status using errcode = 'check_violation';
  end if;
  update private.idempotency_records
     set status = p_status, resource_type = p_resource_type, resource_id = p_resource_id,
         response_digest = p_response_digest
   where id = p_record_id and status = 'PROCESSING';
  return found;
end;
$$;
revoke all on function private.complete_idempotency(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function private.complete_idempotency(uuid, text, text, uuid, text) to finshield_worker;

-- ------------------------------------------------------------
-- 18. Outbox claim·finish (명세 12.3)
-- ------------------------------------------------------------
create or replace function private.claim_outbox_events(p_limit integer default 20)
returns setof private.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 200 then
    raise exception 'claim 인자 범위 위반' using errcode = 'check_violation';
  end if;
  return query
    with picked as (
      select e.id
        from private.outbox_events e
       where e.status in ('PENDING', 'FAILED')
         and e.available_at <= now()
         and e.attempt_no < e.max_attempts
       order by e.available_at, e.created_at
       limit p_limit
       for update skip locked)
    update private.outbox_events e
       set status = 'PROCESSING', attempt_no = e.attempt_no + 1, error_code = null
      from picked
     where e.id = picked.id
    returning e.*;
end;
$$;
revoke all on function private.claim_outbox_events(integer) from public, anon, authenticated;
grant execute on function private.claim_outbox_events(integer) to finshield_worker;

create or replace function private.finish_outbox_event(p_event_id uuid, p_error_code text default null)
returns private.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e private.outbox_events%rowtype;
begin
  select * into e from private.outbox_events where id = p_event_id for update;
  if not found or e.status <> 'PROCESSING' then
    raise exception 'Outbox % 는 PROCESSING 이 아니다', p_event_id using errcode = 'lock_not_available';
  end if;
  if p_error_code is null then
    update private.outbox_events set status = 'DELIVERED', delivered_at = now() where id = e.id;
  else
    update private.outbox_events
       set status = 'FAILED', error_code = p_error_code,
           available_at = now() + make_interval(mins => power(2, e.attempt_no)::integer)
     where id = e.id;
  end if;
  select * into e from private.outbox_events where id = e.id;
  return e;
end;
$$;
revoke all on function private.finish_outbox_event(uuid, text) from public, anon, authenticated;
grant execute on function private.finish_outbox_event(uuid, text) to finshield_worker;

-- ------------------------------------------------------------
-- 19. 운영 Retention Sweeper (명세 13.1)
-- ------------------------------------------------------------
create or replace function private.sweep_operational_retention()
returns table (kind text, affected integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_outbox integer;
  n_idem   integer;
begin
  delete from private.outbox_events
   where status = 'DELIVERED' and delivered_at < now() - interval '30 days';
  get diagnostics n_outbox = row_count;
  delete from private.idempotency_records
   where status <> 'PROCESSING' and expires_at <= now();
  get diagnostics n_idem = row_count;
  return query values ('OUTBOX_DELIVERED_30D', n_outbox), ('IDEMPOTENCY_EXPIRED', n_idem);
end;
$$;
revoke all on function private.sweep_operational_retention() from public, anon, authenticated;
grant execute on function private.sweep_operational_retention() to finshield_worker;

-- ------------------------------------------------------------
-- 20. RLS 와 Grant (명세 9.1, 9.2)
--     Worker 는 함수 경로로만 쓴다. 표 직접 권한은 조회에 한정한다.
-- ------------------------------------------------------------
alter table public.deletion_requests enable row level security;
alter table public.deletion_requests force  row level security;
drop policy if exists deletion_requests__select_own on public.deletion_requests;
create policy deletion_requests__select_own on public.deletion_requests
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists deletion_requests__worker_read on public.deletion_requests;
create policy deletion_requests__worker_read on public.deletion_requests
  for select to finshield_worker using (true);
grant select on public.deletion_requests to authenticated;
grant select on public.deletion_requests to finshield_worker;
revoke all on public.deletion_requests from anon;

do $$
declare
  t text;
begin
  foreach t in array array['file_cleanup_jobs', 'outbox_events', 'idempotency_records',
                           'deletion_ledger', 'case_embeddings'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('alter table private.%I force row level security', t);
    execute format('drop policy if exists %s__worker_read on private.%I', t, t);
    execute format('create policy %s__worker_read on private.%I for select to finshield_worker using (true)', t, t);
    execute format('grant select on private.%I to finshield_worker', t);
    execute format('revoke all on private.%I from anon, authenticated', t);
  end loop;
end
$$;

-- Case Embedding 은 Pipeline 이 직접 쓰고 세션 종료 때 지운다.
drop policy if exists case_embeddings__worker_write on private.case_embeddings;
create policy case_embeddings__worker_write on private.case_embeddings
  for insert to finshield_worker with check (true);
drop policy if exists case_embeddings__worker_delete on private.case_embeddings;
create policy case_embeddings__worker_delete on private.case_embeddings
  for delete to finshield_worker using (true);
grant insert, delete on private.case_embeddings to finshield_worker;
