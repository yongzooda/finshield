-- REV-001·N-AVL-005·N-OPS-004: 만료 Lease의 쓰기를 막고 재시도 소진 Orphan을 종결한다.
--
-- 기존 함수는 lease_token만 비교해, 임대가 만료됐지만 새 Worker가 아직 선점하지 않은
-- 짧은 구간에 오래된 Worker가 실패·최종화를 쓸 수 있었다. 현재 token과 leased_until을
-- 함께 검사하는 wrapper만 Worker에 공개한다. 최대 attempt를 소진한 만료 Job은 더 이상
-- 선점 후보에서 조용히 사라지지 않고, 활성 Run과 함께 FAILED로 종결한다.

alter function private.fail_revalidation_job(uuid, uuid, text, text)
  rename to fail_revalidation_job_without_current_lease_guard;

revoke all on function private.fail_revalidation_job_without_current_lease_guard(uuid, uuid, text, text)
  from public, anon, authenticated, finshield_worker;

create function private.fail_revalidation_job(
  p_job_id uuid, p_lease_token uuid, p_reason_code text, p_error_code text default null)
returns public.revalidation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.revalidation_jobs%rowtype;
begin
  -- 먼저 Job·runtime을 잠근 뒤 현재 시각을 읽는다. now()는 긴 트랜잭션의 시작 시각이다.
  perform 1 from public.revalidation_jobs j where j.id=p_job_id for update;
  perform 1 from private.revalidation_job_runtime rt where rt.job_id=p_job_id for update;
  if not exists (
    select 1 from public.revalidation_jobs j
    join private.revalidation_job_runtime rt on rt.job_id=j.id
    where j.id=p_job_id and j.status='RUNNING' and rt.lease_token=p_lease_token
      and rt.leased_until>clock_timestamp()
  ) then
    raise exception '현재 유효한 재검증 Lease가 아니다' using errcode = 'lock_not_available';
  end if;

  result := private.fail_revalidation_job_without_current_lease_guard(
    p_job_id, p_lease_token, p_reason_code, p_error_code);
  return result;
end
$$;

revoke all on function private.fail_revalidation_job(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.fail_revalidation_job(uuid, uuid, text, text)
  to finshield_worker;

alter function private.finalize_revalidation(uuid, uuid, uuid, jsonb, jsonb, jsonb, text[], text)
  rename to finalize_revalidation_without_current_lease_guard;

revoke all on function private.finalize_revalidation_without_current_lease_guard(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text[], text)
  from public, anon, authenticated, finshield_worker;

create function private.finalize_revalidation(
  p_job_id uuid, p_lease_token uuid, p_run_id uuid,
  p_final_claims jsonb, p_axis_results jsonb, p_guide jsonb default null,
  p_partial_reason_codes text[] default '{}', p_passport_schema_version text default 'p1')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  -- 먼저 Job·runtime을 잠근 뒤 현재 시각을 읽는다. now()는 긴 트랜잭션의 시작 시각이다.
  perform 1 from public.revalidation_jobs j where j.id=p_job_id for update;
  perform 1 from private.revalidation_job_runtime rt where rt.job_id=p_job_id for update;
  if not exists (
    select 1 from public.revalidation_jobs j
    join private.revalidation_job_runtime rt on rt.job_id=j.id
    where j.id=p_job_id and j.status='RUNNING' and rt.lease_token=p_lease_token
      and rt.leased_until>clock_timestamp()
  ) then
    raise exception '현재 유효한 재검증 Lease가 아니다' using errcode = 'lock_not_available';
  end if;

  result := private.finalize_revalidation_without_current_lease_guard(
    p_job_id, p_lease_token, p_run_id, p_final_claims, p_axis_results, p_guide,
    p_partial_reason_codes, p_passport_schema_version);
  return result;
end
$$;

revoke all on function private.finalize_revalidation(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text[], text)
  from public, anon, authenticated;
grant execute on function private.finalize_revalidation(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text[], text)
  to finshield_worker;

alter function private.claim_case_revalidation_job(uuid, uuid, text, integer)
  rename to claim_case_revalidation_job_without_orphan_cleanup;

revoke all on function private.claim_case_revalidation_job_without_orphan_cleanup(uuid, uuid, text, integer)
  from public, anon, authenticated, finshield_worker;

create function private.claim_case_revalidation_job(
  p_owner uuid, p_job uuid, p_worker text, p_lease_seconds integer default 120)
returns table (
  job_id uuid, lease_token uuid, attempt_no integer,
  owner_id uuid, case_id uuid, base_passport_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.revalidation_jobs%rowtype;
  rt private.revalidation_job_runtime%rowtype;
  reason text;
  active_run record;
begin
  if coalesce(p_lease_seconds,0) not between 10 and 600 or octet_length(coalesce(p_worker,'')) not between 1 and 128 then
    raise exception 'claim 인자 범위 위반' using errcode='23514';
  end if;
  select x.* into j
    from public.revalidation_jobs x
   where x.id = p_job and x.owner_id = p_owner
   for update;
  if found then
    select r.* into strict rt
      from private.revalidation_job_runtime r
     where r.job_id = j.id
     for update;
  end if;

  if found and j.status in ('QUEUED', 'RUNNING')
     and rt.attempt_no >= rt.max_attempts
     and (rt.leased_until is null or rt.leased_until < clock_timestamp()) then
    reason := case when exists (
      select 1 from public.verification_runs v
       where v.revalidation_job_id = j.id and v.status in ('QUEUED', 'RUNNING'))
      then 'PROVIDER_RESULT_UNKNOWN' else 'WORKFLOW_RETRY_EXHAUSTED' end;

    for active_run in
      select v.id from public.verification_runs v
       where v.revalidation_job_id = j.id and v.status in ('QUEUED', 'RUNNING')
       order by v.id
    loop
      perform private.fail_verification_run(active_run.id, reason, null);
    end loop;

    update public.revalidation_jobs
       set status = 'FAILED', finished_at = now(), started_at = coalesce(started_at, now()),
           reason_code = reason, error_code = null
     where id = j.id;
    update private.revalidation_job_runtime
       set lease_owner = null, lease_token = null, leased_until = null
     where private.revalidation_job_runtime.job_id = j.id;
    perform private.append_revalidation_event(j.id, 'FAILED',
      jsonb_build_object('reason_code', reason, 'error_code', null));
    return;
  end if;

  if j.id is null or j.status not in ('QUEUED','RUNNING') or rt.available_at>clock_timestamp()
     or rt.attempt_no>=rt.max_attempts or rt.leased_until>=clock_timestamp() then return;end if;
  if j.cancel_requested_at is not null then
    perform private.settle_revalidation_cancel(j.id);return;
  end if;
  update public.revalidation_jobs set status='RUNNING',started_at=coalesce(started_at,clock_timestamp()) where id=j.id;
  update private.revalidation_job_runtime
    set lease_owner=p_worker,lease_token=gen_random_uuid(),
        leased_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),heartbeat_at=clock_timestamp(),
        attempt_no=revalidation_job_runtime.attempt_no+1
    where revalidation_job_runtime.job_id=j.id returning * into rt;
  perform private.append_revalidation_event(j.id,'LEASED',jsonb_build_object('attempt_no',rt.attempt_no));
  return query select j.id,rt.lease_token,rt.attempt_no,j.owner_id,j.case_id,j.base_passport_id;
end
$$;

revoke all on function private.claim_case_revalidation_job(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function private.claim_case_revalidation_job(uuid, uuid, text, integer)
  to finshield_worker;

comment on function private.claim_case_revalidation_job(uuid, uuid, text, integer) is
  '현재 Lease 선점과 재시도 소진 Orphan 종결을 한 잠금 안에서 수행한다.';

-- heartbeat도 잠금 뒤 실제 시각으로 만료를 검사하고 연장한다.
create or replace function private.heartbeat_revalidation_job(p_job_id uuid,p_lease_token uuid,p_extend_seconds integer default 120)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.revalidation_jobs%rowtype;
begin
 if coalesce(p_extend_seconds,0) not between 10 and 600 then raise exception '임대 연장 범위 위반' using errcode='23514';end if;
 select * into j from public.revalidation_jobs where id=p_job_id for update;
 if not found or j.status<>'RUNNING' then return false;end if;
 perform 1 from private.revalidation_job_runtime where job_id=p_job_id for update;
 if not exists(select 1 from private.revalidation_job_runtime
   where job_id=p_job_id and lease_token=p_lease_token and leased_until>clock_timestamp()) then return false;end if;
 if j.cancel_requested_at is not null then perform private.settle_revalidation_cancel(p_job_id);return false;end if;
 update private.revalidation_job_runtime
   set heartbeat_at=clock_timestamp(),leased_until=clock_timestamp()+make_interval(secs=>p_extend_seconds)
   where job_id=p_job_id and lease_token=p_lease_token;
 return true;
end $$;
revoke all on function private.heartbeat_revalidation_job(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function private.heartbeat_revalidation_job(uuid,uuid,integer) to finshield_worker;
