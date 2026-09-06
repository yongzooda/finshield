-- ============================================================
-- 0009 Manifest·Run·Run 입력 고정 시험 (명세 6.8, 6.4, 6.3, 7.1)
--
-- 01~04 가 만든 데이터를 잇는다. 02 가 Case A 를 지웠으므로 Case 를 다시
-- 만들고, 03 의 Registry 와 04 의 Release 를 Manifest 가 참조한다.
-- ============================================================

\echo '21. execution_manifests'
-- Manifest 가 참조할 정책 다섯 유형을 등록한다.
insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
values ('EVIDENCE', 'v1', '{"schema_version":"1"}'::jsonb, 'v1', repeat('1', 64)),
       ('RESULT_MATRIX', 'v1', '{"schema_version":"1"}'::jsonb, 'v1', repeat('2', 64)),
       ('PROFILE', 'v1', '{"schema_version":"1"}'::jsonb, 'v1', repeat('3', 64)),
       ('PII', 'v1', '{"schema_version":"1"}'::jsonb, 'v1', repeat('4', 64));

select fstest.expect_fail($sql$
  insert into private.execution_manifests
    (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version, schema_bundle_version,
     evidence_policy_version, result_matrix_version, coverage_contract_version, profile_policy_version,
     pii_policy_version, kb_release_id, embedding_model, embedding_dimension, config_hash)
  values ('m0', 'LOAN', 's1', '{"schema_version":"1"}'::jsonb, 'p1', 'j1',
          'v9', 'v1', 'v1', 'v1', 'v1', '00000000-0000-4000-8000-00000000d001', 'embed-v4.0', 1024, repeat('a', 64))
$sql$, '등록되지 않은 Evidence 정책 버전');

select fstest.expect_fail($sql$
  insert into private.execution_manifests
    (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version, schema_bundle_version,
     evidence_policy_version, result_matrix_version, coverage_contract_version, profile_policy_version,
     pii_policy_version, kb_release_id, embedding_model, embedding_dimension, config_hash)
  values ('m0', 'LOAN', 's1', '{"schema_version":"1"}'::jsonb, 'p1', 'j1',
          'v1', 'v1', 'v1', 'v1', 'v1', '00000000-0000-4000-8000-00000000d001', 'embed-v4.0', 768, repeat('a', 64))
$sql$, 'Release 선언과 다른 Embedding 차원');

select fstest.expect_fail($sql$
  insert into private.execution_manifests
    (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version, schema_bundle_version,
     evidence_policy_version, result_matrix_version, coverage_contract_version, profile_policy_version,
     pii_policy_version, kb_release_id, config_hash)
  values ('m0', 'LOAN', 's1', '{"schema_version":"1"}'::jsonb, 'p1', 'j1',
          'v1', 'v1', 'v1', 'v1', 'v1', '00000000-0000-4000-8000-0000000000ff', repeat('a', 64))
$sql$, '없는 KB Release 참조');

insert into private.execution_manifests
  (id, manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version, schema_bundle_version,
   evidence_policy_version, result_matrix_version, coverage_contract_version, profile_policy_version,
   pii_policy_version, kb_release_id, embedding_model, embedding_dimension, config_hash)
values ('00000000-0000-4000-8000-00000000aa01', 'm1', 'LOAN', 's1', '{"schema_version":"1","model":"claude-sonnet-5"}'::jsonb,
        'p1', 'j1', 'v1', 'v1', 'v1', 'v1', 'v1', '00000000-0000-4000-8000-00000000d001', 'embed-v4.0', 1024, repeat('a', 64));

select fstest.expect_ok($sql$
  insert into private.execution_manifest_agents (execution_manifest_id, agent_definition_id, logical_agent_key, required)
  values ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000000a0', 'PRODUCT_INSTITUTION', true),
         ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000000a9', 'EVIDENCE_JUDGE', true)
$sql$, 'Manifest 에 Agent 구성 고정');

select fstest.expect_fail($sql$
  insert into private.execution_manifest_agents (execution_manifest_id, agent_definition_id, logical_agent_key, required)
  values ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000000a0', 'DUPLICATE_ROLE', true)
$sql$, '같은 Manifest 에 같은 Agent 정의 중복');

select fstest.expect_ok($sql$
  insert into private.execution_manifest_tools (execution_manifest_id, tool_definition_id, purpose_code, required)
  values ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000000b0', 'LAW_LOOKUP', true)
$sql$, 'Manifest 에 Tool 버전 고정');

select fstest.expect_ok($sql$
  insert into private.execution_manifest_events (execution_manifest_id, event_type)
  values ('00000000-0000-4000-8000-00000000aa01', 'ACTIVATED')
$sql$, 'Manifest 활성화 Event');

select fstest.expect_fail($sql$
  update private.execution_manifests set prompt_bundle_version = 'p2'
   where id = '00000000-0000-4000-8000-00000000aa01'
$sql$, 'Manifest UPDATE');

select fstest.expect_fail($sql$
  delete from private.execution_manifest_events where execution_manifest_id = '00000000-0000-4000-8000-00000000aa01'
$sql$, 'Manifest Event DELETE');

\echo '22. verification_runs'
-- 02 가 Case A 를 Cascade 로 지웠다. 같은 Owner 로 Case 를 다시 만든다.
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-00000000000a', 'LOAN', '재검증 시험 Case',
        '00000000-0000-4000-8000-0000000000d1');

select fstest.expect_fail($sql$
  insert into public.verification_runs
    (owner_id, case_id, run_no, kind, profile_version_id, execution_manifest_id, idempotency_key, request_hash,
     correlation_id, deadline_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc', 1, 'INITIAL',
          '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000aa01', 'k1', repeat('a', 64),
          gen_random_uuid(), now() + interval '120 seconds')
$sql$, '다른 소유자의 Profile Snapshot 을 고정');

select fstest.expect_fail($sql$
  insert into public.verification_runs
    (owner_id, case_id, run_no, kind, profile_version_id, execution_manifest_id, idempotency_key, request_hash,
     correlation_id, deadline_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc', 1, 'INITIAL',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k1', repeat('a', 64),
          gen_random_uuid(), now() + interval '181 seconds')
$sql$, 'Deadline 180초 초과');

select fstest.expect_fail($sql$
  insert into public.verification_runs
    (owner_id, case_id, run_no, kind, profile_version_id, execution_manifest_id, idempotency_key, request_hash,
     correlation_id, deadline_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc', 1, 'REVALIDATION',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k1', repeat('a', 64),
          gen_random_uuid(), now() + interval '120 seconds')
$sql$, '직전 Run 없는 재검증');

select fstest.expect_fail($sql$
  insert into public.verification_runs
    (owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, idempotency_key, request_hash,
     correlation_id, deadline_at, overall_result)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc', 1, 'INITIAL', 'QUEUED',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k1', repeat('a', 64),
          gen_random_uuid(), now() + interval '120 seconds', 'HIGH_CAUTION')
$sql$, '종결 전 종합 결과 기록');

insert into public.verification_runs
  (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, idempotency_key,
   request_hash, correlation_id, started_at, deadline_at)
values ('00000000-0000-4000-8000-00000000bb01', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cc', 1, 'INITIAL', 'RUNNING',
        '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k1', repeat('a', 64),
        gen_random_uuid(), now(), now() + interval '120 seconds');

select fstest.expect_fail($sql$
  insert into public.verification_runs
    (owner_id, case_id, run_no, kind, profile_version_id, execution_manifest_id, idempotency_key, request_hash,
     correlation_id, deadline_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc', 2, 'INITIAL',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k2', repeat('b', 64),
          gen_random_uuid(), now() + interval '120 seconds')
$sql$, 'Case 당 활성 초기 Run 둘');

select fstest.expect_fail($sql$
  insert into public.verification_runs
    (owner_id, case_id, run_no, kind, profile_version_id, execution_manifest_id, idempotency_key, request_hash,
     correlation_id, deadline_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc', 2, 'REVALIDATION',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k1', repeat('c', 64),
          gen_random_uuid(), now() + interval '120 seconds')
$sql$, '같은 idempotency_key 에 다른 request_hash');

select fstest.expect_fail($sql$
  update public.verification_runs set status = 'COMPLETED', finished_at = now()
   where id = '00000000-0000-4000-8000-00000000bb01'
$sql$, '종합 결과 없이 COMPLETED');

select fstest.expect_fail($sql$
  update public.verification_runs set status = 'FAILED', finished_at = now()
   where id = '00000000-0000-4000-8000-00000000bb01'
$sql$, '이유 없이 FAILED');

select fstest.expect_ok($sql$
  update public.verification_runs
     set status = 'COMPLETED', finished_at = now(), overall_result = 'VERIFY_BEFORE_PROCEEDING',
         coverage_satisfied = true
   where id = '00000000-0000-4000-8000-00000000bb01'
$sql$, '결과·Coverage 와 함께 종결');

select fstest.expect_ok($sql$
  update public.financial_cases set latest_successful_run_id = '00000000-0000-4000-8000-00000000bb01'
   where id = '00000000-0000-4000-8000-0000000000cc'
$sql$, 'Case 최신 Run 포인터 (교차 소유 FK)');

select fstest.expect_fail($sql$
  update public.financial_cases set latest_successful_run_id = '00000000-0000-4000-8000-00000000bb01'
   where id = '00000000-0000-4000-8000-0000000000cb'
$sql$, '다른 Case 의 Run 을 최신 Run 으로 지정');

select fstest.expect_ok($sql$
  insert into public.verification_runs
    (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, parent_run_id,
     idempotency_key, request_hash, correlation_id, started_at, deadline_at)
  values ('00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cc', 2, 'REVALIDATION', 'RUNNING',
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01',
          '00000000-0000-4000-8000-00000000bb01', 'k2', repeat('b', 64), gen_random_uuid(), now(),
          now() + interval '120 seconds')
$sql$, '직전 Run 을 가리키는 재검증 Run');

select fstest.expect_fail($sql$
  delete from public.verification_runs where id = '00000000-0000-4000-8000-00000000bb02'
$sql$, 'Case 가 살아 있는데 Run 직접 삭제');

\echo '23. verification_run_claims'
insert into public.claims (id, owner_id, case_id, origin, claim_type, source_locator, extraction_method)
values ('00000000-0000-4000-8000-00000000c101', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cc', 'USER_ADDED', 'INTEREST_RATE', '{"schema_version":"1"}'::jsonb, 'USER');
insert into public.claim_revisions
  (id, owner_id, case_id, claim_id, revision_no, statement_masked, structured_value, materiality, user_confirmed,
   edit_source, content_hash)
values ('00000000-0000-4000-8000-00000000c1a1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-00000000c101', 1, '미확정 진술',
        '{"schema_version":"1"}'::jsonb, 'MATERIAL', false, 'EXTRACTION', repeat('c', 64)),
       ('00000000-0000-4000-8000-00000000c1a2', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-00000000c101', 2, '사용자 확정 진술',
        '{"schema_version":"1"}'::jsonb, 'MATERIAL', true, 'USER_EDIT', repeat('d', 64));

select fstest.expect_fail($sql$
  insert into public.verification_run_claims
    (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, selected_for_verification, materiality, confirmation_state)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc',
          '00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-00000000c101',
          '00000000-0000-4000-8000-00000000c1a1', true, 'MATERIAL', 'CONFIRMED')
$sql$, '사용자 미확정 Material Claim 을 CONFIRMED 로 고정');

select fstest.expect_fail($sql$
  insert into public.verification_run_claims
    (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, selected_for_verification, materiality, confirmation_state)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc',
          '00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-00000000c101',
          '00000000-0000-4000-8000-00000000c1a2', true, 'MATERIAL', 'EXCLUDED')
$sql$, '검증 대상인데 CONFIRMED 가 아님');

select fstest.expect_fail($sql$
  insert into public.verification_run_claims
    (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, selected_for_verification, materiality, confirmation_state)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc',
          '00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-00000000c101',
          '00000000-0000-4000-8000-00000000c1a2', false, 'MATERIAL', 'MISSING')
$sql$, '누락인데 이유 Code 없음');

select fstest.expect_fail($sql$
  insert into public.verification_run_claims
    (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, selected_for_verification, materiality, confirmation_state)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc',
          '00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-0000000000c1',
          '00000000-0000-4000-8000-00000000c1a2', true, 'MATERIAL', 'CONFIRMED')
$sql$, 'Claim identity 와 revision 을 바꿔 끼움');

select fstest.expect_ok($sql$
  insert into public.verification_run_claims
    (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, selected_for_verification, materiality, confirmation_state,
     coverage_item_code)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cc',
          '00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-00000000c101',
          '00000000-0000-4000-8000-00000000c1a2', true, 'MATERIAL', 'CONFIRMED', 'RATE')
$sql$, '사용자 확정 revision 을 Run 에 고정');

select fstest.expect_fail($sql$
  update public.verification_run_claims set selected_for_verification = false
   where verification_run_id = '00000000-0000-4000-8000-00000000bb02'
$sql$, 'Run 입력 고정 뒤 UPDATE');

select fstest.expect_fail($sql$
  delete from public.verification_run_claims
   where verification_run_id = '00000000-0000-4000-8000-00000000bb02'
$sql$, 'Run 이 살아 있는데 Run Claim 직접 삭제');

\echo '24. Run 권한'
do $$
declare n int;
begin
  set local role finshield_worker;
  -- 0021 이 제품 Manifest 를 심으므로 총수는 고정값이 아니다. 이 시험이 만든 것만 센다.
  select count(*) into n from private.execution_manifests
   where id = '00000000-0000-4000-8000-00000000aa01';
  if n <> 1 then raise exception 'Worker 가 Manifest 를 읽지 못했습니다 (%)', n; end if;
  select count(*) into n from public.verification_runs;
  if n <> 2 then raise exception 'Worker 가 Run 을 읽지 못했습니다 (%)', n; end if;
  raise notice '  허용 확인: Worker 가 Manifest·Run 을 읽는다';
  perform fstest.expect_fail($sql$
    update public.verification_runs set status = 'CANCELLED', finished_at = now(), reason_code = 'X'
     where id = '00000000-0000-4000-8000-00000000bb02'
  $sql$, 'Worker 가 Run 상태를 직접 UPDATE');
  perform fstest.expect_fail($sql$
    insert into private.execution_manifest_events (execution_manifest_id, event_type)
    values ('00000000-0000-4000-8000-00000000aa01', 'RETIRED')
  $sql$, 'Worker 가 Manifest Event INSERT');
end
$$;

do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  perform fstest.expect_fail($sql$ select count(*) from public.verification_runs $sql$,
    '회원이 Run 표를 직접 조회 (View 전용)');
  perform fstest.expect_fail($sql$ select count(*) from private.execution_manifests $sql$,
    '회원이 Manifest 조회');
end
$$;

-- Case Cascade 는 Run·Run Claim 을 함께 지운다.
do $$
declare remaining int;
begin
  delete from public.financial_cases where id = '00000000-0000-4000-8000-0000000000cc';
  select (select count(*) from public.verification_runs)
       + (select count(*) from public.verification_run_claims) into remaining;
  if remaining <> 0 then raise exception 'Case Cascade 뒤 Run 행이 남았습니다 (%)', remaining; end if;
  raise notice '  허용 확인: Case 삭제 Cascade 로 Run·Run Claim 제거';
end
$$;

\echo '0009 불변식 시험을 통과했습니다.'
