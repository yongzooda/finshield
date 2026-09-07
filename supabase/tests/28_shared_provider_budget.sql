-- N-OPS-003: Provider 둘의 총합, 도입 이전 사용량, 실패 rollback·정산 일치를 검사한다.
begin;
-- 격리 시험 Fixture 원장만 새로 만든다. 운영 적용 스크립트가 아니다.
delete from private.usage_reservations;
delete from private.usage_budget_counters;
delete from private.budget_limits;
insert into private.budget_limits(scope_type,provider,model,limit_microunits,policy_version)
 select s,p,'*',case when p='all' then 1000 else 2000 end,'shared-budget-synthetic'
 from unnest(array['GLOBAL_DAY','OWNER_DAY','CASE','RUN']) s cross join unnest(array['all','anthropic','cohere']) p;
do $$
declare r1 uuid; r2 uuid; value record; run_id uuid := gen_random_uuid(); owner_id uuid := gen_random_uuid(); case_id uuid; profile_id uuid;
begin
  insert into auth.users(id) values(owner_id);
  case_id := private.create_case(owner_id,'LOAN','합성 Provider 예산','shared-budget-case',repeat('a',64));
  select initial_profile_version_id into profile_id from public.financial_cases where id=case_id;
  insert into public.verification_runs(id,owner_id,case_id,run_no,kind,status,profile_version_id,execution_manifest_id,idempotency_key,request_hash,correlation_id,started_at,deadline_at)
    values(run_id,owner_id,case_id,1,'INITIAL','RUNNING',profile_id,'00000000-0000-4000-8000-00000000aa01','shared-budget-run',repeat('a',64),gen_random_uuid(),now(),now()+interval '120 seconds');
  -- 도입 전에 정산한 비용도 전체 Counter 초기값으로 이어받는다.
  delete from private.budget_limits where provider='all';
  r1 := private.reserve_usage_budget(run_id,null,null,'anthropic','claude-sonnet-5','synthetic-price',100);
  perform private.settle_usage_budget(r1,100,'{"status_category":"OK"}');
  insert into private.budget_limits(scope_type,provider,model,limit_microunits,policy_version)
    select s,'all','*',1000,'shared-budget-synthetic' from unnest(array['GLOBAL_DAY','OWNER_DAY','CASE','RUN']) s;
  r1 := private.reserve_usage_budget(run_id,null,null,'anthropic','claude-sonnet-5','synthetic-price',600);
  if (select count(*) from private.usage_reservation_counters where reservation_id=r1)<>8 then raise exception '전체/Provider 범위 누락'; end if;
  begin
    perform private.reserve_usage_budget(run_id,null,null,'cohere','embed-v4.0','synthetic-price',500);
    raise exception 'Provider 합산 한도 초과 허용';
  exception when sqlstate '23514' then if sqlerrm<>'BUDGET_EXCEEDED' then raise; end if; end;
  if (select count(*) from private.usage_reservations)<>2 then raise exception '실패 예약 부분 저장'; end if;
  perform private.settle_usage_budget(r1,400,'{"status_category":"OK"}');
  r2 := private.reserve_usage_budget(run_id,null,null,'cohere','embed-v4.0','synthetic-price',500);
  perform private.flag_usage_reconciliation(r2,'PROVIDER_RESULT_UNKNOWN');
  select * into value from private.usage_budget_counters where provider='all' and scope_type='GLOBAL_DAY';
  if value.reserved_microunits<>500 or value.consumed_microunits<>500 then raise exception '전체 정산·미확정 예약 불일치'; end if;
  perform private.settle_usage_budget(r2,100,'{"status_category":"OK"}');
  select * into value from private.usage_budget_counters where provider='all' and scope_type='GLOBAL_DAY';
  if value.reserved_microunits<>0 or value.consumed_microunits<>600 then raise exception 'Provider 사용량 합산 불일치'; end if;
  -- 계정이 다른 도구 문맥으로 예약하는 것을 거부한다.
  perform fstest.expect_fail(format('select private.reserve_finshield_retrieval_usage(%L,%L,%L,%L,%L,1)',gen_random_uuid(),gen_random_uuid(),run_id,'embed-v4.0','synthetic-price'),'다른 소유자 검색 비용 예약');
  raise notice '통과: Provider 합산 상한·예약 rollback·양쪽 정산·미확정 유지·소유권';
end $$;
rollback;
