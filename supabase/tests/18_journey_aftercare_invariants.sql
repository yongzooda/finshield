-- 0025 가입·피해 의심·가입 후 점검 불변식 (명세 6.2, 6.7, 요구사항 S-015·S-016)
--
-- 08 이 남긴 Manifest aa01·소유자 000a·프로필 판 00d1 을 쓴다.
\set ON_ERROR_STOP on
\echo '== 18. 가입·가입 후 점검 불변식'

begin;
set local role postgres;

create temp table jctx (key text primary key, val uuid) on commit drop;

do $$
declare
  owner uuid := '00000000-0000-4000-8000-00000000000a';
  ver   uuid := '00000000-0000-4000-8000-0000000000d1';
  man   uuid := '00000000-0000-4000-8000-00000000aa01';
  kase  uuid; kase2 uuid; run uuid; pass uuid;
begin
  insert into public.financial_cases (owner_id, scenario, title_masked, initial_profile_version_id)
  values (owner, 'LOAN', '가입 후 점검 시험 Case', ver) returning id into kase;
  insert into public.financial_cases (owner_id, scenario, title_masked, initial_profile_version_id)
  values (owner, 'LOAN', '피해 의심 시험 Case', ver) returning id into kase2;

  insert into public.verification_runs
    (owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id,
     idempotency_key, request_hash, correlation_id, started_at, finished_at, deadline_at,
     overall_result, coverage_satisfied)
  values (owner, kase, 1, 'INITIAL', 'COMPLETED', ver, man, 'jk1', repeat('a', 64),
          gen_random_uuid(), now(), now(), now() + interval '120 seconds',
          'VERIFY_BEFORE_PROCEEDING', true)
  returning id into run;

  insert into public.evidence_passports
    (owner_id, case_id, verification_run_id, passport_version_no, profile_version_id,
     execution_manifest_id, overall_result, coverage_satisfied, passport_schema_version,
     manifest, payload_hash)
  values (owner, kase, run, 1, ver, man, 'VERIFY_BEFORE_PROCEEDING', true, 'p1',
          '{"schema_version":"1"}'::jsonb, repeat('3', 64))
  returning id into pass;

  insert into jctx values ('owner', owner), ('case', kase), ('case2', kase2),
                          ('passport', pass), ('manifest', man);
end
$$;

\echo '1. 피해 의심만으로는 가입으로 보지 않는다'
do $$
declare owner uuid := (select val from jctx where key = 'owner');
        kase  uuid := (select val from jctx where key = 'case2');
        c public.financial_cases%rowtype;
begin
  select * into c from private.record_damage_suspicion(owner, kase, 'FUNDS_SENT');
  if c.journey_stage <> 'FUNDS_SENT_OR_DAMAGE_SUSPECTED' then
    raise exception '피해 의심 단계로 가지 않았습니다: %', c.journey_stage;
  end if;
  if c.enrollment_confirmed_at is not null then
    raise exception '피해 의심만으로 가입 확인 시각이 채워졌습니다';
  end if;
  if c.aftercare_status <> 'ACTION_REQUIRED' then
    raise exception '피해 의심인데 행동이 필요하다고 적지 않았습니다: %', c.aftercare_status;
  end if;
  if not exists (select 1 from public.case_events
                  where case_id = kase and event_type = 'JOURNEY_DAMAGE_SUSPECTED') then
    raise exception '피해 의심 Event 가 없습니다';
  end if;
  raise notice '  허용 확인: 피해 의심은 가입 확인 없이 성립하고 가입으로 세지 않는다';
end
$$;

\echo '2. 가입 확인이 없으면 가입 후 점검을 시작할 수 없다'
do $$
declare owner uuid := (select val from jctx where key = 'owner');
        kase  uuid := (select val from jctx where key = 'case');
        pass  uuid := (select val from jctx where key = 'passport');
        man   uuid := (select val from jctx where key = 'manifest');
begin
  begin
    perform private.record_precase_assessment(owner, kase, pass, man, 'NORMAL_MANAGEMENT',
              '요약', '[]'::jsonb, '[]'::jsonb);
    raise exception '가입 확인 없이 점검이 시작됐습니다';
  exception when check_violation then
    raise notice '  거부 확인: 가입 확인 없는 점검  (%)', sqlstate;
  end;
end
$$;

\echo '3. 가입 등록은 확인 시각과 Event 를 남기고 같은 내용은 한 번만 쌓는다'
do $$
declare owner uuid := (select val from jctx where key = 'owner');
        kase  uuid := (select val from jctx where key = 'case');
        c public.financial_cases%rowtype; n integer; at1 timestamptz;
begin
  select * into c from private.record_enrollment(owner, kase, 'BRANCH', current_date, '연 15.9% 고정');
  if c.journey_stage <> 'ENROLLED' or c.enrollment_confirmed_at is null then
    raise exception '가입 단계와 확인 시각이 남지 않았습니다: %', c.journey_stage;
  end if;
  at1 := c.enrollment_confirmed_at;

  -- 같은 내용으로 다시 등록해도 Event 는 늘지 않고 확인 시각은 그대로다.
  select * into c from private.record_enrollment(owner, kase, 'BRANCH', current_date, '연 15.9% 고정');
  select count(*) into n from public.case_events
   where case_id = kase and event_type = 'JOURNEY_ENROLLED';
  if n <> 1 then raise exception '같은 가입 등록이 Event 를 % 개 만들었습니다', n; end if;
  if c.enrollment_confirmed_at <> at1 then raise exception '가입 확인 시각이 바뀌었습니다'; end if;

  -- 내용을 고쳐 다시 등록하면 정정 기록이 쌓인다.
  perform private.record_enrollment(owner, kase, 'ONLINE', current_date, '연 15.9% 고정');
  select count(*) into n from public.case_events
   where case_id = kase and event_type = 'JOURNEY_ENROLLED';
  if n <> 2 then raise exception '정정 등록이 쌓이지 않았습니다: %', n; end if;
  raise notice '  허용 확인: 가입 등록은 멱등하고 내용을 고치면 정정 기록이 쌓인다';
end
$$;

\echo '4. 미래 날짜와 잘못된 Code 는 받지 않는다'
do $$
declare owner uuid := (select val from jctx where key = 'owner');
        kase  uuid := (select val from jctx where key = 'case');
begin
  begin
    perform private.record_enrollment(owner, kase, 'BRANCH', current_date + 1, null);
    raise exception '미래 가입일이 통과했습니다';
  exception when check_violation then
    raise notice '  거부 확인: 미래 가입일  (%)', sqlstate;
  end;
  begin
    perform private.record_enrollment(owner, kase, '지점', current_date, null);
    raise exception '자유 문장 채널 Code 가 통과했습니다';
  exception when check_violation then
    raise notice '  거부 확인: 정해진 형식이 아닌 채널 Code  (%)', sqlstate;
  end;
end
$$;

\echo '5. 점검은 Passport 의 프로필 판을 물려받고 답변·행동을 함께 남긴다'
do $$
declare owner uuid := (select val from jctx where key = 'owner');
        kase  uuid := (select val from jctx where key = 'case');
        pass  uuid := (select val from jctx where key = 'passport');
        man   uuid := (select val from jctx where key = 'manifest');
        a uuid; r public.precase_assessments%rowtype; c public.financial_cases%rowtype; n integer;
begin
  a := private.record_precase_assessment(owner, kase, pass, man, 'CORRECTION_OR_INQUIRY',
         '설명과 계약 조건이 다른 부분이 있습니다',
         '[{"question_code":"EXPLAINED_RATE","answer_code":"NO"},
           {"question_code":"UNDERSTOOD_PENALTY","answer_code":"PARTIAL"}]'::jsonb,
         '[{"action_code":"ASK_OFFICIAL_CHANNEL","required_material_codes":["CONTRACT"]}]'::jsonb);

  select * into r from public.precase_assessments where id = a;
  if r.status <> 'COMPLETED' or r.result <> 'CORRECTION_OR_INQUIRY' then
    raise exception '점검이 끝난 상태로 남지 않았습니다: % %', r.status, r.result;
  end if;
  if r.profile_version_id <> (select profile_version_id from public.evidence_passports where id = pass) then
    raise exception '점검이 Passport 와 다른 프로필 판을 썼습니다';
  end if;
  select count(*) into n from public.precase_answers where precase_assessment_id = a;
  if n <> 2 then raise exception '답변이 % 건 남았습니다', n; end if;
  select count(*) into n from public.action_checklists where precase_assessment_id = a;
  if n <> 1 then raise exception '행동 목록이 % 건 남았습니다', n; end if;

  select * into c from public.financial_cases where id = kase;
  if c.aftercare_status <> 'ACTION_REQUIRED' then
    raise exception '행동이 필요한 결과인데 상태가 % 입니다', c.aftercare_status;
  end if;
  if not exists (select 1 from public.case_events
                  where case_id = kase and event_type = 'AFTERCARE_ASSESSMENT_COMPLETED') then
    raise exception '점검 완료 Event 가 없습니다';
  end if;
  raise notice '  허용 확인: 점검은 Passport 의 프로필 판을 쓰고 답변·행동·Event 를 함께 남긴다';

  -- 두 번째 점검은 덮어쓰지 않고 판을 쌓는다.
  a := private.record_precase_assessment(owner, kase, pass, man, 'NORMAL_MANAGEMENT',
         '다시 확인했습니다', '[]'::jsonb, '[]'::jsonb);
  select assessment_no into n from public.precase_assessments where id = a;
  if n <> 2 then raise exception '두 번째 점검이 % 번으로 남았습니다', n; end if;
  raise notice '  허용 확인: 점검은 덮어쓰지 않고 판을 쌓는다';
end
$$;

\echo '6. 남의 Case·다른 Case 의 Passport 는 쓰지 못한다'
do $$
declare owner uuid := (select val from jctx where key = 'owner');
        kase2 uuid := (select val from jctx where key = 'case2');
        pass  uuid := (select val from jctx where key = 'passport');
        man   uuid := (select val from jctx where key = 'manifest');
begin
  begin
    perform private.record_enrollment(gen_random_uuid(), kase2, 'BRANCH', null, null);
    raise exception '남의 Case 에 가입을 등록했습니다';
  exception when insufficient_privilege then
    raise notice '  거부 확인: 남의 Case 가입 등록  (%)', sqlstate;
  end;
  perform private.record_enrollment(owner, kase2, 'BRANCH', null, null);
  begin
    perform private.record_precase_assessment(owner, kase2, pass, man, 'NORMAL_MANAGEMENT',
              null, '[]'::jsonb, '[]'::jsonb);
    raise exception '다른 Case 의 Passport 로 점검했습니다';
  exception when insufficient_privilege then
    raise notice '  거부 확인: 다른 Case 의 Passport  (%)', sqlstate;
  end;
end
$$;

\echo '7. 회원·익명은 이 함수들을 부를 수 없다'
do $$
declare kase uuid := (select val from jctx where key = 'case');
begin
  set local role authenticated;
  begin
    perform private.record_enrollment(gen_random_uuid(), kase, 'BRANCH', null, null);
    raise exception '회원이 가입 등록 함수를 불렀습니다';
  exception when insufficient_privilege then
    raise notice '  거부 확인: 회원의 가입 등록 함수 호출  (%)', sqlstate;
  end;
  begin
    perform private.record_precase_assessment(gen_random_uuid(), kase, gen_random_uuid(),
              gen_random_uuid(), 'NORMAL_MANAGEMENT', null, '[]'::jsonb, '[]'::jsonb);
    raise exception '회원이 점검 기록 함수를 불렀습니다';
  exception when insufficient_privilege then
    raise notice '  거부 확인: 회원의 점검 기록 함수 호출  (%)', sqlstate;
  end;
  set local role postgres;
end
$$;

rollback;
\echo '18. 가입·가입 후 점검 불변식 7건을 통과했습니다.'
