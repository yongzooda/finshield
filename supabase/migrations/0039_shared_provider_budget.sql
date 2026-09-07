-- N-OPS-003·SEC-OPS-003: Provider별 한도와 전체 한도를 같은 예약·정산 원장으로 강제한다.
-- 금액 설정은 승인된 운영 정책으로 별도 등록한다. 이 Migration은 상한을 올리지 않는다.
create or replace function private.reserve_shared_provider_budget()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_key text; case_key text; run_key text; scope record; amount bigint; counter uuid;
  v_day timestamptz := date_trunc('day',now());
begin
  -- 기존 격리 계약의 개별 Provider 시험은 전체 정책을 자동으로 생성하지 않는다.
  if private.budget_limit_for('GLOBAL_DAY','all','*') is null then return new; end if;
  if new.provider='all' then raise exception 'SHARED_PROVIDER_NOT_CALLABLE' using errcode='23514'; end if;
  if new.run_id is not null then
    select owner_id::text,case_id::text,id::text into owner_key,case_key,run_key from public.verification_runs where id=new.run_id;
  elsif new.case_input_id is not null then
    select owner_id::text,case_id::text,'input:'||id::text into owner_key,case_key,run_key from public.case_inputs where id=new.case_input_id;
  elsif new.demo_run_id is not null then
    select 'demo:'||session_id::text,'demo:'||session_id::text,'demo:'||id::text into owner_key,case_key,run_key from demo.runs where id=new.demo_run_id;
  end if;
  if owner_key is null then raise exception 'BUDGET_CONTEXT_REQUIRED' using errcode='23514'; end if;
  for scope in select * from (values
    ('GLOBAL_DAY','global',v_day,v_day+interval '1 day'),('OWNER_DAY',owner_key,v_day,v_day+interval '1 day'),
    ('CASE',case_key,timestamptz '2000-01-01',timestamptz 'infinity'),('RUN',run_key,timestamptz '2000-01-01',timestamptz 'infinity')
  ) s(scope_type,scope_key,period_start,period_end) order by 1 loop
    amount := private.budget_limit_for(scope.scope_type,'all','*');
    if amount is null then raise exception 'BUDGET_LIMIT_MISSING' using errcode='42501',hint='BUDGET_LIMIT_MISSING'; end if;
    if not exists(select 1 from private.usage_budget_counters where scope_type=scope.scope_type and scope_key=scope.scope_key
        and period_start=scope.period_start and provider='all')
      and exists(select 1 from private.usage_budget_counters where scope_type=scope.scope_type and scope_key=scope.scope_key
        and period_start=scope.period_start and provider<>'all' and reserved_microunits>0) then
      raise exception 'BUDGET_POLICY_INITIALIZATION_PENDING' using errcode='55000';
    end if;
    -- 도입 이전 개별 원장도 합산해 시작한다. 과거 사용량을 0으로 초기화하지 않는다.
    insert into private.usage_budget_counters(scope_type,scope_key,provider,model,period_start,period_end,limit_microunits,reserved_microunits,consumed_microunits)
      select scope.scope_type,scope.scope_key,'all','*',scope.period_start,scope.period_end,amount,
        coalesce(sum(reserved_microunits),0),coalesce(sum(consumed_microunits),0)
      from private.usage_budget_counters where scope_type=scope.scope_type and scope_key=scope.scope_key
        and period_start=scope.period_start and provider<>'all'
      on conflict(scope_type,scope_key,provider,model,period_start) do nothing;
    select id into counter from private.usage_budget_counters where scope_type=scope.scope_type and scope_key=scope.scope_key
      and provider='all' and model='*' and period_start=scope.period_start for update;
    update private.usage_budget_counters set reserved_microunits=reserved_microunits+new.estimated_microunits
      where id=counter and reserved_microunits+consumed_microunits+new.estimated_microunits<=amount;
    if not found then raise exception 'BUDGET_EXCEEDED' using errcode='23514',hint='BUDGET_EXCEEDED'; end if;
    insert into private.usage_reservation_counters(reservation_id,counter_id,microunits) values(new.id,counter,new.estimated_microunits);
  end loop;
  return new;
end $$;
revoke all on function private.reserve_shared_provider_budget() from public,anon,authenticated,finshield_worker;
create trigger trg_shared_provider_budget after insert on private.usage_reservations for each row execute function private.reserve_shared_provider_budget();

create or replace function private.reserve_finshield_retrieval_usage(p_owner uuid,p_case uuid,p_run uuid,p_model text,p_pricing text,p_estimate bigint)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if p_model not in ('embed-v4.0','rerank-v4.0-fast') then raise exception 'RETRIEVAL_MODEL_UNREGISTERED' using errcode='23514'; end if;
  if private.budget_limit_for('GLOBAL_DAY','all','*') is null then raise exception 'BUDGET_LIMIT_MISSING' using errcode='42501',hint='BUDGET_LIMIT_MISSING'; end if;
  if not exists(select 1 from public.verification_runs r join public.financial_cases c on c.id=r.case_id
    where r.id=p_run and r.owner_id=p_owner and r.case_id=p_case and c.deleted_at is null and r.status in ('QUEUED','RUNNING')) then
    raise exception 'RETRIEVAL_RUN_REJECTED' using errcode='42501'; end if;
  return private.reserve_usage_budget(p_run,null,null,'cohere',p_model,p_pricing,p_estimate,120);
end $$;
revoke all on function private.reserve_finshield_retrieval_usage(uuid,uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function private.reserve_finshield_retrieval_usage(uuid,uuid,uuid,text,text,bigint) to finshield_worker;
