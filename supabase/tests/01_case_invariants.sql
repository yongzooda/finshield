-- ============================================================
-- 0004 제약·RLS 시험 (명세 6.2, 9.1)
--
-- Stub 과 0001~0004 를 적용한 뒤 실행한다. 성공 경로가 통과하는지와
-- 각 불변식이 실제로 거부하는지를 함께 본다. 거부되어야 할 문장이
-- 통과하면 즉시 실패한다.
--
-- 운영 프로젝트에 적용하지 않는다. 시험 데이터를 만든다.
-- ============================================================

create schema if not exists fstest;

-- 주어진 문장이 반드시 실패해야 한다. 통과하면 시험을 실패시킨다.
create or replace function fstest.expect_fail(statement text, label text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    raise notice '  거부 확인: %  (%)', label, sqlstate;
    return;
  end;
  raise exception '거부되어야 할 문장이 통과했습니다: %', label;
end;
$$;

-- 주어진 문장은 반드시 성공해야 한다.
create or replace function fstest.expect_ok(statement text, label text)
returns void language plpgsql as $$
begin
  execute statement;
  raise notice '  허용 확인: %', label;
end;
$$;

-- 시험 보조 함수는 authenticated·anon 역할로 바꾼 뒤에도 호출해야 한다.
-- security invoker 라 실제 권한·RLS 판정은 호출한 역할 기준으로 유지된다.
grant usage on schema fstest to anon, authenticated;
grant execute on function fstest.expect_fail(text, text) to anon, authenticated;
grant execute on function fstest.expect_ok(text, text)   to anon, authenticated;

-- ------------------------------------------------------------
-- 고정 시험 데이터
-- ------------------------------------------------------------
do $$
declare
  user_a uuid := '00000000-0000-4000-8000-00000000000a';
  user_b uuid := '00000000-0000-4000-8000-00000000000b';
begin
  delete from auth.users where id in (user_a, user_b);
  insert into auth.users (id) values (user_a), (user_b);
end
$$;

-- profiles 는 auth trigger 가 만든다.
do $$
begin
  if (select count(*) from public.profiles
       where id in ('00000000-0000-4000-8000-00000000000a',
                    '00000000-0000-4000-8000-00000000000b')) <> 2 then
    raise exception 'handle_new_user trigger 가 profiles 를 만들지 않았습니다';
  end if;
  raise notice '  허용 확인: auth.users insert 가 profiles 를 생성';
end
$$;

insert into public.financial_profiles
  (id, owner_id, schema_version, income_band, debt_burden_band, emergency_fund_band,
   purpose_code, horizon_code, liquidity_need, loss_tolerance, completeness)
values ('00000000-0000-4000-8000-0000000000fa', '00000000-0000-4000-8000-00000000000a',
        'v1', 'BAND_2', 'LOW', 'BAND_1', 'LOAN_REFINANCE', 'SHORT', 'MEDIUM', 'LOW', 'COMPLETE'),
       ('00000000-0000-4000-8000-0000000000fb', '00000000-0000-4000-8000-00000000000b',
        'v1', 'BAND_2', 'LOW', 'BAND_1', 'LOAN_REFINANCE', 'SHORT', 'MEDIUM', 'LOW', 'COMPLETE');

insert into public.financial_profile_versions
  (id, owner_id, profile_id, version_no, schema_version, snapshot, completeness,
   content_hash, created_reason)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000fa', 1, 'v1', '{"schema_version":"v1"}'::jsonb,
        'COMPLETE', repeat('a', 64), 'CASE_CREATED'),
       ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000000b',
        '00000000-0000-4000-8000-0000000000fb', 1, 'v1', '{"schema_version":"v1"}'::jsonb,
        'COMPLETE', repeat('b', 64), 'CASE_CREATED');

insert into public.financial_cases
  (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-00000000000a',
        'LOAN', '햇살론15 상담 검증', '00000000-0000-4000-8000-0000000000d1'),
       ('00000000-0000-4000-8000-0000000000cb', '00000000-0000-4000-8000-00000000000b',
        'LOAN', '타인 Case', '00000000-0000-4000-8000-0000000000d2');

-- ------------------------------------------------------------
-- 1. financial_cases 불변식
-- ------------------------------------------------------------
\echo '1. financial_cases'
select fstest.expect_fail($sql$
  update public.financial_cases set title_masked = repeat('가', 161)
   where id = '00000000-0000-4000-8000-0000000000ca'
$sql$, 'title_masked 161자');

select fstest.expect_fail($sql$
  update public.financial_cases set deleted_at = now()
   where id = '00000000-0000-4000-8000-0000000000ca'
$sql$, 'deletion_status ACTIVE 인데 deleted_at 설정');

select fstest.expect_fail($sql$
  update public.financial_cases set journey_stage = 'ENROLLED'
   where id = '00000000-0000-4000-8000-0000000000ca'
$sql$, 'ENROLLED 인데 가입 확인 시각 없음');

select fstest.expect_fail($sql$
  update public.financial_cases set enrollment_confirmed_at = now()
   where id = '00000000-0000-4000-8000-0000000000ca'
$sql$, 'PRE_TRANSACTION 인데 가입 확인 시각 있음');

select fstest.expect_ok($sql$
  update public.financial_cases
     set journey_stage = 'FUNDS_SENT_OR_DAMAGE_SUSPECTED'
   where id = '00000000-0000-4000-8000-0000000000ca'
$sql$, '가입 확인 없이 피해 의심 단계로 전진 (명세 6.7)');

select fstest.expect_ok($sql$
  update public.financial_cases set journey_stage = 'PRE_TRANSACTION'
   where id = '00000000-0000-4000-8000-0000000000ca'
$sql$, '피해 의심 단계 원복');

select fstest.expect_fail($sql$
  update public.financial_cases set primary_input_type = 'URL'
   where id = '00000000-0000-4000-8000-0000000000ca'
$sql$, 'P0 에서 URL 입력 유형');

select fstest.expect_fail($sql$
  update public.financial_cases set resume_state = 'DRAFT'
   where id = '00000000-0000-4000-8000-0000000000ca'
$sql$, 'DRAFT lifecycle 에 resume_state 설정');

select fstest.expect_fail($sql$
  insert into public.financial_cases
    (owner_id, scenario, title_masked, initial_profile_version_id)
  values ('00000000-0000-4000-8000-00000000000a', 'LOAN', '남의 Snapshot',
          '00000000-0000-4000-8000-0000000000d2')
$sql$, '다른 소유자의 프로필 Snapshot 참조');

select fstest.expect_fail($sql$
  delete from public.financial_profile_versions
   where id = '00000000-0000-4000-8000-0000000000d1'
$sql$, '참조 Case 가 있는 Snapshot 직접 삭제');

-- updated_at trigger 확인
do $$
declare before_at timestamptz; after_at timestamptz;
begin
  select updated_at into before_at from public.financial_cases
   where id = '00000000-0000-4000-8000-0000000000ca';
  perform pg_sleep(0.01);
  update public.financial_cases set lifecycle = 'INPUT_REVIEW'
   where id = '00000000-0000-4000-8000-0000000000ca';
  select updated_at into after_at from public.financial_cases
   where id = '00000000-0000-4000-8000-0000000000ca';
  if after_at <= before_at then
    raise exception 'set_updated_at trigger 가 동작하지 않았습니다';
  end if;
  raise notice '  허용 확인: updated_at trigger 갱신';
end
$$;

-- ------------------------------------------------------------
-- 2. case_inputs 불변식
-- ------------------------------------------------------------
\echo '2. case_inputs'
insert into public.case_inputs
  (id, owner_id, case_id, input_type, input_stage, raw_delete_status,
   pii_scan_status, raw_expires_at, size_bytes, page_count)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000ca', 'PDF', 'QUARANTINED', 'PENDING',
        'PENDING', now() + interval '23 hours', 1024, 3);

select fstest.expect_fail($sql$
  insert into public.case_inputs
    (owner_id, case_id, input_type, input_stage, raw_delete_status,
     pii_scan_status, raw_expires_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000cb', 'TEXT', 'QUARANTINED',
          'PENDING', 'PENDING', now() + interval '1 hour')
$sql$, '다른 소유자의 Case 에 입력 추가');

select fstest.expect_fail($sql$
  update public.case_inputs set page_count = 11
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, 'PDF 11쪽');

select fstest.expect_fail($sql$
  update public.case_inputs set input_type = 'IMAGE', page_count = 2
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, 'Image 2쪽');

select fstest.expect_fail($sql$
  update public.case_inputs set input_type = 'URL'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, 'P0 에서 URL 입력 행');

select fstest.expect_fail($sql$
  update public.case_inputs set masked_text = '마스킹 결과'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, 'MASKED 이전 단계에서 masked_text 영속');

select fstest.expect_fail($sql$
  update public.case_inputs set input_stage = 'MASKED', masked_text = '마스킹 결과'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, 'PII Gate 미통과 상태의 masked_text 영속');

select fstest.expect_ok($sql$
  update public.case_inputs
     set input_stage = 'MASKED', pii_scan_status = 'PASSED',
         masked_text = '마스킹 결과',
         masked_text_hash = repeat('a', 64)
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, 'MASKED + PII PASSED 뒤 masked_text 영속');

select fstest.expect_fail($sql$
  update public.case_inputs set masked_text_hash = 'not-a-sha256'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, 'masked_text_hash 형식 위반');

select fstest.expect_fail($sql$
  update public.case_inputs set raw_expires_at = created_at + interval '25 hours'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, '원본 보관 24시간 초과');

select fstest.expect_fail($sql$
  update public.case_inputs set input_stage = 'RAW_DELETED'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, '삭제 성공 없이 RAW_DELETED 단계');

select fstest.expect_fail($sql$
  update public.case_inputs set raw_delete_status = 'SUCCEEDED'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, 'SUCCEEDED 인데 raw_deleted_at 없음');

select fstest.expect_ok($sql$
  update public.case_inputs
     set input_outcome = 'CANCELLED',
         raw_delete_status = 'SUCCEEDED', raw_deleted_at = now()
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, '중단 경로에서 단계 보존한 채 삭제 축만 종결 (명세 4.3)');

select fstest.expect_fail($sql$
  update public.case_inputs set input_outcome = 'ACTIVE', claim_confirmed_at = now()
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, '정상 경로 + 삭제 성공인데 RAW_DELETED 아님');

select fstest.expect_ok($sql$
  update public.case_inputs
     set input_outcome = 'ACTIVE', claim_confirmed_at = now(),
         input_stage = 'RAW_DELETED'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, '정상 경로 종결');

-- ------------------------------------------------------------
-- 3. case_input_pages·findings
-- ------------------------------------------------------------
\echo '3. case_input_pages, case_input_findings'
insert into public.case_input_pages
  (id, owner_id, case_id, case_input_id, page_no, parse_status, locator_schema_version)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000e1',
        1, 'SUCCEEDED', 'v1');

select fstest.expect_fail($sql$
  update public.case_input_pages set page_no = 11
   where id = '00000000-0000-4000-8000-0000000000f1'
$sql$, 'page_no 11');

select fstest.expect_fail($sql$
  insert into public.case_input_pages
    (owner_id, case_id, case_input_id, page_no, parse_status, locator_schema_version)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 1, 'SUCCEEDED', 'v1')
$sql$, '같은 입력에 중복 page_no');

select fstest.expect_fail($sql$
  insert into public.case_input_findings
    (owner_id, case_id, case_input_id, finding_type, finding_code,
     locator, severity, resolution)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'PII', 'RRN',
          '{"page":1}'::jsonb, 'BLOCKING', 'MASKED')
$sql$, 'locator 에 schema_version 없음');

select fstest.expect_fail($sql$
  insert into public.case_input_findings
    (owner_id, case_id, case_input_id, finding_type, finding_code,
     locator, severity, resolution)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'SECRET', 'RRN',
          '{"schema_version":"1"}'::jsonb, 'BLOCKING', 'MASKED')
$sql$, '열거하지 않은 finding_type');

select fstest.expect_ok($sql$
  insert into public.case_input_findings
    (owner_id, case_id, case_input_id, page_id, finding_type, finding_code,
     locator, severity, resolution)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1',
          '00000000-0000-4000-8000-0000000000f1', 'PII', 'RRN',
          '{"schema_version":"1","page":1}'::jsonb, 'BLOCKING', 'MASKED')
$sql$, '정상 Finding');

-- ------------------------------------------------------------
-- 4. private.input_objects·ocr_artifacts
-- ------------------------------------------------------------
\echo '4. private.input_objects, private.ocr_artifacts'
insert into public.case_inputs
  (id, owner_id, case_id, input_type, input_stage, raw_delete_status,
   pii_scan_status, raw_expires_at)
values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000ca', 'TEXT', 'QUARANTINED', 'PENDING',
        'PENDING', now() + interval '1 hour');

select fstest.expect_fail($sql$
  insert into private.input_objects
    (owner_id, case_id, case_input_id, input_type, bucket_id, object_path,
     safe_extension, encryption_state, expires_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e2', 'TEXT', 'finshield-quarantine',
          'a/b/c.pdf', 'pdf', 'VERIFIED', now() + interval '1 hour')
$sql$, 'Text 입력에 Storage 객체 연결');

select fstest.expect_fail($sql$
  insert into private.input_objects
    (owner_id, case_id, case_input_id, input_type, bucket_id, object_path,
     safe_extension, encryption_state, expires_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'PDF', 'public-bucket',
          'a/b/c.pdf', 'pdf', 'VERIFIED', now() + interval '1 hour')
$sql$, '격리 Bucket 이 아닌 Bucket');

select fstest.expect_fail($sql$
  insert into private.input_objects
    (owner_id, case_id, case_input_id, input_type, bucket_id, object_path,
     safe_extension, encryption_state, expires_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'PDF', 'finshield-quarantine',
          'a/../../etc/passwd', 'pdf', 'VERIFIED', now() + interval '1 hour')
$sql$, 'object_path 경로 조작');

select fstest.expect_fail($sql$
  insert into private.input_objects
    (owner_id, case_id, case_input_id, input_type, bucket_id, object_path,
     safe_extension, encryption_state, expires_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'PDF', 'finshield-quarantine',
          'a/b/d.exe', 'exe', 'VERIFIED', now() + interval '1 hour')
$sql$, '허용하지 않은 확장자');

select fstest.expect_fail($sql$
  insert into private.input_objects
    (owner_id, case_id, case_input_id, input_type, bucket_id, object_path,
     safe_extension, encryption_state, expires_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'PDF', 'finshield-quarantine',
          'a/b/e.pdf', 'pdf', 'VERIFIED', now() + interval '25 hours')
$sql$, '임시 객체 24시간 초과');

select fstest.expect_ok($sql$
  insert into private.input_objects
    (owner_id, case_id, case_input_id, input_type, bucket_id, object_path,
     safe_extension, encryption_state, expires_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'PDF', 'finshield-quarantine',
          '00000000-0000-4000-8000-00000000000a/case/input/rand.pdf', 'pdf',
          'VERIFIED', now() + interval '1 hour')
$sql$, '정상 격리 객체');

select fstest.expect_fail($sql$
  insert into private.ocr_artifacts
    (owner_id, case_id, case_input_id, page_id, status, expires_at, deleted_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1',
          '00000000-0000-4000-8000-0000000000f1', 'AVAILABLE',
          now() + interval '1 hour', now())
$sql$, 'DELETED 가 아닌데 deleted_at 있음');

select fstest.expect_ok($sql$
  insert into private.ocr_artifacts
    (owner_id, case_id, case_input_id, page_id, status, expires_at)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1',
          '00000000-0000-4000-8000-0000000000f1', 'PROCESSING',
          now() + interval '1 hour')
$sql$, '정상 OCR 중간물 메타데이터');

-- ------------------------------------------------------------
-- 5. case_events append-only
-- ------------------------------------------------------------
\echo '5. case_events'
insert into public.case_events
  (id, owner_id, case_id, event_no, event_type, actor_type, payload, idempotency_key)
values ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000ca', 1, 'CASE_CREATED', 'USER',
        '{"schema_version":"1"}'::jsonb, 'k1');

select fstest.expect_fail($sql$
  update public.case_events set actor_type = 'SYSTEM'
   where id = '00000000-0000-4000-8000-0000000000f2'
$sql$, 'Append-only Event UPDATE');

select fstest.expect_fail($sql$
  insert into public.case_events
    (owner_id, case_id, event_no, event_type, actor_type, payload, idempotency_key)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca', 1, 'CASE_CLOSED', 'USER',
          '{"schema_version":"1"}'::jsonb, 'k2')
$sql$, '같은 Case 에 중복 event_no');

select fstest.expect_fail($sql$
  insert into public.case_events
    (owner_id, case_id, event_no, event_type, actor_type, payload, idempotency_key)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca', 2, 'CASE_CLOSED', 'USER',
          '{"schema_version":"1"}'::jsonb, 'k1')
$sql$, '같은 Owner·Case 에 중복 idempotency_key');

select fstest.expect_fail($sql$
  insert into public.case_events
    (owner_id, case_id, event_no, event_type, actor_type, payload, idempotency_key)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca', 3, 'UNKNOWN_THING', 'USER',
          '{"schema_version":"1"}'::jsonb, 'k3')
$sql$, '허용하지 않은 event_type Namespace');

select fstest.expect_fail($sql$
  insert into public.case_events
    (owner_id, case_id, event_no, event_type, actor_type, payload, idempotency_key)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca', 4, 'CASE_CLOSED', 'USER',
          '{"reason":"x"}'::jsonb, 'k4')
$sql$, 'payload 에 schema_version 없음');

select fstest.expect_fail($sql$
  insert into public.case_events
    (owner_id, case_id, event_no, event_type, actor_type, payload,
     idempotency_key, correction_of_event_id)
  values ('00000000-0000-4000-8000-00000000000b',
          '00000000-0000-4000-8000-0000000000cb', 1, 'CASE_CORRECTED', 'USER',
          '{"schema_version":"1"}'::jsonb, 'k5',
          '00000000-0000-4000-8000-0000000000f2')
$sql$, '다른 Case 의 Event 를 정정 대상으로 지정');

-- ------------------------------------------------------------
-- 6. RLS 교차 소유 (명세 9.1)
-- ------------------------------------------------------------
\echo '6. RLS 교차 소유'
do $$
declare
  own_cases int; other_cases int; own_inputs int; other_inputs int;
  own_events int; other_events int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';

  select count(*) into own_cases from public.financial_cases
   where id = '00000000-0000-4000-8000-0000000000ca';
  select count(*) into other_cases from public.financial_cases
   where id = '00000000-0000-4000-8000-0000000000cb';
  select count(*) into own_inputs from public.case_inputs
   where owner_id = '00000000-0000-4000-8000-00000000000a';
  select count(*) into other_inputs from public.case_inputs
   where owner_id = '00000000-0000-4000-8000-00000000000b';
  select count(*) into own_events from public.case_events
   where case_id = '00000000-0000-4000-8000-0000000000ca';
  select count(*) into other_events from public.case_events
   where case_id = '00000000-0000-4000-8000-0000000000cb';

  if own_cases <> 1 then raise exception '본인 Case 를 읽지 못했습니다 (%)', own_cases; end if;
  if other_cases <> 0 then raise exception '타인 Case 가 보입니다 (%)', other_cases; end if;
  if own_inputs = 0 then raise exception '본인 입력을 읽지 못했습니다'; end if;
  if other_inputs <> 0 then raise exception '타인 입력이 보입니다 (%)', other_inputs; end if;
  if own_events <> 1 then raise exception '본인 Event 를 읽지 못했습니다 (%)', own_events; end if;
  if other_events <> 0 then raise exception '타인 Event 가 보입니다 (%)', other_events; end if;

  raise notice '  허용 확인: 본인 Case·입력·Event 만 조회';
end
$$;

-- 회원은 Case 를 직접 쓰지 못한다 (명세 9.2).
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  perform fstest.expect_fail($sql$
    update public.financial_cases set title_masked = '직접 수정'
     where id = '00000000-0000-4000-8000-0000000000ca'
  $sql$, '회원이 Case 를 직접 UPDATE');
  perform fstest.expect_fail($sql$
    insert into public.case_events
      (owner_id, case_id, event_no, event_type, actor_type, payload, idempotency_key)
    values ('00000000-0000-4000-8000-00000000000a',
            '00000000-0000-4000-8000-0000000000ca', 9, 'CASE_CLOSED', 'USER',
            '{"schema_version":"1"}'::jsonb, 'k9')
  $sql$, '회원이 Event 를 직접 INSERT');
  perform fstest.expect_fail($sql$
    select count(*) from private.input_objects
  $sql$, '회원이 private.input_objects 조회');
  perform fstest.expect_fail($sql$
    select count(*) from private.ocr_artifacts
  $sql$, '회원이 private.ocr_artifacts 조회');
end
$$;

-- 삭제 표시한 Case 와 그 자식은 보이지 않는다 (명세 9.1 5번).
update public.financial_cases
   set deletion_status = 'PENDING', deleted_at = now()
 where id = '00000000-0000-4000-8000-0000000000ca';

do $$
declare visible_cases int; visible_inputs int; visible_events int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  select count(*) into visible_cases from public.financial_cases;
  select count(*) into visible_inputs from public.case_inputs;
  select count(*) into visible_events from public.case_events;
  if visible_cases <> 0 or visible_inputs <> 0 or visible_events <> 0 then
    raise exception '삭제 표시한 Case 나 자식이 보입니다 (%, %, %)',
      visible_cases, visible_inputs, visible_events;
  end if;
  raise notice '  허용 확인: 삭제 표시 즉시 Case 와 자식 조회 차단';
end
$$;

-- 익명은 어떤 회원 테이블도 읽지 못한다.
do $$
begin
  set local role anon;
  perform fstest.expect_fail($sql$ select count(*) from public.financial_cases $sql$,
    '익명이 financial_cases 조회');
  perform fstest.expect_fail($sql$ select count(*) from public.case_inputs $sql$,
    '익명이 case_inputs 조회');
  perform fstest.expect_fail($sql$ select count(*) from public.case_events $sql$,
    '익명이 case_events 조회');
end
$$;

\echo '모든 불변식 시험을 통과했습니다.'
