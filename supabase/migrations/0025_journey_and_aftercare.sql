-- ============================================================
-- 0025 가입 사실 등록·피해 의심 등록·가입 후 점검 기록
--      (명세 6.2·6.7, 요구사항 S-015·S-016·PC-001·PC-007)
--
-- 왜 필요한가.
--   가입 여부와 피해 의심은 검증 상태와 다른 축이다 (규칙 6). 그런데 그 축을
--   움직이는 경로가 없었다. journey_stage·enrollment_confirmed_at·
--   aftercare_status 를 쓰는 함수가 하나도 없어, 가입 후 점검은 Trigger 가
--   요구하는 가입 확인 Event 를 영원히 만들 수 없었다.
--
--   worker 역할은 public.financial_cases 에 직접 쓰지 못한다. 그래서 여기서도
--   security definer 함수만 축을 움직이고, 함수가 소유권과 순서를 다시 본다.
--
-- 무엇을 지키는가.
--   - 피해 의심만으로 가입으로 보지 않는다. enrollment_confirmed_at 은
--     가입 확인에서만 채운다 (명세 6.7).
--   - 점검 기록은 덮어쓰지 않는다. 판을 새로 쌓는다 (규칙 5).
--   - 원본 계약서·녹취를 저장하지 않는다. 마스킹한 답변 Code 와 문장만 받는다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 가입 사실 등록 (S-015)
--    같은 Case 에 두 번 등록해도 처음 확인 시각을 유지한다.
-- ------------------------------------------------------------
create or replace function private.record_enrollment(
  p_owner_id uuid, p_case_id uuid, p_channel_code text,
  p_enrolled_on date default null, p_final_terms_masked text default null)
returns public.financial_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.financial_cases%rowtype;
  v_from public.journey_stage;
  v_at timestamptz;
  v_key text;
begin
  if p_channel_code is null or p_channel_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception '가입 채널 Code 가 올바르지 않다' using errcode = 'check_violation';
  end if;
  if p_final_terms_masked is not null and octet_length(p_final_terms_masked) > 2000 then
    raise exception '최종 조건 문장이 너무 길다' using errcode = 'check_violation';
  end if;
  if p_enrolled_on is not null and p_enrolled_on > (now() at time zone 'UTC')::date then
    raise exception '가입일이 미래다' using errcode = 'check_violation';
  end if;

  select * into c from public.financial_cases
   where id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Case 가 없거나 소유자가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if c.deleted_at is not null then
    raise exception '삭제 중인 Case 에는 가입을 등록할 수 없다' using errcode = 'check_violation';
  end if;

  v_from := c.journey_stage;
  -- 이미 피해 의심 단계면 가입 확인만 채우고 단계는 되돌리지 않는다.
  v_at := coalesce(c.enrollment_confirmed_at, now());

  update public.financial_cases
     set journey_stage = case when v_from = 'FUNDS_SENT_OR_DAMAGE_SUSPECTED'
                              then v_from else 'ENROLLED'::public.journey_stage end,
         enrollment_confirmed_at = v_at,
         lock_version = lock_version + 1
   where id = c.id
  returning * into c;

  -- 같은 내용을 두 번 등록하면 Event 를 늘리지 않는다. 내용을 고쳐 다시
  -- 등록하면 새 Event 가 쌓여 정정 기록이 남는다 (S-015).
  v_key := 'enrolled:' || c.id::text || ':'
           || md5(p_channel_code || ':' || coalesce(p_enrolled_on::text, '')
                  || ':' || coalesce(p_final_terms_masked, ''));
  begin
    perform private.append_case_event(
      p_owner_id, c.id, 'JOURNEY_ENROLLED', 'USER', v_from::text, c.journey_stage::text,
      jsonb_build_object('channel_code', p_channel_code,
                         'enrolled_on', p_enrolled_on,
                         'final_terms_masked', p_final_terms_masked),
      v_key);
  exception when unique_violation then
    null;
  end;
  return c;
end;
$$;
revoke all on function private.record_enrollment(uuid, uuid, text, date, text)
  from public, anon, authenticated;
grant execute on function private.record_enrollment(uuid, uuid, text, date, text) to finshield_worker;

comment on function private.record_enrollment(uuid, uuid, text, date, text) is
  '가입 사실을 확인 Event 와 함께 기록한다. 검증 상태 축은 건드리지 않는다 (명세 6.7)';

-- ------------------------------------------------------------
-- 2. 송금·피해 의심 등록 (S-015)
--    가입 확인 없이도 성립한다. 가입으로 간주하지 않는다.
-- ------------------------------------------------------------
create or replace function private.record_damage_suspicion(
  p_owner_id uuid, p_case_id uuid, p_reason_code text)
returns public.financial_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.financial_cases%rowtype;
  v_from public.journey_stage;
begin
  if p_reason_code is null or p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception '사유 Code 가 올바르지 않다' using errcode = 'check_violation';
  end if;

  select * into c from public.financial_cases
   where id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Case 가 없거나 소유자가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if c.deleted_at is not null then
    raise exception '삭제 중인 Case 에는 등록할 수 없다' using errcode = 'check_violation';
  end if;

  v_from := c.journey_stage;
  update public.financial_cases
     set journey_stage = 'FUNDS_SENT_OR_DAMAGE_SUSPECTED',
         aftercare_status = 'ACTION_REQUIRED',
         lock_version = lock_version + 1
   where id = c.id
  returning * into c;

  perform private.append_case_event(
    p_owner_id, c.id, 'JOURNEY_DAMAGE_SUSPECTED', 'USER', v_from::text, c.journey_stage::text,
    jsonb_build_object('reason_code', p_reason_code),
    'damage:' || c.id::text || ':' || c.lock_version::text);
  return c;
end;
$$;
revoke all on function private.record_damage_suspicion(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.record_damage_suspicion(uuid, uuid, text) to finshield_worker;

comment on function private.record_damage_suspicion(uuid, uuid, text) is
  '송금·피해 의심을 기록한다. 가입 확인 시각은 채우지 않는다 (명세 6.7)';

-- ------------------------------------------------------------
-- 3. 가입 후 점검 기록 (S-016)
--    한 번의 호출로 점검 실행·답변·행동 목록을 함께 남긴다. 점검 표는
--    worker 에게 INSERT 만 열려 있어 중간 상태를 고칠 수 없다. 그래서
--    끝난 상태로 한 번에 넣는다.
--
--    p_answers: [{question_code, question_version, answer_code, answer_text_masked}]
--    p_actions: [{action_code, required_material_codes, official_channel_registry_id}]
-- ------------------------------------------------------------
create or replace function private.record_precase_assessment(
  p_owner_id uuid, p_case_id uuid, p_passport_id uuid, p_manifest_id uuid,
  p_result public.aftercare_result, p_summary_masked text,
  p_answers jsonb, p_actions jsonb, p_schema_version text default 'aftercare-v1')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c    public.financial_cases%rowtype;
  v_no integer;
  v_pv uuid;
  v_id uuid;
  a    jsonb;
  v_action_required boolean;
begin
  if jsonb_typeof(p_answers) <> 'array' or jsonb_typeof(p_actions) <> 'array' then
    raise exception '답변과 행동 목록은 배열이어야 한다' using errcode = 'check_violation';
  end if;

  select * into c from public.financial_cases
   where id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Case 가 없거나 소유자가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if c.deleted_at is not null then
    raise exception '삭제 중인 Case 는 점검할 수 없다' using errcode = 'check_violation';
  end if;
  -- 가입 확인은 Trigger 도 다시 본다. 여기서 먼저 걸러 오해를 줄인다.
  if c.enrollment_confirmed_at is null then
    raise exception '가입 확인 없이 가입 후 점검을 시작할 수 없다' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.evidence_passports p
                  where p.id = p_passport_id and p.owner_id = p_owner_id and p.case_id = p_case_id) then
    raise exception '이 Case 의 Passport 가 아니다' using errcode = 'insufficient_privilege';
  end if;

  -- 점검은 이 Passport 를 딛고 선다. 그래서 프로필도 그 Passport 가 쓴 판을
  -- 그대로 물려받는다. 새 Snapshot 을 뜨면 점검과 근거가 서로 다른 프로필을
  -- 보게 된다.
  select p.profile_version_id into v_pv
    from public.evidence_passports p where p.id = p_passport_id;
  select coalesce(max(assessment_no), 0) + 1 into v_no
    from public.precase_assessments where case_id = p_case_id;

  insert into public.precase_assessments
    (owner_id, case_id, assessment_no, base_passport_id, profile_version_id, status, result,
     assessment_schema_version, execution_manifest_id, summary_masked, started_at, finished_at)
  values (p_owner_id, p_case_id, v_no, p_passport_id, v_pv, 'COMPLETED', p_result,
          p_schema_version, p_manifest_id, p_summary_masked, now(), now())
  returning id into v_id;

  for a in select * from jsonb_array_elements(p_answers) loop
    insert into public.precase_answers
      (owner_id, case_id, precase_assessment_id, question_code, question_version,
       answer_version_no, answer_code, answer_text_masked)
    values (p_owner_id, p_case_id, v_id, a ->> 'question_code',
            coalesce(a ->> 'question_version', p_schema_version), 1,
            a ->> 'answer_code', a ->> 'answer_text_masked');
  end loop;

  for a in select * from jsonb_array_elements(p_actions) loop
    insert into public.action_checklists
      (owner_id, case_id, precase_assessment_id, action_code, official_channel_registry_id,
       status, required_material_codes)
    values (p_owner_id, p_case_id, v_id, a ->> 'action_code',
            nullif(a ->> 'official_channel_registry_id', '')::uuid, 'PENDING',
            coalesce((select array_agg(value::text)
                        from jsonb_array_elements_text(coalesce(a -> 'required_material_codes',
                                                                '[]'::jsonb)) as value),
                     '{}'::text[]));
  end loop;

  v_action_required := p_result in ('CORRECTION_OR_INQUIRY', 'DISPUTE_PREPARATION')
                       or jsonb_array_length(p_actions) > 0;
  update public.financial_cases
     set aftercare_status = case when v_action_required
                                 then 'ACTION_REQUIRED'::public.aftercare_status
                                 else 'COMPLETED'::public.aftercare_status end,
         lock_version = lock_version + 1
   where id = c.id;

  perform private.append_case_event(
    p_owner_id, c.id, 'AFTERCARE_ASSESSMENT_COMPLETED', 'SYSTEM',
    c.aftercare_status::text,
    case when v_action_required then 'ACTION_REQUIRED' else 'COMPLETED' end,
    jsonb_build_object('assessment_no', v_no, 'result', p_result::text,
                       'action_count', jsonb_array_length(p_actions)),
    'aftercare:' || c.id::text || ':' || v_no::text);
  return v_id;
end;
$$;
revoke all on function private.record_precase_assessment(uuid, uuid, uuid, uuid, public.aftercare_result, text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function private.record_precase_assessment(uuid, uuid, uuid, uuid, public.aftercare_result, text, jsonb, jsonb, text)
  to finshield_worker;

comment on function private.record_precase_assessment(uuid, uuid, uuid, uuid, public.aftercare_result, text, jsonb, jsonb, text) is
  '가입 후 점검 결과를 한 번에 남긴다. 중간 상태를 고치지 않고 판을 쌓는다 (명세 6.7)';
