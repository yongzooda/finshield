-- ============================================================
-- 0016 검증 최종화·재검증 최종화 시험 (명세 7.3, 6.5, 6.6, 요구사항 2.2)
--
-- 함수 경로로 Case → 입력 → Run → Agent·Tool·Evidence → 최종화 → Passport
-- 까지 한 바퀴 돌고, 재검증에서 CHANGED 와 NO_CHANGE 를 모두 만든다.
-- ============================================================

create temp table if not exists fctx (key text primary key, val uuid);
grant select on fctx to authenticated, finshield_worker;

-- 준비 Helper: Run 에 Agent 두 개(필수)와 Tool 하나, KB 근거 하나를 만든다.
create or replace function fstest.prepare_run_trace(p_run uuid, p_owner uuid, p_case uuid, p_key text)
returns uuid
language plpgsql
as $$
declare v_agent uuid; v_judge uuid; v_tool uuid; v_ev uuid;
begin
  insert into public.agent_runs
    (owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version, attempt_no, status,
     input_schema_version, output_schema_version, prompt_version, model_provider, model_id, input_tokens, output_tokens, cost_microunits, started_at, finished_at)
  values (p_owner, p_case, p_run, 'PRODUCT_INSTITUTION', 'PRODUCT_INSTITUTION', 'v1', 1, 'SUCCEEDED',
          'in-v1', 'out-v1', 'p-v1', 'anthropic', 'claude-sonnet-5', 1000, 200, 300, now(), now())
  returning id into v_agent;
  insert into public.agent_runs
    (owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version, attempt_no, status,
     input_schema_version, output_schema_version, prompt_version, model_provider, model_id, started_at, finished_at)
  values (p_owner, p_case, p_run, 'EVIDENCE_JUDGE', 'EVIDENCE_JUDGE', 'v1', 1, 'SUCCEEDED',
          'in-v1', 'out-v1', 'p-v1', 'anthropic', 'claude-sonnet-5', now(), now())
  returning id into v_judge;
  insert into public.tool_runs
    (owner_id, case_id, verification_run_id, agent_run_id, logical_tool_key, tool_code, tool_version, transport,
     attempt_no, status, input_schema_version, output_schema_version, sanitized_scope, provenance_complete,
     candidate_count, selected_count, cost_microunits, started_at, finished_at)
  values (p_owner, p_case, p_run, v_agent, 'law', 'law_search', 'v1', 'FUNCTION', 1, 'SUCCEEDED',
          'in-v1', 'out-v1', '{"schema_version":"1","as_of":"2026-09-05"}'::jsonb, true, 20, 1, 5, now(), now())
  returning id into v_tool;
  insert into public.evidences
    (owner_id, case_id, verification_run_id, kb_snapshot_id, produced_by_tool_run_id, source_locator,
     directness, citable, reference_only, incomplete, freshness_at_use, target_match, independence_key,
     selection_reason_code, content_hash)
  values (p_owner, p_case, p_run, '00000000-0000-4000-8000-00000000c001', v_tool, '{"schema_version":"1","article":"19"}'::jsonb,
          'DIRECT', true, false, false, 'FRESH', true, p_key, 'RERANK_TOP', repeat('e', 64))
  returning id into v_ev;
  return v_ev;
end;
$$;

\echo '65. 준비: 함수 경로로 Case·입력·Claim·Run'
do $$
declare v_case uuid; v_run uuid; v_ev uuid;
begin
  v_case := private.create_case('00000000-0000-4000-8000-00000000000a', 'LOAN', '최종화 시험 Case', 'fin-1', repeat('1', 64));
  perform private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v_case, 'INPUT_REVIEW');
  insert into public.case_inputs
    (id, owner_id, case_id, input_type, input_stage, raw_delete_status, pii_scan_status, raw_expires_at, masked_text, masked_text_hash, pii_policy_version)
  values ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-00000000000a', v_case, 'TEXT', 'MASKED', 'PENDING', 'PASSED',
          now() + interval '1 hour', '[마스킹] 상담', repeat('8', 64), 'pii-v1');
  insert into public.claims (id, owner_id, case_id, source_input_id, origin, claim_type, source_locator, extraction_method)
  values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-0000000000e5', 'EXTRACTED', 'INSTITUTION', '{"schema_version":"1"}'::jsonb, 'MODEL'),
         ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-0000000000e5', 'EXTRACTED', 'PRODUCT', '{"schema_version":"1"}'::jsonb, 'MODEL'),
         ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-0000000000e5', 'EXTRACTED', 'CHANNEL', '{"schema_version":"1"}'::jsonb, 'MODEL');
  insert into public.claim_revisions (owner_id, case_id, claim_id, revision_no, statement_masked, structured_value, materiality, user_confirmed, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-0000000000b1', 1, '기관은 A 저축은행', '{"schema_version":"1"}'::jsonb, 'MATERIAL', true, 'USER_EDIT', repeat('1', 64)),
         ('00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-0000000000b2', 1, '상품은 햇살론15', '{"schema_version":"1"}'::jsonb, 'MATERIAL', true, 'USER_EDIT', repeat('2', 64)),
         ('00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-0000000000b3', 1, '카카오톡으로 안내', '{"schema_version":"1"}'::jsonb, 'NON_MATERIAL', true, 'USER_EDIT', repeat('3', 64));
  v_run := private.create_verification_run('00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-00000000aa01', 'fin-run-1', repeat('a', 64));
  insert into fctx values ('case', v_case), ('run1', v_run);
  raise notice '  준비: Case % Run %', v_case, v_run;
end
$$;

\echo '66. 최종화 거부: RUNNING 아님·근거 없는 VERIFIED·빠진 Claim·축 부족'
select fstest.expect_fail(format($sql$
  select private.finalize_verification_run(%L, '[]'::jsonb, '[]'::jsonb)
$sql$, (select val from fctx where key = 'run1')), 'QUEUED Run 최종화');

do $$
declare v_run uuid := (select val from fctx where key = 'run1'); v_case uuid := (select val from fctx where key = 'case'); v_ev uuid;
  axes text := '[{"axis":"AUTHENTICITY","result_code":"AUTH_VERIFIED_SCOPE","summary_masked":"기관·상품 확인","limitation_codes":[]},
                {"axis":"TRANSACTION_SALES_RISK","result_code":"RISK_NONE_IN_SCOPE","summary_masked":"위험 신호 없음","limitation_codes":[]},
                {"axis":"SUITABILITY","result_code":"SUIT_NEED_MORE_INFORMATION","summary_masked":"프로필 일부 미입력","limitation_codes":["PROFILE_PARTIAL"]}]';
begin
  perform private.start_verification_run(v_run);
  v_ev := fstest.prepare_run_trace(v_run, '00000000-0000-4000-8000-00000000000a', v_case, 'fp-law-19');
  insert into fctx values ('ev1', v_ev);

  perform fstest.expect_fail(format($sql$
    select private.finalize_verification_run(%L,
      '[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","decision_summary_masked":"확인","evidences":[]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b2","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b3","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]'::jsonb,
      %L::jsonb)
  $sql$, v_run, v_ev, v_ev, axes), '근거 없는 VERIFIED');

  perform fstest.expect_fail(format($sql$
    select private.finalize_verification_run(%L,
      '[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]'::jsonb,
      %L::jsonb)
  $sql$, v_run, v_ev, axes), '검증 대상 Claim 이 빠진 최종화');

  perform fstest.expect_fail(format($sql$
    select private.finalize_verification_run(%L,
      '[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b2","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b3","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]'::jsonb,
      '[{"axis":"AUTHENTICITY","result_code":"AUTH_VERIFIED_SCOPE","summary_masked":"x","limitation_codes":[]}]'::jsonb)
  $sql$, v_run, v_ev, v_ev, v_ev), '축 결과 한 개');

  perform fstest.expect_fail(format($sql$
    select private.finalize_verification_run(%L,
      '[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"CONFLICT","reason_code":"AUTHORITY_CONFLICT","cove_status":"CHALLENGED","decision_summary_masked":"충돌","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b2","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b3","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]'::jsonb,
      %L::jsonb)
  $sql$, v_run, v_ev, v_ev, v_ev, axes), '한쪽 근거만 있는 CONFLICT');
  perform fstest.expect_fail(format($sql$
    select private.finalize_verification_run(%L,
      '[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b2","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b3","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]'::jsonb,
      %L::jsonb)
  $sql$, v_run, v_ev, v_ev, v_ev, axes), 'CoVe 없는 Material Claim');
  perform fstest.expect_fail(format($sql$
    select private.finalize_verification_run(%L,
      '[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","red_team_status":"COUNTER_EVIDENCE","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b2","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
        {"claim_id":"00000000-0000-4000-8000-0000000000b3","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"확인","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]'::jsonb,
      %L::jsonb)
  $sql$, v_run, v_ev, v_ev, v_ev, axes), 'Red Team 반대 근거가 있는데 VERIFIED');
  raise notice '  거부 확인: 최종화 전제·근거 정책·Claim 누락·축 수·CONFLICT 양측 근거·CoVe·Red Team';
end
$$;

\echo '67. 최종화 성공: 특별한 위험 신호 없음, Passport v1, Case VERIFIED'
do $$
declare v_run uuid := (select val from fctx where key = 'run1'); v_case uuid := (select val from fctx where key = 'case');
  v_ev uuid := (select val from fctx where key = 'ev1'); v_pp uuid; run public.verification_runs%rowtype; pp public.evidence_passports%rowtype; n int;
  v_channel uuid := (select id from kb.official_channel_registry where institution_code = 'INST_FSS' and channel_type = 'PHONE' and valid_to is null limit 1);
begin
  v_pp := private.finalize_verification_run(v_run,
    format('[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","red_team_status":"SUPPORTED_INITIAL","decision_summary_masked":"공식 등록 기관","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
             {"claim_id":"00000000-0000-4000-8000-0000000000b2","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","red_team_status":"SUPPORTED_INITIAL","decision_summary_masked":"공식 상품","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
             {"claim_id":"00000000-0000-4000-8000-0000000000b3","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"공식 채널","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]', v_ev, v_ev, v_ev)::jsonb,
    '[{"axis":"AUTHENTICITY","result_code":"AUTH_VERIFIED_SCOPE","summary_masked":"기관·상품 확인","limitation_codes":[]},
      {"axis":"TRANSACTION_SALES_RISK","result_code":"RISK_NONE_IN_SCOPE","summary_masked":"위험 신호 없음","limitation_codes":[]},
      {"axis":"SUITABILITY","result_code":"SUIT_NEED_MORE_INFORMATION","summary_masked":"프로필 일부 미입력","limitation_codes":["PROFILE_PARTIAL"]}]'::jsonb,
    format('{"status":"COMPLETED","guide_schema_version":"g1","actions":[{"action_no":1,"action_code":"KEEP_RECORDS","reason_code":"NO_RISK"}],"limitation_codes":[],"channels":[{"action_no":1,"official_channel_registry_id":"%s","display_order":1}]}', v_channel)::jsonb);
  insert into fctx values ('pp1', v_pp);
  select * into run from public.verification_runs where id = v_run;
  select * into pp from public.evidence_passports where id = v_pp;
  if run.status <> 'COMPLETED' or run.overall_result <> 'NO_SPECIAL_RISK_IN_VERIFIED_SCOPE' or not run.coverage_satisfied then
    raise exception 'Run 종결값이 다릅니다: % % %', run.status, run.overall_result, run.coverage_satisfied;
  end if;
  if run.input_tokens <> 1000 or run.cost_microunits <> 305 then raise exception 'Token·비용 집계가 다릅니다 (% / %)', run.input_tokens, run.cost_microunits; end if;
  if pp.passport_version_no <> 1 or pp.previous_passport_id is not null or pp.action_guide_id is null
     or not (pp.manifest ? 'final_claims') or jsonb_array_length(pp.manifest -> 'final_claims') <> 3 then
    raise exception 'Passport 내용이 다릅니다';
  end if;
  if (select lifecycle from public.financial_cases where id = v_case) <> 'VERIFIED'
     or (select latest_passport_id from public.financial_cases where id = v_case) <> v_pp then
    raise exception 'Case 가 VERIFIED·최신 Passport 로 갱신되지 않았습니다';
  end if;
  select count(*) into n from private.outbox_events where deduplication_key = 'notify-passport:' || v_pp::text;
  if n <> 1 then raise exception '알림 Outbox 가 없습니다'; end if;
  select count(*) into n from public.action_guide_channels where action_guide_id = pp.action_guide_id;
  if n <> 1 then raise exception 'Guide 채널 연결이 없습니다'; end if;
  raise notice '  허용 확인: 최종화는 Claim·근거·축·Guide·Passport·Run·Case·Outbox 를 한 Transaction 에 쓴다';
end
$$;
select fstest.expect_fail(format($sql$
  select private.finalize_verification_run(%L, '[]'::jsonb, '[]'::jsonb)
$sql$, (select val from fctx where key = 'run1')), '종결된 Run 재최종화');

\echo '68. 재검증 최종화: CHANGED (중대 모순) → NO_CHANGE'
do $$
declare v_case uuid := (select val from fctx where key = 'case'); v_job uuid; cl record; v_run uuid; v_ev uuid; v_ev2 uuid;
  job public.revalidation_jobs%rowtype; d public.passport_diffs%rowtype; pp public.evidence_passports%rowtype; n int;
  axes_risk text := '[{"axis":"AUTHENTICITY","result_code":"AUTH_CONTRADICTED","summary_masked":"기관 등록 불일치","limitation_codes":[]},
                     {"axis":"TRANSACTION_SALES_RISK","result_code":"RISK_MATERIAL","summary_masked":"위험","limitation_codes":[]},
                     {"axis":"SUITABILITY","result_code":"SUIT_NEED_MORE_INFORMATION","summary_masked":"미입력","limitation_codes":["PROFILE_PARTIAL"]}]';
begin
  v_job := private.enqueue_revalidation('00000000-0000-4000-8000-00000000000a', v_case, 'rv-fin-1', repeat('c', 64));
  select * into cl from private.claim_revalidation_job('worker-fin', 120);
  v_run := private.create_verification_run('00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-00000000aa01',
             'fin-run-2', repeat('b', 64), 'REVALIDATION', v_job);
  perform private.start_verification_run(v_run);
  v_ev := fstest.prepare_run_trace(v_run, '00000000-0000-4000-8000-00000000000a', v_case, 'fp-law-19');
  -- 다른 Lease token 은 거부
  perform fstest.expect_fail(format($sql$ select private.finalize_revalidation(%L, gen_random_uuid(), %L, '[]'::jsonb, '[]'::jsonb) $sql$, v_job, v_run),
    '다른 Lease token 으로 재검증 최종화');
  perform private.finalize_revalidation(v_job, cl.lease_token, v_run,
    format('[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"CONTRADICTED","reason_code":"REGISTRY_MISMATCH","cove_status":"CONFIRMED","red_team_status":"COUNTER_EVIDENCE","decision_summary_masked":"등록 기관 아님","evidences":[{"evidence_id":"%s","relation":"CONTRADICT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
             {"claim_id":"00000000-0000-4000-8000-0000000000b2","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","red_team_status":"SUPPORTED_INITIAL","decision_summary_masked":"공식 상품","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
             {"claim_id":"00000000-0000-4000-8000-0000000000b3","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"공식 채널","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]', v_ev, v_ev, v_ev)::jsonb,
    axes_risk::jsonb,
    '{"status":"COMPLETED","guide_schema_version":"g1","actions":[{"action_no":1,"action_code":"STOP_AND_REPORT","reason_code":"REGISTRY_MISMATCH"}],"limitation_codes":[],"channels":[]}'::jsonb);
  select * into job from public.revalidation_jobs where id = v_job;
  select * into d from public.passport_diffs where revalidation_job_id = v_job;
  select * into pp from public.evidence_passports where id = job.result_passport_id;
  if job.status <> 'CHANGED' or job.result_run_id <> v_run or not d.material_change then
    raise exception 'CHANGED 종결이 아닙니다 (% %)', job.status, d.material_change;
  end if;
  if jsonb_array_length(d.claim_changes) <> 1 or (d.claim_changes -> 0 ->> 'after') <> 'CONTRADICTED'
     or jsonb_array_length(d.result_changes) < 1 or jsonb_array_length(d.action_changes) <> 2 then
    raise exception 'Diff 내용이 다릅니다: % %', d.claim_changes, d.result_changes;
  end if;
  if pp.overall_result <> 'MATERIAL_RISK_FOUND' or pp.passport_version_no <> 2 or pp.previous_passport_id <> (select val from fctx where key = 'pp1') then
    raise exception '재검증 Passport 가 다릅니다 (% %)', pp.overall_result, pp.passport_version_no;
  end if;
  if (select latest_passport_id from public.financial_cases where id = v_case) <> pp.id
     or (select lifecycle from public.financial_cases where id = v_case) <> 'VERIFIED' then
    raise exception '재검증 뒤 Case 포인터·상태가 다릅니다';
  end if;
  select count(*) into n from private.outbox_events where deduplication_key = 'notify-revalidation:' || v_job::text
     and payload ->> 'notification_type' = 'MATERIAL_CHANGE_DETECTED';
  if n <> 1 then raise exception '중대 변경 알림 Outbox 가 없습니다'; end if;
  raise notice '  허용 확인: 재검증 CHANGED 는 Diff·새 Passport v2·중대 변경 알림을 남긴다';

  -- 같은 결과로 한 번 더: NO_CHANGE, 빈 Diff, 조용한 알림
  v_job := private.enqueue_revalidation('00000000-0000-4000-8000-00000000000a', v_case, 'rv-fin-2', repeat('c', 64));
  select * into cl from private.claim_revalidation_job('worker-fin', 120);
  v_run := private.create_verification_run('00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-00000000aa01',
             'fin-run-3', repeat('d', 64), 'REVALIDATION', v_job);
  perform private.start_verification_run(v_run);
  v_ev2 := fstest.prepare_run_trace(v_run, '00000000-0000-4000-8000-00000000000a', v_case, 'fp-law-19');
  perform private.finalize_revalidation(v_job, cl.lease_token, v_run,
    format('[{"claim_id":"00000000-0000-4000-8000-0000000000b1","status":"CONTRADICTED","reason_code":"REGISTRY_MISMATCH","cove_status":"CONFIRMED","red_team_status":"COUNTER_EVIDENCE","decision_summary_masked":"등록 기관 아님","evidences":[{"evidence_id":"%s","relation":"CONTRADICT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
             {"claim_id":"00000000-0000-4000-8000-0000000000b2","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","cove_status":"CONFIRMED","red_team_status":"SUPPORTED_INITIAL","decision_summary_masked":"공식 상품","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]},
             {"claim_id":"00000000-0000-4000-8000-0000000000b3","status":"VERIFIED","reason_code":"OFFICIAL_MATCH","decision_summary_masked":"공식 채널","evidences":[{"evidence_id":"%s","relation":"SUPPORT","is_independent":true,"policy_reason_code":"DIRECT_FRESH"}]}]', v_ev2, v_ev2, v_ev2)::jsonb,
    axes_risk::jsonb,
    '{"status":"COMPLETED","guide_schema_version":"g1","actions":[{"action_no":1,"action_code":"STOP_AND_REPORT","reason_code":"REGISTRY_MISMATCH"}],"limitation_codes":[],"channels":[]}'::jsonb);
  select * into job from public.revalidation_jobs where id = v_job;
  select * into d from public.passport_diffs where revalidation_job_id = v_job;
  if job.status <> 'NO_CHANGE' or d.material_change or jsonb_array_length(d.claim_changes) <> 0 then
    raise exception 'NO_CHANGE 종결이 아닙니다 (% %)', job.status, d.claim_changes;
  end if;
  select count(*) into n from private.outbox_events where deduplication_key = 'notify-revalidation:' || v_job::text
     and payload ->> 'notification_type' = 'REVALIDATION_NO_CHANGE';
  if n <> 1 then raise exception '조용한 완료 알림 Outbox 가 없습니다'; end if;
  raise notice '  허용 확인: 같은 결과의 재검증은 NO_CHANGE 와 빈 Diff, 조용한 알림';
end
$$;

\echo '69. Guide 실패는 PARTIAL, Deadline 초과는 거부, Matrix 순수 함수'
do $$
declare v_case uuid; v_run uuid; v_ev uuid; v_pp uuid; run public.verification_runs%rowtype; pp public.evidence_passports%rowtype;
begin
  v_case := private.create_case('00000000-0000-4000-8000-00000000000a', 'LOAN', 'Guide 실패 Case', 'fin-2', repeat('2', 64));
  perform private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v_case, 'INPUT_REVIEW');
  insert into public.case_inputs
    (id, owner_id, case_id, input_type, input_stage, raw_delete_status, pii_scan_status, raw_expires_at, masked_text, masked_text_hash, pii_policy_version)
  values ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-00000000000a', v_case, 'TEXT', 'MASKED', 'PENDING', 'PASSED',
          now() + interval '1 hour', '[마스킹] 상담', repeat('8', 64), 'pii-v1');
  insert into public.claims (id, owner_id, case_id, source_input_id, origin, claim_type, source_locator, extraction_method)
  values ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-0000000000e4', 'EXTRACTED', 'INSTITUTION', '{"schema_version":"1"}'::jsonb, 'MODEL');
  insert into public.claim_revisions (owner_id, case_id, claim_id, revision_no, statement_masked, structured_value, materiality, user_confirmed, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-0000000000b4', 1, '기관은 B 저축은행', '{"schema_version":"1"}'::jsonb, 'MATERIAL', true, 'USER_EDIT', repeat('4', 64));
  v_run := private.create_verification_run('00000000-0000-4000-8000-00000000000a', v_case, '00000000-0000-4000-8000-00000000aa01', 'fin-run-4', repeat('e', 64));
  perform private.start_verification_run(v_run);
  v_ev := fstest.prepare_run_trace(v_run, '00000000-0000-4000-8000-00000000000a', v_case, 'fp-law-19');

  -- Deadline 을 넘긴 Run 은 최종화하지 않는다.
  update public.verification_runs set deadline_at = now() - interval '1 second', created_at = now() - interval '10 seconds' where id = v_run;
  perform fstest.expect_fail(format($sql$
    select private.finalize_verification_run(%L,
      '[{"claim_id":"00000000-0000-4000-8000-0000000000b4","status":"UNKNOWN","reason_code":"NO_OFFICIAL_RECORD","cove_status":"UNRESOLVED","red_team_status":"UNRESOLVED","decision_summary_masked":"확인 불가","evidences":[]}]'::jsonb,
      '[{"axis":"AUTHENTICITY","result_code":"AUTH_UNKNOWN","summary_masked":"x","limitation_codes":[]},{"axis":"TRANSACTION_SALES_RISK","result_code":"RISK_UNKNOWN","summary_masked":"x","limitation_codes":[]},{"axis":"SUITABILITY","result_code":"SUIT_UNKNOWN","summary_masked":"x","limitation_codes":[]}]'::jsonb)
  $sql$, v_run), 'Deadline 을 넘긴 Run 최종화');
  update public.verification_runs set deadline_at = now() + interval '100 seconds', created_at = now() where id = v_run;

  -- Guide 없이 최종화: PARTIAL, GUIDE_FAILED, Passport 는 Guide 없이. Material UNKNOWN → 정보 부족.
  v_pp := private.finalize_verification_run(v_run,
    '[{"claim_id":"00000000-0000-4000-8000-0000000000b4","status":"UNKNOWN","reason_code":"NO_OFFICIAL_RECORD","cove_status":"UNRESOLVED","red_team_status":"UNRESOLVED","decision_summary_masked":"확인 불가","evidences":[]}]'::jsonb,
    '[{"axis":"AUTHENTICITY","result_code":"AUTH_UNKNOWN","summary_masked":"확인 불가","limitation_codes":["NO_RECORD"]},{"axis":"TRANSACTION_SALES_RISK","result_code":"RISK_UNKNOWN","summary_masked":"확인 불가","limitation_codes":[]},{"axis":"SUITABILITY","result_code":"SUIT_UNKNOWN","summary_masked":"확인 불가","limitation_codes":[]}]'::jsonb,
    null);
  select * into run from public.verification_runs where id = v_run;
  select * into pp from public.evidence_passports where id = v_pp;
  if run.status <> 'PARTIAL' or not ('GUIDE_FAILED' = any(run.partial_reason_codes)) or run.overall_result <> 'INSUFFICIENT_INFORMATION' or run.coverage_satisfied then
    raise exception 'Guide 실패 종결값이 다릅니다: % % %', run.status, run.partial_reason_codes, run.overall_result;
  end if;
  if pp.action_guide_id is not null or (pp.manifest -> 'guide' ->> 'status') <> 'FAILED' then
    raise exception 'Passport 가 Guide 실패를 남기지 않았습니다';
  end if;
  if (select lifecycle from public.financial_cases where id = v_case) <> 'VERIFIED' then raise exception 'PARTIAL 도 VERIFIED 로 간다'; end if;
  raise notice '  허용 확인: Guide 실패는 Claim·근거·축을 보존한 PARTIAL, Material UNKNOWN 은 정보 부족';
end
$$;

do $$
begin
  if private.decide_overall_result(true, false, false, false, false, false, true, false) <> 'MATERIAL_RISK_FOUND'
     or private.decide_overall_result(false, true, false, false, false, false, true, false) <> 'MATERIAL_RISK_FOUND'
     or private.decide_overall_result(false, false, true, false, false, false, true, false) <> 'HIGH_CAUTION'
     or private.decide_overall_result(false, false, false, true, false, false, true, false) <> 'HIGH_CAUTION'
     or private.decide_overall_result(false, false, false, false, true, false, true, false) <> 'INSUFFICIENT_INFORMATION'
     or private.decide_overall_result(false, false, false, false, false, true, true, false) <> 'INSUFFICIENT_INFORMATION'
     or private.decide_overall_result(false, false, false, false, false, false, false, false) <> 'INSUFFICIENT_INFORMATION'
     or private.decide_overall_result(false, false, false, false, false, false, true, true) <> 'VERIFY_BEFORE_PROCEEDING'
     or private.decide_overall_result(false, false, false, false, false, false, true, false) <> 'NO_SPECIAL_RISK_IN_VERIFIED_SCOPE' then
    raise exception '종합 결과 Matrix 가 요구사항 2.2 와 다릅니다';
  end if;
  raise notice '  허용 확인: 종합 결과 Matrix 다섯 행의 우선순위';
end
$$;

do $$
begin
  set local role authenticated;
  perform fstest.expect_fail(format($sql$ select private.finalize_verification_run(%L, '[]'::jsonb, '[]'::jsonb) $sql$,
    (select val from fctx where key = 'run1')), '회원이 최종화 함수 호출');
end
$$;

\echo '0016 불변식 시험을 통과했습니다.'
