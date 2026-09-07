-- PC-005/007·N-OPS-003: 거래 전 Run을 변경하지 않는 가입 후 Agent 실행 문맥.
create table public.precase_review_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, case_id uuid not null,
 base_passport_id uuid not null, execution_manifest_id uuid not null references private.execution_manifests(id),
 request_key uuid not null, request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 input_masked jsonb not null check(jsonb_typeof(input_masked)='object' and octet_length(input_masked::text)<=65536),
 status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
 agent_trace jsonb not null default '[]' check(jsonb_typeof(agent_trace)='array' and jsonb_array_length(agent_trace)<=2 and octet_length(agent_trace::text)<=262144),
 assessment_id uuid, lease_token uuid, leased_until timestamptz, dispatch_at timestamptz,
 created_at timestamptz not null default now(), deadline_at timestamptz not null default now()+interval '120 seconds',
 finished_at timestamptz, reason_code text check(octet_length(reason_code)<=64),
 foreign key(case_id,owner_id) references public.financial_cases(id,owner_id) on delete cascade,
 foreign key(base_passport_id,owner_id,case_id) references public.evidence_passports(id,owner_id,case_id) on delete cascade,
 foreign key(assessment_id,owner_id,case_id) references public.precase_assessments(id,owner_id,case_id) on delete cascade,
 unique(owner_id,case_id,request_key),
 check((status in ('QUEUED','RUNNING'))=(finished_at is null)),
 check((status in ('COMPLETED','PARTIAL'))=(assessment_id is not null))
);
create index idx_precase_review_jobs__case on public.precase_review_jobs(owner_id,case_id,created_at desc);
alter table public.precase_review_jobs enable row level security;
alter table public.precase_review_jobs force row level security;
create policy precase_review_owner on public.precase_review_jobs for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.financial_cases c where c.id=case_id and c.deleted_at is null));
create policy member_session_required on public.precase_review_jobs as restrictive for all to authenticated
 using((select public.member_session_active())) with check((select public.member_session_active()));
revoke all on public.precase_review_jobs from public,anon,authenticated,finshield_worker;
grant select on public.precase_review_jobs to authenticated;
create trigger trg_account_work_guard before insert on public.precase_review_jobs for each row execute function private.guard_account_work();
create trigger trg_precase_review_delete before delete on public.precase_review_jobs for each row execute function private.reject_direct_delete('public','financial_cases','case_id');

create function private.enqueue_precase_review(p_owner uuid,p_case uuid,p_passport uuid,p_manifest uuid,p_key uuid,p_hash text,p_input jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.financial_cases%rowtype; old public.precase_review_jobs%rowtype; result uuid; item jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-delete:'||p_owner::text,0));
 select * into c from public.financial_cases where id=p_case and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'CASE_NOT_FOUND' using errcode='42501';end if;
 select * into old from public.precase_review_jobs where owner_id=p_owner and case_id=p_case and request_key=p_key;
 if found then
   if old.request_hash<>p_hash then raise exception 'REQUEST_KEY_CONFLICT' using errcode='23514';end if;
   return old.id;
 end if;
 if c.enrollment_confirmed_at is null then raise exception 'ENROLLMENT_REQUIRED' using errcode='23514';end if;
 if not exists(select 1 from public.evidence_passports where id=p_passport and case_id=p_case and owner_id=p_owner) then
  raise exception 'PASSPORT_SCOPE_REJECTED' using errcode='42501';end if;
 if exists(select 1 from public.precase_review_jobs where case_id=p_case and status in ('QUEUED','RUNNING') and deadline_at>now()) then
  raise exception 'AFTERCARE_ALREADY_RUNNING' using errcode='55000';end if;
 if p_input->>'schema_version' is distinct from 'aftercare-review-v1' or jsonb_typeof(p_input->'answers') is distinct from 'array'
   or jsonb_typeof(p_input->'comparison') is distinct from 'array' then raise exception 'AFTERCARE_INPUT_INVALID' using errcode='23514';end if;
 for item in select * from jsonb_array_elements(p_input->'comparison') loop
  if not exists(select 1 from public.final_claim_versions f join public.evidence_passports p on p.verification_run_id=f.verification_run_id
     join public.claim_revisions r on r.id=f.claim_revision_id
     where p.id=p_passport and f.claim_id=(item->>'claim_id')::uuid and r.statement_masked=item->>'before') then
    raise exception 'CONTRACT_CLAIM_SCOPE_REJECTED' using errcode='42501';end if;
 end loop;
 insert into public.precase_review_jobs(owner_id,case_id,base_passport_id,execution_manifest_id,request_key,request_hash,input_masked)
 values(p_owner,p_case,p_passport,p_manifest,p_key,p_hash,p_input) returning id into result;
 return result;
end $$;

create function private.precase_review_context(p_job uuid)
returns jsonb language sql security definer set search_path='' as $$
 select to_jsonb(j)||jsonb_build_object('journey_stage',c.journey_stage,'case_active',c.deleted_at is null,
 'claims',(select jsonb_agg(jsonb_build_object('claim_ref','C'||n,'claim_id',claim_id,'claim_type',claim_type,
    'statement_masked',statement_masked,'materiality',materiality,'status',status) order by n)
  from (select f.claim_id,f.status,c.claim_type,r.statement_masked,r.materiality,row_number() over(order by f.claim_id) n from public.final_claim_versions f
   join public.claim_revisions r on r.id=f.claim_revision_id join public.claims c on c.id=f.claim_id
   join public.evidence_passports p on p.verification_run_id=f.verification_run_id where p.id=j.base_passport_id) f))
 from public.precase_review_jobs j join public.financial_cases c on c.id=j.case_id where j.id=p_job
$$;

create function private.claim_precase_review(p_job uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.precase_review_jobs%rowtype; token uuid:=gen_random_uuid();
begin
 select * into j from public.precase_review_jobs where id=p_job for update;
 if not found or j.status not in ('QUEUED','RUNNING') then return null;end if;
 if not exists(select 1 from public.financial_cases where id=j.case_id and deleted_at is null) then
  update public.precase_review_jobs set status='CANCELLED',finished_at=now(),lease_token=null,leased_until=null,reason_code='CASE_DELETED' where id=p_job;return null;
 end if;
 if j.deadline_at<=now() or (j.status='RUNNING' and j.leased_until<=now()) then
  update public.precase_review_jobs set status='FAILED',finished_at=now(),lease_token=null,leased_until=null,
    reason_code=case when j.status='RUNNING' then 'PROVIDER_RESULT_UNKNOWN' else 'DEADLINE_EXCEEDED' end where id=p_job;return null;
 end if;
 if j.status='RUNNING' then return null;end if;
 update public.precase_review_jobs set status='RUNNING',lease_token=token,leased_until=now()+interval '30 seconds' where id=p_job;
 return token;
end $$;

create function private.heartbeat_precase_review(p_job uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.precase_review_jobs j set leased_until=now()+interval '30 seconds'
 where id=p_job and lease_token=p_lease and status='RUNNING' and leased_until>now() and deadline_at>now()
 and exists(select 1 from public.financial_cases c where c.id=j.case_id and c.deleted_at is null);
 return found;
end $$;

create function private.record_precase_agent(p_job uuid,p_lease uuid,p_trace jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.precase_review_jobs%rowtype; tool jsonb; source jsonb; agent_id uuid; v_agent_code text:=p_trace->>'agent_code';
begin
 select * into j from public.precase_review_jobs where id=p_job for update;
 if not found or j.status<>'RUNNING' or j.lease_token is distinct from p_lease or j.leased_until<=now() or j.deadline_at<=now()
 or not exists(select 1 from public.financial_cases where id=j.case_id and deleted_at is null) then return false;end if;
 if exists(select 1 from jsonb_array_elements(j.agent_trace) x where x->>'agent_code'=v_agent_code) then
  return exists(select 1 from jsonb_array_elements(j.agent_trace) x where x=p_trace);
 end if;
 if v_agent_code is distinct from (case when jsonb_array_length(j.agent_trace)=0 then 'SALES_CONDUCT' else 'REGULATION_DISPUTE' end)
 or coalesce(p_trace->>'status' not in ('SUCCEEDED','PARTIAL','FAILED'),true) or jsonb_typeof(p_trace->'tools') is distinct from 'array'
 then raise exception 'AFTERCARE_AGENT_REJECTED' using errcode='23514';end if;
 select a.id into agent_id from private.agent_definitions a join private.execution_manifest_agents m on m.agent_definition_id=a.id
 where m.execution_manifest_id=j.execution_manifest_id and a.agent_code=v_agent_code and a.version=p_trace->>'version';
 if not found then raise exception 'AFTERCARE_MANIFEST_REJECTED' using errcode='23514';end if;
 if p_trace->>'model_id' is distinct from (select model_bundle->>'domain_model' from private.execution_manifests where id=j.execution_manifest_id) then
  raise exception 'AFTERCARE_MODEL_REJECTED' using errcode='23514';end if;
 for tool in select * from jsonb_array_elements(p_trace->'tools') loop
  if not exists(select 1 from private.agent_tool_allowlists al join private.tool_definitions t on t.id=al.tool_definition_id
   where al.agent_definition_id=agent_id and t.tool_code=tool->>'tool_code' and t.version=tool->>'version' and al.purpose_code=tool->>'purpose_code') then
   raise exception 'AFTERCARE_TOOL_REJECTED' using errcode='23514';end if;
  if jsonb_typeof(tool->'sources') is distinct from 'array' then raise exception 'AFTERCARE_SOURCE_REJECTED' using errcode='23514';end if;
  for source in select * from jsonb_array_elements(tool->'sources') loop
   if (tool->>'provenance_complete')::boolean is distinct from true or not exists(select 1 from kb.source_snapshots s
     where s.id=(source->>'snapshot_id')::uuid and s.content_hash=source->>'content_hash') then
     raise exception 'AFTERCARE_SOURCE_REJECTED' using errcode='23514';end if;
  end loop;
 end loop;
 update public.precase_review_jobs set agent_trace=agent_trace||jsonb_build_array(p_trace) where id=p_job;
 return true;
end $$;

create function private.finish_precase_review(p_job uuid,p_lease uuid,p_result public.aftercare_result,p_summary text,p_actions jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.precase_review_jobs%rowtype; complete boolean; assessment uuid;
begin
 select * into j from public.precase_review_jobs where id=p_job for update;
 if j.status in ('COMPLETED','PARTIAL') then return j.assessment_id;end if;
 if not found or j.status<>'RUNNING' or j.lease_token is distinct from p_lease or j.leased_until<=now()
 or not exists(select 1 from public.financial_cases where id=j.case_id and deleted_at is null) then return null;end if;
 complete:=j.deadline_at>now() and jsonb_array_length(j.agent_trace)=2 and not exists(select 1 from jsonb_array_elements(j.agent_trace) x
   where x->>'status'<>'SUCCEEDED' or jsonb_array_length(x->'tools')=0
   or exists(select 1 from jsonb_array_elements(x->'tools') t where t->>'status' is distinct from 'SUCCEEDED' or (t->>'provenance_complete')::boolean is distinct from true));
 if not complete and p_result='NORMAL_MANAGEMENT' then p_result:='ADDITIONAL_EXPLANATION';end if;
 assessment:=private.record_precase_assessment(j.owner_id,j.case_id,j.base_passport_id,j.execution_manifest_id,p_result,
   case when complete then p_summary else 'Agent 검토가 일부 미확인입니다. '||p_summary end,j.input_masked->'answers',p_actions,'aftercare-v3');
 -- 같은 트랜잭션에서만 부분 상태를 확정한다. 이전 점검이나 Passport는 갱신하지 않는다.
 if not complete then update public.precase_assessments set status='PARTIAL',reason_code='AGENT_REVIEW_INCOMPLETE' where id=assessment;end if;
 update public.precase_review_jobs set status=case when complete then 'COMPLETED' else 'PARTIAL' end,
   assessment_id=assessment,finished_at=now(),lease_token=null,leased_until=null where id=p_job;
 return assessment;
end $$;

create function private.fail_precase_review(p_job uuid,p_lease uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_reason not in ('PROVIDER_RESULT_UNKNOWN','DEADLINE_EXCEEDED','REVIEW_FAILED','CASE_DELETED','USER_CANCELLED') then
  raise exception 'REASON_REJECTED' using errcode='23514';end if;
 update public.precase_review_jobs set status=case when p_reason in ('CASE_DELETED','USER_CANCELLED') then 'CANCELLED' else 'FAILED' end,
  finished_at=now(),reason_code=p_reason,lease_token=null,leased_until=null
 where id=p_job and status='RUNNING' and lease_token=p_lease;
 return found;
end $$;

create function private.claim_precase_dispatch(p_owner uuid,p_case uuid,p_job uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.precase_review_jobs j set dispatch_at=now() where id=p_job and owner_id=p_owner and case_id=p_case
 and status='QUEUED' and (dispatch_at is null or dispatch_at<now()-interval '15 seconds')
 and exists(select 1 from public.financial_cases c where c.id=j.case_id and c.deleted_at is null);
 return found;
end $$;

create function private.stop_precase_reviews(p_owner uuid,p_case uuid,p_job uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update public.precase_review_jobs set status=case when p_job is null then 'FAILED' else 'CANCELLED' end,
   finished_at=now(),reason_code=case when p_job is null then 'DEADLINE_EXCEEDED' else 'USER_CANCELLED' end,lease_token=null,leased_until=null
 where owner_id=p_owner and case_id=p_case and status in ('QUEUED','RUNNING')
 and ((p_job is null and deadline_at<=now()) or (p_job is not null and id=p_job));
 get diagnostics n=row_count;
 return n;
end $$;

do $$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='private'::regnamespace and proname in
  ('enqueue_precase_review','precase_review_context','claim_precase_review','heartbeat_precase_review','record_precase_agent','finish_precase_review','fail_precase_review','claim_precase_dispatch','stop_precase_reviews') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to finshield_worker',f.signature);
 end loop;
end $$;

-- 점검 전용 비용도 기존 정산·미확정 예약과 전체 Provider 상한을 그대로 사용한다.
alter table private.usage_reservations add column precase_review_job_id uuid references public.precase_review_jobs(id) on delete cascade;
alter table private.usage_reservations drop constraint ck_usage_reservations__one_context;
alter table private.usage_reservations add constraint ck_usage_reservations__one_context check(num_nonnulls(run_id,case_input_id,demo_run_id,precase_review_job_id)=1);
create index idx_usage_reservations__precase_review on private.usage_reservations(precase_review_job_id);
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
  elsif new.precase_review_job_id is not null then
    select owner_id::text,case_id::text,'aftercare:'||id::text into owner_key,case_key,run_key from public.precase_review_jobs where id=new.precase_review_job_id;
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

create function private.reserve_precase_usage(p_owner uuid,p_case uuid,p_job uuid,p_provider text,p_model text,p_pricing_version text,p_estimated_microunits bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_res uuid; v_day timestamptz:=date_trunc('day',now()); scope record; v_limit bigint;
 v_counter uuid; v_reserved bigint; v_consumed bigint; v_owner_key text:=p_owner::text; v_case_key text:=p_case::text; v_run_key text:='aftercare:'||p_job::text;
begin
 if p_estimated_microunits<=0 or not ((p_provider='anthropic' and p_model='claude-sonnet-5') or (p_provider='cohere' and p_model='embed-v4.0')) then
  raise exception 'AFTERCARE_MODEL_REJECTED' using errcode='23514';end if;
 if not exists(select 1 from public.precase_review_jobs j join public.financial_cases c on c.id=j.case_id
   where j.id=p_job and j.owner_id=p_owner and j.case_id=p_case and j.status='RUNNING' and j.leased_until>now() and j.deadline_at>now() and c.deleted_at is null) then
   raise exception 'AFTERCARE_CONTEXT_REJECTED' using errcode='42501';end if;
 if private.budget_limit_for('GLOBAL_DAY','all','*') is null then raise exception 'BUDGET_LIMIT_MISSING' using errcode='42501',hint='BUDGET_LIMIT_MISSING';end if;
 insert into private.usage_reservations(precase_review_job_id,provider,model,pricing_version,estimated_microunits,expires_at)
 values(p_job,p_provider,p_model,p_pricing_version,p_estimated_microunits,now()+interval '120 seconds') returning id into v_res;
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
end $$;
revoke all on function private.reserve_precase_usage(uuid,uuid,uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function private.reserve_precase_usage(uuid,uuid,uuid,text,text,text,bigint) to finshield_worker;
