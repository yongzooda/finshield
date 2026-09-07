-- AUTH-008·RES-001·PASS-002: 모델 없이 실제 Run → 최종화 → Passport → Profile 변경을 검증한다.
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

do $$
declare owner uuid:='00000000-0000-4000-8000-00000000000a';other_owner uuid:='00000000-0000-4000-8000-00000000000b';
 skipped_owner uuid:=gen_random_uuid(); p uuid; before_axes jsonb; after_axes jsonb; p_hash text; run uuid; data jsonb; cid uuid;
begin
 insert into auth.users(id) values(skipped_owner);
 p:=fstest.profile_policy_probe(skipped_owner,'NONE');
 data:=private.read_finalized_axes(skipped_owner,p);
 if not data @> '[{"axis":"SUITABILITY","result_code":"NEED_MORE_INFORMATION","limitation_codes":["PROFILE_SKIPPED"]}]' then raise exception '건너뛰기 확정 방지 실패';end if;
 update public.financial_profiles set schema_version='v1',income_band='BAND_4',debt_burden_band='HIGH',emergency_fund_band='BAND_0',
  purpose_code='INVESTMENT',horizon_code='SHORT',liquidity_need='HIGH',loss_tolerance='LOW',completeness='COMPLETE' where owner_id=owner;
 p:=fstest.profile_policy_probe(owner,'CURRENT');
 select verification_run_id,payload_hash,case_id into run,p_hash,cid from public.evidence_passports where id=p;
 before_axes:=private.read_finalized_axes(owner,p);
 select x into data from jsonb_array_elements(before_axes) x where x->>'axis'='SUITABILITY';
 if data->>'result_code'<>'UNCERTAIN' or jsonb_array_length(data#>'{policy_evaluation,products}')<>1
   or not data#>'{policy_evaluation,checks}' @> '[{"rule_code":"LOAN_HORIZON","outcome":"CAUTION"},{"rule_code":"LOAN_DEBT_BURDEN","outcome":"CAUTION"},{"rule_code":"LOAN_ELIGIBILITY","outcome":"NEED_INPUT"}]' then
  raise exception '부담·기간·가입 요건 분리 실패: %',data;end if;
 if not (select manifest->'policy_versions'->>'profile'='profile-policy-v2' from public.evidence_passports where id=p) then raise exception '정책 버전 고정 실패';end if;
 if not exists(select 1 from public.evidence_passports ep join public.verification_axis_results ax on ax.verification_run_id=ep.verification_run_id and ax.axis='SUITABILITY'
  where ep.id=p and ep.manifest->'axis_results' @> jsonb_build_array(jsonb_build_object('axis','SUITABILITY','content_hash',ax.content_hash))) then raise exception 'Trace 해시가 Passport에 없음';end if;
 update public.financial_profiles set income_band='BAND_1',debt_burden_band='LOW',emergency_fund_band='BAND_3',purpose_code='LOAN_LIVING',horizon_code='LONG' where owner_id=owner;
 after_axes:=private.read_finalized_axes(owner,p);
 if before_axes<>after_axes or (select payload_hash from public.evidence_passports where id=p)<>p_hash then raise exception '현재 프로필 수정이 이전 Passport 변경';end if;
 if private.read_finalized_axes(other_owner,p) is not null then raise exception '타인의 비교 내역 조회 허용';end if;
 begin update public.verification_axis_results set policy_evaluation='{}' where verification_run_id=run;raise exception '정책 기록 변조 허용';exception when restrict_violation then null;end;
 p:=fstest.profile_policy_probe(owner,'NONE');
 data:=private.read_finalized_axes(owner,p);
 if not data @> '[{"axis":"SUITABILITY","result_code":"NEED_MORE_INFORMATION","limitation_codes":["CURRENT_PRODUCT_CONDITIONS_UNVERIFIED","ELIGIBILITY_NOT_ASSESSED"]}]' then raise exception '프로필 완전성으로 적합성 확정';end if;
 p:=fstest.profile_policy_probe(owner,'ENDED');
 select x into data from jsonb_array_elements(private.read_finalized_axes(owner,p)) x where x->>'axis'='SUITABILITY';
 if data#>'{policy_evaluation,products}'<>'[]'::jsonb then raise exception '종료 상품 조건 재사용';end if;
 p:=fstest.profile_policy_probe(owner,'CURRENT','다른 은행 상품의 대출기간 안내');
 select x into data from jsonb_array_elements(private.read_finalized_axes(owner,p)) x where x->>'axis'='SUITABILITY';
 if data#>'{policy_evaluation,products}'<>'[]'::jsonb then raise exception '이름이 다른 상품 조건 재사용';end if;
 if (select profile_policy_version from private.execution_manifests where manifest_version='finshield-p0-loan-v2')<>'profile-policy-v1' then raise exception '과거 Manifest 변경';end if;
 raise notice '통과: 실제 최종화·자기신고 확정 거부·부담/기간/가입 분리·종료/다른 상품 제외·현재 프로필 변경 후 불변·교차 회원 거부·이전 Manifest 보존';
end $$;
do $$ begin raise notice '30_profile_policy 시험을 모두 통과했습니다'; end $$;
rollback;
