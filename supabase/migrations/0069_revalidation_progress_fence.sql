-- REV-001·N-AVL-005: 진행 기록에도 현재 Lease를 요구한다.
create function private.record_revalidation_progress(p_job uuid,p_lease uuid,p_event jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.revalidation_jobs where id=p_job for update;
 perform 1 from private.revalidation_job_runtime where job_id=p_job for update;
 if not exists(select 1 from public.revalidation_jobs j join private.revalidation_job_runtime rt on rt.job_id=j.id
   where j.id=p_job and j.status='RUNNING' and j.cancel_requested_at is null
     and rt.lease_token=p_lease and rt.leased_until>clock_timestamp()) then
   raise exception 'REVALIDATION_LEASE_LOST' using errcode='55P03';
 end if;
 if jsonb_typeof(p_event) is distinct from 'object' or octet_length(p_event::text)>4096 then
   raise exception 'REVALIDATION_PROGRESS_INVALID' using errcode='23514';
 end if;
 perform private.append_revalidation_event(p_job,'HEARTBEAT_PROGRESS',p_event);
end $$;
revoke all on function private.record_revalidation_progress(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.record_revalidation_progress(uuid,uuid,jsonb) to finshield_worker;
-- 이전 Worker도 token 없는 진행 기록 쓰기를 우회할 수 없게 한다. 내부 보안 함수는 소유자 권한으로 호출한다.
revoke execute on function private.append_revalidation_event(uuid,text,jsonb,uuid) from finshield_worker;
