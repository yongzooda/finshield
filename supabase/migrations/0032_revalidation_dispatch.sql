-- REV-001·D-007·N-AVL-008: Workflow에는 Job ID만 전달하고 본문·소유권·진행·취소는 DB에서 읽는다.
create or replace function private.revalidation_context(p_job uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('job_id',j.id,'owner_id',j.owner_id,'case_id',j.case_id,'status',j.status,
 'base_passport_id',j.base_passport_id,'result_passport_id',j.result_passport_id,
 'leased_until',rt.leased_until,'cancel_requested',j.cancel_requested_at is not null,
 'existing_run_id',(select r.id from public.verification_runs r where r.revalidation_job_id=j.id order by r.created_at desc limit 1))
 from public.revalidation_jobs j join private.revalidation_job_runtime rt on rt.job_id=j.id
 join public.financial_cases c on c.id=j.case_id where j.id=p_job and c.deleted_at is null
$$;
revoke all on function private.revalidation_context(uuid) from public,anon,authenticated;
grant execute on function private.revalidation_context(uuid) to finshield_worker;

create or replace function private.read_revalidation_status(p_owner uuid,p_case uuid,p_job uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j public.revalidation_jobs%rowtype;
begin
 if not exists(select 1 from public.financial_cases where id=p_case and owner_id=p_owner and deleted_at is null) then
 raise exception '본인 Case가 없다' using errcode='insufficient_privilege';end if;
 select * into j from public.revalidation_jobs where owner_id=p_owner and case_id=p_case
 and (p_job is null or id=p_job) order by queued_at desc limit 1;
 if not found then return null;end if;
 return jsonb_build_object('job_id',j.id,'job_status',j.status,'passport_id',j.result_passport_id,'reason_code',j.reason_code,
 'partial',coalesce((select status='PARTIAL' from public.verification_runs where id=j.result_run_id),false),
 'diff',(select jsonb_build_object('material_change',d.material_change,'claim_changes',d.claim_changes,
   'evidence_changes',d.evidence_changes,'result_changes',d.result_changes) from public.passport_diffs d where d.revalidation_job_id=j.id),
 'claims',coalesce((select jsonb_agg(jsonb_build_object('claim_id',rc.claim_id,'statement_masked',rv.statement_masked))
   from public.verification_run_claims rc join public.claim_revisions rv on rv.id=rc.claim_revision_id
   where rc.verification_run_id=(select verification_run_id from public.evidence_passports where id=j.base_passport_id)),'[]'),
 'events',coalesce((select jsonb_agg(jsonb_build_object('event_type',e.event_type,'payload',e.payload) order by e.event_no)
   from public.revalidation_events e where e.revalidation_job_id=j.id),'[]'));
end $$;
revoke all on function private.read_revalidation_status(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.read_revalidation_status(uuid,uuid,uuid) to finshield_worker;

create or replace function private.heartbeat_revalidation_job(p_job_id uuid,p_lease_token uuid,p_extend_seconds integer default 120)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.revalidation_jobs%rowtype;
begin
 if p_extend_seconds not between 10 and 600 then raise exception '임대 연장 범위 위반' using errcode='check_violation';end if;
 select * into j from public.revalidation_jobs where id=p_job_id for update;
 if not found or j.status<>'RUNNING' or not exists(select 1 from private.revalidation_job_runtime
 where job_id=p_job_id and lease_token=p_lease_token and leased_until>=now()) then return false;end if;
 if j.cancel_requested_at is not null then perform private.settle_revalidation_cancel(p_job_id);return false;end if;
 update private.revalidation_job_runtime set heartbeat_at=now(),leased_until=now()+make_interval(secs=>p_extend_seconds)
 where job_id=p_job_id and lease_token=p_lease_token;
 return true;
end $$;
revoke all on function private.heartbeat_revalidation_job(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function private.heartbeat_revalidation_job(uuid,uuid,integer) to finshield_worker;

-- 진행 이벤트와 취소 이벤트의 번호를 같은 Job 잠금으로 직렬화한다.
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
  select * into j from public.revalidation_jobs where id = p_job_id for update;
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

