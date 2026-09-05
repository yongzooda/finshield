-- ============================================================
-- 0010 Agent·Tool·Evidence 불변식 시험 (명세 6.4, 6.5, 규칙 1·2·3)
--
-- 05 가 Case cc 를 지웠다. Manifest aa01 과 Registry·KB 는 남아 있다.
-- ============================================================

\echo '25. 준비: Case·Run·Claim'
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000000a', 'LOAN', 'Evidence 시험 Case',
        '00000000-0000-4000-8000-0000000000d1');
insert into public.verification_runs
  (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, idempotency_key,
   request_hash, correlation_id, started_at, deadline_at)
values ('00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cd', 1, 'INITIAL', 'RUNNING',
        '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k10', repeat('a', 64),
        gen_random_uuid(), now(), now() + interval '120 seconds');
insert into public.claims (id, owner_id, case_id, origin, claim_type, source_locator, extraction_method)
values ('00000000-0000-4000-8000-00000000c110', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cd', 'USER_ADDED', 'INTEREST_RATE', '{"schema_version":"1"}'::jsonb, 'USER');
insert into public.claim_revisions
  (id, owner_id, case_id, claim_id, revision_no, statement_masked, structured_value, materiality, user_confirmed,
   edit_source, content_hash)
values ('00000000-0000-4000-8000-00000000c1b1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000c110', 1, '연 19.9% 상한 주장',
        '{"schema_version":"1"}'::jsonb, 'MATERIAL', true, 'USER_EDIT', repeat('b', 64));

\echo '26. agent_runs: Manifest 고정 강제'
select fstest.expect_fail($sql$
  insert into public.agent_runs
    (owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version, attempt_no,
     input_schema_version, output_schema_version, prompt_version)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', 'PRODUCT_INSTITUTION', 'GHOST_AGENT', 'v1', 1, 'in-v1', 'out-v1', 'p-v1')
$sql$, 'Registry 에 없는 Agent 실행');

select fstest.expect_fail($sql$
  insert into public.agent_runs
    (owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version, attempt_no,
     input_schema_version, output_schema_version, prompt_version)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', 'FRAUD_CHANNEL', 'EVIDENCE_JUDGE', 'v1', 1, 'in-v1', 'out-v1', 'p-v1')
$sql$, 'Manifest 의 논리 키와 다른 Agent 정의');

select fstest.expect_ok($sql$
  insert into public.agent_runs
    (id, owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version, attempt_no, status,
     input_schema_version, output_schema_version, prompt_version, model_provider, model_id, started_at)
  values ('00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
          'PRODUCT_INSTITUTION', 'PRODUCT_INSTITUTION', 'v1', 1, 'RUNNING', 'in-v1', 'out-v1', 'p-v1',
          'anthropic', 'claude-sonnet-5', now())
$sql$, 'Manifest 에 고정된 Agent 실행');

select fstest.expect_fail($sql$
  insert into public.agent_runs
    (owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version, attempt_no,
     input_schema_version, output_schema_version, prompt_version, model_provider)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', 'EVIDENCE_JUDGE', 'EVIDENCE_JUDGE', 'v1', 1, 'in-v1', 'out-v1', 'p-v1', 'anthropic')
$sql$, 'Provider 만 있고 모델 ID 없음');

select fstest.expect_ok($sql$
  insert into public.agent_run_claims (owner_id, case_id, agent_run_id, claim_id, relation)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-00000000c110', 'INPUT')
$sql$, 'Agent 입력 Claim 연결');

select fstest.expect_fail($sql$
  insert into public.agent_run_claims (owner_id, case_id, agent_run_id, claim_id, relation)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-00000000c110', 'SUMMARY')
$sql$, '열거하지 않은 relation');

\echo '27. tool_runs: Manifest·Allowlist 강제'
-- 등록은 됐지만 Manifest 에도 Allowlist 에도 없는 Tool
insert into private.tool_definitions
  (id, tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('00000000-0000-4000-8000-0000000000b9', 'rogue_search', 'v1', 'FUNCTION', 'in-v1', 'out-v1',
        1024, 1, 1000, 0, repeat('9', 64));

select fstest.expect_fail($sql$
  insert into public.tool_runs
    (owner_id, case_id, verification_run_id, agent_run_id, logical_tool_key, tool_code, tool_version, transport,
     attempt_no, input_schema_version, output_schema_version, sanitized_scope)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ab01', 'search', 'rogue_search', 'v1',
          'FUNCTION', 1, 'in-v1', 'out-v1', '{"schema_version":"1"}'::jsonb)
$sql$, 'Manifest 에 없는 Tool 호출');

-- Manifest 에는 있지만 이 Agent 의 Allowlist 에는 없는 Tool: 허용 목록은 PRODUCT_INSTITUTION(a0) 에만 있다.
select fstest.expect_ok($sql$
  insert into public.agent_runs
    (id, owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version, attempt_no, status,
     input_schema_version, output_schema_version, prompt_version, started_at)
  values ('00000000-0000-4000-8000-00000000ab02', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
          'EVIDENCE_JUDGE', 'EVIDENCE_JUDGE', 'v1', 1, 'RUNNING', 'in-v1', 'out-v1', 'p-v1', now())
$sql$, 'Judge Agent 실행');
select fstest.expect_fail($sql$
  insert into public.tool_runs
    (owner_id, case_id, verification_run_id, agent_run_id, logical_tool_key, tool_code, tool_version, transport,
     attempt_no, input_schema_version, output_schema_version, sanitized_scope)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ab02', 'law', 'law_search', 'v1',
          'FUNCTION', 1, 'in-v1', 'out-v1', '{"schema_version":"1"}'::jsonb)
$sql$, 'Agent Allowlist 에 없는 Tool 호출');

select fstest.expect_fail($sql$
  insert into public.tool_runs
    (owner_id, case_id, verification_run_id, agent_run_id, logical_tool_key, tool_code, tool_version, transport,
     attempt_no, status, input_schema_version, output_schema_version, sanitized_scope, provenance_complete)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ab01', 'law', 'law_search', 'v1',
          'FUNCTION', 1, 'RUNNING', 'in-v1', 'out-v1', '{"schema_version":"1"}'::jsonb, true)
$sql$, '실행 중인데 Provenance 완전 표시');

select fstest.expect_ok($sql$
  insert into public.tool_runs
    (id, owner_id, case_id, verification_run_id, agent_run_id, logical_tool_key, tool_code, tool_version, transport,
     attempt_no, status, input_schema_version, output_schema_version, sanitized_scope, provenance_complete,
     candidate_count, selected_count, started_at, finished_at)
  values ('00000000-0000-4000-8000-00000000ac01', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
          '00000000-0000-4000-8000-00000000ab01', 'law', 'law_search', 'v1', 'FUNCTION', 1, 'SUCCEEDED',
          'in-v1', 'out-v1', '{"schema_version":"1","as_of":"2026-09-05"}'::jsonb, true, 42, 5, now(), now())
$sql$, '허용된 Tool 호출 성공 (Provenance 완전)');

select fstest.expect_ok($sql$
  insert into public.tool_runs
    (id, owner_id, case_id, verification_run_id, agent_run_id, logical_tool_key, tool_code, tool_version, transport,
     attempt_no, status, input_schema_version, output_schema_version, sanitized_scope, provenance_complete,
     started_at, finished_at, reason_code)
  values ('00000000-0000-4000-8000-00000000ac02', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
          '00000000-0000-4000-8000-00000000ab01', 'law', 'law_search', 'v1', 'FUNCTION', 2, 'FAILED',
          'in-v1', 'out-v1', '{"schema_version":"1"}'::jsonb, false, now(), now(), 'HTTP_503')
$sql$, '재시도 실패 (Provenance 불완전)');

select fstest.expect_fail($sql$
  update public.tool_runs set candidate_count = 99 where id = '00000000-0000-4000-8000-00000000ac01'
$sql$, '종결된 Tool 행 수정');

\echo '28. retrieval_steps'
select fstest.expect_ok($sql$
  insert into public.retrieval_steps
    (owner_id, case_id, tool_run_id, step_no, stage, query_digest, candidate_count, cutoff_config, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000ac01', 1, 'METADATA_FILTER', repeat('1', 64), 42, '{"schema_version":"1"}'::jsonb, 3),
         ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000ac01', 3, 'VECTOR', repeat('1', 64), 20, '{"schema_version":"1"}'::jsonb, 90)
$sql$, 'AI-007 순서대로 단계 기록');

select fstest.expect_fail($sql$
  insert into public.retrieval_steps
    (owner_id, case_id, tool_run_id, step_no, stage, query_digest, candidate_count, cutoff_config, duration_ms)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000ac01', 2, 'VECTOR', repeat('1', 64), 20, '{"schema_version":"1"}'::jsonb, 90)
$sql$, '순번과 단계 이름이 어긋남 (2번에 VECTOR)');

\echo '29. evidences: Provenance·인용 가능성'
select fstest.expect_fail($sql$
  insert into public.evidences
    (owner_id, case_id, verification_run_id, kb_snapshot_id, case_snapshot_id, produced_by_tool_run_id, source_locator,
     directness, citable, reference_only, incomplete, freshness_at_use, target_match, independence_key,
     selection_reason_code, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', null, null, '00000000-0000-4000-8000-00000000ac01',
          '{"schema_version":"1"}'::jsonb, 'DIRECT', true, false, false, 'FRESH', true, 'fp-1', 'RERANK_TOP', repeat('c', 64))
$sql$, 'Source 가 하나도 없는 Evidence');

select fstest.expect_fail($sql$
  insert into public.evidences
    (owner_id, case_id, verification_run_id, kb_snapshot_id, produced_by_tool_run_id, source_locator,
     directness, citable, reference_only, incomplete, freshness_at_use, target_match, independence_key,
     selection_reason_code, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000c001',
          '00000000-0000-4000-8000-00000000ac02', '{"schema_version":"1"}'::jsonb, 'DIRECT', true, false, false,
          'FRESH', true, 'fp-1', 'RERANK_TOP', repeat('c', 64))
$sql$, 'Provenance 불완전한 Tool 결과를 Evidence 로 승격');

select fstest.expect_fail($sql$
  insert into public.evidences
    (owner_id, case_id, verification_run_id, kb_snapshot_id, produced_by_tool_run_id, source_locator,
     directness, citable, reference_only, incomplete, freshness_at_use, target_match, independence_key,
     selection_reason_code, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000c001',
          '00000000-0000-4000-8000-00000000ac01', '{"schema_version":"1"}'::jsonb, 'DIRECT', true, true, false,
          'FRESH', true, 'fp-1', 'RERANK_TOP', repeat('c', 64))
$sql$, '참고용(reference_only) 인데 인용 가능 표시');

-- 인용 불가 Snapshot (GUIDE, is_citable=true 였다. 인용 불가 Snapshot 을 하나 만든다)
insert into kb.source_snapshots
  (id, source_type, authority_level, publisher_name, source_title, retrieved_at, content_hash, source_fingerprint,
   freshness_status, is_complete, is_citable)
values ('00000000-0000-4000-8000-00000000c009', 'DISPUTE', 'C', '합성 분쟁사례집', '유사 분쟁 사례', now(),
        repeat('e', 64), repeat('e', 64), 'FRESH', true, false);
select fstest.expect_fail($sql$
  insert into public.evidences
    (owner_id, case_id, verification_run_id, kb_snapshot_id, produced_by_tool_run_id, source_locator,
     directness, citable, reference_only, incomplete, freshness_at_use, target_match, independence_key,
     selection_reason_code, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000c009',
          '00000000-0000-4000-8000-00000000ac01', '{"schema_version":"1"}'::jsonb, 'INDIRECT', true, false, false,
          'FRESH', true, 'fp-dispute', 'RERANK_TOP', repeat('c', 64))
$sql$, '인용 불가 Snapshot 을 인용 가능 Evidence 로 표시');

select fstest.expect_ok($sql$
  insert into public.evidences
    (id, owner_id, case_id, verification_run_id, kb_snapshot_id, produced_by_tool_run_id, source_locator,
     directness, citable, reference_only, incomplete, freshness_at_use, target_match, independence_key,
     selection_reason_code, content_hash)
  values ('00000000-0000-4000-8000-00000000ad01', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
          '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000ac01',
          '{"schema_version":"1","article":"19"}'::jsonb, 'DIRECT', true, false, false, 'FRESH', true,
          'fp-law-19', 'RERANK_TOP', repeat('c', 64)),
         ('00000000-0000-4000-8000-00000000ad02', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
          '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000ac01',
          '{"schema_version":"1","article":"19","mirror":true}'::jsonb, 'DIRECT', true, false, false, 'FRESH', true,
          'fp-law-19', 'RERANK_SECOND', repeat('d', 64)),
         ('00000000-0000-4000-8000-00000000ad03', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
          '00000000-0000-4000-8000-00000000c009', '00000000-0000-4000-8000-00000000ac01',
          '{"schema_version":"1"}'::jsonb, 'CONTEXT_ONLY', false, true, false, 'FRESH', false,
          'fp-dispute', 'RERANK_CONTEXT', repeat('e', 64))
$sql$, '직접 근거 2건(같은 복제군)과 참고용 근거 1건');

\echo '30. final_claim_versions: Evidence Policy Validator'
-- 근거 관계 없이 VERIFIED 를 Commit 하려는 시도. Deferred Trigger 라 Commit 시점에 실패한다.
do $$
begin
  begin
    insert into public.final_claim_versions
      (id, owner_id, case_id, verification_run_id, claim_id, claim_revision_id, status, reason_code, policy_version,
       coverage_contract_version, cove_status, red_team_status, is_material, decision_summary_masked, content_hash)
    values ('00000000-0000-4000-8000-00000000ae00', '00000000-0000-4000-8000-00000000000a',
            '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
            '00000000-0000-4000-8000-00000000c110', '00000000-0000-4000-8000-00000000c1b1', 'VERIFIED',
            'EP-01', 'v1', 'v1', 'CONFIRMED', 'NOT_REQUIRED', true, '근거 없이 확정 시도', repeat('f', 64));
    set constraints all immediate;
    raise exception '근거 관계 없는 VERIFIED 가 통과했습니다';
  exception
    when check_violation then
      raise notice '  거부 확인: 근거 관계 없는 VERIFIED Commit  (%)', sqlstate;
  end;
end
$$;

-- 참고용·간접 근거만 연결한 VERIFIED 도 실패한다.
do $$
begin
  begin
    insert into public.final_claim_versions
      (id, owner_id, case_id, verification_run_id, claim_id, claim_revision_id, status, reason_code, policy_version,
       coverage_contract_version, cove_status, red_team_status, is_material, decision_summary_masked, content_hash)
    values ('00000000-0000-4000-8000-00000000ae01', '00000000-0000-4000-8000-00000000000a',
            '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
            '00000000-0000-4000-8000-00000000c110', '00000000-0000-4000-8000-00000000c1b1', 'VERIFIED',
            'EP-01', 'v1', 'v1', 'CONFIRMED', 'NOT_REQUIRED', true, '참고용 근거로 확정 시도', repeat('f', 64));
    insert into public.claim_evidences
      (owner_id, case_id, verification_run_id, final_claim_version_id, evidence_id, independence_key, relation,
       is_independent, policy_reason_code)
    values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
            '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ae01',
            '00000000-0000-4000-8000-00000000ad03', 'fp-dispute', 'SUPPORT', true, 'EP-05');
    set constraints all immediate;
    raise exception '참고용 근거만으로 VERIFIED 가 통과했습니다';
  exception
    when check_violation then
      raise notice '  거부 확인: 참고용·간접 근거만으로 VERIFIED  (%)', sqlstate;
  end;
end
$$;

-- 직접·인용 가능·최신·대상 일치 SUPPORT 근거가 있으면 Commit 된다.
do $$
begin
  insert into public.final_claim_versions
    (id, owner_id, case_id, verification_run_id, claim_id, claim_revision_id, status, reason_code, policy_version,
     coverage_contract_version, cove_status, red_team_status, is_material, decision_summary_masked, content_hash)
  values ('00000000-0000-4000-8000-00000000ae02', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cd', '00000000-0000-4000-8000-00000000bb10',
          '00000000-0000-4000-8000-00000000c110', '00000000-0000-4000-8000-00000000c1b1', 'VERIFIED',
          'EP-01', 'v1', 'v1', 'CONFIRMED', 'NOT_REQUIRED', true, '법 제19조 직접 근거로 확인', repeat('f', 64));
  insert into public.claim_evidences
    (owner_id, case_id, verification_run_id, final_claim_version_id, evidence_id, independence_key, relation,
     is_independent, policy_reason_code)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ae02',
          '00000000-0000-4000-8000-00000000ad01', 'fp-law-19', 'SUPPORT', true, 'EP-01'),
         ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ae02',
          '00000000-0000-4000-8000-00000000ad03', 'fp-dispute', 'CONTEXT', true, 'EP-07');
  set constraints all immediate;
  raise notice '  허용 확인: 직접·인용 가능 SUPPORT 근거로 VERIFIED Commit';
end
$$;

select fstest.expect_fail($sql$
  insert into public.claim_evidences
    (owner_id, case_id, verification_run_id, final_claim_version_id, evidence_id, independence_key, relation,
     is_independent, policy_reason_code)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ae02',
          '00000000-0000-4000-8000-00000000ad02', 'fp-law-19', 'SUPPORT', true, 'EP-01')
$sql$, '같은 복제군의 두 번째 독립 대표 (규칙 3)');

select fstest.expect_ok($sql$
  insert into public.claim_evidences
    (owner_id, case_id, verification_run_id, final_claim_version_id, evidence_id, independence_key, relation,
     is_independent, policy_reason_code)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ae02',
          '00000000-0000-4000-8000-00000000ad02', 'fp-law-19', 'SUPPORT', false, 'EP-01')
$sql$, '같은 복제군의 비독립 연결');

select fstest.expect_fail($sql$
  insert into public.claim_evidences
    (owner_id, case_id, verification_run_id, final_claim_version_id, evidence_id, independence_key, relation,
     is_independent, policy_reason_code)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000ae02',
          '00000000-0000-4000-8000-00000000ad01', 'fp-forged', 'CONTRADICT', true, 'EP-01')
$sql$, 'Evidence 와 다른 independence_key 를 적음');

select fstest.expect_fail($sql$
  insert into public.final_claim_versions
    (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, status, reason_code, policy_version,
     coverage_contract_version, cove_status, red_team_status, is_material, decision_summary_masked, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000c110',
          '00000000-0000-4000-8000-00000000c1b1', 'UNKNOWN', 'INSUFFICIENT', 'v1', 'v1', 'NOT_REQUIRED',
          'NOT_REQUIRED', true, '중복', repeat('f', 64))
$sql$, '같은 Run 의 같은 Claim 에 두 번째 최종 상태');

select fstest.expect_fail($sql$
  insert into public.final_claim_versions
    (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, status, reason_code, policy_version,
     coverage_contract_version, cove_status, red_team_status, is_material, decision_summary_masked, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cd',
          '00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-0000000000c1',
          '00000000-0000-4000-8000-00000000c1b1', 'UNKNOWN', 'INSUFFICIENT', 'v1', 'v1', 'NOT_REQUIRED',
          'NOT_REQUIRED', true, '바꿔치기', repeat('f', 64))
$sql$, 'Claim identity 와 revision 바꿔치기');

select fstest.expect_fail($sql$
  update public.final_claim_versions set status = 'CONTRADICTED' where id = '00000000-0000-4000-8000-00000000ae02'
$sql$, '최종 Claim 상태 UPDATE');

\echo '31. 권한과 Cascade'
do $$
declare n int;
begin
  set local role finshield_worker;
  select count(*) into n from public.evidences;
  if n <> 3 then raise exception 'Worker 가 Evidence 를 읽지 못했습니다 (%)', n; end if;
  raise notice '  허용 확인: Worker 가 Evidence 를 읽는다';
  perform fstest.expect_fail($sql$
    update public.agent_runs set status = 'SUCCEEDED', finished_at = now()
     where id = '00000000-0000-4000-8000-00000000ab01'
  $sql$, 'Worker 가 Agent 상태를 직접 UPDATE');
end
$$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  perform fstest.expect_fail($sql$ select count(*) from public.evidences $sql$, '회원이 Evidence 표를 직접 조회 (View 전용)');
end
$$;

do $$
declare remaining int;
begin
  delete from public.financial_cases where id = '00000000-0000-4000-8000-0000000000cd';
  select (select count(*) from public.agent_runs) + (select count(*) from public.tool_runs)
       + (select count(*) from public.retrieval_steps) + (select count(*) from public.evidences)
       + (select count(*) from public.final_claim_versions) + (select count(*) from public.claim_evidences)
    into remaining;
  if remaining <> 0 then raise exception 'Case Cascade 뒤 실행 Trace 가 남았습니다 (%)', remaining; end if;
  raise notice '  허용 확인: Case 삭제 Cascade 로 실행 Trace·Evidence 전부 제거';
end
$$;

\echo '0010 불변식 시험을 통과했습니다.'
