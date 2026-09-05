-- ============================================================
-- 0016 검증 최종화와 재검증 최종화 (명세 7.2, 7.3, 6.5, 6.6, 요구사항 2.2·RES-011)
--
-- 함수: private.finalize_verification_run, private.finalize_revalidation,
--       private.decide_overall_result (순수 함수)
--
-- 원칙 (명세 7.3):
--  1. Case·Run 을 잠그고 소유·활성·삭제·취소·Deadline 을 다시 확인한다.
--  2. Manifest 가 고정한 정책 버전을 그대로 쓴다. 호출자가 버전을 고를 수 없다.
--  3. 모든 검증 대상 Claim 에 최종 상태가 있어야 한다. 빠지면 실패다.
--  4. VERIFIED·CONTRADICTED 는 직접·인용 가능·최신·대상 일치 독립 근거가
--     있어야 한다(0010 Deferred Trigger). 이 함수 끝에서 즉시 검사로 끌어당겨
--     Commit 전에 실패시킨다. CONFLICT 는 SUPPORT·CONTRADICT 양쪽이 필요하다.
--  5. 종합 결과는 요구사항 2.2 의 우선순위 Matrix 로 코드가 정한다. Agent 는
--     범주를 고르지 못한다. 특별한 위험 신호 없음은 Coverage 충족이 전제다.
--  6. Guide 만 실패하면 Claim·근거·축 결과를 보존하고 PARTIAL 로 종결한다.
--  7. 하나라도 실패하면 전부 되돌린다. 성공 Passport 없는 성공 화면은 없다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 종합 결과 Matrix (요구사항 2.2). 입력만으로 결정되는 순수 함수다.
-- ------------------------------------------------------------
create or replace function private.decide_overall_result(
  p_material_contradicted boolean, p_high_risk_rule boolean,
  p_non_material_contradicted boolean, p_material_conflict boolean,
  p_material_undecided boolean, p_agent_partial boolean,
  p_coverage_satisfied boolean, p_pre_action_remaining boolean)
returns public.overall_result
language sql
immutable
set search_path = ''
as $$
  select case
    when p_material_contradicted or p_high_risk_rule then 'MATERIAL_RISK_FOUND'::public.overall_result
    when p_non_material_contradicted or p_material_conflict then 'HIGH_CAUTION'::public.overall_result
    when p_material_undecided or p_agent_partial or not p_coverage_satisfied then 'INSUFFICIENT_INFORMATION'::public.overall_result
    when p_pre_action_remaining then 'VERIFY_BEFORE_PROCEEDING'::public.overall_result
    else 'NO_SPECIAL_RISK_IN_VERIFIED_SCOPE'::public.overall_result
  end
$$;
revoke all on function private.decide_overall_result(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function private.decide_overall_result(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean)
  to finshield_worker;

-- ------------------------------------------------------------
-- 2. finalize_verification_run (명세 7.2, 7.3)
--
-- p_final_claims: [{claim_id, status, reason_code, cove_status, red_team_status,
--                   decision_summary_masked,
--                   evidences: [{evidence_id, relation, is_independent, policy_reason_code}]}]
-- p_axis_results: [{axis, result_code, summary_masked, limitation_codes}]  (3축 모두)
-- p_guide: {status, guide_schema_version, actions, limitation_codes,
--           channels: [{action_no, official_channel_registry_id, display_order}]} 또는 null(Guide 실패)
-- ------------------------------------------------------------
create or replace function private.finalize_verification_run(
  p_run_id uuid, p_final_claims jsonb, p_axis_results jsonb, p_guide jsonb default null,
  p_partial_reason_codes text[] default '{}', p_passport_schema_version text default 'p1')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.verification_runs%rowtype;
  c        public.financial_cases%rowtype;
  m        private.execution_manifests%rowtype;
  cov_rules jsonb;
  matrix_rules jsonb;
  required_types text[];
  high_risk_codes text[];
  pre_action_codes text[];
  entry    jsonb;
  ev       jsonb;
  ax       jsonb;
  rc       record;
  v_claim  public.claims%rowtype;
  v_fcv    uuid;
  v_status public.claim_status;
  v_hash   text;
  v_partial text[] := coalesce(p_partial_reason_codes, '{}');
  v_material_contradicted boolean := false;
  v_high_risk boolean := false;
  v_non_material_contradicted boolean := false;
  v_material_conflict boolean := false;
  v_material_undecided boolean := false;
  v_agent_partial boolean := false;
  v_pre_action boolean := false;
  v_coverage boolean;
  v_overall public.overall_result;
  v_guide_id uuid;
  v_guide_status text := 'FAILED';
  v_guide_hash text;
  v_passport uuid;
  v_version integer;
  v_manifest jsonb;
  v_final_status public.verification_run_status;
  n_selected integer;
  n_entries integer;
  v_axes text[];
begin
  -- 같은 Transaction 안에서 앞선 최종화가 IMMEDIATE 로 바꿔 놓았을 수 있으므로 되돌린다.
  set constraints all deferred;
  -- 1. 잠금과 재검증
  select * into r from public.verification_runs where id = p_run_id for update;
  if not found or r.status <> 'RUNNING' then
    raise exception 'RUNNING Run 만 최종화한다' using errcode = 'check_violation';
  end if;
  select * into c from public.financial_cases where id = r.case_id and owner_id = r.owner_id for update;
  if not found or c.deleted_at is not null then
    raise exception '삭제 중인 Case 의 Run 은 최종화하지 않는다' using errcode = 'check_violation';
  end if;
  if now() > r.deadline_at then
    raise exception 'Deadline % 를 넘긴 Run 은 최종화할 수 없다', r.deadline_at
      using errcode = 'check_violation', hint = 'DEADLINE_EXCEEDED';
  end if;
  if r.kind = 'INITIAL' and c.lifecycle <> 'VERIFYING' then
    raise exception 'VERIFYING 상태의 Case 만 초기 검증을 최종화한다 (현재 %)', c.lifecycle using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_final_claims) <> 'array' or jsonb_typeof(p_axis_results) <> 'array' then
    raise exception 'final_claims·axis_results 는 배열이어야 한다' using errcode = 'check_violation';
  end if;

  -- 2. Manifest 와 정책 버전
  select * into m from private.execution_manifests where id = r.execution_manifest_id;
  select rules into cov_rules from private.policy_versions where policy_type = 'COVERAGE' and version = m.coverage_contract_version;
  select rules into matrix_rules from private.policy_versions where policy_type = 'RESULT_MATRIX' and version = m.result_matrix_version;
  if cov_rules is null or matrix_rules is null then
    raise exception 'Manifest 가 가리키는 Coverage·Result Matrix 정책이 없다' using errcode = 'check_violation';
  end if;
  select coalesce(array_agg(x), '{}') into required_types from jsonb_array_elements_text(coalesce(cov_rules -> 'required_claim_types', '[]'::jsonb)) x;
  select coalesce(array_agg(x), '{}') into high_risk_codes from jsonb_array_elements_text(coalesce(matrix_rules -> 'high_risk_reason_codes', '[]'::jsonb)) x;
  select coalesce(array_agg(x), '{}') into pre_action_codes
    from jsonb_array_elements_text(coalesce(matrix_rules -> 'pre_action_codes',
         '["VERIFY_OFFICIAL_CHANNEL","CONFIRM_CONTRACT_TERMS","CONFIRM_BEFORE_TRANSFER"]'::jsonb)) x;

  -- 3. 최종 Claim: 검증 대상 전부에 정확히 하나씩
  select count(*) into n_selected from public.verification_run_claims where verification_run_id = r.id and selected_for_verification;
  select count(distinct e ->> 'claim_id') into n_entries from jsonb_array_elements(p_final_claims) e;
  if n_entries <> jsonb_array_length(p_final_claims) then
    raise exception '같은 Claim 에 최종 상태가 두 번 왔다' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.verification_run_claims vrc
              where vrc.verification_run_id = r.id and vrc.selected_for_verification
                and not exists (select 1 from jsonb_array_elements(p_final_claims) e where (e ->> 'claim_id')::uuid = vrc.claim_id)) then
    raise exception '검증 대상 Claim 에 최종 상태가 빠졌다' using errcode = 'check_violation';
  end if;

  for entry in select * from jsonb_array_elements(p_final_claims) loop
    select vrc.claim_id, vrc.claim_revision_id, vrc.materiality into rc
      from public.verification_run_claims vrc
     where vrc.verification_run_id = r.id and vrc.claim_id = (entry ->> 'claim_id')::uuid and vrc.selected_for_verification;
    if not found then
      raise exception 'Run 의 검증 대상이 아닌 Claim % 에 최종 상태가 왔다', entry ->> 'claim_id' using errcode = 'check_violation';
    end if;
    v_status := (entry ->> 'status')::public.claim_status;
    -- Material Claim 은 CoVe 를 거쳐야 하고, VERIFIED·CONTRADICTED 는 CoVe 가 확인한 결론이어야 한다.
    -- Red Team 이 반대 근거를 찾았다면 VERIFIED 가 아니라 CONFLICT 로 보존한다 (명세 7.3 의 3, 규칙 3).
    if rc.materiality = 'MATERIAL' then
      if coalesce(entry ->> 'cove_status', 'NOT_REQUIRED') = 'NOT_REQUIRED' then
        raise exception 'Material Claim % 는 CoVe 없이 최종화할 수 없다', rc.claim_id using errcode = 'check_violation';
      end if;
      if v_status in ('VERIFIED', 'CONTRADICTED') and entry ->> 'cove_status' <> 'CONFIRMED' then
        raise exception 'Material Claim % 의 % 는 CoVe CONFIRMED 가 필요하다 (현재 %)', rc.claim_id, v_status, entry ->> 'cove_status'
          using errcode = 'check_violation';
      end if;
      if v_status = 'VERIFIED' and entry ->> 'red_team_status' = 'COUNTER_EVIDENCE' then
        raise exception 'Red Team 반대 근거가 있는 Claim % 는 VERIFIED 가 아니라 CONFLICT 로 보존한다', rc.claim_id
          using errcode = 'check_violation';
      end if;
    end if;
    v_hash := encode(extensions.digest((entry - 'evidences')::text, 'sha256'), 'hex');
    insert into public.final_claim_versions
      (owner_id, case_id, verification_run_id, claim_id, claim_revision_id, status, reason_code,
       policy_version, coverage_contract_version, cove_status, red_team_status, is_material,
       decision_summary_masked, content_hash)
    values (r.owner_id, r.case_id, r.id, rc.claim_id, rc.claim_revision_id, v_status,
            coalesce(entry ->> 'reason_code', 'UNSPECIFIED'),
            m.evidence_policy_version, m.coverage_contract_version,
            coalesce(entry ->> 'cove_status', 'NOT_REQUIRED'), coalesce(entry ->> 'red_team_status', 'NOT_REQUIRED'),
            rc.materiality = 'MATERIAL', coalesce(entry ->> 'decision_summary_masked', '요약 없음'), v_hash)
    returning id into v_fcv;

    for ev in select * from jsonb_array_elements(coalesce(entry -> 'evidences', '[]'::jsonb)) loop
      insert into public.claim_evidences
        (owner_id, case_id, verification_run_id, final_claim_version_id, evidence_id, independence_key,
         relation, is_independent, policy_reason_code)
      select r.owner_id, r.case_id, r.id, v_fcv, e.id, e.independence_key,
             (ev ->> 'relation')::public.claim_evidence_relation,
             coalesce((ev ->> 'is_independent')::boolean, false),
             coalesce(ev ->> 'policy_reason_code', 'UNSPECIFIED')
        from public.evidences e
       where e.id = (ev ->> 'evidence_id')::uuid and e.verification_run_id = r.id;
      if not found then
        raise exception 'Evidence % 는 이 Run 의 것이 아니다', ev ->> 'evidence_id' using errcode = 'check_violation';
      end if;
    end loop;

    -- CONFLICT 는 양쪽 관계가 모두 있어야 한다 (명세 7.3 의 5).
    if v_status = 'CONFLICT' and not (
         exists (select 1 from public.claim_evidences ce where ce.final_claim_version_id = v_fcv and ce.relation = 'SUPPORT')
         and exists (select 1 from public.claim_evidences ce where ce.final_claim_version_id = v_fcv and ce.relation = 'CONTRADICT')) then
      raise exception 'CONFLICT 는 SUPPORT 와 CONTRADICT 근거가 모두 있어야 한다' using errcode = 'check_violation';
    end if;

    -- Matrix 입력 집계
    if rc.materiality = 'MATERIAL' then
      if v_status = 'CONTRADICTED' then v_material_contradicted := true; end if;
      if v_status = 'CONFLICT' then v_material_conflict := true; end if;
      if v_status in ('UNKNOWN', 'NEED_MORE_INFORMATION', 'WITHHELD') then v_material_undecided := true; end if;
    else
      if v_status = 'CONTRADICTED' then v_non_material_contradicted := true; end if;
      if v_status <> 'VERIFIED' then v_pre_action := true; end if;
    end if;
    if entry ->> 'reason_code' = any(high_risk_codes) then v_high_risk := true; end if;
  end loop;

  -- 4. 핵심 Agent 부분실패 (요구사항 2.2 의 3행)
  for rc in
    select ma.logical_agent_key,
           (select ar.status from public.agent_runs ar
             where ar.verification_run_id = r.id and ar.logical_agent_key = ma.logical_agent_key
             order by ar.attempt_no desc limit 1) as last_status
      from private.execution_manifest_agents ma
     where ma.execution_manifest_id = m.id and ma.required
  loop
    if rc.last_status is null or rc.last_status <> 'SUCCEEDED' then
      v_agent_partial := true;
      v_partial := array_append(v_partial, 'AGENT_' || rc.logical_agent_key || '_' || coalesce(rc.last_status::text, 'MISSING'));
    end if;
  end loop;

  -- 5. Coverage: 확정되지 않은 Material Claim 이 없고 필수 유형마다 판정된 Claim 이 있다.
  v_coverage := not v_material_undecided
    and not exists (select 1 from public.verification_run_claims vrc
                     where vrc.verification_run_id = r.id and vrc.materiality = 'MATERIAL' and vrc.confirmation_state <> 'CONFIRMED')
    and not exists (
      select 1 from unnest(required_types) t
       where not exists (
         select 1 from public.final_claim_versions f join public.claims cl on cl.id = f.claim_id
          where f.verification_run_id = r.id and cl.claim_type = t and f.status in ('VERIFIED', 'CONTRADICTED')));

  -- 6. Guide
  if p_guide is not null then
    if jsonb_typeof(p_guide) <> 'object' or (p_guide ->> 'status') not in ('COMPLETED', 'WITHHELD') then
      raise exception 'Guide 는 COMPLETED 또는 WITHHELD 상태여야 한다' using errcode = 'check_violation';
    end if;
    v_guide_status := p_guide ->> 'status';
    v_guide_hash := encode(extensions.digest((p_guide - 'channels')::text, 'sha256'), 'hex');
    insert into public.action_guides
      (owner_id, case_id, verification_run_id, version_no, status, guide_schema_version, actions, limitation_codes, content_hash)
    values (r.owner_id, r.case_id, r.id,
            (select coalesce(max(version_no), 0) + 1 from public.action_guides where verification_run_id = r.id),
            v_guide_status, coalesce(p_guide ->> 'guide_schema_version', 'g1'),
            coalesce(p_guide -> 'actions', '[]'::jsonb),
            (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(p_guide -> 'limitation_codes', '[]'::jsonb)) x),
            v_guide_hash)
    returning id into v_guide_id;
    for ev in select * from jsonb_array_elements(coalesce(p_guide -> 'channels', '[]'::jsonb)) loop
      insert into public.action_guide_channels
        (owner_id, case_id, verification_run_id, action_guide_id, official_channel_registry_id, action_no, display_order)
      values (r.owner_id, r.case_id, r.id, v_guide_id, (ev ->> 'official_channel_registry_id')::uuid,
              (ev ->> 'action_no')::integer, coalesce((ev ->> 'display_order')::integer, (ev ->> 'action_no')::integer));
    end loop;
    if v_guide_status = 'COMPLETED' and exists (
         select 1 from jsonb_array_elements(coalesce(p_guide -> 'actions', '[]'::jsonb)) a
          where a ->> 'action_code' = any(pre_action_codes)) then
      v_pre_action := true;
    end if;
    if v_guide_status = 'WITHHELD' then v_partial := array_append(v_partial, 'GUIDE_WITHHELD'); end if;
  else
    -- Guide 실패: 실패 행을 남겨 이력을 보존하고 Passport 는 Guide 없이 만든다.
    insert into public.action_guides
      (owner_id, case_id, verification_run_id, version_no, status, guide_schema_version, actions, limitation_codes, content_hash)
    values (r.owner_id, r.case_id, r.id,
            (select coalesce(max(version_no), 0) + 1 from public.action_guides where verification_run_id = r.id),
            'FAILED', 'g1', '[]'::jsonb, array['GUIDE_FAILED'], encode(extensions.digest('GUIDE_FAILED', 'sha256'), 'hex'));
    v_partial := array_append(v_partial, 'GUIDE_FAILED');
  end if;

  -- 7. 종합 결과 (코드 Matrix)
  v_overall := private.decide_overall_result(
    v_material_contradicted, v_high_risk, v_non_material_contradicted, v_material_conflict,
    v_material_undecided, v_agent_partial, v_coverage, v_pre_action);

  -- 8. 축 결과 3개
  select coalesce(array_agg(a ->> 'axis'), '{}') into v_axes from jsonb_array_elements(p_axis_results) a;
  if jsonb_array_length(p_axis_results) <> 3
     or not (v_axes @> array['AUTHENTICITY', 'TRANSACTION_SALES_RISK', 'SUITABILITY']) then
    raise exception '축 결과는 AUTHENTICITY·TRANSACTION_SALES_RISK·SUITABILITY 세 개여야 한다' using errcode = 'check_violation';
  end if;
  for ax in select * from jsonb_array_elements(p_axis_results) loop
    if matrix_rules -> 'axis_codes' ? (ax ->> 'axis')
       and not (matrix_rules -> 'axis_codes' -> (ax ->> 'axis') ? (ax ->> 'result_code')) then
      raise exception '축 % 의 결과 Code % 는 정책 Registry 에 없다', ax ->> 'axis', ax ->> 'result_code' using errcode = 'check_violation';
    end if;
    insert into public.verification_axis_results
      (owner_id, case_id, verification_run_id, axis, result_code, summary_masked, limitation_codes, content_hash)
    values (r.owner_id, r.case_id, r.id, (ax ->> 'axis')::public.result_axis, ax ->> 'result_code',
            coalesce(ax ->> 'summary_masked', '요약 없음'),
            (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(ax -> 'limitation_codes', '[]'::jsonb)) x),
            encode(extensions.digest(ax::text, 'sha256'), 'hex'));
  end loop;

  -- 9. Passport
  select coalesce(max(passport_version_no), 0) + 1 into v_version from public.evidence_passports where case_id = c.id;
  v_manifest := jsonb_build_object(
    'schema_version', '1',
    'run_id', r.id, 'run_kind', r.kind, 'execution_manifest_id', m.id, 'manifest_version', m.manifest_version,
    'profile_version_id', r.profile_version_id,
    'policy_versions', jsonb_build_object('evidence', m.evidence_policy_version, 'result_matrix', m.result_matrix_version,
                                          'coverage', m.coverage_contract_version, 'profile', m.profile_policy_version,
                                          'pii', m.pii_policy_version),
    'kb_release_id', m.kb_release_id,
    'final_claims', (select coalesce(jsonb_agg(jsonb_build_object('claim_id', f.claim_id, 'final_claim_version_id', f.id,
                                    'status', f.status, 'is_material', f.is_material, 'content_hash', f.content_hash) order by f.claim_id), '[]'::jsonb)
                       from public.final_claim_versions f where f.verification_run_id = r.id),
    'evidences', (select coalesce(jsonb_agg(jsonb_build_object('evidence_id', e.id, 'independence_key', e.independence_key,
                                  'content_hash', e.content_hash) order by e.id), '[]'::jsonb)
                    from public.evidences e where e.verification_run_id = r.id
                     and exists (select 1 from public.claim_evidences ce where ce.evidence_id = e.id)),
    'axis_results', (select coalesce(jsonb_agg(jsonb_build_object('axis', a.axis, 'result_code', a.result_code,
                                     'content_hash', a.content_hash) order by a.axis), '[]'::jsonb)
                       from public.verification_axis_results a where a.verification_run_id = r.id),
    'guide', jsonb_build_object('action_guide_id', v_guide_id, 'status', v_guide_status, 'content_hash', v_guide_hash),
    'overall_result', v_overall, 'coverage_satisfied', v_coverage,
    'partial_reason_codes', to_jsonb(v_partial));
  insert into public.evidence_passports
    (owner_id, case_id, verification_run_id, passport_version_no, previous_passport_id, profile_version_id,
     execution_manifest_id, action_guide_id, overall_result, coverage_satisfied, passport_schema_version, manifest, payload_hash)
  values (r.owner_id, r.case_id, r.id, v_version, c.latest_passport_id, r.profile_version_id, m.id,
          case when v_guide_status = 'COMPLETED' then v_guide_id end,
          v_overall, v_coverage, p_passport_schema_version, v_manifest,
          encode(extensions.digest(v_manifest::text, 'sha256'), 'hex'))
  returning id into v_passport;

  -- 10. Run·Case·Event·Outbox
  v_final_status := case when cardinality(v_partial) = 0 then 'COMPLETED' else 'PARTIAL' end;
  update public.verification_runs
     set status = v_final_status, finished_at = now(), overall_result = v_overall, coverage_satisfied = v_coverage,
         partial_reason_codes = v_partial,
         input_tokens = coalesce((select sum(a.input_tokens) from public.agent_runs a where a.verification_run_id = r.id), 0),
         output_tokens = coalesce((select sum(a.output_tokens) from public.agent_runs a where a.verification_run_id = r.id), 0),
         cost_microunits = coalesce((select sum(a.cost_microunits) from public.agent_runs a where a.verification_run_id = r.id), 0)
                         + coalesce((select sum(t.cost_microunits) from public.tool_runs t where t.verification_run_id = r.id), 0)
   where id = r.id;
  update public.financial_cases
     set latest_successful_run_id = r.id, latest_passport_id = v_passport, lock_version = lock_version + 1
   where id = c.id;
  if r.kind = 'INITIAL' then
    perform private.transition_financial_case(r.owner_id, c.id, 'VERIFIED', 'SYSTEM', 'RUN_FINALIZED');
  end if;
  perform private.append_case_event(r.owner_id, c.id, 'RUN_COMPLETED', 'SYSTEM', null, null,
            jsonb_build_object('run_id', r.id, 'passport_id', v_passport, 'overall_result', v_overall,
                               'run_status', v_final_status, 'partial_reason_codes', to_jsonb(v_partial)),
            'run-completed:' || r.id::text);
  if r.kind = 'INITIAL' then
    insert into private.outbox_events (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
    values ('EVIDENCE_PASSPORT', v_passport, 'NOTIFICATION_REQUESTED', 'notify-passport:' || v_passport::text,
            jsonb_build_object('schema_version', '1', 'notification_type', 'VERIFICATION_COMPLETED',
                               'passport_id', v_passport, 'case_id', c.id, 'owner_id', r.owner_id))
    on conflict (deduplication_key) do nothing;
  end if;

  -- 근거 정책 Deferred Trigger 를 지금 검사해 Commit 전에 실패시킨다. 검사 뒤 모드는 되돌린다.
  set constraints all immediate;
  set constraints all deferred;
  return v_passport;
end;
$$;
revoke all on function private.finalize_verification_run(uuid, jsonb, jsonb, jsonb, text[], text)
  from public, anon, authenticated;
grant execute on function private.finalize_verification_run(uuid, jsonb, jsonb, jsonb, text[], text)
  to finshield_worker;

-- ------------------------------------------------------------
-- 3. finalize_revalidation (명세 7.2, 6.6)
--    Fencing token 검증 → 새 Run·Passport → Diff → Job 종결·Event·Outbox.
-- ------------------------------------------------------------
create or replace function private.finalize_revalidation(
  p_job_id uuid, p_lease_token uuid, p_run_id uuid,
  p_final_claims jsonb, p_axis_results jsonb, p_guide jsonb default null,
  p_partial_reason_codes text[] default '{}', p_passport_schema_version text default 'p1')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  j        public.revalidation_jobs%rowtype;
  r        public.verification_runs%rowtype;
  base     public.evidence_passports%rowtype;
  v_new    uuid;
  v_claim_changes jsonb;
  v_evidence_changes jsonb;
  v_result_changes jsonb;
  v_action_changes jsonb;
  v_material boolean;
  v_diff   uuid;
  v_status public.revalidation_job_status;
  v_new_overall public.overall_result;
begin
  select * into j from public.revalidation_jobs where id = p_job_id for update;
  if not found or j.status <> 'RUNNING' then
    raise exception 'RUNNING Job 만 최종화한다' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from private.revalidation_job_runtime rt where rt.job_id = j.id and rt.lease_token = p_lease_token) then
    raise exception 'Lease token 이 일치하지 않는다' using errcode = 'lock_not_available';
  end if;
  select * into r from public.verification_runs where id = p_run_id;
  if not found or r.kind <> 'REVALIDATION' or r.revalidation_job_id is distinct from j.id or r.case_id <> j.case_id then
    raise exception 'Run 이 이 Job 의 REVALIDATION Run 이 아니다' using errcode = 'check_violation';
  end if;
  if j.cancel_requested_at is not null then
    perform private.fail_verification_run(r.id, 'USER_CANCELLED');
    perform private.settle_revalidation_cancel(j.id);
    return j.id;
  end if;
  select * into base from public.evidence_passports where id = j.base_passport_id;

  v_new := private.finalize_verification_run(p_run_id, p_final_claims, p_axis_results, p_guide,
                                             p_partial_reason_codes, p_passport_schema_version);
  select overall_result into v_new_overall from public.evidence_passports where id = v_new;

  -- Diff: 불변 ID·상태만 비교한다. 본문은 복제하지 않는다.
  with before_c as (
    select f.claim_id, f.status::text as status, f.is_material from public.final_claim_versions f where f.verification_run_id = base.verification_run_id),
  after_c as (
    select f.claim_id, f.status::text as status, f.is_material from public.final_claim_versions f where f.verification_run_id = r.id)
  select coalesce(jsonb_agg(jsonb_build_object('claim_id', coalesce(b.claim_id, a.claim_id), 'before', b.status, 'after', a.status,
                                               'is_material', coalesce(a.is_material, b.is_material)) order by coalesce(b.claim_id, a.claim_id)), '[]'::jsonb)
    into v_claim_changes
    from before_c b full outer join after_c a on a.claim_id = b.claim_id
   where b.status is distinct from a.status;

  with before_e as (
    select distinct e.independence_key from public.evidences e
     where e.verification_run_id = base.verification_run_id and exists (select 1 from public.claim_evidences ce where ce.evidence_id = e.id)),
  after_e as (
    select distinct e.independence_key from public.evidences e
     where e.verification_run_id = r.id and exists (select 1 from public.claim_evidences ce where ce.evidence_id = e.id))
  select coalesce(jsonb_agg(jsonb_build_object('independence_key', coalesce(b.independence_key, a.independence_key),
                                               'change', case when b.independence_key is null then 'ADDED' else 'REMOVED' end)
                            order by coalesce(b.independence_key, a.independence_key)), '[]'::jsonb)
    into v_evidence_changes
    from before_e b full outer join after_e a on a.independence_key = b.independence_key
   where b.independence_key is null or a.independence_key is null;

  with before_a as (
    select x.axis::text as axis, x.result_code from public.verification_axis_results x where x.verification_run_id = base.verification_run_id),
  after_a as (
    select x.axis::text as axis, x.result_code from public.verification_axis_results x where x.verification_run_id = r.id)
  select (case when base.overall_result <> v_new_overall
               then jsonb_build_array(jsonb_build_object('field', 'overall_result', 'before', base.overall_result, 'after', v_new_overall))
               else '[]'::jsonb end)
         || coalesce((select jsonb_agg(jsonb_build_object('field', 'axis:' || b.axis, 'before', b.result_code, 'after', a.result_code) order by b.axis)
                        from before_a b join after_a a on a.axis = b.axis where a.result_code <> b.result_code), '[]'::jsonb)
    into v_result_changes;

  with before_g as (
    select a ->> 'action_code' as code from public.action_guides g cross join jsonb_array_elements(g.actions) a
     where g.id = base.action_guide_id),
  after_g as (
    select a ->> 'action_code' as code from public.evidence_passports p
      join public.action_guides g on g.id = p.action_guide_id cross join jsonb_array_elements(g.actions) a
     where p.id = v_new)
  select coalesce(jsonb_agg(jsonb_build_object('action_code', coalesce(b.code, a.code),
                                               'change', case when b.code is null then 'ADDED' else 'REMOVED' end) order by coalesce(b.code, a.code)), '[]'::jsonb)
    into v_action_changes
    from (select distinct code from before_g) b full outer join (select distinct code from after_g) a on a.code = b.code
   where b.code is null or a.code is null;

  v_material := jsonb_array_length(v_result_changes) > 0
    or exists (select 1 from jsonb_array_elements(v_claim_changes) x where (x ->> 'is_material')::boolean);

  insert into public.passport_diffs
    (owner_id, case_id, revalidation_job_id, before_passport_id, after_passport_id, material_change,
     claim_changes, evidence_changes, result_changes, action_changes, diff_schema_version, content_hash)
  values (j.owner_id, j.case_id, j.id, base.id, v_new, v_material,
          v_claim_changes, v_evidence_changes, v_result_changes, v_action_changes, 'd1',
          encode(extensions.digest((v_claim_changes::text || v_evidence_changes::text || v_result_changes::text || v_action_changes::text), 'sha256'), 'hex'))
  returning id into v_diff;

  v_status := case when v_material then 'CHANGED' else 'NO_CHANGE' end;
  update public.revalidation_jobs
     set status = v_status, finished_at = now(), result_run_id = r.id, result_passport_id = v_new
   where id = j.id;
  update private.revalidation_job_runtime
     set lease_owner = null, lease_token = null, leased_until = null
   where job_id = j.id;
  perform private.append_revalidation_event(j.id, 'COMPLETED',
            jsonb_build_object('status', v_status, 'result_passport_id', v_new, 'diff_id', v_diff));
  perform private.append_case_event(j.owner_id, j.case_id, 'REVALIDATION_COMPLETED', 'SYSTEM', null, null,
            jsonb_build_object('revalidation_job_id', j.id, 'status', v_status, 'passport_id', v_new),
            'revalidation-completed:' || j.id::text);
  insert into private.outbox_events (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
  values ('REVALIDATION_JOB', j.id, 'NOTIFICATION_REQUESTED', 'notify-revalidation:' || j.id::text,
          jsonb_build_object('schema_version', '1',
                             'notification_type', case when v_material then 'MATERIAL_CHANGE_DETECTED' else 'REVALIDATION_NO_CHANGE' end,
                             'revalidation_job_id', j.id, 'passport_diff_id', v_diff, 'passport_id', v_new,
                             'case_id', j.case_id, 'owner_id', j.owner_id))
  on conflict (deduplication_key) do nothing;

  set constraints all immediate;
  set constraints all deferred;
  return j.id;
end;
$$;
revoke all on function private.finalize_revalidation(uuid, uuid, uuid, jsonb, jsonb, jsonb, text[], text)
  from public, anon, authenticated;
grant execute on function private.finalize_revalidation(uuid, uuid, uuid, jsonb, jsonb, jsonb, text[], text)
  to finshield_worker;
