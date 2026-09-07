-- S-009·N-PERF-009·EC-020: 끊긴 초기 검증을 실패로 종결한 뒤 같은 Claim으로 재시도한다.
--
-- P0 초기 검증은 동기 Stream이다. Function이 강제 종료되면 catch가 실행되지 않아
-- RUNNING 행이 남을 수 있다. 사용자가 실제로 실패 화면을 본 Run ID를 다시 보내거나
-- DB deadline이 지난 경우에만 그 행을 종결한다. 살아 있는 다른 요청을 추측해서
-- 중단하지 않으며, 늦게 돌아온 Worker는 terminal Run을 최종화할 수 없다.
create or replace function private.prepare_initial_verification_retry(
  p_owner uuid, p_case uuid, p_replace_run uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.financial_cases%rowtype;
  r public.verification_runs%rowtype;
  reason text;
begin
  select * into c from public.financial_cases
   where id=p_case and owner_id=p_owner for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 접근 불가' using errcode='insufficient_privilege';
  end if;

  select * into r from public.verification_runs
   where case_id=p_case and owner_id=p_owner and kind='INITIAL'
     and status in ('QUEUED','RUNNING')
   order by created_at desc limit 1 for update;
  if not found then
    if c.lifecycle='DRAFT' then
      perform private.transition_financial_case(p_owner,p_case,'INPUT_REVIEW','USER','CLAIMS_CONFIRMED');
    end if;
    return null;
  end if;

  if r.deadline_at > now() and (p_replace_run is null or p_replace_run<>r.id) then
    raise exception '다른 초기 검증이 아직 실행 중이다' using errcode='unique_violation';
  end if;
  reason:=case when r.deadline_at<=now() then 'DEADLINE_EXCEEDED' else 'CLIENT_RETRY' end;

  update public.verification_runs
     set status='FAILED',finished_at=now(),started_at=coalesce(started_at,now()),reason_code=reason
   where id=r.id;
  if c.lifecycle='VERIFYING' then
    perform private.transition_financial_case(p_owner,p_case,'INPUT_REVIEW','SYSTEM',reason);
  end if;
  perform private.append_case_event(p_owner,p_case,'RUN_FAILED','SYSTEM',null,null,
    jsonb_build_object('run_id',r.id,'reason_code',reason,'error_code',null),
    'run-failed:'||r.id::text);
  return r.id;
end
$$;

revoke all on function private.prepare_initial_verification_retry(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function private.prepare_initial_verification_retry(uuid,uuid,uuid)
  to finshield_worker;
