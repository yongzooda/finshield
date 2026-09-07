-- SEC-OPS-003·N-OPS-003: 검증 Run 이전의 마스킹 입력과 공개 Demo도 같은 예산 원장으로 제한한다.
alter table private.usage_reservations alter column run_id drop not null;
alter table private.usage_reservations add column case_input_id uuid references public.case_inputs(id) on delete cascade;
alter table private.usage_reservations add column demo_run_id uuid references demo.runs(id) on delete cascade;
alter table private.usage_reservations add constraint ck_usage_reservations__one_context
 check (num_nonnulls(run_id,case_input_id,demo_run_id)=1);
create index idx_usage_reservations__input on private.usage_reservations(case_input_id);
create index idx_usage_reservations__demo_run on private.usage_reservations(demo_run_id);

create or replace function private.reserve_finshield_model_usage(
 p_owner uuid,p_case uuid,p_input uuid,p_run uuid,p_demo_run uuid,
 p_model text,p_pricing_version text,p_estimated_microunits bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_res uuid; v_day timestamptz:=date_trunc('day',now()); scope record; v_limit bigint;
 v_counter uuid; v_reserved bigint; v_consumed bigint;
 v_owner_key text; v_case_key text; v_run_key text; demo_session uuid;
begin
 if num_nonnulls(p_input,p_run,p_demo_run)<>1 or p_estimated_microunits<=0 then
 raise exception '호출 문맥 또는 예산 범위 위반' using errcode='check_violation';end if;
 if p_run is not null then
   if not exists(select 1 from public.verification_runs r join public.financial_cases c on c.id=r.case_id
    where r.id=p_run and r.owner_id=p_owner and r.case_id=p_case and c.deleted_at is null) then
    raise exception '본인 Run이 아니다' using errcode='insufficient_privilege';end if;
   return private.reserve_usage_budget(p_run,null,null,'anthropic',p_model,p_pricing_version,p_estimated_microunits,120);
 elsif p_input is not null then
   if not exists(select 1 from public.case_inputs i join public.financial_cases c on c.id=i.case_id
     where i.id=p_input and i.owner_id=p_owner and i.case_id=p_case and i.input_stage='MASKED'
     and i.input_outcome='ACTIVE' and i.raw_expires_at>now() and c.deleted_at is null
     and c.lifecycle in ('DRAFT','INPUT_REVIEW','NEED_MORE_INFORMATION')) then
    raise exception '본인 마스킹 입력이 아니다' using errcode='insufficient_privilege';end if;
   v_owner_key:=p_owner::text;v_case_key:=p_case::text;v_run_key:='input:'||p_input::text;
 else
   if p_owner is not null or p_case is not null then raise exception 'Demo와 회원 문맥 혼합' using errcode='check_violation';end if;
   select r.session_id into demo_session from demo.runs r join demo.sessions s on s.id=r.session_id
    where r.id=p_demo_run and r.status='RUNNING' and s.expires_at>now();
   if not found then raise exception '진행 중인 Demo가 아니다' using errcode='insufficient_privilege';end if;
   v_owner_key:='demo:'||demo_session::text;v_case_key:=v_owner_key;v_run_key:='demo:'||p_demo_run::text;
 end if;
 insert into private.usage_reservations(case_input_id,demo_run_id,provider,model,pricing_version,estimated_microunits,expires_at)
 values(p_input,p_demo_run,'anthropic',p_model,p_pricing_version,p_estimated_microunits,now()+interval '120 seconds') returning id into v_res;
  -- day·owner·case·run 네 범위를 정해진 순서로 잠근다 (교착 방지).
  for scope in
    select * from (values
      ('GLOBAL_DAY', 'global', v_day, v_day + interval '1 day'),
      ('OWNER_DAY', v_owner_key, v_day, v_day + interval '1 day'),
      ('CASE', v_case_key, timestamptz '2000-01-01', timestamptz 'infinity'),
      ('RUN', v_run_key, timestamptz '2000-01-01', timestamptz 'infinity')
    ) as s (scope_type, scope_key, period_start, period_end)
    order by 1
  loop
    v_limit := private.budget_limit_for(scope.scope_type, 'anthropic', p_model);
    if v_limit is null then
      raise exception '예산 상한 설정이 없어 예약을 거부한다: % %/%', scope.scope_type, 'anthropic', p_model
        using errcode = 'insufficient_privilege', hint = 'BUDGET_LIMIT_MISSING';
    end if;
    insert into private.usage_budget_counters
      (scope_type, scope_key, provider, model, period_start, period_end, limit_microunits)
    values (scope.scope_type, scope.scope_key, 'anthropic', p_model, scope.period_start, scope.period_end, v_limit)
    on conflict (scope_type, scope_key, provider, model, period_start) do nothing;

    select id, reserved_microunits, consumed_microunits into v_counter, v_reserved, v_consumed
      from private.usage_budget_counters
     where scope_type = scope.scope_type and scope_key = scope.scope_key
       and provider = 'anthropic' and model = p_model and period_start = scope.period_start
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

revoke all on function private.reserve_finshield_model_usage(uuid,uuid,uuid,uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function private.reserve_finshield_model_usage(uuid,uuid,uuid,uuid,uuid,text,text,bigint) to finshield_worker;
