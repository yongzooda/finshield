-- PC-008: 같은 Case 문서·확인·원본 정리·Passport 불변의 실제 격리 DB 시험.
begin;
-- 격리 Fixture의 과거 비용 원장을 시험 트랜잭션 안에서만 비운다.
delete from private.usage_reservations;
delete from private.usage_budget_counters;
delete from private.budget_limits;
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
declare owner uuid:='00000000-0000-4000-8000-00000000000a'; other_owner uuid:='00000000-0000-4000-8000-00000000000b';
 p uuid; cid uuid; target uuid; man uuid; slot record; page uuid; term uuid; sel jsonb; source jsonb; job_input jsonb;
 before_hash text; before_claims integer; before_lifecycle public.case_lifecycle; old_input uuid; job uuid; reservation uuid;
begin
 p:=fstest.profile_policy_probe(owner,'NONE');
 select case_id,execution_manifest_id,payload_hash into cid,man,before_hash from public.evidence_passports where id=p;
 select claim_id into target from public.final_claim_versions where case_id=cid limit 1;
 select count(*) into before_claims from public.claims where case_id=cid;
 select lifecycle into before_lifecycle from public.financial_cases where id=cid;
 perform fstest.expect_fail(format('select private.open_aftercare_upload_slot(%L,%L,%L,%L,100)',owner,cid,'IMAGE','image/png'),'가입 등록 없는 문서 거부');
 perform private.record_enrollment(owner,cid,'BRANCH',current_date,'합성 문서 시험');
 perform fstest.expect_fail(format('select private.open_aftercare_upload_slot(%L,%L,%L,%L,100)',other_owner,cid,'IMAGE','image/png'),'타인 Case 업로드 거부');
 select * into slot from private.open_aftercare_upload_slot(owner,cid,'IMAGE','image/png',100);
 old_input:=slot.case_input_id;
 if (select input_purpose from public.case_inputs where id=old_input)<>'AFTERCARE' then raise exception '목적 미고정';end if;
 perform fstest.expect_fail(format('update public.case_inputs set input_purpose=%L where id=%L','PROPOSAL',old_input),'문서 목적 변경 거부');
 perform fstest.expect_fail(format('select private.open_aftercare_upload_slot(%L,%L,%L,%L,100)',owner,cid,'PDF','application/pdf'),'기존 미완료 문서 중복 거부');
 perform private.record_file_ocr_consent(owner,cid,old_input,false);
 perform private.confirm_upload_slot(slot.object_id,'89504e470d0a1a0a');
 perform private.advance_input_stage(owner,cid,old_input,'VALIDATED','{"detected_mime":"image/png","magic_signature":"89504e470d0a1a0a"}');
 if private.authorize_file_ocr(owner,cid,old_input) then raise exception '동의 거절 후 OCR 승인';end if;
 perform private.register_input_pages(owner,cid,old_input,1,'SUCCEEDED','v1');
 select id into page from public.case_input_pages where case_input_id=old_input;
 perform private.advance_input_stage(owner,cid,old_input,'EXTRACTED','{}');
 perform private.advance_input_stage(owner,cid,old_input,'MASKED','{"masked_text":"기간은 36개월입니다","masked_text_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pii_policy_version":"v1"}');
 -- 실제 파서 뒤 모델 비용 예약도 같은 완료 Case를 허용해야 한다.
 insert into private.budget_limits(scope_type,provider,model,limit_microunits,policy_version)
 select scope,provider,model,1000000,'isolated-aftercare-budget-test'
 from unnest(array['GLOBAL_DAY','OWNER_DAY','CASE','RUN']) scope
 cross join (values ('anthropic','claude-sonnet-5'),('all','*')) providers(provider,model)
 on conflict(scope_type,provider,model) do update set limit_microunits=excluded.limit_microunits;
 perform fstest.expect_fail(format('select private.reserve_finshield_model_usage(%L,%L,%L,null,null,%L,%L,100)',other_owner,cid,old_input,'claude-sonnet-5','test'),'타인 계약 문서 예약 거부');
 reservation:=private.reserve_finshield_model_usage(owner,cid,old_input,null,null,'claude-sonnet-5','test',100);
 if (select count(*) from private.usage_reservation_counters where reservation_id=reservation)<>8 then raise exception '개별·합산 8범위 예약 누락';end if;
 perform private.settle_usage_budget(reservation,40,'{"input_tokens":10,"output_tokens":2}');
 if exists(select 1 from private.usage_reservation_counters rc join private.usage_budget_counters b on b.id=rc.counter_id
   where rc.reservation_id=reservation and (b.reserved_microunits<>0 or b.consumed_microunits<40)) then raise exception '가입 후 예약 정산 실패';end if;
 perform fstest.expect_fail(format('select private.reserve_finshield_model_usage(%L,%L,%L,null,null,%L,%L,1000001)',owner,cid,old_input,'claude-sonnet-5','test'),'가입 후 상한 초과 거부');
 term:=private.record_file_claim(owner,cid,old_input,page,'PRODUCT_TERM','기간은 36개월입니다','NON_MATERIAL','{"schema_version":"v1","kind":"masked_text_span","page_no":1,"start":0,"end":12}');
 if exists(select 1 from public.claims where id=term) then raise exception '계약 문구가 거래 전 Claim에 혼입';end if;
 sel:=jsonb_build_array(jsonb_build_object('id',term,'target_claim_id',target,'statement_masked','기간은 60개월입니다'));
 perform fstest.expect_fail(format('select private.confirm_aftercare_document(%L,%L,%L,%L,%L)',other_owner,cid,old_input,p,sel),'타인 문서 확인 거부');
 perform private.confirm_aftercare_document(owner,cid,old_input,p,sel);
 perform private.confirm_aftercare_document(owner,cid,old_input,p,sel);
 perform fstest.expect_fail(format('select private.reserve_finshield_model_usage(%L,%L,%L,null,null,%L,%L,100)',owner,cid,old_input,'claude-sonnet-5','test'),'확인 완료 문서 재호출 예약 거부');
 if (select original_statement_masked from public.precase_document_terms where id=term)<>'기간은 36개월입니다'
  or (select statement_masked from public.precase_document_terms where id=term)<>'기간은 60개월입니다' then raise exception '인식 원문·사용자 수정 이력 유실';end if;
 perform fstest.expect_fail(format('select private.confirm_aftercare_document(%L,%L,%L,%L,%L)',owner,cid,old_input,p,
  jsonb_set(sel,'{0,statement_masked}','"다른 문구"')),'확정 후 문구 변경 거부');
 if (select count(*) from private.file_cleanup_jobs where target_id=slot.object_id)<>1 then raise exception '확인 삭제 중복 또는 누락';end if;
 if (select lifecycle from public.financial_cases where id=cid)<>before_lifecycle
  or (select count(*) from public.claims where case_id=cid)<>before_claims
  or (select payload_hash from public.evidence_passports where id=p)<>before_hash then raise exception '기존 Case·Claim·Passport 변경';end if;
 select jsonb_build_object('id',id,'input_id',case_input_id,'target_claim_id',target_claim_id,'statement_masked',statement_masked,
  'original_statement_masked',original_statement_masked,'source_locator',source_locator) into source from public.precase_document_terms where id=term;
 job_input:=jsonb_build_object('schema_version','aftercare-review-v1','answers','[]'::jsonb,'comparison',jsonb_build_array(jsonb_build_object(
  'claim_id',target,'before','햇살론15 대출기간 안내','contract','기간은 60개월입니다','result','DIFFERENT_TEXT')),'document_sources',jsonb_build_array(source));
 perform fstest.expect_fail(format('select private.enqueue_precase_review(%L,%L,%L,%L,%L,%L,%L)',owner,cid,p,man,gen_random_uuid(),repeat('a',64),
  jsonb_set(job_input,'{document_sources,0,statement_masked}','"위조 문구"')),'점검 문서 출처 위조 거부');
 job:=private.enqueue_precase_review(owner,cid,p,man,gen_random_uuid(),repeat('b',64),job_input);
 if (select input_masked->'document_sources' from public.precase_review_jobs where id=job)<>jsonb_build_array(source) then raise exception '점검 문서 출처 유실';end if;
 perform private.stop_precase_reviews(owner,cid,job);
 select * into slot from private.open_aftercare_upload_slot(owner,cid,'PDF','application/pdf',100);
 perform private.stop_case_input(owner,cid,slot.case_input_id,'USER_STOPPED');
 if not exists(select 1 from private.file_cleanup_jobs where target_id=slot.object_id) then raise exception '중단 삭제 누락';end if;
 perform fstest.expect_fail('set local role finshield_worker;select * from public.precase_document_terms','Worker 계약 본문 접근 거부');
 raise notice '32_aftercare_documents 시험을 모두 통과했습니다';
end $$;
rollback;
