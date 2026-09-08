-- AI-007·N-OPS-003: Cohere Fast를 제품 Retrieval의 relevance 단계와 비용 원장에 고정한다.
-- USD 1 = 1,000,000 microunits. search unit은 현재 등록 단가에서 2,000 microunits다.

create or replace function private.apply_judge_rerank_budget_policy()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare policy constant text:='judge-readiness-20260908-v2'; limits integer:=0; counters integer:=0;
begin
  insert into private.budget_limits(scope_type,provider,model,limit_microunits,policy_version) values
    ('GLOBAL_DAY','cohere','rerank-v4.0-fast',2000000,policy),
    ('OWNER_DAY','cohere','rerank-v4.0-fast',500000,policy),
    ('CASE','cohere','rerank-v4.0-fast',500000,policy),
    ('RUN','cohere','rerank-v4.0-fast',100000,policy)
  on conflict(scope_type,provider,model) do update set
    limit_microunits=greatest(private.budget_limits.limit_microunits,excluded.limit_microunits),
    policy_version=case when private.budget_limits.limit_microunits<excluded.limit_microunits
      then excluded.policy_version else private.budget_limits.policy_version end;
  get diagnostics limits=row_count;
  with configured(scope_type,limit_microunits) as (values
    ('GLOBAL_DAY',2000000::bigint),('OWNER_DAY',500000::bigint),
    ('CASE',500000::bigint),('RUN',100000::bigint))
  update private.usage_budget_counters c set limit_microunits=greatest(
    c.limit_microunits,configured.limit_microunits,c.reserved_microunits+c.consumed_microunits)
  from configured where c.scope_type=configured.scope_type and c.provider='cohere'
    and c.model='rerank-v4.0-fast' and c.period_end>now();
  get diagnostics counters=row_count;
  return jsonb_build_object('policy_version',policy,'limit_rows_seen',limits,'active_counters_seen',counters);
end $$;
revoke all on function private.apply_judge_rerank_budget_policy() from public,anon,authenticated,service_role,finshield_worker;
select private.apply_judge_rerank_budget_policy();

-- 가입 후 점검도 같은 Case의 공용 KB를 조회하므로 Fast 예약을 허용한다.
create or replace function private.reserve_precase_usage(
  p_owner uuid,p_case uuid,p_job uuid,p_provider text,p_model text,
  p_pricing_version text,p_estimated_microunits bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_res uuid;v_day timestamptz:=date_trunc('day',now());scope record;v_limit bigint;
 v_counter uuid;v_reserved bigint;v_consumed bigint;v_owner_key text:=p_owner::text;
 v_case_key text:=p_case::text;v_run_key text:='aftercare:'||p_job::text;
begin
 if p_estimated_microunits<=0 or not (
   (p_provider='anthropic' and p_model='claude-sonnet-5') or
   (p_provider='cohere' and p_model in ('embed-v4.0','rerank-v4.0-fast'))) then
  raise exception 'AFTERCARE_MODEL_REJECTED' using errcode='23514';end if;
 if not exists(select 1 from public.precase_review_jobs j join public.financial_cases c on c.id=j.case_id
   where j.id=p_job and j.owner_id=p_owner and j.case_id=p_case and j.status='RUNNING'
     and j.leased_until>now() and j.deadline_at>now() and c.deleted_at is null) then
   raise exception 'AFTERCARE_CONTEXT_REJECTED' using errcode='42501';end if;
 if private.budget_limit_for('GLOBAL_DAY','all','*') is null then
   raise exception 'BUDGET_LIMIT_MISSING' using errcode='42501',hint='BUDGET_LIMIT_MISSING';end if;
 insert into private.usage_reservations
   (precase_review_job_id,provider,model,pricing_version,estimated_microunits,expires_at)
 values(p_job,p_provider,p_model,p_pricing_version,p_estimated_microunits,now()+interval '120 seconds')
 returning id into v_res;
 for scope in select * from (values
   ('GLOBAL_DAY','global',v_day,v_day+interval '1 day'),
   ('OWNER_DAY',v_owner_key,v_day,v_day+interval '1 day'),
   ('CASE',v_case_key,timestamptz '2000-01-01',timestamptz 'infinity'),
   ('RUN',v_run_key,timestamptz '2000-01-01',timestamptz 'infinity'))
   s(scope_type,scope_key,period_start,period_end) order by 1 loop
  v_limit:=private.budget_limit_for(scope.scope_type,p_provider,p_model);
  if v_limit is null then raise exception '예산 상한 설정이 없어 예약을 거부한다: % %/%',
    scope.scope_type,p_provider,p_model using errcode='42501',hint='BUDGET_LIMIT_MISSING';end if;
  insert into private.usage_budget_counters
    (scope_type,scope_key,provider,model,period_start,period_end,limit_microunits)
  values(scope.scope_type,scope.scope_key,p_provider,p_model,scope.period_start,scope.period_end,v_limit)
  on conflict(scope_type,scope_key,provider,model,period_start) do nothing;
  select id,reserved_microunits,consumed_microunits into v_counter,v_reserved,v_consumed
    from private.usage_budget_counters where scope_type=scope.scope_type and scope_key=scope.scope_key
      and provider=p_provider and model=p_model and period_start=scope.period_start for update;
  if v_reserved+v_consumed+p_estimated_microunits>v_limit then
    raise exception '예산 상한 초과: %',scope.scope_type using errcode='23514',hint='BUDGET_EXCEEDED';end if;
  update private.usage_budget_counters set reserved_microunits=reserved_microunits+p_estimated_microunits
    where id=v_counter;
  insert into private.usage_reservation_counters(reservation_id,counter_id,microunits)
    values(v_res,v_counter,p_estimated_microunits);
 end loop;
 return v_res;
end $$;
revoke all on function private.reserve_precase_usage(uuid,uuid,uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function private.reserve_precase_usage(uuid,uuid,uuid,text,text,text,bigint) to finshield_worker;

-- 실행 당시의 Retrieval Provider까지 Passport에서 되짚을 수 있게 새 Manifest를 쌓는다.
insert into private.execution_manifests
  (manifest_version,scenario,scenario_version,model_bundle,prompt_bundle_version,
   schema_bundle_version,evidence_policy_version,result_matrix_version,coverage_contract_version,
   profile_policy_version,pii_policy_version,kb_release_id,embedding_model,embedding_dimension,config_hash)
select 'finshield-p0-loan-v8',m.scenario,m.scenario_version,
  jsonb_set(m.model_bundle,'{retrieval}',jsonb_build_object(
    'embedding_model','embed-v4.0','rerank_model','rerank-v4.0-fast',
    'keyword_candidate_pool',20,'vector_candidate_pool',20,'max_rerank_candidates',40,
    'top_k',5,'max_query_bytes',8192,'max_document_bytes',32768,'max_tokens_per_document',4096,
    'pricing_version','cohere-text-usd-20260907')),
  m.prompt_bundle_version,m.schema_bundle_version,m.evidence_policy_version,m.result_matrix_version,
  m.coverage_contract_version,m.profile_policy_version,m.pii_policy_version,m.kb_release_id,
  m.embedding_model,m.embedding_dimension,
  encode(extensions.digest(m.config_hash||':retrieval-fast-v1:embed-v4.0:rerank-v4.0-fast:20:20:40:5:8192:32768:4096','sha256'),'hex')
from private.execution_manifests m where m.manifest_version='finshield-p0-loan-v7'
on conflict(manifest_version) do nothing;

insert into private.execution_manifest_agents(execution_manifest_id,agent_definition_id,logical_agent_key,required)
select n.id,a.agent_definition_id,a.logical_agent_key,a.required from private.execution_manifest_agents a
join private.execution_manifests m on m.id=a.execution_manifest_id and m.manifest_version='finshield-p0-loan-v7'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v8' on conflict do nothing;

insert into private.execution_manifest_tools(execution_manifest_id,tool_definition_id,purpose_code,required)
select n.id,t.tool_definition_id,t.purpose_code,t.required from private.execution_manifest_tools t
join private.execution_manifests m on m.id=t.execution_manifest_id and m.manifest_version='finshield-p0-loan-v7'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v8' on conflict do nothing;
