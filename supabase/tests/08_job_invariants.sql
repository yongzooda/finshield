-- ============================================================
-- 0012 재검증 Job·Diff·알림·PreCase 보호 시험 (명세 6.6, 6.7, 7.1, 12절)
--
-- 07 이 Case ce 를 지웠다. Manifest aa01·Registry·KB·채널은 남아 있다.
-- ============================================================

\echo '37. 준비: Case·Run·Passport 두 벌'
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('00000000-0000-4000-8000-0000000000cf', '00000000-0000-4000-8000-00000000000a', 'LOAN', '재검증 Job 시험 Case',
        '00000000-0000-4000-8000-0000000000d1');
insert into public.verification_runs
  (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, idempotency_key,
   request_hash, correlation_id, started_at, finished_at, deadline_at, overall_result, coverage_satisfied)
values ('00000000-0000-4000-8000-00000000bb30', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cf', 1, 'INITIAL', 'COMPLETED',
        '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k30', repeat('a', 64),
        gen_random_uuid(), now(), now(), now() + interval '120 seconds', 'VERIFY_BEFORE_PROCEEDING', true);
insert into public.evidence_passports
  (id, owner_id, case_id, verification_run_id, passport_version_no, profile_version_id, execution_manifest_id,
   overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
values ('00000000-0000-4000-8000-00000000e010', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cf', '00000000-0000-4000-8000-00000000bb30', 1,
        '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01',
        'VERIFY_BEFORE_PROCEEDING', true, 'p1', '{"schema_version":"1"}'::jsonb, repeat('1', 64));

\echo '38. revalidation_jobs'
insert into public.revalidation_jobs
  (id, owner_id, case_id, base_passport_id, status, trigger_type, idempotency_key, request_hash, queued_at)
values ('00000000-0000-4000-8000-00000000f010', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cf', '00000000-0000-4000-8000-00000000e010', 'QUEUED', 'MANUAL', 'j1',
        repeat('b', 64), now());

select fstest.expect_fail($sql$
  insert into public.revalidation_jobs
    (owner_id, case_id, base_passport_id, status, trigger_type, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
          '00000000-0000-4000-8000-00000000e010', 'QUEUED', 'MANUAL', 'j2', repeat('c', 64))
$sql$, 'Case 당 활성 재검증 Job 둘');

select fstest.expect_fail($sql$
  insert into public.revalidation_jobs
    (owner_id, case_id, base_passport_id, status, trigger_type, idempotency_key, request_hash, finished_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
          '00000000-0000-4000-8000-00000000e010', 'FAILED', 'MANUAL', 'j3', repeat('c', 64), now())
$sql$, '이유 없이 FAILED');

select fstest.expect_fail($sql$
  insert into public.revalidation_jobs
    (owner_id, case_id, base_passport_id, status, trigger_type, idempotency_key, request_hash, finished_at,
     reason_code, result_run_id)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
          '00000000-0000-4000-8000-00000000e010', 'FAILED', 'MANUAL', 'j3', repeat('c', 64), now(),
          'USER_CANCELLED', '00000000-0000-4000-8000-00000000bb30')
$sql$, 'FAILED 인데 성공 결과 포인터');

select fstest.expect_ok($sql$
  insert into private.revalidation_job_runtime (job_id, max_attempts, available_at)
  values ('00000000-0000-4000-8000-00000000f010', 3, now())
$sql$, 'Job Runtime 생성');

select fstest.expect_fail($sql$
  update private.revalidation_job_runtime set lease_owner = 'worker-1'
   where job_id = '00000000-0000-4000-8000-00000000f010'
$sql$, 'Token·만료 없는 반쪽 Lease');

select fstest.expect_ok($sql$
  update private.revalidation_job_runtime
     set lease_owner = 'worker-1', lease_token = gen_random_uuid(), leased_until = now() + interval '30 seconds',
         attempt_no = 1
   where job_id = '00000000-0000-4000-8000-00000000f010'
$sql$, '완전한 Lease 부여');

select fstest.expect_fail($sql$
  update private.revalidation_job_runtime set attempt_no = 4
   where job_id = '00000000-0000-4000-8000-00000000f010'
$sql$, 'max_attempts 초과 시도');

\echo '39. 종결 정합성 (Deferred Trigger)'
-- 결과 Run·Passport 를 만든다.
insert into public.verification_runs
  (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, parent_run_id,
   revalidation_job_id, idempotency_key, request_hash, correlation_id, started_at, finished_at, deadline_at,
   overall_result, coverage_satisfied)
values ('00000000-0000-4000-8000-00000000bb31', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cf', 2, 'REVALIDATION', 'COMPLETED',
        '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01',
        '00000000-0000-4000-8000-00000000bb30', '00000000-0000-4000-8000-00000000f010', 'k31', repeat('d', 64),
        gen_random_uuid(), now(), now(), now() + interval '120 seconds', 'VERIFY_BEFORE_PROCEEDING', true);
insert into public.evidence_passports
  (id, owner_id, case_id, verification_run_id, passport_version_no, previous_passport_id, profile_version_id,
   execution_manifest_id, overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
values ('00000000-0000-4000-8000-00000000e011', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000cf', '00000000-0000-4000-8000-00000000bb31', 2,
        '00000000-0000-4000-8000-00000000e010', '00000000-0000-4000-8000-0000000000d1',
        '00000000-0000-4000-8000-00000000aa01', 'VERIFY_BEFORE_PROCEEDING', true, 'p1',
        '{"schema_version":"1"}'::jsonb, repeat('2', 64));

-- Diff 없이 NO_CHANGE 종결 → Commit 시점에 거부
do $$
begin
  begin
    update public.revalidation_jobs
       set status = 'NO_CHANGE', started_at = now(), finished_at = now(),
           result_run_id = '00000000-0000-4000-8000-00000000bb31', result_passport_id = '00000000-0000-4000-8000-00000000e011'
     where id = '00000000-0000-4000-8000-00000000f010';
    set constraints all immediate;
    raise exception 'Diff 없는 종결이 통과했습니다';
  exception when check_violation then
    raise notice '  거부 확인: Diff 없는 NO_CHANGE 종결 Commit  (%)', sqlstate;
  end;
end
$$;

-- NO_CHANGE 인데 material_change=true 인 Diff → 거부
do $$
begin
  begin
    update public.revalidation_jobs
       set status = 'NO_CHANGE', started_at = now(), finished_at = now(),
           result_run_id = '00000000-0000-4000-8000-00000000bb31', result_passport_id = '00000000-0000-4000-8000-00000000e011'
     where id = '00000000-0000-4000-8000-00000000f010';
    insert into public.passport_diffs
      (owner_id, case_id, revalidation_job_id, before_passport_id, after_passport_id, material_change,
       claim_changes, evidence_changes, result_changes, action_changes, diff_schema_version, content_hash)
    values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
            '00000000-0000-4000-8000-00000000f010', '00000000-0000-4000-8000-00000000e010',
            '00000000-0000-4000-8000-00000000e011', true, '[]', '[]', '[]', '[]', 'd1', repeat('3', 64));
    set constraints all immediate;
    raise exception 'NO_CHANGE 에 중대 변경 Diff 가 통과했습니다';
  exception when check_violation then
    raise notice '  거부 확인: NO_CHANGE 인데 material_change=true  (%)', sqlstate;
  end;
end
$$;

-- 올바른 종결: 빈 Diff, before=base, after=result, 결과 Run 이 Job 을 가리킴
do $$
begin
  update public.revalidation_jobs
     set status = 'NO_CHANGE', started_at = now(), finished_at = now(),
         result_run_id = '00000000-0000-4000-8000-00000000bb31', result_passport_id = '00000000-0000-4000-8000-00000000e011'
   where id = '00000000-0000-4000-8000-00000000f010';
  insert into public.passport_diffs
    (id, owner_id, case_id, revalidation_job_id, before_passport_id, after_passport_id, material_change,
     claim_changes, evidence_changes, result_changes, action_changes, diff_schema_version, content_hash)
  values ('00000000-0000-4000-8000-00000000f110', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cf', '00000000-0000-4000-8000-00000000f010',
          '00000000-0000-4000-8000-00000000e010', '00000000-0000-4000-8000-00000000e011', false,
          '[]', '[]', '[]', '[]', 'd1', repeat('3', 64));
  set constraints all immediate;
  raise notice '  허용 확인: 빈 Diff 와 함께 NO_CHANGE 종결 Commit';
end
$$;

select fstest.expect_fail($sql$
  insert into public.passport_diffs
    (owner_id, case_id, revalidation_job_id, before_passport_id, after_passport_id, material_change,
     claim_changes, evidence_changes, result_changes, action_changes, diff_schema_version, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
          '00000000-0000-4000-8000-00000000f010', '00000000-0000-4000-8000-00000000e010',
          '00000000-0000-4000-8000-00000000e011', false, '[]', '[]', '[]', '[]', 'd1', repeat('4', 64))
$sql$, 'Job 당 두 번째 Diff');

select fstest.expect_fail($sql$
  update public.passport_diffs set material_change = true where id = '00000000-0000-4000-8000-00000000f110'
$sql$, 'Diff UPDATE');

\echo '40. revalidation_events, notifications'
select fstest.expect_fail($sql$
  insert into public.revalidation_events (owner_id, case_id, revalidation_job_id, event_no, event_type, payload)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
          '00000000-0000-4000-8000-00000000f010', 1, 'SOURCE_FETCHED', '{"schema_version":"1"}'::jsonb)
$sql$, '실제 Fetch Event 없는 Source 재조회 Event');

select fstest.expect_ok($sql$
  insert into public.revalidation_events
    (owner_id, case_id, revalidation_job_id, event_no, event_type, source_fetch_event_id, payload)
  select '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
         '00000000-0000-4000-8000-00000000f010', 1, 'SOURCE_UNCHANGED', f.id, '{"schema_version":"1"}'::jsonb
    from kb.source_fetch_events f where f.request_key = 'LAW-001/20260101'
$sql$, 'Fetch Event 를 가리키는 재조회 Event');

select fstest.expect_fail($sql$
  insert into public.notifications
    (owner_id, case_id, notification_type, revalidation_job_id, deduplication_key, title, body_masked)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf', 'MATERIAL_CHANGE_DETECTED',
          '00000000-0000-4000-8000-00000000f010', 'job-f010-risk', '중대 변경', '변경이 감지됐습니다')
$sql$, 'NO_CHANGE Job 에 위험 알림');

select fstest.expect_ok($sql$
  insert into public.notifications
    (owner_id, case_id, notification_type, revalidation_job_id, passport_diff_id, deduplication_key, title, body_masked)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf', 'REVALIDATION_NO_CHANGE',
          '00000000-0000-4000-8000-00000000f010', '00000000-0000-4000-8000-00000000f110', 'job-f010-done',
          '재검증 완료', '변경 사항이 없습니다')
$sql$, 'NO_CHANGE 조용한 완료 알림');

select fstest.expect_fail($sql$
  insert into public.notifications
    (owner_id, case_id, notification_type, revalidation_job_id, deduplication_key, title, body_masked)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf', 'REVALIDATION_NO_CHANGE',
          '00000000-0000-4000-8000-00000000f010', 'job-f010-done', '중복', '중복')
$sql$, '같은 deduplication_key 중복 알림');

select fstest.expect_fail($sql$
  insert into public.notifications
    (owner_id, case_id, notification_type, channel, deduplication_key, title, body_masked)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf', 'REVALIDATION_NO_CHANGE',
          'EMAIL', 'job-f010-mail', '메일', 'P1')
$sql$, 'P0 에서 EMAIL 채널');

select fstest.expect_ok($sql$
  insert into public.notification_preferences (owner_id, scope_type) values ('00000000-0000-4000-8000-00000000000a', 'ACCOUNT')
$sql$, '계정 기본 알림 설정');
select fstest.expect_fail($sql$
  insert into public.notification_preferences (owner_id, scope_type) values ('00000000-0000-4000-8000-00000000000a', 'ACCOUNT')
$sql$, '계정 기본 설정 둘');
select fstest.expect_fail($sql$
  insert into public.notification_preferences (owner_id, scope_type, case_id, email_enabled)
  values ('00000000-0000-4000-8000-00000000000a', 'CASE', '00000000-0000-4000-8000-0000000000cf', true)
$sql$, 'P1 Feature Gate 전 Email 켜기');
select fstest.expect_fail($sql$
  insert into public.notification_preferences (owner_id, scope_type, case_id)
  values ('00000000-0000-4000-8000-00000000000a', 'ACCOUNT', '00000000-0000-4000-8000-0000000000cf')
$sql$, 'ACCOUNT scope 인데 case_id 있음');

\echo '41. precase_assessments: 가입 확인 없이 시작 불가'
select fstest.expect_fail($sql$
  insert into public.precase_assessments
    (owner_id, case_id, assessment_no, base_passport_id, profile_version_id, assessment_schema_version, execution_manifest_id)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf', 1,
          '00000000-0000-4000-8000-00000000e011', '00000000-0000-4000-8000-0000000000d1', 'a1',
          '00000000-0000-4000-8000-00000000aa01')
$sql$, '가입 확인 없는 Case 의 가입 후 점검');

-- 가입 확인 Event 와 시각을 기록한다 (피해 의심만으로는 안 된다).
insert into public.case_events (owner_id, case_id, event_no, event_type, actor_type, payload, idempotency_key)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf', 1, 'JOURNEY_ENROLLED', 'USER',
        '{"schema_version":"1","channel":"BRANCH"}'::jsonb, 'enroll-1');
update public.financial_cases set journey_stage = 'ENROLLED', enrollment_confirmed_at = now()
 where id = '00000000-0000-4000-8000-0000000000cf';

select fstest.expect_ok($sql$
  insert into public.precase_assessments
    (id, owner_id, case_id, assessment_no, base_passport_id, profile_version_id, assessment_schema_version, execution_manifest_id)
  values ('00000000-0000-4000-8000-00000000a010', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cf', 1, '00000000-0000-4000-8000-00000000e011',
          '00000000-0000-4000-8000-0000000000d1', 'a1', '00000000-0000-4000-8000-00000000aa01')
$sql$, '가입 확인 뒤 가입 후 점검 시작');

select fstest.expect_fail($sql$
  update public.precase_assessments set status = 'COMPLETED', finished_at = now()
   where id = '00000000-0000-4000-8000-00000000a010'
$sql$, '결과 없이 COMPLETED');

select fstest.expect_ok($sql$
  insert into public.precase_answers
    (id, owner_id, case_id, precase_assessment_id, question_code, question_version, answer_version_no, answer_code)
  values ('00000000-0000-4000-8000-00000000a110', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cf', '00000000-0000-4000-8000-00000000a010', 'EXPLAINED_RATE', 'q1', 1, 'YES')
$sql$, '첫 답변');
select fstest.expect_fail($sql$
  insert into public.precase_answers
    (owner_id, case_id, precase_assessment_id, question_code, question_version, answer_version_no, answer_code)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
          '00000000-0000-4000-8000-00000000a010', 'EXPLAINED_RATE', 'q1', 2, 'NO')
$sql$, '직전 답변 없이 정정 버전');
select fstest.expect_ok($sql$
  insert into public.precase_answers
    (owner_id, case_id, precase_assessment_id, question_code, question_version, answer_version_no, answer_code, supersedes_answer_id)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
          '00000000-0000-4000-8000-00000000a010', 'EXPLAINED_RATE', 'q1', 2, 'NO', '00000000-0000-4000-8000-00000000a110')
$sql$, '직전 답변을 가리키는 정정');
select fstest.expect_fail($sql$
  update public.precase_answers set answer_code = 'MAYBE' where id = '00000000-0000-4000-8000-00000000a110'
$sql$, '답변 UPDATE');

select fstest.expect_ok($sql$
  insert into public.action_checklists (owner_id, case_id, precase_assessment_id, action_code, required_material_codes)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000cf',
          '00000000-0000-4000-8000-00000000a010', 'REQUEST_ADDITIONAL_EXPLANATION', array['CONTRACT_COPY'])
$sql$, 'Checklist 항목');
select fstest.expect_fail($sql$
  update public.action_checklists set status = 'DONE' where precase_assessment_id = '00000000-0000-4000-8000-00000000a010'
$sql$, 'completed_at 없이 DONE');

\echo '42. 권한과 Cascade'
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","session_id":"10000000-0000-4000-8000-00000000000a","exp":4102444800}';
  select count(*) into n from public.notifications where read_at is null;
  if n <> 1 then raise exception '회원이 본인 알림을 읽지 못했습니다 (%)', n; end if;
  select count(*) into n from public.passport_diffs;
  if n <> 1 then raise exception '회원이 본인 Diff 를 읽지 못했습니다 (%)', n; end if;
  raise notice '  허용 확인: 회원이 본인 알림·Diff·점검을 읽는다';
  perform fstest.expect_fail($sql$
    update public.notifications set read_at = now() where deduplication_key = 'job-f010-done'
  $sql$, '회원이 알림을 직접 UPDATE (RPC 전용)');
  perform fstest.expect_fail($sql$ select count(*) from private.revalidation_job_runtime $sql$,
    '회원이 Job Runtime 조회');
end
$$;

do $$
declare n int;
begin
  set local role finshield_worker;
  select count(*) into n from private.revalidation_job_runtime;
  if n <> 1 then raise exception 'Worker 가 Runtime 을 읽지 못했습니다 (%)', n; end if;
  raise notice '  허용 확인: Worker 가 Job Runtime 을 읽고 Lease 한다';
  perform fstest.expect_fail($sql$
    update public.revalidation_jobs set status = 'FAILED', finished_at = now(), reason_code = 'X'
     where id = '00000000-0000-4000-8000-00000000f010'
  $sql$, 'Worker 가 Job 상태를 직접 UPDATE');
end
$$;

do $$
declare remaining int;
begin
  delete from public.financial_cases where id = '00000000-0000-4000-8000-0000000000cf';
  select (select count(*) from public.revalidation_jobs) + (select count(*) from private.revalidation_job_runtime)
       + (select count(*) from public.passport_diffs) + (select count(*) from public.notifications)
       + (select count(*) from public.precase_assessments) + (select count(*) from public.action_checklists)
    into remaining;
  if remaining <> 0 then raise exception 'Case Cascade 뒤 Job·알림·점검 행이 남았습니다 (%)', remaining; end if;
  raise notice '  허용 확인: Case 삭제 Cascade 로 Job·Runtime·Diff·알림·점검 제거';
end
$$;

\echo '0012 불변식 시험을 통과했습니다.'
