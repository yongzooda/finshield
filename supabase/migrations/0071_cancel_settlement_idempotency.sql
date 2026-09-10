-- REV-001·N-AVL-005: 취소 종결의 중복 전달을 한 번의 terminal 원장으로 접는다.
-- 지금까지는 호출자인 cancel_revalidation_job 과 claim_case_revalidation_job 이
-- 상태를 먼저 보고 한 번만 부르는 데 기대고 있었다. Workflow Job 은 같은 단계를
-- 다시 전달할 수 있으므로 settle 자체가 멱등해야 한다. 이미 종결된 Job 에는
-- 상태·Lease·이벤트를 다시 쓰지 않는다. 기존 terminal 행과 이벤트는 바꾸지 않는다.
create or replace function private.settle_revalidation_cancel(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settled integer := 0;
begin
  update public.revalidation_jobs
     set status = 'FAILED', finished_at = now(), started_at = coalesce(started_at, now()),
         reason_code = 'USER_CANCELLED'
   where id = p_job_id and status in ('QUEUED', 'RUNNING');
  get diagnostics v_settled = row_count;
  if v_settled = 0 then
    return;
  end if;
  update private.revalidation_job_runtime
     set lease_owner = null, lease_token = null, leased_until = null
   where job_id = p_job_id;
  perform private.append_revalidation_event(p_job_id, 'CANCELLED', '{}'::jsonb);
end;
$$;
revoke all on function private.settle_revalidation_cancel(uuid) from public, anon, authenticated;
