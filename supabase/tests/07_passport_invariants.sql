-- ============================================================
-- 0011 축 결과·Guide·Passport 불변식 시험 (명세 6.4, 6.5, 7.1, 7.4)
--
-- 06 이 Case cd 를 지웠다. Manifest aa01 과 Registry·KB·채널 Registry 는
-- 남아 있다.
-- ============================================================

\echo '32. 준비: Case·Run'
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('00000000-0000-4000-8000-0000000000ce', '00000000-0000-4000-8000-00000000000a', 'LOAN', 'Passport 시험 Case',
        '00000000-0000-4000-8000-0000000000d1');
insert into public.verification_runs
  (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, idempotency_key,
   request_hash, correlation_id, started_at, deadline_at)
values ('00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000ce', 1, 'INITIAL', 'RUNNING',
        '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k20', repeat('a', 64),
        gen_random_uuid(), now(), now() + interval '120 seconds');

\echo '33. verification_axis_results'
select fstest.expect_ok($sql$
  insert into public.verification_axis_results
    (owner_id, case_id, verification_run_id, axis, result_code, summary_masked, limitation_codes, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 'AUTHENTICITY', 'AUTH_VERIFIED_SCOPE', '기관·상품 식별 확인',
          array[]::text[], repeat('1', 64)),
         ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 'SUITABILITY', 'SUIT_NEED_MORE_INFORMATION', '프로필 미입력',
          array['PROFILE_SKIPPED'], repeat('2', 64))
$sql$, '축별 결과 기록');

select fstest.expect_fail($sql$
  insert into public.verification_axis_results
    (owner_id, case_id, verification_run_id, axis, result_code, summary_masked, limitation_codes, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 'AUTHENTICITY', 'AUTH_COPY', '복사', array[]::text[], repeat('3', 64))
$sql$, '같은 Run 에 같은 축 두 번');

select fstest.expect_fail($sql$
  update public.verification_axis_results set result_code = 'AUTH_CHANGED'
   where verification_run_id = '00000000-0000-4000-8000-00000000bb20' and axis = 'AUTHENTICITY'
$sql$, '축 결과 UPDATE');

\echo '34. action_guides: 원시 채널 금지'
select fstest.expect_fail($sql$
  insert into public.action_guides
    (owner_id, case_id, verification_run_id, version_no, status, guide_schema_version, actions, limitation_codes, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 1, 'COMPLETED', 'g1',
          '[{"action_no":1,"action_code":"REPORT","url":"https://example.invalid/report"}]'::jsonb,
          array[]::text[], repeat('4', 64))
$sql$, 'actions 에 URL 원문');

select fstest.expect_fail($sql$
  insert into public.action_guides
    (owner_id, case_id, verification_run_id, version_no, status, guide_schema_version, actions, limitation_codes, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 1, 'COMPLETED', 'g1',
          '[{"action_no":1,"action_code":"CALL","phone":"02-1234-5678"}]'::jsonb,
          array[]::text[], repeat('4', 64))
$sql$, 'actions 에 전화번호 원문');

select fstest.expect_fail($sql$
  insert into public.action_guides
    (owner_id, case_id, verification_run_id, version_no, status, guide_schema_version, actions, limitation_codes, content_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 1, 'COMPLETED', 'g1', '[]'::jsonb, array[]::text[], repeat('4', 64))
$sql$, 'COMPLETED 인데 행동이 없음');

select fstest.expect_ok($sql$
  insert into public.action_guides
    (id, owner_id, case_id, verification_run_id, version_no, status, guide_schema_version, actions, limitation_codes, content_hash)
  values ('00000000-0000-4000-8000-00000000af01', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ce', '00000000-0000-4000-8000-00000000bb20', 1, 'COMPLETED', 'g1',
          '[{"action_no":1,"action_code":"REPORT_TO_FSS","reason_code":"UNREGISTERED_LENDER"}]'::jsonb,
          array[]::text[], repeat('4', 64))
$sql$, '채널 ID 참조형 Guide');

-- 04 가 만든 채널 Registry 행 (INST_FSS PHONE 1332)
select fstest.expect_ok($sql$
  insert into public.action_guide_channels
    (owner_id, case_id, verification_run_id, action_guide_id, official_channel_registry_id, action_no, display_order)
  select '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
         '00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-00000000af01', r.id, 1, 1
    from kb.official_channel_registry r where r.institution_code = 'INST_FSS' and r.channel_type = 'PHONE'
$sql$, '승인 채널을 행동 1에 연결');

select fstest.expect_fail($sql$
  insert into public.action_guide_channels
    (owner_id, case_id, verification_run_id, action_guide_id, official_channel_registry_id, action_no, display_order)
  select '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
         '00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-00000000af01', r.id, 2, 2
    from kb.official_channel_registry r where r.institution_code = 'INST_FSS' and r.channel_type = 'PHONE'
$sql$, 'Guide 에 없는 action_no 2 에 채널 연결');

-- 유효기간이 끝난 채널
insert into kb.official_channel_registry
  (id, institution_code, channel_type, normalized_value, display_value, source_snapshot_id, valid_from, valid_to)
values ('00000000-0000-4000-8000-00000000cf01', 'INST_FSS', 'URL', 'https://old.invalid', '옛 홈페이지',
        '00000000-0000-4000-8000-00000000c001', '2020-01-01', '2021-12-31');
select fstest.expect_fail($sql$
  insert into public.action_guide_channels
    (owner_id, case_id, verification_run_id, action_guide_id, official_channel_registry_id, action_no, display_order)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', '00000000-0000-4000-8000-00000000af01',
          '00000000-0000-4000-8000-00000000cf01', 1, 2)
$sql$, '유효기간 밖 채널 연결');

\echo '35. evidence_passports'
select fstest.expect_fail($sql$
  insert into public.evidence_passports
    (owner_id, case_id, verification_run_id, passport_version_no, profile_version_id, execution_manifest_id,
     action_guide_id, overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 1, '00000000-0000-4000-8000-0000000000d1',
          '00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000af01',
          'NO_SPECIAL_RISK_IN_VERIFIED_SCOPE', false, 'p1', '{"schema_version":"1"}'::jsonb, repeat('5', 64))
$sql$, 'Coverage 미충족인데 특별한 위험 신호 없음');

-- Run 이 고정한 Profile Snapshot 과 다른 값 (Owner B 의 d2 는 FK 에서, 같은 Owner 의 다른 값은 Trigger 에서 걸린다)
insert into public.financial_profile_versions
  (id, owner_id, profile_id, version_no, schema_version, snapshot, completeness, content_hash, created_reason)
values ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000fa', 2, 'v1', '{"schema_version":"v1"}'::jsonb, 'COMPLETE', repeat('c', 64), 'PROFILE_UPDATED');
select fstest.expect_fail($sql$
  insert into public.evidence_passports
    (owner_id, case_id, verification_run_id, passport_version_no, profile_version_id, execution_manifest_id,
     action_guide_id, overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 1, '00000000-0000-4000-8000-0000000000d3',
          '00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000af01',
          'VERIFY_BEFORE_PROCEEDING', true, 'p1', '{"schema_version":"1"}'::jsonb, repeat('5', 64))
$sql$, 'Run 이 고정한 Profile Snapshot 과 다른 Passport');

select fstest.expect_ok($sql$
  insert into public.evidence_passports
    (id, owner_id, case_id, verification_run_id, passport_version_no, profile_version_id, execution_manifest_id,
     action_guide_id, overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
  values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ce', '00000000-0000-4000-8000-00000000bb20', 1,
          '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01',
          '00000000-0000-4000-8000-00000000af01', 'VERIFY_BEFORE_PROCEEDING', true, 'p1',
          '{"schema_version":"1","claims":[],"axes":2}'::jsonb, repeat('5', 64))
$sql$, 'Run 이 고정한 값과 일치하는 Passport');

select fstest.expect_fail($sql$
  insert into public.evidence_passports
    (owner_id, case_id, verification_run_id, passport_version_no, profile_version_id, execution_manifest_id,
     overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
          '00000000-0000-4000-8000-00000000bb20', 1, '00000000-0000-4000-8000-0000000000d1',
          '00000000-0000-4000-8000-00000000aa01', 'HIGH_CAUTION', true, 'p1', '{"schema_version":"1"}'::jsonb, repeat('6', 64))
$sql$, 'Case 안 Passport 번호 중복');

select fstest.expect_ok($sql$
  update public.financial_cases set latest_passport_id = '00000000-0000-4000-8000-00000000e001'
   where id = '00000000-0000-4000-8000-0000000000ce'
$sql$, 'Case 최신 Passport 포인터 (교차 소유 FK)');

select fstest.expect_fail($sql$
  update public.financial_cases set latest_passport_id = '00000000-0000-4000-8000-00000000e001'
   where id = '00000000-0000-4000-8000-0000000000cb'
$sql$, '다른 Case 의 Passport 를 최신으로 지정');

select fstest.expect_fail($sql$
  update public.evidence_passports set overall_result = 'HIGH_CAUTION' where id = '00000000-0000-4000-8000-00000000e001'
$sql$, 'Passport UPDATE');

select fstest.expect_fail($sql$
  delete from public.evidence_passports where id = '00000000-0000-4000-8000-00000000e001'
$sql$, 'Case 가 살아 있는데 Passport 직접 삭제');

\echo '36. 권한과 Cascade'
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  select count(*) into n from public.evidence_passports;
  if n <> 1 then raise exception '회원이 본인 Passport 를 읽지 못했습니다 (%)', n; end if;
  select count(*) into n from public.verification_axis_results;
  if n <> 2 then raise exception '회원이 본인 축 결과를 읽지 못했습니다 (%)', n; end if;
  raise notice '  허용 확인: 회원이 본인 Passport·축 결과·Guide 를 읽는다';
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b"}';
  select count(*) into n from public.evidence_passports;
  if n <> 0 then raise exception '타인 Passport 가 보입니다 (%)', n; end if;
  raise notice '  허용 확인: 타인 Passport 차단';
  perform fstest.expect_fail($sql$
    insert into public.evidence_passports
      (owner_id, case_id, verification_run_id, passport_version_no, profile_version_id, execution_manifest_id,
       overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
    values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000ce',
            '00000000-0000-4000-8000-00000000bb20', 2, '00000000-0000-4000-8000-0000000000d1',
            '00000000-0000-4000-8000-00000000aa01', 'HIGH_CAUTION', true, 'p1', '{"schema_version":"1"}'::jsonb, repeat('7', 64))
  $sql$, '회원이 Passport 를 직접 INSERT');
end
$$;

do $$
declare remaining int;
begin
  delete from public.financial_cases where id = '00000000-0000-4000-8000-0000000000ce';
  select (select count(*) from public.evidence_passports) + (select count(*) from public.action_guides)
       + (select count(*) from public.action_guide_channels) + (select count(*) from public.verification_axis_results)
    into remaining;
  if remaining <> 0 then raise exception 'Case Cascade 뒤 결과 행이 남았습니다 (%)', remaining; end if;
  raise notice '  허용 확인: Case 삭제 Cascade 로 Passport·Guide·축 결과 제거';
end
$$;

\echo '0011 불변식 시험을 통과했습니다.'
