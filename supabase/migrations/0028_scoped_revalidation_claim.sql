-- REV-001·D-007: 웹 재검증은 자기 Job만, 알림 처리기는 알림 Event만 선점한다.
create or replace function private.claim_case_revalidation_job(p_owner uuid, p_job uuid, p_worker text, p_lease_seconds integer default 120)
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
   where x.id=p_job and x.owner_id=p_owner and x.status in ('QUEUED', 'RUNNING')
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
revoke all on function private.claim_case_revalidation_job(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function private.claim_case_revalidation_job(uuid, uuid, text, integer) to finshield_worker;

create or replace function private.claim_notification_events(p_limit integer default 20)
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
       where e.event_type='NOTIFICATION_REQUESTED' and e.status in ('PENDING', 'FAILED')
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
revoke all on function private.claim_notification_events(integer) from public, anon, authenticated;
grant execute on function private.claim_notification_events(integer) to finshield_worker;
