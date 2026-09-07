-- SEC-OPS-003: Intake·회원 Run·Demo 문맥을 혼합하지 않는 예산 예약.
\echo '모델 예산 문맥·초과·정산·불명확한 사용량'
begin;
do $$
declare owner uuid:='00000000-0000-4000-8000-00000000000a'; c uuid; inp uuid; reservation uuid; n int;
 d record; dr uuid; manifest uuid; baseline jsonb;
begin
 insert into private.budget_limits(scope_type,provider,model,limit_microunits,policy_version)
 select scope,'anthropic','claude-sonnet-5',1000000,'isolated-budget-test' from unnest(array['GLOBAL_DAY','OWNER_DAY','CASE','RUN']) scope
 on conflict(scope_type,provider,model) do update set limit_microunits=excluded.limit_microunits;
 c:=private.create_case(owner,'LOAN','합성 예산 시험','budget-input-case',repeat('a',64));
 inp:=private.create_text_input(owner,c,100,86400);
 perform fstest.expect_fail(format('select private.reserve_finshield_model_usage(%L,%L,%L,null,null,%L,%L,100)',owner,c,inp,'claude-sonnet-5','sonnet5-usd-20260907'),'마스킹 전 비용 예약 거부');
 perform private.advance_input_stage(owner,c,inp,'VALIDATED','{}');
 perform private.advance_input_stage(owner,c,inp,'EXTRACTED','{}');
 perform private.advance_input_stage(owner,c,inp,'MASKED',jsonb_build_object('masked_text','합성 문장','masked_text_hash',repeat('b',64),'pii_policy_version','test'));
 perform fstest.expect_fail(format('select private.reserve_finshield_model_usage(%L,%L,%L,null,null,%L,%L,100)',
 '00000000-0000-4000-8000-00000000000b',c,inp,'claude-sonnet-5','sonnet5-usd-20260907'),'다른 소유자의 입력 예산 거부');
 reservation:=private.reserve_finshield_model_usage(owner,c,inp,null,null,'claude-sonnet-5','sonnet5-usd-20260907',900000);
 perform fstest.expect_fail(format('select private.reserve_finshield_model_usage(%L,%L,%L,null,null,%L,%L,200000)',owner,c,inp,'claude-sonnet-5','sonnet5-usd-20260907'),'예약액을 포함한 상한 초과 거부');
 select jsonb_object_agg(c.id::text,jsonb_build_object('reserved',c.reserved_microunits-900000,'consumed',c.consumed_microunits)) into baseline
 from private.usage_reservation_counters rc join private.usage_budget_counters c on c.id=rc.counter_id where rc.reservation_id=reservation;
 perform private.flag_usage_reconciliation(reservation,'PROVIDER_RESULT_UNKNOWN');
 if not exists(select 1 from private.usage_reservations where id=reservation and status='RESERVED' and reconcile_required) then raise exception '불명확한 비용 해제';end if;
 perform private.settle_usage_budget(reservation,400,'{"input_tokens":100,"output_tokens":20,"status_category":"REFUSAL","retry_count":0}');
 select count(*) into n from private.usage_reservation_counters rc join private.usage_budget_counters c on c.id=rc.counter_id
 where rc.reservation_id=reservation and c.consumed_microunits=(baseline->c.id::text->>'consumed')::bigint+400 and c.reserved_microunits=(baseline->c.id::text->>'reserved')::bigint;
 if n<>4 then raise exception '네 범위 원장 정산 실패';end if;
 perform fstest.expect_fail(format('select private.settle_usage_budget(%L,400)',reservation),'동일 응답 중복 정산 거부');

 select * into d from private.create_demo_session('sunshine-loan-text','LIVE',interval '1 hour');
 select id into manifest from private.execution_manifests limit 1;
 insert into demo.runs(session_id,execution_manifest_id,status,started_at)values(d.session_id,manifest,'RUNNING',now())returning id into dr;
 reservation:=private.reserve_finshield_model_usage(null,null,null,null,dr,'claude-sonnet-5','sonnet5-usd-20260907',100);
 if not exists(select 1 from private.usage_reservations where id=reservation and demo_run_id=dr and run_id is null and case_input_id is null) then raise exception 'Demo 회원 원장 혼합';end if;
 perform private.release_usage_budget(reservation,'PROVIDER_NOT_BILLED');
 raise notice '  통과: 마스킹 전·타인 입력 차단·예약 합산 상한·4범위 정산·중복 정산 거부·Demo 분리';
end $$;
rollback;
