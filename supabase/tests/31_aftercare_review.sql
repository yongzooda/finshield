-- PC-005/007: 실제 점검 Job·소유권·미확정 복구·예산·이전 Passport 보존. 합성 SQL Trace이며 모델 호출은 없다.
begin;
create function fstest.profile_policy_probe(p_owner uuid,p_mode text,p_statement text default '햇살론15 대출기간 안내')
returns uuid language plpgsql as $$
declare cid uuid; inp uuid; claim uuid; run uuid; man uuid; ar uuid; tr uuid; snap uuid; ev uuid;
 locator jsonb; finals jsonb; passport uuid;
begin
 select id into man from private.execution_manifests where manifest_version='finshield-p0-loan-v3';
 cid:=private.create_case(p_owner,'LOAN','합성 프로필 정책 시험',gen_random_uuid()::text,repeat('a',64));
 inp:=private.create_text_input(p_owner,cid,100,86400);
 perform private.advance_input_stage(p_owner,cid,inp,'VALIDATED','{}');
 perform private.advance_input_stage(p_owner,cid,inp,'EXTRACTED','{}');
 perform private.advance_input_stage(p_owner,cid,inp,'MASKED',jsonb_build_object('masked_text',p_statement,'masked_text_hash',repeat('b',64),'pii_policy_version','pii-policy-v1'));
 claim:=private.record_extracted_claim(p_owner,cid,inp,null,'PRODUCT_TERM',p_statement,'NON_MATERIAL','MODEL');
 perform private.confirm_case_claims(p_owner,cid,jsonb_build_array(jsonb_build_object('claim_id',claim,'expected_revision_no',1)));
 perform private.transition_financial_case(p_owner,cid,'INPUT_REVIEW','USER','CLAIMS_CONFIRMED');
 run:=private.create_verification_run(p_owner,cid,man,gen_random_uuid()::text,repeat('c',64),'INITIAL',null);
 perform private.start_verification_run(run);
 if p_mode<>'NONE' then
  insert into public.agent_runs(owner_id,case_id,verification_run_id,logical_agent_key,agent_code,agent_version,attempt_no,status,
   input_schema_version,output_schema_version,prompt_version,model_provider,model_id,started_at,finished_at)
  values(p_owner,cid,run,'PRODUCT_INSTITUTION','PRODUCT_INSTITUTION','p0-v2',1,'SUCCEEDED','in-v1','out-v1','product-institution-v2','anthropic','claude-sonnet-5',now(),now()) returning id into ar;
  insert into public.tool_runs(owner_id,case_id,verification_run_id,agent_run_id,logical_tool_key,tool_code,tool_version,transport,attempt_no,status,
   input_schema_version,output_schema_version,sanitized_scope,provenance_complete,candidate_count,selected_count,started_at,finished_at)
  values(p_owner,cid,run,ar,'product','search_financial_product','p0-v2','FUNCTION',1,'SUCCEEDED','in-v1','out-v1','{"schema_version":"1"}',true,1,1,now(),now()) returning id into tr;
  snap:=private.record_source_snapshot('PRODUCT','B','합성 시험 기관','합성 상품 조건',
   'https://www.kinfa.or.kr/financialProduct/hessalLoan.do','kinfa:hessalLoan',null,null,null,null,'synthetic-profile-test',
   repeat('a',64),repeat('b',64),'FRESH',null,true,true,'profile-policy-test',run::text);
  locator:=jsonb_build_object('schema_version','1','temporal_status',case when p_mode='ENDED' then 'ENDED' else 'NO_END_NOTICE' end,
   'assessed_on',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'),
   'profile_terms',jsonb_build_object('schema_version','kinfa-hessal-profile-terms-v1','term_months',jsonb_build_array(36,60),
    'product_id','kinfa:hessalLoan','product_name','햇살론15','product_kind','LOAN','early_repayment_fee','UNKNOWN'));
  insert into public.evidences(owner_id,case_id,verification_run_id,kb_snapshot_id,produced_by_tool_run_id,source_locator,
   directness,citable,reference_only,incomplete,freshness_at_use,target_match,independence_key,selection_reason_code,content_hash)
  values(p_owner,cid,run,snap,tr,locator,'DIRECT',true,false,false,'FRESH',true,repeat('b',64),'SYNTHETIC_PROFILE_TEST',repeat('a',64)) returning id into ev;
 end if;
 finals:=jsonb_build_array(jsonb_build_object('claim_id',claim,'status',case when ev is null then 'UNKNOWN' else 'VERIFIED' end,
  'reason_code','SYNTHETIC_PROFILE_TEST','cove_status','NOT_REQUIRED','red_team_status','NOT_REQUIRED',
  'decision_summary_masked','합성 정책 시험이며 실제 Agent 실행은 없음',
  'evidences',case when ev is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('evidence_id',ev,'relation','SUPPORT','is_independent',true,'policy_reason_code','DIRECT_FRESH')) end));
 -- 전달된 적합성 CONFIRMED를 SQL이 신뢰하지 않아야 한다.
 passport:=private.finalize_verification_run(run,finals,'[{"axis":"AUTHENTICITY","result_code":"UNCERTAIN","summary_masked":"합성","limitation_codes":[]},
  {"axis":"TRANSACTION_SALES_RISK","result_code":"UNCERTAIN","summary_masked":"합성","limitation_codes":[]},
  {"axis":"SUITABILITY","result_code":"CONFIRMED","summary_masked":"전달값을 신뢰하면 실패","limitation_codes":[]}]');
 return passport;
end $$;

create function fstest.fail_aftercare_assessment() returns trigger language plpgsql as $$
begin if current_setting('fstest.aftercare_fail',true)='1' then raise exception 'SYNTHETIC_ASSESSMENT_WRITE_FAILURE';end if;return new;end $$;
create trigger fstest_aftercare_failure before insert on public.precase_assessments for each row execute function fstest.fail_aftercare_assessment();
delete from private.usage_reservations;
delete from private.usage_budget_counters;
delete from private.budget_limits;
insert into private.budget_limits(scope_type,provider,model,limit_microunits,policy_version)
 select s,p,'*',1000,'aftercare-synthetic' from unnest(array['GLOBAL_DAY','OWNER_DAY','CASE','RUN']) s cross join unnest(array['all','anthropic','cohere']) p;
do $$
declare owner uuid:='00000000-0000-4000-8000-00000000000a'; other_owner uuid:='00000000-0000-4000-8000-00000000000b';
 p uuid; cid uuid; man uuid; job uuid; key uuid:=gen_random_uuid(); lease uuid; assessment uuid; reservation uuid; input jsonb;
 trace jsonb; context jsonb; old_hash text; clone uuid;
begin
 p:=fstest.profile_policy_probe(owner,'NONE');
 select case_id,execution_manifest_id,payload_hash into cid,man,old_hash from public.evidence_passports where id=p;
 perform private.record_enrollment(owner,cid,'BRANCH',current_date,'합성 가입 후 점검');
 input:='{"schema_version":"aftercare-review-v1","answers":[{"question_code":"UNDERSTOOD_TERMS","answer_code":"NO","question_version":"aftercare-v2"}],"comparison":[]}';
 job:=private.enqueue_precase_review(owner,cid,p,man,key,repeat('a',64),input);
 if private.enqueue_precase_review(owner,cid,p,man,key,repeat('a',64),input)<>job then raise exception '접수 중복';end if;
 perform fstest.expect_fail(format('select private.enqueue_precase_review(%L,%L,%L,%L,%L,%L,%L)',owner,cid,p,man,key,repeat('b',64),input),'동일 key 본문 변경');
 perform fstest.expect_fail(format('select private.enqueue_precase_review(%L,%L,%L,%L,%L,%L,%L)',other_owner,cid,p,man,key,repeat('a',64),input),'다른 회원 접수');
 if private.claim_precase_dispatch(other_owner,cid,job) then raise exception '다른 회원 예약';end if;
 if not private.claim_precase_dispatch(owner,cid,job) or private.claim_precase_dispatch(owner,cid,job) then raise exception '중복 배포 예약';end if;
 lease:=private.claim_precase_review(job);
 if lease is null or private.claim_precase_review(job) is not null then raise exception '중복 Worker 선점';end if;
 if private.heartbeat_precase_review(job,gen_random_uuid()) then raise exception '다른 Lease 수락';end if;
 context:=private.precase_review_context(job);
 if jsonb_array_length(context->'claims')<>1 or context#>>'{claims,0,statement_masked}'<>'햇살론15 대출기간 안내' then raise exception '기준 Claim 복원 실패';end if;
 reservation:=private.reserve_precase_usage(owner,cid,job,'anthropic','claude-sonnet-5','synthetic',600);
 if (select count(*) from private.usage_reservation_counters where reservation_id=reservation)<>8 then raise exception '점검 전체/Provider 비용 누락';end if;
 perform fstest.expect_fail(format('select private.reserve_precase_usage(%L,%L,%L,%L,%L,%L,500)',owner,cid,job,'cohere','embed-v4.0','synthetic'),'점검 Provider 합산 초과');
 perform private.flag_usage_reconciliation(reservation,'PROVIDER_RESULT_UNKNOWN');
 if (select reserved_microunits from private.usage_budget_counters where provider='all' and scope_type='GLOBAL_DAY')<>600 then raise exception '미확정 예약 유실';end if;
 perform private.settle_usage_budget(reservation,100,'{"status_category":"OK"}');
 trace:='{"agent_code":"PRODUCT_INSTITUTION","version":"p0-v2","model_id":"claude-sonnet-5","status":"SUCCEEDED","tools":[]}';
 perform fstest.expect_fail(format('select private.record_precase_agent(%L,%L,%L)',job,lease,trace),'가입 후 Allowlist 밖 Agent');
 trace:='{"agent_code":"SALES_CONDUCT","version":"p0-v2","model_id":"claude-sonnet-5","status":"PARTIAL","tools":[]}';
 if private.record_precase_agent(job,gen_random_uuid(),trace) then raise exception '오래된 Worker 기록';end if;
 if not private.record_precase_agent(job,lease,trace) or not private.record_precase_agent(job,lease,trace) then raise exception 'Agent 저장 멱등 실패';end if;
 trace:='{"agent_code":"REGULATION_DISPUTE","version":"p0-v2","model_id":"claude-sonnet-5","status":"SUCCEEDED","tools":[{"tool_code":"parse_url_host","version":"p0-v2","purpose_code":"PARSE_URL","sources":[]}]}';
 perform fstest.expect_fail(format('select private.record_precase_agent(%L,%L,%L)',job,lease,trace),'Allowlist 밖 Tool');
 trace:='{"agent_code":"REGULATION_DISPUTE","version":"p0-v2","model_id":"claude-sonnet-5","status":"FAILED","tools":[]}';
 perform private.record_precase_agent(job,lease,trace);
 perform set_config('fstest.aftercare_fail','1',true);
 perform fstest.expect_fail(format('select private.finish_precase_review(%L,%L,%L,%L,%L)',job,lease,'NORMAL_MANAGEMENT','합성 실패 주입','[]'),'점검 결과 쓰기 실패');
 if (select status from public.precase_review_jobs where id=job)<>'RUNNING' or exists(select 1 from public.precase_assessments where case_id=cid) then raise exception '실패 트랜잭션 부분 저장';end if;
 perform set_config('fstest.aftercare_fail','0',true);
 assessment:=private.finish_precase_review(job,lease,'NORMAL_MANAGEMENT','합성 규칙 결과','[]');
 if assessment is null or (select status<>'PARTIAL' or result<>'ADDITIONAL_EXPLANATION' from public.precase_assessments where id=assessment) then raise exception '실패한 Agent 검토가 정상 완료';end if;
 if private.finish_precase_review(job,lease,'NORMAL_MANAGEMENT','중복 결과','[]')<>assessment then raise exception '종결 중복';end if;
 if (select count(*) from public.precase_assessments where case_id=cid)<>1 then raise exception '중복 점검 생성';end if;
 if (select payload_hash from public.evidence_passports where id=p)<>old_hash then raise exception '과거 Passport 변경';end if;
 clone:=private.enqueue_precase_review(owner,cid,p,man,gen_random_uuid(),repeat('c',64),input);lease:=private.claim_precase_review(clone);
 trace:='{"agent_code":"SALES_CONDUCT","version":"p0-v2","model_id":"claude-sonnet-5","status":"SUCCEEDED","tools":[{"tool_code":"check_documents","version":"p0-v2","purpose_code":"CHECK_DOCUMENTS","status":"SUCCEEDED","provenance_complete":true,"sources":[]}]}';
 perform private.record_precase_agent(clone,lease,trace);
 trace:='{"agent_code":"REGULATION_DISPUTE","version":"p0-v2","model_id":"claude-sonnet-5","status":"SUCCEEDED","tools":[{"tool_code":"lookup_statute","version":"p0-v2","purpose_code":"LOOKUP_LAW","status":"SUCCEEDED","provenance_complete":true,"sources":[]}]}';
 -- 실제 Registry의 목적 코드와 일치시킨 합성 Tool 실행이다.
 trace:=jsonb_set(trace,'{tools,0,purpose_code}',to_jsonb((select al.purpose_code from private.agent_tool_allowlists al join private.agent_definitions a on a.id=al.agent_definition_id join private.tool_definitions t on t.id=al.tool_definition_id where a.agent_code='REGULATION_DISPUTE' and a.version='p0-v2' and t.tool_code='lookup_statute' and t.version='p0-v2')));
 perform private.record_precase_agent(clone,lease,trace);
 assessment:=private.finish_precase_review(clone,lease,'ADDITIONAL_EXPLANATION','정상 실행되었지만 자료가 없어 추가 설명 필요','[]');
 if assessment is null or (select status from public.precase_review_jobs where id=clone)<>'COMPLETED' then raise exception '두 Agent 정상 실행 종결 실패';end if;
 clone:=private.enqueue_precase_review(owner,cid,p,man,gen_random_uuid(),repeat('d',64),input);lease:=private.claim_precase_review(clone);
 update public.precase_review_jobs set leased_until=now()-interval '1 second' where id=clone;
 if private.claim_precase_review(clone) is not null then raise exception '미확정 Provider 재호출 허용';end if;
 if (select status<>'FAILED' or reason_code<>'PROVIDER_RESULT_UNKNOWN' from public.precase_review_jobs where id=clone) then raise exception '미확정 실행 종결 누락';end if;
 clone:=private.enqueue_precase_review(owner,cid,p,man,gen_random_uuid(),repeat('e',64),input);lease:=private.claim_precase_review(clone);
 if private.stop_precase_reviews(other_owner,cid,clone)<>0 then raise exception '다른 회원 취소';end if;
 if private.stop_precase_reviews(owner,cid,clone)<>1 or private.heartbeat_precase_review(clone,lease) then raise exception '취소 후 Worker 활성';end if;
 perform fstest.expect_fail(format('select private.reserve_precase_usage(%L,%L,%L,%L,%L,%L,1)',owner,cid,clone,'anthropic','claude-sonnet-5','synthetic'),'취소 후 모델 비용 예약');
 clone:=private.enqueue_precase_review(owner,cid,p,man,gen_random_uuid(),repeat('f',64),input);
 update public.precase_review_jobs set deadline_at=now()-interval '1 second' where id=clone;
 if private.stop_precase_reviews(owner,cid,null)<>1 then raise exception '대기 작업 기한 회수 실패';end if;
 if private.finish_precase_review(clone,lease,'NORMAL_MANAGEMENT','오래된 Worker','[]') is not null then raise exception '종결 뒤 늦은 결과 저장';end if;
 perform fstest.expect_fail('set local role finshield_worker; select * from public.precase_review_jobs','Worker 직접 본문 읽기');
 raise notice '31_aftercare_review 시험을 모두 통과했습니다';
end $$;
rollback;
