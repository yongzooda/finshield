-- ============================================================
-- 0017 Demo 격리·평가·신뢰센터·안전 View 시험 (명세 6.10, 6.8, 9.3)
--
-- 12 가 함수 경로로 만든 VERIFIED Case(fctx 'case')와 Passport 를 View 로 본다.
-- ============================================================

\echo '70. Demo Seed·Session·결과 모드'
insert into demo.seed_versions (id, seed_code, version, input_type, masked_input, expected_claim_manifest, content_hash)
values ('00000000-0000-4000-8000-00000000dd01', 'sunshine-loan-text', 'v1', 'TEXT', '[합성] 햇살론15 상담 문자',
        '{"schema_version":"1","claims":["INSTITUTION","PRODUCT"]}'::jsonb, repeat('d', 64));
select fstest.expect_ok($sql$
  insert into demo.seed_sources (seed_version_id, source_snapshot_id, purpose_code)
  values ('00000000-0000-4000-8000-00000000dd01', '00000000-0000-4000-8000-00000000c001', 'LAW_CITATION')
$sql$, 'Seed 근거를 공용 Snapshot 으로 고정');
select fstest.expect_fail($sql$
  update demo.seed_versions set masked_input = '수정' where id = '00000000-0000-4000-8000-00000000dd01'
$sql$, 'Seed UPDATE');
select fstest.expect_fail($sql$
  insert into demo.seed_versions (seed_code, version, input_type, masked_input, expected_claim_manifest, content_hash)
  values ('bad', 'v1', 'URL', 'x', '{"schema_version":"1"}'::jsonb, repeat('d', 64))
$sql$, 'URL Seed');

create temp table if not exists dctx (key text primary key, val text);
grant select on dctx to finshield_worker;
do $$
declare s record; r record; n int;
begin
  select * into s from private.create_demo_session('sunshine-loan-text', 'LIVE', interval '1 hour');
  if s.capability_token !~ '^[0-9a-f]{64}$' then raise exception 'token 형식이 다릅니다'; end if;
  insert into dctx values ('token', s.capability_token), ('session', s.session_id::text);
  if exists (select 1 from demo.sessions where capability_token_hash = s.capability_token) then
    raise exception 'token 원문이 저장됐습니다';
  end if;
  select * into r from private.read_demo_session(s.capability_token);
  if r.session_id <> s.session_id or r.mode <> 'LIVE' or r.run_id is not null then raise exception 'Session 조회가 다릅니다'; end if;
  select count(*) into n from private.read_demo_session('0000');
  if n <> 0 then raise exception '잘못된 token 이 Session 을 읽었습니다'; end if;
  perform fstest.expect_fail($sql$ select * from private.create_demo_session('sunshine-loan-text', 'LIVE', interval '25 hours') $sql$,
    '24시간 넘는 Demo Session');
  perform fstest.expect_fail($sql$ select * from private.create_demo_session('no-such-seed') $sql$, '승인되지 않은 Seed');
  raise notice '  허용 확인: Session 은 Hash 만 저장하고 Capability 로만 읽힌다';
end
$$;

do $$
declare v_session uuid := (select val::uuid from dctx where key = 'session'); v_run uuid;
begin
  insert into demo.runs (session_id, execution_manifest_id, status, overall_result, started_at, finished_at)
  values (v_session, '00000000-0000-4000-8000-00000000aa01', 'SUCCEEDED', 'VERIFY_BEFORE_PROCEEDING', now(), now())
  returning id into v_run;
  insert into dctx values ('run', v_run::text);
  perform fstest.expect_fail(format($sql$
    insert into demo.result_snapshots (demo_run_id, result_manifest, computed_at, basis_date, is_precomputed, content_hash)
    values (%L, '{"schema_version":"1"}'::jsonb, now(), current_date, true, %L) $sql$, v_run, repeat('1', 64)),
    'LIVE Session 에 사전계산 결과');
  insert into demo.result_snapshots (demo_run_id, result_manifest, computed_at, basis_date, is_precomputed, content_hash)
  values (v_run, '{"schema_version":"1","overall_result":"VERIFY_BEFORE_PROCEEDING"}'::jsonb, now(), current_date, false, repeat('1', 64));
  perform fstest.expect_fail(format($sql$
    insert into demo.result_snapshots (demo_run_id, result_manifest, computed_at, basis_date, is_precomputed, content_hash)
    values (%L, '{"schema_version":"1"}'::jsonb, now(), current_date, false, %L) $sql$, v_run, repeat('2', 64)),
    'Run 당 결과 둘');
  raise notice '  허용 확인: Live 결과는 사전계산일 수 없다';
end
$$;

do $$
declare s record; v_run uuid; r record;
begin
  select * into s from private.create_demo_session('sunshine-loan-text', 'STATIC_FALLBACK', interval '1 hour');
  insert into demo.runs (session_id, execution_manifest_id, status, overall_result, started_at, finished_at)
  values (s.session_id, '00000000-0000-4000-8000-00000000aa01', 'SUCCEEDED', 'VERIFY_BEFORE_PROCEEDING', now(), now())
  returning id into v_run;
  perform fstest.expect_fail(format($sql$
    insert into demo.result_snapshots (demo_run_id, result_manifest, computed_at, basis_date, is_precomputed, content_hash)
    values (%L, '{"schema_version":"1"}'::jsonb, now(), current_date, false, %L) $sql$, v_run, repeat('3', 64)),
    'STATIC_FALLBACK Session 에 Live 결과');
  insert into demo.result_snapshots (demo_run_id, result_manifest, computed_at, basis_date, is_precomputed, content_hash)
  values (v_run, '{"schema_version":"1"}'::jsonb, now() - interval '3 days', current_date - 3, true, repeat('3', 64));
  select * into r from private.read_demo_session(s.capability_token);
  if not r.is_precomputed or r.basis_date <> current_date - 3 then raise exception '정적 Fallback 배지 정보가 없습니다'; end if;
  raise notice '  허용 확인: 정적 Fallback 은 사전계산·기준일을 가진다';
  -- 만료 Sweeper 는 demo 만 지운다.
  update demo.sessions set created_at = now() - interval '3 hours', expires_at = now() - interval '1 hour' where id = s.session_id;
  select coalesce(jsonb_object_agg(kind, affected), '{}'::jsonb) as m into r from private.sweep_demo();
  if (r.m ->> 'DEMO_SESSION_EXPIRED')::int <> 1 then raise exception 'Demo Sweeper 집계가 다릅니다: %', r.m; end if;
  if exists (select 1 from demo.runs where id = v_run) then raise exception '만료 Session 의 Run 이 남았습니다'; end if;
  raise notice '  허용 확인: 만료 Session 과 실행이 Demo 스키마 안에서만 정리된다';
end
$$;

\echo '71. 평가·신뢰센터'
insert into kb.evaluation_sets (id, name, version, product_scope, sample_count, fixture_manifest_hash)
values ('00000000-0000-4000-8000-00000000ee01', 'claim-eval', 'v1', 'FINSHIELD', 60, repeat('e', 64)),
       ('00000000-0000-4000-8000-00000000ee02', 'precase-legacy', 'v1', 'PRECASE_LEGACY', 100, repeat('f', 64));
insert into kb.evaluation_runs (id, evaluation_set_id, execution_manifest_id, method_variant, status, started_at, finished_at, result_hash)
values ('00000000-0000-4000-8000-00000000ee11', '00000000-0000-4000-8000-00000000ee01', '00000000-0000-4000-8000-00000000aa01', 'FULL', 'COMPLETED', now(), now(), repeat('1', 64)),
       ('00000000-0000-4000-8000-00000000ee12', '00000000-0000-4000-8000-00000000ee02', '00000000-0000-4000-8000-00000000aa01', 'FULL', 'COMPLETED', now(), now(), repeat('2', 64)),
       ('00000000-0000-4000-8000-00000000ee13', '00000000-0000-4000-8000-00000000ee01', '00000000-0000-4000-8000-00000000aa01', 'LLM_ONLY', 'RUNNING', now(), null, null);
select fstest.expect_fail($sql$
  insert into kb.evaluation_metrics (evaluation_run_id, metric_code, numerator, denominator, value_numeric, unit, formula_version)
  values ('00000000-0000-4000-8000-00000000ee11', 'VERIFICATION_PRECISION', 45, 50, 0.95, 'RATIO', 'f1')
$sql$, '분자·분모와 다른 비율 값');
select fstest.expect_fail($sql$
  insert into kb.evaluation_metrics (evaluation_run_id, metric_code, numerator, denominator, value_numeric, unit, formula_version)
  values ('00000000-0000-4000-8000-00000000ee11', 'CONFLICT_RATE', 0, 0, 0, 'RATIO', 'f1')
$sql$, '분모 0 인데 값 있음 (N/A 여야 함)');
insert into kb.evaluation_metrics (evaluation_run_id, metric_code, numerator, denominator, value_numeric, unit, formula_version)
values ('00000000-0000-4000-8000-00000000ee11', 'VERIFICATION_PRECISION', 45, 50, 0.9, 'RATIO', 'f1'),
       ('00000000-0000-4000-8000-00000000ee11', 'CONFLICT_RATE', 0, 0, null, 'RATIO', 'f1'),
       ('00000000-0000-4000-8000-00000000ee12', 'VERIFICATION_PRECISION', 99, 100, 0.99, 'RATIO', 'f1');
select fstest.expect_fail($sql$
  update kb.evaluation_runs set published_at = now() where id = '00000000-0000-4000-8000-00000000ee13'
$sql$, '완료되지 않은 평가 Run 공개');
update kb.evaluation_runs set published_at = now() where id in ('00000000-0000-4000-8000-00000000ee11', '00000000-0000-4000-8000-00000000ee12');
select private.record_tool_health('law_search', 'UP', 300, 120);
select private.record_tool_health('law_search', 'DEGRADED', 300, 900, 'HTTP_503');
select fstest.expect_fail($sql$ select private.record_tool_health('law_search', 'DOWN', 300, null, 'timeout: connect to 10.0.0.1 failed') $sql$,
  '원문 오류 문자열이 든 Tool 상태');

do $$
declare n int; r record;
begin
  set local role anon;
  select count(*) into n from public.trust_center_metrics_v;
  if n <> 2 then raise exception '신뢰센터가 공개 FinShield 지표 2건이 아닙니다 (%)', n; end if;
  if exists (select 1 from public.trust_center_metrics_v where evaluation_set = 'precase-legacy') then
    raise exception 'PreCase 수치가 신뢰센터에 섞였습니다';
  end if;
  select * into r from public.trust_center_metrics_v where metric_code = 'CONFLICT_RATE';
  if r.value_numeric is not null or r.denominator <> 0 then raise exception '분모 0 이 N/A 로 보이지 않습니다'; end if;
  select * into r from public.tool_health_v where tool_code = 'law_search';
  if r.status <> 'DEGRADED' or not r.is_fresh then raise exception '최신 Tool 상태가 아닙니다'; end if;
  perform fstest.expect_fail($sql$ select count(*) from kb.evaluation_metrics $sql$, '익명이 평가 표 직접 조회');
  perform fstest.expect_fail($sql$ select count(*) from demo.sessions $sql$, '익명이 Demo Session 직접 조회');
  raise notice '  허용 확인: 익명은 공개 FinShield 지표와 최신 Tool 상태만, 산식·표본·분모 보존';
end
$$;

\echo '72. 회원 안전 View'
do $$
declare v_case uuid := (select id from public.financial_cases where title_masked = '최종화 시험 Case'); n int; r record;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","session_id":"10000000-0000-4000-8000-00000000000a","exp":4102444800}';
  select * into r from public.case_list_v where id = v_case;
  if r.overall_result <> 'MATERIAL_RISK_FOUND' or r.latest_passport_id is null then raise exception '목록 View 값이 다릅니다'; end if;
  select * into r from public.case_detail_v where id = v_case;
  if jsonb_array_length(r.passports) <> 3 or jsonb_array_length(r.runs) <> 3 or jsonb_array_length(r.inputs) <> 1 then
    raise exception '상세 View 집계가 다릅니다 (% % %)', jsonb_array_length(r.passports), jsonb_array_length(r.runs), jsonb_array_length(r.inputs);
  end if;
  if r.inputs::text like '%object_path%' or r.runs::text like '%lease%' then raise exception '상세 View 에 원본 경로·Lease 가 있습니다'; end if;
  select count(*) into n from public.run_progress_v where case_id = v_case;
  if n <> 3 then raise exception 'Run 진행 View 수가 다릅니다 (%)', n; end if;
  select * into r from public.run_progress_v where case_id = v_case order by run_no limit 1;
  if jsonb_array_length(r.agents) <> 2 or r.agents::text like '%prompt%' or r.agents::text like '%input_digest%' then
    raise exception 'Run 진행 View 가 Agent 요약 외 것을 노출합니다';
  end if;
  select * into r from public.passport_v where case_id = v_case and is_latest;
  if r.passport_version_no <> 3 or jsonb_array_length(r.claims) <> 3 or jsonb_array_length(r.axis_results) <> 3 then
    raise exception 'Passport View 값이 다릅니다 (% % %)', r.passport_version_no, jsonb_array_length(r.claims), jsonb_array_length(r.axis_results);
  end if;
  select * into r from public.passport_v where case_id = v_case and passport_version_no = 1;
  if jsonb_array_length(r.guide -> 'channels') <> 1 or (r.guide -> 'channels' -> 0 ->> 'display_value') <> '금융감독원 1332' then
    raise exception 'Passport View 의 승인 채널 표시값이 없습니다: %', r.guide;
  end if;
  raise notice '  허용 확인: 회원 View 는 본인 Case 의 요약·Passport·채널 표시값만 준다';
end
$$;
do $$
declare v_case uuid := (select id from public.financial_cases where title_masked = '최종화 시험 Case'); n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","session_id":"10000000-0000-4000-8000-00000000000b","exp":4102444800}';
  select count(*) into n from public.case_list_v where id = v_case;
  select count(*) + n into n from public.passport_v where case_id = v_case;
  if n <> 0 then raise exception '타인이 View 로 Case·Passport 를 봤습니다 (%)', n; end if;
  if public.guide_channels_json((select action_guide_id from public.evidence_passports where case_id = v_case and passport_version_no = 1)) <> '[]'::jsonb then
    raise exception '타인이 Guide 채널을 읽었습니다';
  end if;
  raise notice '  허용 확인: 타인에게는 View·채널 Helper 가 비어 있다';
end
$$;
do $$
begin
  set local role anon;
  perform fstest.expect_fail($sql$ select count(*) from public.case_list_v $sql$, '익명이 회원 View 조회');
end
$$;

\echo '0017 불변식 시험을 통과했습니다.'
