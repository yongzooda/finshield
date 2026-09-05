-- ============================================================
-- 0014 Budget·Rate·Audit·Source Cache·Circuit (명세 6.9, 6.11, 7.2, 15절 12번 묶음)
--
-- 대상: private.budget_limits, private.usage_budget_counters,
--       private.usage_reservations, private.usage_reservation_counters,
--       private.rate_limit_buckets, private.audit_events,
--       private.source_cache_entries, private.provider_circuits
--
-- 함수: reserve·settle·release·reconcile 예산, Rate 소비, Provider 직렬화
--       (1 TPS), Circuit Breaker, Source Cache 갱신·조회, 감사 기록,
--       Budget·Audit Retention
--
-- 원칙 (ADR 10, 요구사항 N-OPS-003·SEC-OPS-003):
--  - 예약은 day·owner·case·run 행을 한 Transaction 에서 잠그고 원자적으로
--    반영한다. Cap 을 넘는 신규 예약은 0건이다.
--  - 상한 설정이 없는 범위는 무제한이 아니라 fail-closed 다.
--  - 실제 사용량이 불명확하면 예약을 유지하고 대조 대상으로 표시한다.
--  - 감사 행은 Code 와 숫자만 담는다. 자유 문자열 열이 없어 PII 가 들어갈
--    자리가 없다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. private.budget_limits (운영 설정, 명세 6.9 보완)
-- ------------------------------------------------------------
create table if not exists private.budget_limits (
  id               uuid primary key default gen_random_uuid(),
  scope_type       text not null,
  provider         text not null,
  model            text not null default '*',
  limit_microunits bigint not null,
  policy_version   text not null,
  updated_at       timestamptz not null default now(),

  constraint uq_budget_limits__scope unique (scope_type, provider, model),
  constraint ck_budget_limits__scope_type
    check (scope_type in ('GLOBAL_DAY', 'OWNER_DAY', 'CASE', 'RUN')),
  constraint ck_budget_limits__provider check (provider ~ '^[a-z0-9_.-]{1,64}$'),
  constraint ck_budget_limits__model check (model = '*' or model ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  constraint ck_budget_limits__limit check (limit_microunits >= 0),
  constraint ck_budget_limits__policy_len check (octet_length(policy_version) between 1 and 64)
);

comment on table private.budget_limits is
  '범위별 예산 상한. 정확한 model 행이 없으면 * 행을 쓰고, 그것도 없으면 예약을 거부한다 (fail-closed)';

drop trigger if exists trg_budget_limits__updated_at on private.budget_limits;
create trigger trg_budget_limits__updated_at
  before update on private.budget_limits
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------
-- 2. private.usage_budget_counters (명세 6.9)
-- ------------------------------------------------------------
create table if not exists private.usage_budget_counters (
  id                  uuid primary key default gen_random_uuid(),
  scope_type          text not null,
  scope_key           text not null,
  provider            text not null,
  model               text not null,
  period_start        timestamptz not null,
  period_end          timestamptz not null,
  limit_microunits    bigint not null,
  reserved_microunits bigint not null default 0,
  consumed_microunits bigint not null default 0,
  updated_at          timestamptz not null default now(),

  constraint uq_usage_budget_counters__scope
    unique (scope_type, scope_key, provider, model, period_start),
  constraint ck_usage_budget_counters__scope_type
    check (scope_type in ('GLOBAL_DAY', 'OWNER_DAY', 'CASE', 'RUN')),
  constraint ck_usage_budget_counters__scope_key_len check (octet_length(scope_key) between 1 and 128),
  constraint ck_usage_budget_counters__period check (period_end > period_start),
  constraint ck_usage_budget_counters__amounts
    check (limit_microunits >= 0 and reserved_microunits >= 0 and consumed_microunits >= 0)
);

comment on table private.usage_budget_counters is
  '호출 전 원자 예약 원장. reserved 는 예약 중, consumed 는 정산된 실제 비용이다 (명세 6.9)';

drop trigger if exists trg_usage_budget_counters__updated_at on private.usage_budget_counters;
create trigger trg_usage_budget_counters__updated_at
  before update on private.usage_budget_counters
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------
-- 3. private.usage_reservations, private.usage_reservation_counters (명세 6.9, ADR 10.2)
-- ------------------------------------------------------------
create table if not exists private.usage_reservations (
  id                          uuid primary key default gen_random_uuid(),
  run_id                      uuid not null,
  agent_run_id                uuid,
  tool_run_id                 uuid,
  provider                    text not null,
  model                       text not null,
  pricing_version             text not null,
  estimated_microunits        bigint not null,
  actual_microunits           bigint,
  status                      text not null default 'RESERVED',
  reconcile_required          boolean not null default false,
  input_tokens                bigint,
  output_tokens               bigint,
  cache_creation_input_tokens bigint,
  cache_read_input_tokens     bigint,
  elapsed_ms                  integer,
  status_category             text,
  retry_count                 integer,
  provider_request_ref        text,
  error_code                  text,
  expires_at                  timestamptz not null,
  created_at                  timestamptz not null default now(),
  settled_at                  timestamptz,

  constraint fk_usage_reservations__run
    foreign key (run_id) references public.verification_runs (id) on delete cascade,
  constraint fk_usage_reservations__agent_run
    foreign key (agent_run_id) references public.agent_runs (id) on delete cascade,
  constraint fk_usage_reservations__tool_run
    foreign key (tool_run_id) references public.tool_runs (id) on delete cascade,

  constraint ck_usage_reservations__status check (status in ('RESERVED', 'SETTLED', 'RELEASED')),
  constraint ck_usage_reservations__estimate check (estimated_microunits > 0),
  constraint ck_usage_reservations__actual check (actual_microunits is null or actual_microunits >= 0),
  constraint ck_usage_reservations__settled_pairing
    check ((status = 'SETTLED') = (settled_at is not null)
           and (status <> 'SETTLED' or actual_microunits is not null)),
  constraint ck_usage_reservations__tokens
    check (coalesce(input_tokens, 0) >= 0 and coalesce(output_tokens, 0) >= 0
           and coalesce(cache_creation_input_tokens, 0) >= 0 and coalesce(cache_read_input_tokens, 0) >= 0
           and coalesce(elapsed_ms, 0) >= 0 and coalesce(retry_count, 0) >= 0),
  constraint ck_usage_reservations__status_category
    check (status_category is null or status_category in ('OK', 'RATE_LIMITED', 'TIMEOUT', 'REFUSAL', 'SCHEMA_ERROR', 'PROVIDER_ERROR')),
  -- Provider request ID 의 비민감 부분만. 원문·Secret 이 들어갈 길이를 주지 않는다.
  constraint ck_usage_reservations__request_ref
    check (provider_request_ref is null or provider_request_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint ck_usage_reservations__codes_len
    check ((error_code is null or octet_length(error_code) <= 64)
           and octet_length(pricing_version) between 1 and 64),
  constraint ck_usage_reservations__expires check (expires_at > created_at)
);

comment on table private.usage_reservations is
  '예약과 정산. timeout 처럼 사용량이 불명확하면 RESERVED 를 유지하고 reconcile_required 로 표시한다 (ADR 10.2)';

create index if not exists idx_usage_reservations__run on private.usage_reservations (run_id);
create index if not exists idx_usage_reservations__agent_run on private.usage_reservations (agent_run_id);
create index if not exists idx_usage_reservations__tool_run on private.usage_reservations (tool_run_id);
create index if not exists idx_usage_reservations__open
  on private.usage_reservations (expires_at) where status = 'RESERVED';

create table if not exists private.usage_reservation_counters (
  reservation_id uuid not null,
  counter_id     uuid not null,
  microunits     bigint not null,
  primary key (reservation_id, counter_id),
  constraint fk_usage_reservation_counters__reservation
    foreign key (reservation_id) references private.usage_reservations (id) on delete cascade,
  constraint fk_usage_reservation_counters__counter
    foreign key (counter_id) references private.usage_budget_counters (id) on delete restrict,
  constraint ck_usage_reservation_counters__amount check (microunits > 0)
);
create index if not exists idx_usage_reservation_counters__counter on private.usage_reservation_counters (counter_id);

-- ------------------------------------------------------------
-- 4. private.rate_limit_buckets (명세 6.9, SEC-OPS-003)
-- ------------------------------------------------------------
create table if not exists private.rate_limit_buckets (
  scope_type   text not null,
  scope_key    text not null,
  operation    text not null,
  window_start timestamptz not null,
  window_end   timestamptz not null,
  count        integer not null default 0,
  limit_value  integer not null,
  updated_at   timestamptz not null default now(),

  primary key (scope_type, scope_key, operation, window_start),
  constraint ck_rate_limit_buckets__scope_type
    check (scope_type in ('OWNER', 'IP_HMAC', 'CASE', 'TOOL', 'GLOBAL')),
  constraint ck_rate_limit_buckets__scope_key_len check (octet_length(scope_key) between 1 and 128),
  constraint ck_rate_limit_buckets__operation check (operation ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_rate_limit_buckets__window check (window_end > window_start),
  constraint ck_rate_limit_buckets__count check (count >= 0 and limit_value > 0 and count <= limit_value)
);

comment on table private.rate_limit_buckets is
  '다층 Rate 원장. IP 는 회전 Salt HMAC 만 두고 24시간 안에 지운다 (명세 6.9)';

drop trigger if exists trg_rate_limit_buckets__updated_at on private.rate_limit_buckets;
create trigger trg_rate_limit_buckets__updated_at
  before update on private.rate_limit_buckets
  for each row execute function private.set_updated_at();

create index if not exists idx_rate_limit_buckets__window_end on private.rate_limit_buckets (window_end);

-- ------------------------------------------------------------
-- 5. private.audit_events (명세 6.9, D-020)
--    자유 문자열 열이 없다. Code 는 대문자 식별자, 나머지는 UUID·숫자다.
--    사용자 표 FK 를 두지 않아 Case 삭제 뒤에도 90일 남는다.
-- ------------------------------------------------------------
create table if not exists private.audit_events (
  id             uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  event_code     text not null,
  actor_type     text not null,
  owner_ref      uuid,
  case_id        uuid,
  run_id         uuid,
  agent_run_id   uuid,
  tool_run_id    uuid,
  status_code    text not null,
  error_code     text,
  duration_ms    integer,
  created_at     timestamptz not null default now(),

  constraint ck_audit_events__event_code check (event_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_audit_events__actor_type check (actor_type in ('USER', 'SYSTEM', 'AGENT', 'WORKER')),
  constraint ck_audit_events__status_code check (status_code ~ '^[A-Z0-9_]{1,32}$'),
  constraint ck_audit_events__error_code check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_audit_events__duration check (duration_ms is null or duration_ms >= 0)
);

comment on table private.audit_events is
  '원문·PII·Secret 없는 운영 Trace. created_at 은 서버 기본값만 쓴다 (명세 6.9)';

drop trigger if exists trg_audit_events__reject_update on private.audit_events;
create trigger trg_audit_events__reject_update before update on private.audit_events
  for each row execute function private.reject_update();

create index if not exists idx_audit_events__correlation on private.audit_events (correlation_id, created_at);
create index if not exists idx_audit_events__created on private.audit_events (created_at);

-- ------------------------------------------------------------
-- 6. private.source_cache_entries (명세 6.11, 11.3)
-- ------------------------------------------------------------
create table if not exists private.source_cache_entries (
  source_adapter     text not null,
  cache_key          text not null,
  source_snapshot_id uuid,
  retrieved_at       timestamptz not null default now(),
  fresh_until        timestamptz,
  expires_at         timestamptz not null,
  status             text not null,
  last_error_code    text,
  updated_at         timestamptz not null default now(),

  primary key (source_adapter, cache_key),
  constraint fk_source_cache_entries__snapshot
    foreign key (source_snapshot_id) references kb.source_snapshots (id),
  constraint ck_source_cache_entries__adapter check (source_adapter ~ '^[a-z0-9_.-]{1,64}$'),
  constraint ck_source_cache_entries__key_len check (octet_length(cache_key) between 1 and 512),
  -- FRESH·STALE 는 Snapshot 을 가리키고, MISS·EMPTY 는 없으며, ERROR 는 Code 가 필수다.
  constraint ck_source_cache_entries__status check (status in ('FRESH', 'STALE', 'MISS', 'EMPTY', 'ERROR')),
  constraint ck_source_cache_entries__snapshot_by_status
    check ((status in ('FRESH', 'STALE') and source_snapshot_id is not null)
           or (status in ('MISS', 'EMPTY') and source_snapshot_id is null)
           or status = 'ERROR'),
  constraint ck_source_cache_entries__fresh_until
    check (status <> 'FRESH' or (fresh_until is not null and fresh_until > retrieved_at)),
  constraint ck_source_cache_entries__error_code
    check ((status = 'ERROR') = (last_error_code is not null)),
  constraint ck_source_cache_entries__error_code_len check (last_error_code is null or octet_length(last_error_code) <= 64),
  constraint ck_source_cache_entries__expires check (expires_at > retrieved_at)
);

comment on table private.source_cache_entries is
  '가변 Cache Pointer. 본문을 UPDATE 하지 않고 새 kb.source_snapshots 를 가리킨다 (명세 6.11)';

drop trigger if exists trg_source_cache_entries__updated_at on private.source_cache_entries;
create trigger trg_source_cache_entries__updated_at
  before update on private.source_cache_entries
  for each row execute function private.set_updated_at();

create index if not exists idx_source_cache_entries__expires on private.source_cache_entries (expires_at);

-- ------------------------------------------------------------
-- 7. private.provider_circuits (명세 6.11, ADR 4.3·10.1)
--    Circuit Breaker 와 Provider 직렬화(1 TPS 등)를 한 행에서 관리한다.
-- ------------------------------------------------------------
create table if not exists private.provider_circuits (
  provider_code   text not null,
  tool_code       text not null default '*',
  state           text not null default 'CLOSED',
  failure_count   integer not null default 0,
  opened_at       timestamptz,
  open_until      timestamptz,
  last_error_code text,
  min_interval_ms integer not null default 0,
  next_allowed_at timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (provider_code, tool_code),
  constraint ck_provider_circuits__provider check (provider_code ~ '^[a-z0-9_.-]{1,64}$'),
  constraint ck_provider_circuits__tool check (tool_code = '*' or tool_code ~ '^[a-z0-9_.-]{1,64}$'),
  constraint ck_provider_circuits__state check (state in ('CLOSED', 'OPEN', 'HALF_OPEN')),
  constraint ck_provider_circuits__failure_count check (failure_count >= 0),
  constraint ck_provider_circuits__open_pairing
    check ((state = 'OPEN') = (opened_at is not null and open_until is not null and open_until > opened_at)),
  constraint ck_provider_circuits__error_code_len check (last_error_code is null or octet_length(last_error_code) <= 64),
  constraint ck_provider_circuits__interval check (min_interval_ms between 0 and 60000)
);

comment on table private.provider_circuits is
  'Provider·Tool 별 Circuit Breaker 상태와 직렬화 시각. 다중 인스턴스가 공유한다 (명세 6.11, ADR 10.1)';

drop trigger if exists trg_provider_circuits__updated_at on private.provider_circuits;
create trigger trg_provider_circuits__updated_at
  before update on private.provider_circuits
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------
-- 8. 예산 예약 (명세 7.2, ADR 10.2)
-- ------------------------------------------------------------
create or replace function private.budget_limit_for(p_scope_type text, p_provider text, p_model text)
returns bigint
language sql
security definer
stable
set search_path = ''
as $$
  select l.limit_microunits
    from private.budget_limits l
   where l.scope_type = p_scope_type and l.provider = p_provider and l.model in (p_model, '*')
   order by (l.model = p_model) desc
   limit 1
$$;
revoke all on function private.budget_limit_for(text, text, text) from public, anon, authenticated;

create or replace function private.reserve_usage_budget(
  p_run_id uuid, p_agent_run_id uuid, p_tool_run_id uuid,
  p_provider text, p_model text, p_pricing_version text,
  p_estimated_microunits bigint, p_lease_seconds integer default 300)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.verification_runs%rowtype;
  v_res      uuid;
  v_day      timestamptz := date_trunc('day', now());
  scope      record;
  v_limit    bigint;
  v_counter  uuid;
  v_reserved bigint;
  v_consumed bigint;
begin
  if p_estimated_microunits <= 0 then
    raise exception '예상 비용은 0 보다 커야 한다' using errcode = 'check_violation';
  end if;
  select * into r from public.verification_runs where id = p_run_id for update;
  if not found then
    raise exception 'Run % 이 없다', p_run_id using errcode = 'no_data_found';
  end if;
  if r.status not in ('QUEUED', 'RUNNING') then
    raise exception '종결된 Run 에는 예약할 수 없다' using errcode = 'check_violation';
  end if;

  insert into private.usage_reservations
    (run_id, agent_run_id, tool_run_id, provider, model, pricing_version, estimated_microunits, expires_at)
  values (p_run_id, p_agent_run_id, p_tool_run_id, p_provider, p_model, p_pricing_version,
          p_estimated_microunits, now() + make_interval(secs => p_lease_seconds))
  returning id into v_res;

  -- day·owner·case·run 네 범위를 정해진 순서로 잠근다 (교착 방지).
  for scope in
    select * from (values
      ('GLOBAL_DAY', 'global', v_day, v_day + interval '1 day'),
      ('OWNER_DAY', r.owner_id::text, v_day, v_day + interval '1 day'),
      ('CASE', r.case_id::text, timestamptz '2000-01-01', timestamptz 'infinity'),
      ('RUN', r.id::text, timestamptz '2000-01-01', timestamptz 'infinity')
    ) as s (scope_type, scope_key, period_start, period_end)
    order by 1
  loop
    v_limit := private.budget_limit_for(scope.scope_type, p_provider, p_model);
    if v_limit is null then
      raise exception '예산 상한 설정이 없어 예약을 거부한다: % %/%', scope.scope_type, p_provider, p_model
        using errcode = 'insufficient_privilege', hint = 'BUDGET_LIMIT_MISSING';
    end if;
    insert into private.usage_budget_counters
      (scope_type, scope_key, provider, model, period_start, period_end, limit_microunits)
    values (scope.scope_type, scope.scope_key, p_provider, p_model, scope.period_start, scope.period_end, v_limit)
    on conflict (scope_type, scope_key, provider, model, period_start) do nothing;

    select id, reserved_microunits, consumed_microunits into v_counter, v_reserved, v_consumed
      from private.usage_budget_counters
     where scope_type = scope.scope_type and scope_key = scope.scope_key
       and provider = p_provider and model = p_model and period_start = scope.period_start
     for update;
    if v_reserved + v_consumed + p_estimated_microunits > v_limit then
      raise exception '예산 상한 초과: % (예약 % + 사용 % + 요청 % > 상한 %)',
        scope.scope_type, v_reserved, v_consumed, p_estimated_microunits, v_limit
        using errcode = 'check_violation', hint = 'BUDGET_EXCEEDED';
    end if;
    update private.usage_budget_counters
       set reserved_microunits = reserved_microunits + p_estimated_microunits
     where id = v_counter;
    insert into private.usage_reservation_counters (reservation_id, counter_id, microunits)
    values (v_res, v_counter, p_estimated_microunits);
  end loop;
  return v_res;
end;
$$;
revoke all on function private.reserve_usage_budget(uuid, uuid, uuid, text, text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function private.reserve_usage_budget(uuid, uuid, uuid, text, text, text, bigint, integer)
  to finshield_worker;

create or replace function private.settle_usage_budget(
  p_reservation_id uuid, p_actual_microunits bigint, p_usage jsonb default '{}'::jsonb)
returns private.usage_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  res private.usage_reservations%rowtype;
  rc  record;
begin
  if p_actual_microunits < 0 then
    raise exception '실제 비용은 음수일 수 없다' using errcode = 'check_violation';
  end if;
  select * into res from private.usage_reservations where id = p_reservation_id for update;
  if not found or res.status <> 'RESERVED' then
    raise exception '예약 % 는 정산할 수 없는 상태다', p_reservation_id using errcode = 'check_violation';
  end if;
  for rc in
    select c.counter_id, c.microunits from private.usage_reservation_counters c
     where c.reservation_id = res.id order by c.counter_id
  loop
    update private.usage_budget_counters
       set reserved_microunits = greatest(reserved_microunits - rc.microunits, 0),
           consumed_microunits = consumed_microunits + p_actual_microunits
     where id = rc.counter_id;
  end loop;
  update private.usage_reservations
     set status = 'SETTLED', settled_at = now(), actual_microunits = p_actual_microunits,
         reconcile_required = false,
         input_tokens = (p_usage ->> 'input_tokens')::bigint,
         output_tokens = (p_usage ->> 'output_tokens')::bigint,
         cache_creation_input_tokens = (p_usage ->> 'cache_creation_input_tokens')::bigint,
         cache_read_input_tokens = (p_usage ->> 'cache_read_input_tokens')::bigint,
         elapsed_ms = (p_usage ->> 'elapsed_ms')::integer,
         status_category = p_usage ->> 'status_category',
         retry_count = (p_usage ->> 'retry_count')::integer,
         provider_request_ref = p_usage ->> 'provider_request_ref',
         error_code = p_usage ->> 'error_code'
   where id = res.id
  returning * into res;
  -- 실제 비용이 예상을 넘으면 기록은 하되 경보를 남긴다.
  if p_actual_microunits > res.estimated_microunits then
    insert into private.outbox_events (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
    values ('USAGE_RESERVATION', res.id, 'BUDGET_OVERRUN', 'budget-overrun:' || res.id::text,
            jsonb_build_object('schema_version', '1', 'reservation_id', res.id,
                               'estimated_microunits', res.estimated_microunits,
                               'actual_microunits', p_actual_microunits))
    on conflict (deduplication_key) do nothing;
  end if;
  return res;
end;
$$;
revoke all on function private.settle_usage_budget(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function private.settle_usage_budget(uuid, bigint, jsonb) to finshield_worker;

-- 호출이 시작되지 않았을 때만 예약을 되돌린다.
create or replace function private.release_usage_budget(p_reservation_id uuid, p_error_code text default null)
returns private.usage_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  res private.usage_reservations%rowtype;
  rc  record;
begin
  select * into res from private.usage_reservations where id = p_reservation_id for update;
  if not found or res.status <> 'RESERVED' then
    raise exception '예약 % 는 해제할 수 없는 상태다', p_reservation_id using errcode = 'check_violation';
  end if;
  for rc in
    select c.counter_id, c.microunits from private.usage_reservation_counters c
     where c.reservation_id = res.id order by c.counter_id
  loop
    update private.usage_budget_counters
       set reserved_microunits = greatest(reserved_microunits - rc.microunits, 0)
     where id = rc.counter_id;
  end loop;
  update private.usage_reservations
     set status = 'RELEASED', error_code = p_error_code, reconcile_required = false
   where id = res.id
  returning * into res;
  return res;
end;
$$;
revoke all on function private.release_usage_budget(uuid, text) from public, anon, authenticated;
grant execute on function private.release_usage_budget(uuid, text) to finshield_worker;

-- 사용량이 불명확한 timeout 은 예약을 유지한 채 대조 대상으로 표시한다 (ADR 10.2 의 5).
create or replace function private.flag_usage_reconciliation(p_reservation_id uuid, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.usage_reservations
     set reconcile_required = true, error_code = p_error_code, status_category = 'TIMEOUT'
   where id = p_reservation_id and status = 'RESERVED';
  return found;
end;
$$;
revoke all on function private.flag_usage_reconciliation(uuid, text) from public, anon, authenticated;
grant execute on function private.flag_usage_reconciliation(uuid, text) to finshield_worker;

-- 만료된 예약은 해제하지 않고 대조 대상으로 남긴다. 예산은 보수적으로 잡혀 있다.
create or replace function private.sweep_usage_reservations()
returns table (kind text, affected integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update private.usage_reservations
     set reconcile_required = true, error_code = coalesce(error_code, 'RESERVATION_EXPIRED')
   where status = 'RESERVED' and expires_at <= now() and not reconcile_required;
  get diagnostics n = row_count;
  if n > 0 then
    insert into private.outbox_events (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
    values ('USAGE_RESERVATION', gen_random_uuid(), 'RECONCILIATION_REQUIRED',
            'reconcile:' || to_char(now(), 'YYYYMMDDHH24MI'),
            jsonb_build_object('schema_version', '1', 'expired_reservations', n))
    on conflict (deduplication_key) do nothing;
  end if;
  return query values ('RESERVATION_EXPIRED', n);
end;
$$;
revoke all on function private.sweep_usage_reservations() from public, anon, authenticated;
grant execute on function private.sweep_usage_reservations() to finshield_worker;

-- ------------------------------------------------------------
-- 9. Rate 소비 (명세 6.9, SEC-OPS-003)
-- ------------------------------------------------------------
create or replace function private.consume_rate_limit(
  p_scope_type text, p_scope_key text, p_operation text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
  b       private.rate_limit_buckets%rowtype;
begin
  if p_limit <= 0 or p_window_seconds not between 1 and 86400 then
    raise exception 'Rate 인자 범위 위반' using errcode = 'check_violation';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_end := v_start + make_interval(secs => p_window_seconds);
  insert into private.rate_limit_buckets (scope_type, scope_key, operation, window_start, window_end, limit_value)
  values (p_scope_type, p_scope_key, p_operation, v_start, v_end, p_limit)
  on conflict (scope_type, scope_key, operation, window_start) do nothing;
  select * into b from private.rate_limit_buckets
   where scope_type = p_scope_type and scope_key = p_scope_key and operation = p_operation and window_start = v_start
   for update;
  if b.count >= b.limit_value then
    return query select false, 0, greatest(ceil(extract(epoch from (b.window_end - now())))::integer, 1);
    return;
  end if;
  update private.rate_limit_buckets set count = count + 1
   where scope_type = p_scope_type and scope_key = p_scope_key and operation = p_operation and window_start = v_start;
  return query select true, b.limit_value - b.count - 1, 0;
end;
$$;
revoke all on function private.consume_rate_limit(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function private.consume_rate_limit(text, text, text, integer, integer) to finshield_worker;

-- ------------------------------------------------------------
-- 10. Provider 직렬화와 Circuit Breaker (ADR 4.3, 10.1)
-- ------------------------------------------------------------
-- 다음 허용 시각을 돌려준다. 호출자는 그 시각까지 기다린 뒤 호출한다.
create or replace function private.acquire_provider_slot(
  p_provider_code text, p_tool_code text default '*', p_min_interval_ms integer default 1000)
returns table (scheduled_at timestamptz, circuit_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c private.provider_circuits%rowtype;
  v_at timestamptz;
begin
  insert into private.provider_circuits (provider_code, tool_code, min_interval_ms)
  values (p_provider_code, p_tool_code, p_min_interval_ms)
  on conflict (provider_code, tool_code) do nothing;
  select * into c from private.provider_circuits
   where provider_code = p_provider_code and tool_code = p_tool_code for update;
  if c.state = 'OPEN' then
    if c.open_until > now() then
      raise exception 'Circuit OPEN: % % (% 까지)', p_provider_code, p_tool_code, c.open_until
        using errcode = 'check_violation', hint = 'CIRCUIT_OPEN';
    end if;
    update private.provider_circuits set state = 'HALF_OPEN', opened_at = null, open_until = null
     where provider_code = p_provider_code and tool_code = p_tool_code;
    c.state := 'HALF_OPEN';
  end if;
  v_at := greatest(c.next_allowed_at, now());
  update private.provider_circuits
     set next_allowed_at = v_at + make_interval(secs => greatest(c.min_interval_ms, p_min_interval_ms) / 1000.0)
   where provider_code = p_provider_code and tool_code = p_tool_code;
  return query select v_at, c.state;
end;
$$;
revoke all on function private.acquire_provider_slot(text, text, integer) from public, anon, authenticated;
grant execute on function private.acquire_provider_slot(text, text, integer) to finshield_worker;

create or replace function private.record_provider_outcome(
  p_provider_code text, p_tool_code text, p_ok boolean, p_error_code text default null,
  p_failure_threshold integer default 5, p_open_seconds integer default 60)
returns private.provider_circuits
language plpgsql
security definer
set search_path = ''
as $$
declare
  c private.provider_circuits%rowtype;
begin
  insert into private.provider_circuits (provider_code, tool_code)
  values (p_provider_code, p_tool_code)
  on conflict (provider_code, tool_code) do nothing;
  select * into c from private.provider_circuits
   where provider_code = p_provider_code and tool_code = p_tool_code for update;
  if p_ok then
    update private.provider_circuits
       set state = 'CLOSED', failure_count = 0, opened_at = null, open_until = null, last_error_code = null
     where provider_code = p_provider_code and tool_code = p_tool_code
    returning * into c;
  elsif c.state = 'HALF_OPEN' or c.failure_count + 1 >= p_failure_threshold then
    update private.provider_circuits
       set state = 'OPEN', failure_count = c.failure_count + 1, opened_at = now(),
           open_until = now() + make_interval(secs => p_open_seconds), last_error_code = p_error_code
     where provider_code = p_provider_code and tool_code = p_tool_code
    returning * into c;
  else
    update private.provider_circuits
       set failure_count = c.failure_count + 1, last_error_code = p_error_code
     where provider_code = p_provider_code and tool_code = p_tool_code
    returning * into c;
  end if;
  return c;
end;
$$;
revoke all on function private.record_provider_outcome(text, text, boolean, text, integer, integer)
  from public, anon, authenticated;
grant execute on function private.record_provider_outcome(text, text, boolean, text, integer, integer)
  to finshield_worker;

-- ------------------------------------------------------------
-- 11. Source Cache (명세 11.3)
-- ------------------------------------------------------------
create or replace function private.upsert_source_cache(
  p_adapter text, p_key text, p_status text, p_snapshot_id uuid, p_fresh_until timestamptz,
  p_expires_at timestamptz, p_error_code text default null)
returns private.source_cache_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  e private.source_cache_entries%rowtype;
begin
  insert into private.source_cache_entries
    (source_adapter, cache_key, source_snapshot_id, retrieved_at, fresh_until, expires_at, status, last_error_code)
  values (p_adapter, p_key, p_snapshot_id, now(), p_fresh_until, p_expires_at, p_status, p_error_code)
  on conflict (source_adapter, cache_key) do update
    -- 오류는 마지막 성공 Snapshot 을 지우지 않고 STALE 판단 근거로 남긴다.
    set source_snapshot_id = coalesce(excluded.source_snapshot_id,
                                      case when excluded.status = 'ERROR' then private.source_cache_entries.source_snapshot_id end),
        retrieved_at = case when excluded.status = 'ERROR' then private.source_cache_entries.retrieved_at else excluded.retrieved_at end,
        fresh_until = case when excluded.status = 'ERROR' then private.source_cache_entries.fresh_until else excluded.fresh_until end,
        expires_at = excluded.expires_at,
        status = excluded.status,
        last_error_code = excluded.last_error_code
  returning * into e;
  return e;
end;
$$;
revoke all on function private.upsert_source_cache(text, text, text, uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function private.upsert_source_cache(text, text, text, uuid, timestamptz, timestamptz, text)
  to finshield_worker;

-- 지금 시점의 신선도를 계산해 돌려준다. 본문은 kb.source_snapshots 에서 읽는다.
create or replace function private.read_source_cache(p_adapter text, p_key text)
returns table (source_snapshot_id uuid, effective_status text, retrieved_at timestamptz, last_error_code text)
language sql
security definer
stable
set search_path = ''
as $$
  select e.source_snapshot_id,
         case when e.expires_at <= now() then 'MISS'
              when e.status = 'FRESH' and e.fresh_until > now() then 'FRESH'
              when e.source_snapshot_id is not null then 'STALE'
              else e.status end,
         e.retrieved_at, e.last_error_code
    from private.source_cache_entries e
   where e.source_adapter = p_adapter and e.cache_key = p_key
$$;
revoke all on function private.read_source_cache(text, text) from public, anon, authenticated;
grant execute on function private.read_source_cache(text, text) to finshield_worker;

-- ------------------------------------------------------------
-- 12. 감사 기록과 Retention (명세 6.9, 13.1)
-- ------------------------------------------------------------
create or replace function private.log_audit_event(
  p_correlation_id uuid, p_event_code text, p_actor_type text, p_status_code text,
  p_owner_ref uuid default null, p_case_id uuid default null, p_run_id uuid default null,
  p_agent_run_id uuid default null, p_tool_run_id uuid default null,
  p_error_code text default null, p_duration_ms integer default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into private.audit_events
    (correlation_id, event_code, actor_type, owner_ref, case_id, run_id, agent_run_id, tool_run_id,
     status_code, error_code, duration_ms)
  values (p_correlation_id, p_event_code, p_actor_type, p_owner_ref, p_case_id, p_run_id, p_agent_run_id,
          p_tool_run_id, p_status_code, p_error_code, p_duration_ms)
  returning id
$$;
revoke all on function private.log_audit_event(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function private.log_audit_event(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, text, integer)
  to finshield_worker;

create or replace function private.sweep_budget_audit_retention()
returns table (kind text, affected integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_audit integer; n_res integer; n_rate integer; n_cache integer; n_counter integer;
begin
  delete from private.audit_events where created_at < now() - interval '90 days';
  get diagnostics n_audit = row_count;
  delete from private.usage_reservations
   where status in ('SETTLED', 'RELEASED') and created_at < now() - interval '90 days';
  get diagnostics n_res = row_count;
  -- IP HMAC 은 24시간, 나머지 창도 지나면 의미가 없다.
  delete from private.rate_limit_buckets where window_end < now() - interval '24 hours';
  get diagnostics n_rate = row_count;
  delete from private.source_cache_entries where expires_at < now() - interval '7 days';
  get diagnostics n_cache = row_count;
  -- 일 단위 Counter 는 예약이 남지 않은 것만 13개월 뒤 지운다 (집계 보존 기간).
  delete from private.usage_budget_counters c
   where c.scope_type in ('GLOBAL_DAY', 'OWNER_DAY') and c.period_end < now() - interval '13 months'
     and not exists (select 1 from private.usage_reservation_counters rc where rc.counter_id = c.id);
  get diagnostics n_counter = row_count;
  return query values ('AUDIT_90D', n_audit), ('RESERVATION_90D', n_res), ('RATE_BUCKET_24H', n_rate),
                      ('SOURCE_CACHE_7D', n_cache), ('DAY_COUNTER_13M', n_counter);
end;
$$;
revoke all on function private.sweep_budget_audit_retention() from public, anon, authenticated;
grant execute on function private.sweep_budget_audit_retention() to finshield_worker;

-- ------------------------------------------------------------
-- 13. RLS 와 Grant (명세 9.2)
--     Worker 는 조회만 직접 하고 감소·삭제·정산은 함수로 한다.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['budget_limits', 'usage_budget_counters', 'usage_reservations',
                           'usage_reservation_counters', 'rate_limit_buckets', 'audit_events',
                           'source_cache_entries', 'provider_circuits'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('alter table private.%I force row level security', t);
    execute format('drop policy if exists %s__worker_read on private.%I', t, t);
    execute format('create policy %s__worker_read on private.%I for select to finshield_worker using (true)', t, t);
    execute format('grant select on private.%I to finshield_worker', t);
    execute format('revoke all on private.%I from anon, authenticated', t);
  end loop;
end
$$;
