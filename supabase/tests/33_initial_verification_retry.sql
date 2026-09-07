-- S-009·N-PERF-009·EC-020: timeout·연결 단절 뒤 초기 Run을 하나만 종결하고 재시도한다.
\echo '초기 검증 timeout과 명시 재시도 복구'
begin;
do $$
declare owner uuid:='00000000-0000-4000-8000-00000000000a'; c uuid; inp uuid; claim uuid;
 man uuid; first_run uuid; second_run uuid; recovered uuid;
begin
 select id into strict man from private.execution_manifests where manifest_version='finshield-p0-loan-v3';
 c:=private.create_case(owner,'LOAN','합성 초기 재시도','initial-retry-test',repeat('a',64));
 inp:=private.create_text_input(owner,c,100,86400);
 perform private.advance_input_stage(owner,c,inp,'VALIDATED','{}');
 perform private.advance_input_stage(owner,c,inp,'EXTRACTED','{}');
 perform private.advance_input_stage(owner,c,inp,'MASKED',jsonb_build_object('masked_text','햇살론15 금리 확인','masked_text_hash',repeat('b',64),'pii_policy_version','test'));
 claim:=private.record_extracted_claim(owner,c,inp,null,'PRODUCT_TERM','햇살론15 금리 확인','MATERIAL','MODEL');
 recovered:=private.prepare_initial_verification_retry(owner,c,null);
 if recovered is not null or (select lifecycle from public.financial_cases where id=c)<>'INPUT_REVIEW' then
   raise exception '최초 실행 준비 실패';
 end if;
 perform private.confirm_case_claims(owner,c,jsonb_build_array(jsonb_build_object('claim_id',claim,'expected_revision_no',1)));
 first_run:=private.create_verification_run(owner,c,man,'initial-retry-1',repeat('c',64),'INITIAL',null);
 perform private.start_verification_run(first_run);

 perform fstest.expect_fail(format('select private.prepare_initial_verification_retry(%L,%L,null)',owner,c),'살아 있는 Run 자동 종결 거부');
 perform fstest.expect_fail(format('select private.prepare_initial_verification_retry(%L,%L,%L)',owner,c,gen_random_uuid()),'다른 Run ID로 중단 거부');
 recovered:=private.prepare_initial_verification_retry(owner,c,first_run);
 if recovered<>first_run or (select status from public.verification_runs where id=first_run)<>'FAILED'
   or (select reason_code from public.verification_runs where id=first_run)<>'CLIENT_RETRY'
   or (select lifecycle from public.financial_cases where id=c)<>'INPUT_REVIEW' then
   raise exception '명시 재시도 종결 실패';
 end if;
 if private.prepare_initial_verification_retry(owner,c,first_run) is not null
   or (select count(*) from public.case_events where case_id=c and event_type='RUN_FAILED' and payload->>'run_id'=first_run::text)<>1 then
   raise exception '반복 종결이 원장을 추가';
 end if;

 perform private.confirm_case_claims(owner,c,jsonb_build_array(jsonb_build_object('claim_id',claim)));
 second_run:=private.create_verification_run(owner,c,man,'initial-retry-2',repeat('d',64),'INITIAL',null);
 perform private.start_verification_run(second_run);
 update public.verification_runs set created_at=created_at-interval '121 seconds',
   started_at=started_at-interval '121 seconds',deadline_at=deadline_at-interval '121 seconds'
   where id=second_run;
 recovered:=private.prepare_initial_verification_retry(owner,c,null);
 if recovered<>second_run or (select status from public.verification_runs where id=second_run)<>'FAILED'
   or (select reason_code from public.verification_runs where id=second_run)<>'DEADLINE_EXCEEDED'
   or (select lifecycle from public.financial_cases where id=c)<>'INPUT_REVIEW' then
   raise exception '기한 초과 자동 종결 실패';
 end if;
 raise notice '  통과: 실행 중 보호·명시 재시도·기한 초과·중복 종결 방지';
end $$;
do $$ begin raise notice '33_initial_verification_retry 시험을 모두 통과했습니다'; end $$;
rollback;
