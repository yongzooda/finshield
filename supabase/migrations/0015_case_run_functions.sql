-- ============================================================
-- 0015 Case·입력·Run·재검증 상태 함수와 검색 함수 (명세 4.2~4.4, 7.2, 9.3, 11.2)
--
-- 함수: snapshot_financial_profile, append_case_event, create_case,
--       transition_financial_case, advance_input_stage,
--       create_verification_run, start_verification_run,
--       fail_verification_run, enqueue_revalidation,
--       claim_revalidation_job, heartbeat_revalidation_job,
--       fail_revalidation_job, cancel_revalidation_job,
--       search_public_knowledge, search_case_knowledge
--
-- 원칙:
--  - 모든 상태 전이는 부모 Case 행을 잠근 뒤 한 경로에서 검증하고
--    case_events 를 같은 Transaction 에 남긴다 (명세 4.2, 12.2).
--  - 입력은 한 번에 한 단계만 전진한다. MASKED 전에는 masked_text 가
--    영속되지 않고 PII BLOCKING 발견이 열려 있으면 MASKED 가 되지 않는다.
--  - Run 시작은 Claim revision·Profile Snapshot·Manifest 를 고정한다.
--    확정된 Claim 이 하나도 없으면 Run 을 만들지 않는다.
--  - Claim 확인·사용자 중단은 원본 Cleanup 을 같은 Transaction 에 만든다 (규칙 4).
--  - 최종화(finalize_verification_run, finalize_revalidation)는 Evidence
--    Policy 검사가 필요해 다음 Migration 에서 만든다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 금융 프로필 Snapshot (명세 6.1)
--    프로필이 없으면 모든 값이 UNSPECIFIED 인 SKIPPED 프로필을 만든다.
--    RUN_STARTED 는 내용이 같으면 최신 Snapshot 을 재사용한다.
-- ------------------------------------------------------------
create or replace function private.snapshot_financial_profile(p_owner_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  fp     public.financial_profiles%rowtype;
  v_snap jsonb;
  v_hash text;
  v_latest_id uuid;
  v_latest_hash text;
  v_id   uuid;
begin
  if p_reason not in ('CASE_CREATED', 'RUN_STARTED', 'PROFILE_UPDATED') then
    raise exception 'Snapshot 사유 위반: %', p_reason using errcode = 'check_violation';
  end if;
  select * into fp from public.financial_profiles where owner_id = p_owner_id for update;
  if not found then
    insert into public.financial_profiles
      (owner_id, schema_version, income_band, debt_burden_band, emergency_fund_band,
       purpose_code, horizon_code, liquidity_need, loss_tolerance, completeness)
    values (p_owner_id, 'v1', 'UNSPECIFIED', 'UNSPECIFIED', 'UNSPECIFIED',
            'UNSPECIFIED', 'UNSPECIFIED', 'UNSPECIFIED', 'UNSPECIFIED', 'SKIPPED')
    returning * into fp;
  end if;
  v_snap := jsonb_build_object(
    'schema_version', fp.schema_version, 'income_band', fp.income_band,
    'debt_burden_band', fp.debt_burden_band, 'emergency_fund_band', fp.emergency_fund_band,
    'purpose_code', fp.purpose_code, 'horizon_code', fp.horizon_code,
    'liquidity_need', fp.liquidity_need, 'loss_tolerance', fp.loss_tolerance,
    'completeness', fp.completeness);
  v_hash := encode(extensions.digest(v_snap::text, 'sha256'), 'hex');
  select id, content_hash into v_latest_id, v_latest_hash
    from public.financial_profile_versions
   where owner_id = p_owner_id and profile_id = fp.id
   order by version_no desc limit 1;
  if p_reason <> 'CASE_CREATED' and v_latest_id is not null and v_latest_hash = v_hash then
    return v_latest_id;
  end if;
  insert into public.financial_profile_versions
    (owner_id, profile_id, version_no, schema_version, snapshot, completeness, content_hash, created_reason)
  values (p_owner_id, fp.id,
          (select coalesce(max(version_no), 0) + 1 from public.financial_profile_versions
            where owner_id = p_owner_id and profile_id = fp.id),
          fp.schema_version, v_snap, fp.completeness, v_hash, p_reason)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.snapshot_financial_profile(uuid, text) from public, anon, authenticated;
grant execute on function private.snapshot_financial_profile(uuid, text) to finshield_worker;

-- ------------------------------------------------------------
-- 2. Case Event 추가. 호출자가 Case 행 잠금을 이미 잡고 있어야 한다.
-- ------------------------------------------------------------
create or replace function private.append_case_event(
  p_owner_id uuid, p_case_id uuid, p_event_type text, p_actor_type text,
  p_from_state text, p_to_state text, p_payload jsonb, p_idempotency_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no bigint;
begin
  select coalesce(max(event_no), 0) + 1 into v_no from public.case_events where case_id = p_case_id;
  insert into public.case_events
    (owner_id, case_id, event_no, event_type, actor_type, from_state, to_state, payload, idempotency_key)
  values (p_owner_id, p_case_id, v_no, p_event_type, p_actor_type, p_from_state, p_to_state,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('schema_version', '1'), p_idempotency_key);
  return v_no;
end;
$$;
revoke all on function private.append_case_event(uuid, uuid, text, text, text, text, jsonb, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. create_case (명세 7.2)
-- ------------------------------------------------------------
create or replace function private.create_case(
  p_owner_id uuid, p_scenario public.case_scenario, p_title_masked text,
  p_idempotency_key text, p_request_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  idem record;
  v_pv uuid;
  v_case uuid;
begin
  if not exists (select 1 from public.profiles where id = p_owner_id) then
    raise exception '소유자 프로필이 없다' using errcode = 'insufficient_privilege';
  end if;
  select * into idem from private.claim_idempotency(p_owner_id, null, 'CREATE_CASE', p_idempotency_key, p_request_hash);
  if not idem.is_new then
    if idem.status = 'SUCCEEDED' then
      return idem.resource_id;
    end if;
    raise exception '같은 요청이 처리 중이거나 실패했다' using errcode = 'unique_violation';
  end if;
  v_pv := private.snapshot_financial_profile(p_owner_id, 'CASE_CREATED');
  insert into public.financial_cases (owner_id, scenario, title_masked, initial_profile_version_id)
  values (p_owner_id, p_scenario, p_title_masked, v_pv)
  returning id into v_case;
  perform private.append_case_event(p_owner_id, v_case, 'CASE_CREATED', 'USER', null, 'DRAFT',
            jsonb_build_object('scenario', p_scenario, 'profile_version_id', v_pv), 'case-created:' || v_case::text);
  perform private.complete_idempotency(idem.record_id, 'SUCCEEDED', 'financial_case', v_case, null);
  return v_case;
end;
$$;
revoke all on function private.create_case(uuid, public.case_scenario, text, text, text) from public, anon, authenticated;
grant execute on function private.create_case(uuid, public.case_scenario, text, text, text) to finshield_worker;

-- ------------------------------------------------------------
-- 4. transition_financial_case (명세 4.2, 7.2)
--    VERIFYING 진입과 VERIFIED 확정은 SYSTEM(Run 함수)만 할 수 있다.
--    STOPPED_BY_USER 는 활성 초기 Run 을 취소하고 원본 Cleanup 을 만든다.
-- ------------------------------------------------------------
create or replace function private.transition_financial_case(
  p_owner_id uuid, p_case_id uuid, p_to public.case_lifecycle,
  p_actor_type text default 'USER', p_reason_code text default null)
returns public.financial_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        public.financial_cases%rowtype;
  v_from   public.case_lifecycle;
  v_resume public.case_resume_state;
  v_has_inputs boolean;
  r record;
  allowed boolean := false;
begin
  if p_actor_type not in ('USER', 'SYSTEM') then
    raise exception 'actor_type 위반' using errcode = 'check_violation';
  end if;
  select * into c from public.financial_cases where id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Case 가 없거나 소유자가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if c.deleted_at is not null then
    raise exception '삭제 중인 Case 는 전이할 수 없다' using errcode = 'check_violation';
  end if;
  v_from := c.lifecycle;
  v_has_inputs := exists (select 1 from public.case_inputs i where i.case_id = c.id);

  allowed := case v_from
    when 'DRAFT' then p_to in ('INPUT_REVIEW', 'STOPPED_BY_USER', 'CLOSED')
    when 'INPUT_REVIEW' then p_to in ('VERIFYING', 'STOPPED_BY_USER', 'CLOSED')
    when 'VERIFYING' then p_to in ('VERIFIED', 'NEED_MORE_INFORMATION', 'INPUT_REVIEW', 'STOPPED_BY_USER')
    when 'NEED_MORE_INFORMATION' then p_to in ('INPUT_REVIEW', 'STOPPED_BY_USER', 'CLOSED')
    when 'STOPPED_BY_USER' then p_to = 'CLOSED' or p_to::text = c.resume_state::text
    when 'VERIFIED' then p_to = 'CLOSED'
    when 'CLOSED' then (p_to = 'DRAFT' and not v_has_inputs) or (p_to = 'INPUT_REVIEW' and v_has_inputs)
    else false end;
  if not allowed then
    raise exception '허용하지 않는 Case 전이: % → %', v_from, p_to using errcode = 'check_violation';
  end if;
  if p_to in ('VERIFYING', 'VERIFIED') and p_actor_type <> 'SYSTEM' then
    raise exception '% 는 Run 함수만 설정한다', p_to using errcode = 'insufficient_privilege';
  end if;
  if p_to = 'VERIFYING' and not v_has_inputs then
    raise exception '입력 없는 Case 는 검증을 시작할 수 없다' using errcode = 'check_violation';
  end if;

  v_resume := null;
  if p_to in ('STOPPED_BY_USER', 'CLOSED') then
    v_resume := case when v_from = 'DRAFT' or (v_from = 'STOPPED_BY_USER' and c.resume_state = 'DRAFT')
                          or (v_from = 'CLOSED' and not v_has_inputs)
                     then 'DRAFT'::public.case_resume_state else 'INPUT_REVIEW'::public.case_resume_state end;
  end if;

  if p_to = 'STOPPED_BY_USER' then
    -- 활성 초기 Run 취소와 원본 Cleanup (규칙 4: 사용자 중단)
    update public.verification_runs
       set status = 'CANCELLED', finished_at = now(), started_at = coalesce(started_at, now()),
           reason_code = 'USER_STOPPED'
     where case_id = c.id and kind = 'INITIAL' and status in ('QUEUED', 'RUNNING');
    for r in select id from private.input_objects where case_id = c.id and deleted_at is null loop
      perform private.enqueue_file_cleanup('INPUT_OBJECT', r.id, 'USER_STOPPED');
    end loop;
    for r in select id from private.ocr_artifacts where case_id = c.id and deleted_at is null loop
      perform private.enqueue_file_cleanup('OCR_ARTIFACT', r.id, 'USER_STOPPED');
    end loop;
    for r in select id from private.case_embeddings where case_id = c.id loop
      perform private.enqueue_file_cleanup('CASE_EMBEDDING', r.id, 'USER_STOPPED');
    end loop;
  end if;

  update public.financial_cases
     set lifecycle = p_to, resume_state = v_resume, lock_version = lock_version + 1
   where id = c.id
  returning * into c;
  perform private.append_case_event(p_owner_id, c.id, 'CASE_LIFECYCLE_CHANGED', p_actor_type,
            v_from::text, p_to::text,
            jsonb_build_object('reason_code', p_reason_code, 'resume_state', v_resume),
            'lifecycle:' || c.id::text || ':' || c.lock_version::text);
  return c;
end;
$$;
revoke all on function private.transition_financial_case(uuid, uuid, public.case_lifecycle, text, text)
  from public, anon, authenticated;
grant execute on function private.transition_financial_case(uuid, uuid, public.case_lifecycle, text, text)
  to finshield_worker;

-- ------------------------------------------------------------
-- 5. advance_input_stage (명세 4.3, 7.2)
-- ------------------------------------------------------------
create or replace function private.advance_input_stage(
  p_owner_id uuid, p_case_id uuid, p_input_id uuid, p_to public.input_stage, p_patch jsonb default '{}'::jsonb)
returns public.case_inputs
language plpgsql
security definer
set search_path = ''
as $$
declare
  c  public.financial_cases%rowtype;
  i  public.case_inputs%rowtype;
  v_pos_from integer;
  v_pos_to   integer;
  r  record;
  n  integer;
  n2 integer;
begin
  if jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'patch 는 object 여야 한다' using errcode = 'check_violation';
  end if;
  select * into c from public.financial_cases where id = p_case_id and owner_id = p_owner_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 가 없거나 삭제 중이다' using errcode = 'insufficient_privilege';
  end if;
  if c.lifecycle not in ('DRAFT', 'INPUT_REVIEW', 'NEED_MORE_INFORMATION') then
    raise exception '% 상태의 Case 에서는 입력을 진행할 수 없다', c.lifecycle using errcode = 'check_violation';
  end if;
  select * into i from public.case_inputs where id = p_input_id and case_id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception '입력이 없거나 Case 가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if i.input_outcome <> 'ACTIVE' then
    raise exception '% 입력은 전진할 수 없다', i.input_outcome using errcode = 'check_violation';
  end if;
  v_pos_from := array_position(enum_range(null::public.input_stage), i.input_stage);
  v_pos_to := array_position(enum_range(null::public.input_stage), p_to);
  if v_pos_to <> v_pos_from + 1 then
    raise exception '입력 단계는 한 번에 한 단계만 전진한다: % → %', i.input_stage, p_to using errcode = 'check_violation';
  end if;

  if p_to = 'VALIDATED' then
    if i.input_type in ('IMAGE', 'PDF') then
      if not exists (select 1 from private.input_objects o
                      where o.case_input_id = i.id and o.slot_state = 'UPLOADED' and o.deleted_at is null) then
        raise exception '업로드가 확인된 객체가 없어 VALIDATED 로 갈 수 없다' using errcode = 'check_violation';
      end if;
      if p_patch ->> 'detected_mime' is null or p_patch ->> 'magic_signature' is null then
        raise exception 'MIME·Magic Byte 검증 결과가 없다' using errcode = 'check_violation';
      end if;
      update public.case_inputs
         set detected_mime = p_patch ->> 'detected_mime', magic_signature = p_patch ->> 'magic_signature',
             declared_mime = coalesce(p_patch ->> 'declared_mime', declared_mime)
       where id = i.id;
    end if;
  elsif p_to = 'EXTRACTED' then
    if i.input_type in ('IMAGE', 'PDF') then
      select count(*) filter (where parse_status = 'SUCCEEDED'),
             count(*) filter (where parse_status = 'PENDING')
        into n, n2 from public.case_input_pages p where p.case_input_id = i.id;
      if n < 1 or n2 > 0 then
        raise exception '성공한 페이지가 없거나 처리 중인 페이지가 있다' using errcode = 'check_violation';
      end if;
    end if;
  elsif p_to = 'MASKED' then
    if p_patch ->> 'masked_text' is null or p_patch ->> 'masked_text_hash' is null or p_patch ->> 'pii_policy_version' is null then
      raise exception '마스킹 결과·Hash·PII 정책 버전이 필요하다' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.case_input_findings f
                where f.case_input_id = i.id and f.severity = 'BLOCKING' and f.resolution = 'OPEN') then
      raise exception '해결되지 않은 BLOCKING 발견이 있어 MASKED 로 갈 수 없다' using errcode = 'check_violation';
    end if;
    update public.case_inputs
       set pii_scan_status = 'PASSED', pii_policy_version = p_patch ->> 'pii_policy_version',
           masked_text = p_patch ->> 'masked_text', masked_text_hash = p_patch ->> 'masked_text_hash',
           input_stage = 'MASKED'
     where id = i.id;
  elsif p_to = 'CLAIM_CONFIRMED' then
    -- 이 입력의 모든 Claim 최신 revision 이 확정 또는 제거여야 하고 확정이 하나 이상이어야 한다.
    select count(*) filter (where not rv.is_removed and rv.user_confirmed),
           count(*) filter (where not rv.is_removed and not rv.user_confirmed)
      into n, n2
      from public.claims cl
      join lateral (select * from public.claim_revisions x where x.claim_id = cl.id order by x.revision_no desc limit 1) rv on true
     where cl.source_input_id = i.id;
    if n < 1 then
      raise exception '사용자가 확정한 Claim 이 없다' using errcode = 'check_violation';
    end if;
    if n2 > 0 then
      raise exception '확정되지 않은 Claim 이 남아 있다' using errcode = 'check_violation';
    end if;
    update public.case_inputs set claim_confirmed_at = coalesce(claim_confirmed_at, now()) where id = i.id;
    -- 규칙 4: Claim 확인 즉시 원본 삭제를 시도한다.
    for r in select id from private.input_objects where case_input_id = i.id and deleted_at is null loop
      perform private.enqueue_file_cleanup('INPUT_OBJECT', r.id, 'CLAIM_CONFIRMED');
    end loop;
    for r in select id from private.ocr_artifacts where case_input_id = i.id and deleted_at is null loop
      perform private.enqueue_file_cleanup('OCR_ARTIFACT', r.id, 'CLAIM_CONFIRMED');
    end loop;
    perform private.append_case_event(p_owner_id, c.id, 'CASE_INPUT_CLAIMS_CONFIRMED', 'USER', null, null,
              jsonb_build_object('case_input_id', i.id, 'confirmed_claims', n), 'claims-confirmed:' || i.id::text);
  elsif p_to = 'RAW_DELETED' then
    if i.raw_delete_status <> 'SUCCEEDED' then
      raise exception '원본 삭제가 확인되지 않아 RAW_DELETED 로 갈 수 없다' using errcode = 'check_violation';
    end if;
  end if;

  update public.case_inputs set input_stage = p_to where id = i.id returning * into i;
  return i;
end;
$$;
revoke all on function private.advance_input_stage(uuid, uuid, uuid, public.input_stage, jsonb)
  from public, anon, authenticated;
grant execute on function private.advance_input_stage(uuid, uuid, uuid, public.input_stage, jsonb)
  to finshield_worker;

-- ------------------------------------------------------------
-- 6. create_verification_run (명세 7.2, 6.3, 6.4)
-- ------------------------------------------------------------
create or replace function private.create_verification_run(
  p_owner_id uuid, p_case_id uuid, p_execution_manifest_id uuid,
  p_idempotency_key text, p_request_hash text,
  p_kind public.verification_run_kind default 'INITIAL', p_revalidation_job_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   public.financial_cases%rowtype;
  m   private.execution_manifests%rowtype;
  v_existing uuid;
  v_existing_hash text;
  v_pv uuid;
  v_run uuid;
  v_deadline interval;
  v_selected integer := 0;
  r record;
begin
  select * into c from public.financial_cases where id = p_case_id and owner_id = p_owner_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 가 없거나 삭제 중이다' using errcode = 'insufficient_privilege';
  end if;
  select id, request_hash into v_existing, v_existing_hash from public.verification_runs
   where owner_id = p_owner_id and case_id = p_case_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    if v_existing_hash <> p_request_hash then
      raise exception '같은 Idempotency Key 에 다른 Payload 가 왔다' using errcode = 'unique_violation';
    end if;
    return v_existing;
  end if;
  select * into m from private.execution_manifests where id = p_execution_manifest_id;
  if not found then
    raise exception '실행 Manifest 가 없다' using errcode = 'no_data_found';
  end if;
  if m.scenario <> c.scenario then
    raise exception 'Manifest 시나리오 % 가 Case 시나리오 % 와 다르다', m.scenario, c.scenario using errcode = 'check_violation';
  end if;
  if p_kind = 'INITIAL' then
    if c.lifecycle <> 'INPUT_REVIEW' then
      raise exception 'INPUT_REVIEW 상태에서만 초기 검증을 시작한다 (현재 %)', c.lifecycle using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.verification_runs where case_id = c.id and kind = 'INITIAL' and status in ('QUEUED', 'RUNNING')) then
      raise exception '활성 초기 Run 이 이미 있다' using errcode = 'unique_violation';
    end if;
  else
    if c.lifecycle <> 'VERIFIED' or c.latest_successful_run_id is null then
      raise exception 'VERIFIED Case 에서만 재검증 Run 을 만든다' using errcode = 'check_violation';
    end if;
    if p_revalidation_job_id is null or not exists (
         select 1 from public.revalidation_jobs j where j.id = p_revalidation_job_id and j.case_id = c.id and j.status = 'RUNNING') then
      raise exception 'RUNNING 재검증 Job 이 필요하다' using errcode = 'check_violation';
    end if;
  end if;
  if not exists (select 1 from public.case_inputs i where i.case_id = c.id and i.input_outcome = 'ACTIVE') then
    raise exception '활성 입력이 없다' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.case_inputs i where i.case_id = c.id and i.input_outcome = 'ACTIVE'
              and i.input_stage in ('QUARANTINED', 'VALIDATED', 'EXTRACTED')) then
    raise exception 'MASKED 이전 입력이 있어 Run 을 만들 수 없다' using errcode = 'check_violation';
  end if;
  v_deadline := case when exists (select 1 from public.case_inputs i where i.case_id = c.id
                                    and i.input_outcome = 'ACTIVE' and i.input_type in ('IMAGE', 'PDF'))
                     then interval '180 seconds' else interval '120 seconds' end;
  v_pv := private.snapshot_financial_profile(p_owner_id, 'RUN_STARTED');

  insert into public.verification_runs
    (owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, parent_run_id,
     revalidation_job_id, idempotency_key, request_hash, correlation_id, deadline_at)
  values (p_owner_id, c.id,
          (select coalesce(max(run_no), 0) + 1 from public.verification_runs where case_id = c.id),
          p_kind, 'QUEUED', v_pv, m.id,
          case when p_kind = 'REVALIDATION' then c.latest_successful_run_id end,
          p_revalidation_job_id, p_idempotency_key, p_request_hash, gen_random_uuid(), now() + v_deadline)
  returning id into v_run;

  -- Claim 최신 revision 고정 (명세 6.3). 제거된 Claim 은 넣지 않는다.
  for r in
    select cl.id as claim_id, rv.id as revision_id, rv.materiality, rv.user_confirmed
      from public.claims cl
      join lateral (select * from public.claim_revisions x where x.claim_id = cl.id order by x.revision_no desc limit 1) rv on true
     where cl.case_id = c.id and not rv.is_removed
  loop
    insert into public.verification_run_claims
      (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, selected_for_verification,
       materiality, confirmation_state, exclusion_reason_code)
    values (p_owner_id, c.id, v_run, r.claim_id, r.revision_id, r.user_confirmed, r.materiality,
            case when r.user_confirmed then 'CONFIRMED' else 'MISSING' end,
            case when r.user_confirmed then null else 'USER_NOT_CONFIRMED' end);
    if r.user_confirmed then v_selected := v_selected + 1; end if;
  end loop;
  if v_selected = 0 then
    raise exception '검증할 확정 Claim 이 없어 Run 을 만들지 않는다' using errcode = 'check_violation';
  end if;

  if p_kind = 'INITIAL' then
    perform private.transition_financial_case(p_owner_id, c.id, 'VERIFYING', 'SYSTEM', 'RUN_CREATED');
  end if;
  perform private.append_case_event(p_owner_id, c.id, 'RUN_CREATED', 'SYSTEM', null, null,
            jsonb_build_object('run_id', v_run, 'kind', p_kind, 'selected_claims', v_selected),
            'run-created:' || v_run::text);
  insert into private.outbox_events (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
  values ('VERIFICATION_RUN', v_run, 'VERIFICATION_RUN_QUEUED', 'run-queued:' || v_run::text,
          jsonb_build_object('schema_version', '1', 'run_id', v_run, 'kind', p_kind))
  on conflict (deduplication_key) do nothing;
  return v_run;
end;
$$;
revoke all on function private.create_verification_run(uuid, uuid, uuid, text, text, public.verification_run_kind, uuid)
  from public, anon, authenticated;
grant execute on function private.create_verification_run(uuid, uuid, uuid, text, text, public.verification_run_kind, uuid)
  to finshield_worker;

create or replace function private.start_verification_run(p_run_id uuid)
returns public.verification_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.verification_runs%rowtype;
begin
  select * into r from public.verification_runs where id = p_run_id for update;
  if not found or r.status <> 'QUEUED' then
    raise exception 'QUEUED Run 만 시작할 수 있다' using errcode = 'check_violation';
  end if;
  update public.verification_runs set status = 'RUNNING', started_at = now() where id = r.id returning * into r;
  return r;
end;
$$;
revoke all on function private.start_verification_run(uuid) from public, anon, authenticated;
grant execute on function private.start_verification_run(uuid) to finshield_worker;

-- 전면 실패: Passport 없이 종결하고 초기 검증이면 Case 를 INPUT_REVIEW 로 되돌린다 (명세 4.4).
create or replace function private.fail_verification_run(p_run_id uuid, p_reason_code text, p_error_code text default null)
returns public.verification_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.verification_runs%rowtype;
  c public.financial_cases%rowtype;
begin
  select * into r from public.verification_runs where id = p_run_id for update;
  if not found or r.status not in ('QUEUED', 'RUNNING') then
    raise exception '활성 Run 만 실패로 종결한다' using errcode = 'check_violation';
  end if;
  select * into c from public.financial_cases where id = r.case_id for update;
  update public.verification_runs
     set status = 'FAILED', finished_at = now(), started_at = coalesce(started_at, now()),
         reason_code = p_reason_code, error_code = p_error_code
   where id = r.id returning * into r;
  if r.kind = 'INITIAL' and c.lifecycle = 'VERIFYING' then
    perform private.transition_financial_case(r.owner_id, r.case_id, 'INPUT_REVIEW', 'SYSTEM', p_reason_code);
  end if;
  perform private.append_case_event(r.owner_id, r.case_id, 'RUN_FAILED', 'SYSTEM', null, null,
            jsonb_build_object('run_id', r.id, 'reason_code', p_reason_code, 'error_code', p_error_code),
            'run-failed:' || r.id::text);
  return r;
end;
$$;
revoke all on function private.fail_verification_run(uuid, text, text) from public, anon, authenticated;
grant execute on function private.fail_verification_run(uuid, text, text) to finshield_worker;

-- ------------------------------------------------------------
-- 7. 재검증 Job: enqueue·claim·heartbeat·fail·cancel (명세 7.2, 4.4, 12.2)
-- ------------------------------------------------------------
create or replace function private.append_revalidation_event(
  p_job_id uuid, p_event_type text, p_payload jsonb, p_fetch_event_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.revalidation_jobs%rowtype;
  v_no integer;
begin
  select * into j from public.revalidation_jobs where id = p_job_id;
  select coalesce(max(event_no), 0) + 1 into v_no from public.revalidation_events where revalidation_job_id = p_job_id;
  insert into public.revalidation_events
    (owner_id, case_id, revalidation_job_id, event_no, event_type, source_fetch_event_id, payload)
  values (j.owner_id, j.case_id, j.id, v_no, p_event_type, p_fetch_event_id,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('schema_version', '1'));
  return v_no;
end;
$$;
revoke all on function private.append_revalidation_event(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.append_revalidation_event(uuid, text, jsonb, uuid) to finshield_worker;

create or replace function private.enqueue_revalidation(
  p_owner_id uuid, p_case_id uuid, p_idempotency_key text, p_request_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.financial_cases%rowtype;
  v_existing uuid;
  v_hash text;
  v_job uuid;
begin
  select * into c from public.financial_cases where id = p_case_id and owner_id = p_owner_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 가 없거나 삭제 중이다' using errcode = 'insufficient_privilege';
  end if;
  select id, request_hash into v_existing, v_hash from public.revalidation_jobs
   where owner_id = p_owner_id and case_id = p_case_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    if v_hash <> p_request_hash then
      raise exception '같은 Idempotency Key 에 다른 Payload 가 왔다' using errcode = 'unique_violation';
    end if;
    return v_existing;
  end if;
  if c.lifecycle <> 'VERIFIED' or c.latest_passport_id is null then
    raise exception 'VERIFIED Case 와 기준 Passport 가 있어야 재검증한다' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.revalidation_jobs j where j.case_id = c.id and j.status in ('QUEUED', 'RUNNING')) then
    raise exception '활성 재검증 Job 이 이미 있다' using errcode = 'unique_violation';
  end if;
  insert into public.revalidation_jobs
    (owner_id, case_id, base_passport_id, status, trigger_type, idempotency_key, request_hash, queued_at)
  values (p_owner_id, c.id, c.latest_passport_id, 'QUEUED', 'MANUAL', p_idempotency_key, p_request_hash, now())
  returning id into v_job;
  insert into private.revalidation_job_runtime (job_id, max_attempts, available_at) values (v_job, 3, now());
  perform private.append_revalidation_event(v_job, 'QUEUED', jsonb_build_object('base_passport_id', c.latest_passport_id));
  perform private.append_case_event(p_owner_id, c.id, 'REVALIDATION_REQUESTED', 'USER', null, null,
            jsonb_build_object('revalidation_job_id', v_job), 'revalidation-requested:' || v_job::text);
  insert into private.outbox_events (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
  values ('REVALIDATION_JOB', v_job, 'REVALIDATION_JOB_QUEUED', 'revalidation-queued:' || v_job::text,
          jsonb_build_object('schema_version', '1', 'job_id', v_job))
  on conflict (deduplication_key) do nothing;
  return v_job;
end;
$$;
revoke all on function private.enqueue_revalidation(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.enqueue_revalidation(uuid, uuid, text, text) to finshield_worker;

-- 취소 요청이 걸린 Job 을 FAILED·USER_CANCELLED 로 종결한다 (명세 4.4). 호출자가 Job 잠금을 잡고 있다.
create or replace function private.settle_revalidation_cancel(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.revalidation_jobs
     set status = 'FAILED', finished_at = now(), started_at = coalesce(started_at, now()),
         reason_code = 'USER_CANCELLED'
   where id = p_job_id and status in ('QUEUED', 'RUNNING');
  update private.revalidation_job_runtime
     set lease_owner = null, lease_token = null, leased_until = null
   where job_id = p_job_id;
  perform private.append_revalidation_event(p_job_id, 'CANCELLED', '{}'::jsonb);
end;
$$;
revoke all on function private.settle_revalidation_cancel(uuid) from public, anon, authenticated;

create or replace function private.claim_revalidation_job(p_worker text, p_lease_seconds integer default 120)
returns table (job_id uuid, lease_token uuid, attempt_no integer, owner_id uuid, case_id uuid, base_passport_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.revalidation_jobs%rowtype;
  rt private.revalidation_job_runtime%rowtype;
begin
  if p_lease_seconds not between 10 and 600 or octet_length(coalesce(p_worker, '')) not between 1 and 128 then
    raise exception 'claim 인자 범위 위반' using errcode = 'check_violation';
  end if;
  select x.* into j
    from public.revalidation_jobs x
    join private.revalidation_job_runtime r on r.job_id = x.id
   where x.status in ('QUEUED', 'RUNNING')
     and r.available_at <= now()
     and r.attempt_no < r.max_attempts
     and (r.leased_until is null or r.leased_until < now())
   order by x.queued_at
   limit 1
   for update of x skip locked;
  if not found then
    return;
  end if;
  if j.cancel_requested_at is not null then
    perform private.settle_revalidation_cancel(j.id);
    return;
  end if;
  update public.revalidation_jobs
     set status = 'RUNNING', started_at = coalesce(started_at, now())
   where id = j.id;
  update private.revalidation_job_runtime
     set lease_owner = p_worker, lease_token = gen_random_uuid(),
         leased_until = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now(),
         attempt_no = revalidation_job_runtime.attempt_no + 1
   where revalidation_job_runtime.job_id = j.id
  returning * into rt;
  perform private.append_revalidation_event(j.id, 'LEASED', jsonb_build_object('attempt_no', rt.attempt_no));
  return query select j.id, rt.lease_token, rt.attempt_no, j.owner_id, j.case_id, j.base_passport_id;
end;
$$;
revoke all on function private.claim_revalidation_job(text, integer) from public, anon, authenticated;
grant execute on function private.claim_revalidation_job(text, integer) to finshield_worker;

create or replace function private.heartbeat_revalidation_job(p_job_id uuid, p_lease_token uuid, p_extend_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.revalidation_job_runtime
     set heartbeat_at = now(), leased_until = now() + make_interval(secs => p_extend_seconds)
   where job_id = p_job_id and lease_token = p_lease_token and leased_until >= now();
  return found;
end;
$$;
revoke all on function private.heartbeat_revalidation_job(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function private.heartbeat_revalidation_job(uuid, uuid, integer) to finshield_worker;

-- Worker 의 명시적 실패 종결. Lease token 이 맞아야 한다. 이전 Passport 와 Case VERIFIED 는 바뀌지 않는다.
create or replace function private.fail_revalidation_job(
  p_job_id uuid, p_lease_token uuid, p_reason_code text, p_error_code text default null)
returns public.revalidation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.revalidation_jobs%rowtype;
begin
  select * into j from public.revalidation_jobs where id = p_job_id for update;
  if not found or j.status <> 'RUNNING' then
    raise exception 'RUNNING Job 만 실패로 종결한다' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from private.revalidation_job_runtime r where r.job_id = j.id and r.lease_token = p_lease_token) then
    raise exception 'Lease token 이 일치하지 않는다' using errcode = 'lock_not_available';
  end if;
  update public.revalidation_jobs
     set status = 'FAILED', finished_at = now(), reason_code = p_reason_code, error_code = p_error_code
   where id = j.id returning * into j;
  update private.revalidation_job_runtime
     set lease_owner = null, lease_token = null, leased_until = null
   where job_id = j.id;
  perform private.append_revalidation_event(j.id, 'FAILED', jsonb_build_object('reason_code', p_reason_code, 'error_code', p_error_code));
  return j;
end;
$$;
revoke all on function private.fail_revalidation_job(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.fail_revalidation_job(uuid, uuid, text, text) to finshield_worker;

create or replace function private.cancel_revalidation_job(p_owner_id uuid, p_job_id uuid)
returns public.revalidation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.revalidation_jobs%rowtype;
  v_leased boolean;
begin
  select * into j from public.revalidation_jobs where id = p_job_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Job 이 없거나 소유자가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if j.status not in ('QUEUED', 'RUNNING') then
    return j;
  end if;
  update public.revalidation_jobs set cancel_requested_at = coalesce(cancel_requested_at, now()) where id = j.id;
  select exists (select 1 from private.revalidation_job_runtime r where r.job_id = j.id and r.leased_until >= now()) into v_leased;
  -- Lease 중이면 Worker 가 다음 확인에서 종결한다. 아니면 지금 종결한다.
  if not v_leased then
    perform private.settle_revalidation_cancel(j.id);
  end if;
  select * into j from public.revalidation_jobs where id = j.id;
  return j;
end;
$$;
revoke all on function private.cancel_revalidation_job(uuid, uuid) from public, anon, authenticated;
grant execute on function private.cancel_revalidation_job(uuid, uuid) to finshield_worker;

-- ------------------------------------------------------------
-- 8. 검색 함수 (명세 9.3, 11.1, 11.2)
--    Manifest 가 고정한 KB Release·Embedding 모델 안에서만 검색한다.
--    Metadata Filter → Keyword·Vector 후보 → Provenance 와 함께 반환.
-- ------------------------------------------------------------
create or replace function private.search_public_knowledge(
  p_execution_manifest_id uuid, p_query_text text, p_query_embedding extensions.vector,
  p_institution_codes text[] default null, p_product_codes text[] default null,
  p_channel_codes text[] default null, p_scenario_code text default null,
  p_as_of date default current_date, p_limit integer default 20)
returns table (
  chunk_id uuid, document_id uuid, source_snapshot_id uuid, kb_release_id uuid,
  document_type text, title text, publisher text, valid_from date, valid_to date,
  source_locator jsonb, chunk_text text, keyword_rank real, vector_distance double precision, matched_by text)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  m   private.execution_manifests%rowtype;
  rel kb.kb_releases%rowtype;
begin
  if p_limit not between 1 and 50 then
    raise exception '후보 수 상한 위반' using errcode = 'check_violation';
  end if;
  if p_query_text is null and p_query_embedding is null then
    raise exception '질의 문자열 또는 Embedding 이 필요하다' using errcode = 'check_violation';
  end if;
  select * into m from private.execution_manifests where id = p_execution_manifest_id;
  if not found then
    raise exception '실행 Manifest 가 없다' using errcode = 'no_data_found';
  end if;
  select * into rel from kb.kb_releases where id = m.kb_release_id;
  if p_query_embedding is not null and (rel.embedding_model is null or m.embedding_model is null) then
    raise exception 'Release 에 Embedding 설정이 없어 Vector 검색을 할 수 없다' using errcode = 'check_violation';
  end if;
  return query
    with filtered as (
      select d.id, d.source_snapshot_id, d.kb_release_id, d.document_type, d.title, d.publisher, d.valid_from, d.valid_to
        from kb.knowledge_documents d
       where d.kb_release_id = m.kb_release_id
         and (p_institution_codes is null or d.institution_codes && p_institution_codes)
         and (p_product_codes is null or d.product_codes && p_product_codes)
         and (p_channel_codes is null or d.channel_codes && p_channel_codes)
         and (p_scenario_code is null or p_scenario_code = any(d.scenario_codes))
         and (d.valid_from is null or d.valid_from <= p_as_of)
         and (d.valid_to is null or d.valid_to >= p_as_of)),
    kw as (
      select c.id as cid, ts_rank(c.search_vector, plainto_tsquery('simple', p_query_text)) as rank
        from kb.knowledge_chunks c join filtered d on d.id = c.knowledge_document_id
       where p_query_text is not null and c.search_vector @@ plainto_tsquery('simple', p_query_text)
       order by rank desc limit p_limit),
    vec as (
      select e.knowledge_chunk_id as cid, (e.embedding operator(extensions.<=>) p_query_embedding) as distance
        from kb.knowledge_embeddings e
        join kb.knowledge_chunks c on c.id = e.knowledge_chunk_id
        join filtered d on d.id = c.knowledge_document_id
       where p_query_embedding is not null
         and e.kb_release_id = m.kb_release_id
         and e.model_id = rel.embedding_model and e.model_version = rel.embedding_model_version
       order by distance limit p_limit),
    merged as (
      select coalesce(kw.cid, vec.cid) as cid, kw.rank, vec.distance,
             case when kw.cid is not null and vec.cid is not null then 'KEYWORD_AND_VECTOR'
                  when kw.cid is not null then 'KEYWORD' else 'VECTOR' end as matched_by
        from kw full outer join vec on vec.cid = kw.cid)
    select c.id, d.id, d.source_snapshot_id, d.kb_release_id, d.document_type, d.title, d.publisher,
           d.valid_from, d.valid_to, c.source_locator, left(c.chunk_text, 4000), mg.rank, mg.distance, mg.matched_by
      from merged mg
      join kb.knowledge_chunks c on c.id = mg.cid
      join filtered d on d.id = c.knowledge_document_id
     order by mg.distance nulls last, mg.rank desc nulls last, c.id;
end;
$$;
revoke all on function private.search_public_knowledge(uuid, text, extensions.vector, text[], text[], text[], text, date, integer)
  from public, anon, authenticated;
grant execute on function private.search_public_knowledge(uuid, text, extensions.vector, text[], text[], text[], text, date, integer)
  to finshield_worker;

create or replace function private.search_case_knowledge(
  p_owner_id uuid, p_case_id uuid, p_query_embedding extensions.vector, p_limit integer default 10)
returns table (embedding_id uuid, case_input_id uuid, page_id uuid, vector_distance double precision)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_owner_id is null or p_case_id is null or p_query_embedding is null then
    raise exception '범위 없는 Vector Query 는 거부한다' using errcode = 'check_violation';
  end if;
  if p_limit not between 1 and 20 then
    raise exception '후보 수 상한 위반' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.financial_cases c where c.id = p_case_id and c.owner_id = p_owner_id and c.deleted_at is null) then
    raise exception 'Case 가 없거나 소유자가 다르다' using errcode = 'insufficient_privilege';
  end if;
  return query
    select e.id, e.case_input_id, e.page_id, (e.embedding operator(extensions.<=>) p_query_embedding)
      from private.case_embeddings e
     where e.owner_id = p_owner_id and e.case_id = p_case_id and e.expires_at > now()
     order by 4, e.id
     limit p_limit;
end;
$$;
revoke all on function private.search_case_knowledge(uuid, uuid, extensions.vector, integer) from public, anon, authenticated;
grant execute on function private.search_case_knowledge(uuid, uuid, extensions.vector, integer) to finshield_worker;
