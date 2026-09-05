-- ============================================================
-- 0015 Case·입력·Run·재검증 상태 함수와 검색 함수 시험 (명세 4.2~4.4, 7.2, 11)
--
-- 함수가 만든 ID 를 DO 블록 사이에 넘기기 위해 임시 표를 쓴다.
-- ============================================================

create temp table if not exists ctx (key text primary key, val uuid);
grant select on ctx to authenticated, finshield_worker;

\echo '58. create_case: Idempotency 와 프로필 Snapshot'
do $$
declare v1 uuid; v2 uuid; n int;
begin
  v1 := private.create_case('00000000-0000-4000-8000-00000000000a', 'LOAN', '함수 시험 Case', 'cc-1', repeat('1', 64));
  v2 := private.create_case('00000000-0000-4000-8000-00000000000a', 'LOAN', '다른 제목', 'cc-1', repeat('1', 64));
  if v1 <> v2 then raise exception '같은 Key·Hash 가 새 Case 를 만들었습니다'; end if;
  insert into ctx values ('case', v1);
  select count(*) into n from public.financial_profile_versions v
   join public.financial_cases c on c.initial_profile_version_id = v.id
   where c.id = v1 and v.created_reason = 'CASE_CREATED';
  if n <> 1 then raise exception 'CASE_CREATED Snapshot 이 없습니다'; end if;
  select count(*) into n from public.case_events where case_id = v1 and event_type = 'CASE_CREATED' and event_no = 1;
  if n <> 1 then raise exception 'CASE_CREATED Event 가 없습니다'; end if;
  raise notice '  허용 확인: create_case 는 Snapshot·첫 Event 를 남기고 같은 요청은 같은 Case 를 돌려준다';
end
$$;
select fstest.expect_fail($sql$
  select private.create_case('00000000-0000-4000-8000-00000000000a', 'LOAN', '제목', 'cc-1', repeat('2', 64))
$sql$, '같은 Key 다른 Hash');
select fstest.expect_fail($sql$
  select private.create_case('00000000-0000-4000-8000-0000000000ff', 'LOAN', '제목', 'cc-x', repeat('2', 64))
$sql$, '프로필 없는 소유자');

-- 금융 프로필을 아직 만들지 않은 사용자는 명시적 SKIPPED Snapshot 을 받는다.
insert into auth.users (id) values ('00000000-0000-4000-8000-00000000000c');
do $$
declare v uuid; comp text;
begin
  v := private.create_case('00000000-0000-4000-8000-00000000000c', 'LOAN', '프로필 없는 사용자', 'cc-c', repeat('3', 64));
  select pv.completeness into comp from public.financial_cases c
    join public.financial_profile_versions pv on pv.id = c.initial_profile_version_id where c.id = v;
  if comp <> 'SKIPPED' then raise exception 'SKIPPED Snapshot 이 아닙니다 (%)', comp; end if;
  raise notice '  허용 확인: 프로필 없는 사용자는 SKIPPED Snapshot';
end
$$;

\echo '59. transition_financial_case'
select fstest.expect_fail(format($sql$
  select private.transition_financial_case('00000000-0000-4000-8000-00000000000a', %L, 'VERIFYING')
$sql$, (select val from ctx where key = 'case')), '회원이 DRAFT → VERIFYING');
select fstest.expect_fail(format($sql$
  select private.transition_financial_case('00000000-0000-4000-8000-00000000000a', %L, 'VERIFIED', 'SYSTEM')
$sql$, (select val from ctx where key = 'case')), 'DRAFT → VERIFIED 건너뛰기');
select fstest.expect_fail(format($sql$
  select private.transition_financial_case('00000000-0000-4000-8000-00000000000b', %L, 'INPUT_REVIEW')
$sql$, (select val from ctx where key = 'case')), '타인이 Case 전이');
do $$
declare c public.financial_cases%rowtype; v uuid := (select val from ctx where key = 'case');
begin
  c := private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v, 'INPUT_REVIEW');
  c := private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v, 'STOPPED_BY_USER', 'USER', 'USER_PAUSE');
  if c.resume_state <> 'INPUT_REVIEW' then raise exception 'resume_state 가 INPUT_REVIEW 가 아닙니다'; end if;
  perform fstest.expect_fail(format($sql$
    select private.transition_financial_case('00000000-0000-4000-8000-00000000000a', %L, 'DRAFT') $sql$, v),
    '저장된 재개 상태와 다른 재개');
  c := private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v, 'INPUT_REVIEW');
  if c.resume_state is not null then raise exception '재개 뒤 resume_state 가 남았습니다'; end if;
  c := private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v, 'CLOSED');
  perform fstest.expect_fail(format($sql$
    select private.transition_financial_case('00000000-0000-4000-8000-00000000000a', %L, 'INPUT_REVIEW') $sql$, v),
    '입력 없는 CLOSED → INPUT_REVIEW');
  c := private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v, 'DRAFT');
  if (select count(*) from public.case_events where case_id = v and event_type = 'CASE_LIFECYCLE_CHANGED') <> 5 then
    raise exception '전이 Event 수가 다릅니다';
  end if;
  raise notice '  허용 확인: 허용 전이·재개·종료·재개 Event 5건';
end
$$;

\echo '60. advance_input_stage'
insert into public.case_inputs
  (id, owner_id, case_id, input_type, input_stage, raw_delete_status, pii_scan_status, raw_expires_at, size_bytes, page_count)
select '00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-00000000000a', val, 'PDF', 'QUARANTINED',
       'PENDING', 'PENDING', now() + interval '23 hours', 4096, 1 from ctx where key = 'case';
do $$
declare v uuid := (select val from ctx where key = 'case'); i public.case_inputs%rowtype; n int;
begin
  perform private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v, 'INPUT_REVIEW');
  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'EXTRACTED') $sql$, v),
    '단계 건너뛰기 QUARANTINED → EXTRACTED');
  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'VALIDATED',
      '{"detected_mime":"application/pdf","magic_signature":"PDF"}') $sql$, v),
    '업로드 확인 객체 없는 VALIDATED');
  insert into private.input_objects
    (id, owner_id, case_id, case_input_id, input_type, bucket_id, object_path, safe_extension, encryption_state, expires_at, slot_state, uploaded_at)
  values ('00000000-0000-4000-8000-000000000e71', '00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7',
          'PDF', 'finshield-quarantine',
          '00000000-0000-4000-8000-00000000000a/' || v::text || '/00000000-0000-4000-8000-0000000000e7/77777777-7777-4777-8777-777777777777.pdf',
          'pdf', 'VERIFIED', now() + interval '1 hour', 'UPLOADED', now());
  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'VALIDATED', '{}') $sql$, v),
    'MIME·Magic 결과 없는 VALIDATED');
  i := private.advance_input_stage('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7', 'VALIDATED',
         '{"detected_mime":"application/pdf","magic_signature":"PDF"}');
  if i.input_stage <> 'VALIDATED' or i.detected_mime <> 'application/pdf' then raise exception 'VALIDATED 실패'; end if;
  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'EXTRACTED') $sql$, v),
    '성공한 페이지 없는 EXTRACTED');
  insert into public.case_input_pages (id, owner_id, case_id, case_input_id, page_no, parse_status, locator_schema_version)
  values ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7', 1, 'SUCCEEDED', 'v1');
  i := private.advance_input_stage('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7', 'EXTRACTED');
  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'MASKED', '{}') $sql$, v),
    '마스킹 결과 없는 MASKED');
  insert into public.case_input_findings (owner_id, case_id, case_input_id, page_id, finding_type, finding_code, locator, severity, resolution)
  values ('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000f7',
          'PII', 'RRN', '{"schema_version":"1"}'::jsonb, 'BLOCKING', 'OPEN');
  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'MASKED',
      '{"masked_text":"[마스킹] 상담 내용","masked_text_hash":"%s","pii_policy_version":"pii-v1"}') $sql$, v, repeat('5', 64)),
    '열린 BLOCKING PII 발견이 있는 MASKED');
  update public.case_input_findings set resolution = 'MASKED' where case_input_id = '00000000-0000-4000-8000-0000000000e7';
  i := private.advance_input_stage('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7', 'MASKED',
         format('{"masked_text":"[마스킹] 상담 내용","masked_text_hash":"%s","pii_policy_version":"pii-v1"}', repeat('5', 64))::jsonb);
  if i.pii_scan_status <> 'PASSED' or i.masked_text is null then raise exception 'MASKED 결과가 다릅니다'; end if;
  raise notice '  허용 확인: 한 단계씩 전진, 업로드·페이지·PII 선행조건';

  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'CLAIM_CONFIRMED') $sql$, v),
    '확정 Claim 없는 CLAIM_CONFIRMED');
  insert into public.claims (id, owner_id, case_id, source_input_id, source_page_id, origin, claim_type, source_locator, extraction_method)
  values ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7',
          '00000000-0000-4000-8000-0000000000f7', 'EXTRACTED', 'INSTITUTION', '{"schema_version":"1"}'::jsonb, 'MODEL');
  insert into public.claim_revisions (owner_id, case_id, claim_id, revision_no, statement_masked, structured_value, materiality, user_confirmed, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000b7', 1, '기관은 A 저축은행이다',
          '{"schema_version":"1"}'::jsonb, 'MATERIAL', false, 'EXTRACTION', repeat('6', 64));
  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'CLAIM_CONFIRMED') $sql$, v),
    '미확정 Claim 이 남은 CLAIM_CONFIRMED');
  insert into public.claim_revisions (owner_id, case_id, claim_id, revision_no, statement_masked, structured_value, materiality, user_confirmed, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000b7', 2, '기관은 A 저축은행이다',
          '{"schema_version":"1"}'::jsonb, 'MATERIAL', true, 'USER_EDIT', repeat('7', 64));
  i := private.advance_input_stage('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7', 'CLAIM_CONFIRMED');
  if i.claim_confirmed_at is null then raise exception 'claim_confirmed_at 이 비어 있습니다'; end if;
  select count(*) into n from private.file_cleanup_jobs where target_id = '00000000-0000-4000-8000-000000000e71' and reason_code = 'CLAIM_CONFIRMED';
  if n <> 1 then raise exception 'Claim 확인 뒤 원본 Cleanup 이 없습니다'; end if;
  perform fstest.expect_fail(format($sql$
    select private.advance_input_stage('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-0000000000e7', 'RAW_DELETED') $sql$, v),
    '원본 삭제 확인 전 RAW_DELETED');
  raise notice '  허용 확인: Claim 확인은 원본 Cleanup 을 같은 Transaction 에 만든다';
end
$$;

\echo '61. create_verification_run·start·fail'
do $$
declare v uuid := (select val from ctx where key = 'case'); r1 uuid; r2 uuid; n int; run public.verification_runs%rowtype;
begin
  r1 := private.create_verification_run('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-00000000aa01', 'run-1', repeat('a', 64));
  r2 := private.create_verification_run('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-00000000aa01', 'run-1', repeat('a', 64));
  if r1 <> r2 then raise exception '같은 Key·Hash 가 새 Run 을 만들었습니다'; end if;
  insert into ctx values ('run1', r1);
  select * into run from public.verification_runs where id = r1;
  if run.status <> 'QUEUED' or run.run_no <> 1 or run.deadline_at > run.created_at + interval '180 seconds' then
    raise exception 'Run 초기값이 다릅니다';
  end if;
  select count(*) into n from public.verification_run_claims where verification_run_id = r1 and confirmation_state = 'CONFIRMED' and selected_for_verification;
  if n <> 1 then raise exception '확정 Claim 고정이 다릅니다 (%)', n; end if;
  if (select lifecycle from public.financial_cases where id = v) <> 'VERIFYING' then raise exception 'Case 가 VERIFYING 이 아닙니다'; end if;
  -- 프로필이 바뀌지 않았으면 Case 생성 Snapshot 을 재사용한다. 바뀌면 RUN_STARTED 로 새로 만든다.
  if run.profile_version_id <> (select initial_profile_version_id from public.financial_cases where id = v) then
    raise exception '내용이 같은 Snapshot 을 재사용하지 않았습니다';
  end if;
  select count(*) into n from private.outbox_events where deduplication_key = 'run-queued:' || r1::text;
  if n <> 1 then raise exception 'Run Outbox 가 없습니다'; end if;
  raise notice '  허용 확인: Run 은 Claim revision·Snapshot·Manifest 를 고정하고 Case 를 VERIFYING 으로 바꾼다';
  perform fstest.expect_fail(format($sql$
    select private.create_verification_run('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-00000000aa01', 'run-1', %L) $sql$, v, repeat('b', 64)),
    '같은 Key 다른 Hash');
  perform fstest.expect_fail(format($sql$
    select private.create_verification_run('00000000-0000-4000-8000-00000000000a', %L, '00000000-0000-4000-8000-00000000aa01', 'run-2', %L) $sql$, v, repeat('b', 64)),
    'VERIFYING 중 두 번째 초기 Run');
  run := private.start_verification_run(r1);
  if run.status <> 'RUNNING' or run.started_at is null then raise exception 'RUNNING 전환 실패'; end if;
  perform fstest.expect_fail(format($sql$ select private.start_verification_run(%L) $sql$, r1), 'RUNNING Run 재시작');
  run := private.fail_verification_run(r1, 'JUDGE_FAILED', 'SCHEMA_ERROR');
  if run.status <> 'FAILED' or run.finished_at is null then raise exception 'FAILED 종결 실패'; end if;
  if (select lifecycle from public.financial_cases where id = v) <> 'INPUT_REVIEW' then raise exception '실패 뒤 Case 가 INPUT_REVIEW 가 아닙니다'; end if;
  raise notice '  허용 확인: 전면 실패는 Passport 없이 종결하고 Case 를 INPUT_REVIEW 로 되돌린다';

  -- 새 Run 을 만들고 사용자가 중단하면 Run 취소와 USER_STOPPED Cleanup 이 생긴다.
  r2 := private.create_verification_run('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-00000000aa01', 'run-2', repeat('b', 64));
  perform private.transition_financial_case('00000000-0000-4000-8000-00000000000a', v, 'STOPPED_BY_USER');
  if (select status from public.verification_runs where id = r2) <> 'CANCELLED' then raise exception '중단이 Run 을 취소하지 않았습니다'; end if;
  select count(*) into n from private.file_cleanup_jobs where target_id = '00000000-0000-4000-8000-000000000e71' and reason_code = 'USER_STOPPED';
  if n <> 1 then raise exception '중단 Cleanup 이 없습니다'; end if;
  raise notice '  허용 확인: 사용자 중단은 활성 Run 취소와 원본 Cleanup 을 만든다';
end
$$;
select fstest.expect_fail($sql$
  select private.create_verification_run('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ca',
    '00000000-0000-4000-8000-00000000aa01', 'run-x', repeat('a', 64))
$sql$, '없는 Case 의 Run');

\echo '62. 재검증 Job: enqueue·claim·heartbeat·fail·cancel 과 REVALIDATION Run'
-- VERIFIED Case 와 기준 Passport 를 만든다.
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id, lifecycle)
values ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-00000000000a', 'LOAN', '재검증 함수 Case',
        '00000000-0000-4000-8000-0000000000d1', 'INPUT_REVIEW');
insert into public.case_inputs
  (id, owner_id, case_id, input_type, input_stage, raw_delete_status, pii_scan_status, raw_expires_at, masked_text, masked_text_hash, pii_policy_version)
values ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7',
        'TEXT', 'MASKED', 'PENDING', 'PASSED', now() + interval '1 hour', '[마스킹] 텍스트', repeat('8', 64), 'pii-v1');
insert into public.claims (id, owner_id, case_id, source_input_id, origin, claim_type, source_locator, extraction_method)
values ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7',
        '00000000-0000-4000-8000-0000000000e6', 'EXTRACTED', 'PRODUCT', '{"schema_version":"1"}'::jsonb, 'MODEL');
insert into public.claim_revisions (owner_id, case_id, claim_id, revision_no, statement_masked, structured_value, materiality, user_confirmed, edit_source, content_hash)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000b6', 1,
        '상품은 햇살론15 다', '{"schema_version":"1"}'::jsonb, 'MATERIAL', true, 'USER_EDIT', repeat('9', 64));
insert into public.verification_runs
  (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, idempotency_key,
   request_hash, correlation_id, started_at, finished_at, deadline_at, overall_result, coverage_satisfied)
values ('00000000-0000-4000-8000-00000000bb50', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7',
        1, 'INITIAL', 'COMPLETED', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k50',
        repeat('a', 64), gen_random_uuid(), now(), now(), now() + interval '120 seconds', 'VERIFY_BEFORE_PROCEEDING', true);
insert into public.evidence_passports
  (id, owner_id, case_id, verification_run_id, passport_version_no, profile_version_id, execution_manifest_id,
   overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
values ('00000000-0000-4000-8000-00000000e050', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7',
        '00000000-0000-4000-8000-00000000bb50', 1, '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01',
        'VERIFY_BEFORE_PROCEEDING', true, 'p1', '{"schema_version":"1"}'::jsonb, repeat('1', 64));
update public.financial_cases
   set lifecycle = 'VERIFIED', latest_successful_run_id = '00000000-0000-4000-8000-00000000bb50', latest_passport_id = '00000000-0000-4000-8000-00000000e050'
 where id = '00000000-0000-4000-8000-0000000000c7';

do $$
declare j1 uuid; j2 uuid; cl record; n int; job public.revalidation_jobs%rowtype; rv uuid;
begin
  j1 := private.enqueue_revalidation('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7', 'rv-1', repeat('c', 64));
  j2 := private.enqueue_revalidation('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7', 'rv-1', repeat('c', 64));
  if j1 <> j2 then raise exception '같은 Key 가 새 Job 을 만들었습니다'; end if;
  perform fstest.expect_fail($sql$
    select private.enqueue_revalidation('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7', 'rv-2', repeat('c', 64))
  $sql$, '활성 Job 이 있는데 새 재검증');
  select count(*) into n from public.revalidation_events where revalidation_job_id = j1 and event_type = 'QUEUED';
  if n <> 1 then raise exception 'QUEUED Event 가 없습니다'; end if;
  select * into cl from private.claim_revalidation_job('worker-1', 60);
  if cl.job_id <> j1 or cl.lease_token is null or cl.attempt_no <> 1 then raise exception 'Claim 결과가 다릅니다'; end if;
  select count(*) into n from private.claim_revalidation_job('worker-2', 60);
  if n <> 0 then raise exception 'Lease 중인 Job 이 다시 Claim 됐습니다'; end if;
  if not private.heartbeat_revalidation_job(j1, cl.lease_token, 60) then raise exception 'Heartbeat 실패'; end if;
  if private.heartbeat_revalidation_job(j1, gen_random_uuid(), 60) then raise exception '다른 token 의 Heartbeat 가 통과했습니다'; end if;
  raise notice '  허용 확인: enqueue → claim(Lease·Attempt) → heartbeat(token 검증)';

  -- RUNNING Job 위에서 REVALIDATION Run 을 만든다. Case 는 VERIFIED 그대로다.
  rv := private.create_verification_run('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7',
          '00000000-0000-4000-8000-00000000aa01', 'rv-run-1', repeat('d', 64), 'REVALIDATION', j1);
  if (select kind from public.verification_runs where id = rv) <> 'REVALIDATION'
     or (select parent_run_id from public.verification_runs where id = rv) <> '00000000-0000-4000-8000-00000000bb50'
     or (select lifecycle from public.financial_cases where id = '00000000-0000-4000-8000-0000000000c7') <> 'VERIFIED' then
    raise exception 'REVALIDATION Run 이 잘못 만들어졌습니다';
  end if;
  raise notice '  허용 확인: 재검증 Run 은 직전 Run 을 가리키고 Case VERIFIED 를 유지한다';

  perform fstest.expect_fail(format($sql$ select private.fail_revalidation_job(%L, gen_random_uuid(), 'SOURCE_UNAVAILABLE') $sql$, j1),
    '다른 Lease token 으로 Job 실패 종결');
  job := private.fail_revalidation_job(j1, cl.lease_token, 'SOURCE_UNAVAILABLE', 'HTTP_503');
  if job.status <> 'FAILED' or job.finished_at is null then raise exception 'Job FAILED 종결 실패'; end if;
  if (select lifecycle from public.financial_cases where id = '00000000-0000-4000-8000-0000000000c7') <> 'VERIFIED' then
    raise exception '재검증 실패가 Case 상태를 바꿨습니다';
  end if;
  perform private.fail_verification_run(rv, 'REVALIDATION_FAILED');

  -- QUEUED 상태의 취소는 즉시 FAILED·USER_CANCELLED 로 종결한다.
  j2 := private.enqueue_revalidation('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c7', 'rv-2', repeat('c', 64));
  perform fstest.expect_fail(format($sql$ select private.cancel_revalidation_job('00000000-0000-4000-8000-00000000000b', %L) $sql$, j2),
    '타인이 Job 취소');
  job := private.cancel_revalidation_job('00000000-0000-4000-8000-00000000000a', j2);
  if job.status <> 'FAILED' or job.reason_code <> 'USER_CANCELLED' then raise exception '취소 종결이 다릅니다'; end if;
  select count(*) into n from public.revalidation_events where revalidation_job_id = j2 and event_type = 'CANCELLED';
  if n <> 1 then raise exception 'CANCELLED Event 가 없습니다'; end if;
  raise notice '  허용 확인: 취소는 cancel_requested_at 뒤 FAILED·USER_CANCELLED 로 종결';
end
$$;
select fstest.expect_fail(format($sql$
  select private.enqueue_revalidation('00000000-0000-4000-8000-00000000000a', %L, 'rv-9', %L)
$sql$, (select val from ctx where key = 'case'), repeat('c', 64)), 'VERIFIED 가 아닌 Case 의 재검증');

\echo '63. 검색 함수'
do $$
declare n int; r record; q extensions.vector := (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024));
begin
  select count(*) into n from private.search_public_knowledge('00000000-0000-4000-8000-00000000aa01', '설명의무를 이행하고', q, array['INST_MOLEG']);
  if n <> 1 then raise exception 'Keyword·Vector 후보가 1건이 아닙니다 (%)', n; end if;
  select * into r from private.search_public_knowledge('00000000-0000-4000-8000-00000000aa01', '설명의무를 이행하고', q, array['INST_MOLEG']);
  if r.matched_by <> 'KEYWORD_AND_VECTOR' or r.source_snapshot_id is null then raise exception '후보의 Provenance 가 비어 있습니다'; end if;
  select count(*) into n from private.search_public_knowledge('00000000-0000-4000-8000-00000000aa01', '설명의무를 이행하고', q, array['INST_OTHER']);
  if n <> 0 then raise exception 'Metadata Filter 가 다른 기관 문서를 통과시켰습니다'; end if;
  select count(*) into n from private.search_public_knowledge('00000000-0000-4000-8000-00000000aa01', '설명의무를 이행하고', null, null, null, null, 'SAVINGS');
  if n <> 0 then raise exception '시나리오 Filter 가 동작하지 않았습니다'; end if;
  select count(*) into n from private.search_public_knowledge('00000000-0000-4000-8000-00000000aa01', '존재하지 않는 단어', null);
  if n <> 0 then raise exception '검색 0건이 후보를 만들었습니다'; end if;
  raise notice '  허용 확인: Manifest Release 안 Metadata Filter → Keyword·Vector 후보와 Provenance, 0건은 0건';
  perform fstest.expect_fail($sql$
    select * from private.search_public_knowledge('00000000-0000-4000-8000-00000000aa01', 'x', null, null, null, null, null, current_date, 51)
  $sql$, '후보 상한 50 초과');
  perform fstest.expect_fail($sql$
    select * from private.search_case_knowledge(null, null, (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024)))
  $sql$, '범위 없는 사용자 Vector Query');
end
$$;

do $$
declare v uuid := (select val from ctx where key = 'case'); n int;
begin
  insert into private.case_embeddings
    (owner_id, case_id, case_input_id, page_id, model_id, model_version, dimensions, embedding, masked_content_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000000a', v, '00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000f7',
          'embed-v4.0', '2026-09', 1024, (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024)),
          repeat('a', 64), now() + interval '1 hour');
  select count(*) into n from private.search_case_knowledge('00000000-0000-4000-8000-00000000000a', v,
    (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024)));
  if n <> 1 then raise exception 'Case Vector 검색이 1건이 아닙니다 (%)', n; end if;
  perform fstest.expect_fail(format($sql$
    select * from private.search_case_knowledge('00000000-0000-4000-8000-00000000000b', %L,
      (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024))) $sql$, v),
    '타인 Case 의 Vector 검색');
  raise notice '  허용 확인: 사용자 Vector 검색은 Owner·Case 고정';
end
$$;

\echo '64. 권한'
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  perform fstest.expect_fail($sql$
    select private.create_case('00000000-0000-4000-8000-00000000000a', 'LOAN', '직접', 'cc-9', repeat('1', 64))
  $sql$, '회원이 create_case 직접 호출');
  perform fstest.expect_fail(format($sql$ update public.financial_cases set lifecycle = 'VERIFIED' where id = %L $sql$,
    (select val from ctx where key = 'case')), '회원이 lifecycle 직접 UPDATE');
end
$$;
do $$
declare v uuid;
begin
  set local role finshield_worker;
  v := private.create_case('00000000-0000-4000-8000-00000000000b', 'LOAN', 'Worker 경로', 'cc-w', repeat('1', 64));
  if v is null then raise exception 'Worker 가 create_case 를 호출하지 못했습니다'; end if;
  raise notice '  허용 확인: Worker 는 함수로 Case 를 만들고 회원은 직접 못 바꾼다';
end
$$;

\echo '0015 불변식 시험을 통과했습니다.'
