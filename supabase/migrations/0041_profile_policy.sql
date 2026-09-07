-- AUTH-006·AUTH-007·RES-001·PASS-002: 실행 Snapshot에만 결정적 적합성 규칙을 적용한다.
-- 과거 Policy·Manifest·Passport는 그대로 둔다. 새 정책은 대출 주의사항이며 신용심사·승인 판정이 아니다.
insert into private.policy_versions(policy_type,version,rules,schema_version,content_hash)
select 'PROFILE','profile-policy-v2',rules,'2',encode(extensions.digest(rules::text,'sha256'),'hex')
from (select '{"skip_suspends_axes":["SUITABILITY"],"snapshot_at":"RUN_START","implementation":"db-profile-policy-v2","rules":["LOAN_DEBT_BURDEN","LOAN_EMERGENCY_BUFFER","LOAN_PURPOSE","LOAN_HORIZON","LOAN_LIQUIDITY","LOAN_ELIGIBILITY","LOAN_AFFORDABILITY"],"approval_inference":false,"annualize_monthly_income":false}'::jsonb rules) x;

insert into private.execution_manifests
 (manifest_version,scenario,scenario_version,model_bundle,prompt_bundle_version,schema_bundle_version,evidence_policy_version,
 result_matrix_version,coverage_contract_version,profile_policy_version,pii_policy_version,kb_release_id,config_hash)
select 'finshield-p0-loan-v3',scenario,scenario_version,model_bundle,prompt_bundle_version,schema_bundle_version,evidence_policy_version,
 result_matrix_version,coverage_contract_version,'profile-policy-v2',pii_policy_version,kb_release_id,
 encode(extensions.digest(config_hash||':profile-policy-v2','sha256'),'hex')
from private.execution_manifests where manifest_version='finshield-p0-loan-v2';
insert into private.execution_manifest_agents(execution_manifest_id,agent_definition_id,logical_agent_key,required)
select n.id,a.agent_definition_id,a.logical_agent_key,a.required from private.execution_manifest_agents a
join private.execution_manifests m on m.id=a.execution_manifest_id and m.manifest_version='finshield-p0-loan-v2'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v3';
insert into private.execution_manifest_tools(execution_manifest_id,tool_definition_id,purpose_code,required)
select n.id,t.tool_definition_id,t.purpose_code,t.required from private.execution_manifest_tools t
join private.execution_manifests m on m.id=t.execution_manifest_id and m.manifest_version='finshield-p0-loan-v2'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v3';

alter table public.verification_axis_results add column policy_evaluation jsonb;
alter table public.verification_axis_results add constraint ck_verification_axis_results__policy_evaluation
 check(policy_evaluation is null or (axis='SUITABILITY' and jsonb_typeof(policy_evaluation)='object'
   and octet_length(policy_evaluation::text)<=65536));

-- Worker가 전달한 축의 자기신고 대신 Run Snapshot과 실제 Claim에 연결된 Evidence만 읽는다.
create function private.evaluate_profile_policy(p_run uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r record; profile jsonb; checks jsonb:='[]'; limits text[]:='{}'; item record;
 products jsonb:='[]'; terms jsonb; notes text[]:='{}'; concern boolean:=false; usable integer:=0;
 result_code text:='NEED_MORE_INFORMATION'; summary text;
begin
 select vr.*,m.profile_policy_version,c.scenario,p.schema_version profile_schema,p.snapshot,p.completeness,p.content_hash profile_hash
 into r from public.verification_runs vr
 join private.execution_manifests m on m.id=vr.execution_manifest_id
 join public.financial_cases c on c.id=vr.case_id and c.owner_id=vr.owner_id and c.deleted_at is null
 join public.financial_profile_versions p on p.id=vr.profile_version_id and p.owner_id=vr.owner_id
 where vr.id=p_run;
 if not found or r.profile_policy_version<>'profile-policy-v2' then
  raise exception 'PROFILE_POLICY_CONTEXT_MISSING' using errcode='23514';
 end if;
 profile:=r.snapshot;
 if r.profile_schema<>'v1' or r.scenario<>'LOAN' then
  limits:=array['PROFILE_SCHEMA_OR_SCENARIO_UNSUPPORTED'];
  summary:='이 실행의 프로필 형식 또는 상품 범위에는 적합성 규칙을 적용하지 못했습니다.';
 elsif r.completeness='SKIPPED' then
  limits:=array['PROFILE_SKIPPED'];
  summary:='금융 프로필을 건너뛰어 적합성을 판단하지 않았습니다. 안전하다는 뜻이 아닙니다.';
 else
  if r.completeness='PARTIAL' then limits:=array_append(limits,'PROFILE_PARTIAL'); end if;
  -- P0 LOAN Case의 부담·완충 자금·목적은 사용자 범주의 의미만 사용한다. 법정 적합성 임계값으로 표현하지 않는다.
  checks:=checks||jsonb_build_array(jsonb_build_object('rule_code','LOAN_DEBT_BURDEN','profile_fields',jsonb_build_array('debt_burden_band'),
   'outcome',case when profile->>'debt_burden_band'='HIGH' then 'CAUTION' when profile->>'debt_burden_band'='UNSPECIFIED' then 'NEED_INPUT' else 'NO_FLAG_IN_SCOPE' end,
   'reason_masked',case when profile->>'debt_burden_band'='HIGH' then '현재 빚 부담을 높음으로 답했습니다. 새 대출의 월 상환액과 기존 상환액을 함께 확인해야 합니다.'
    when profile->>'debt_burden_band'='UNSPECIFIED' then '기존 빚 부담을 입력하지 않았습니다.' else '기존 빚 부담 응답에서 높음 표시는 없지만 상환 능력을 확인한 것은 아닙니다.' end));
  if profile->>'debt_burden_band'='HIGH' then concern:=true;notes:=array_append(notes,'기존 빚 부담이 높음');end if;
  checks:=checks||jsonb_build_array(jsonb_build_object('rule_code','LOAN_EMERGENCY_BUFFER','profile_fields',jsonb_build_array('emergency_fund_band'),
   'outcome',case when profile->>'emergency_fund_band' in ('BAND_0','BAND_1') then 'CAUTION' when profile->>'emergency_fund_band'='UNSPECIFIED' then 'NEED_INPUT' else 'NO_FLAG_IN_SCOPE' end,
   'reason_masked',case when profile->>'emergency_fund_band' in ('BAND_0','BAND_1') then '비상 자금이 한 달 치 미만입니다. 소득 중단 시에도 상환을 이어갈 수 있는지 확인해야 합니다.'
    when profile->>'emergency_fund_band'='UNSPECIFIED' then '비상 자금 범주를 입력하지 않았습니다.' else '비상 자금 응답에서 한 달 미만 표시는 없지만 충분한 상환 여력을 입증하지는 않습니다.' end));
  if profile->>'emergency_fund_band' in ('BAND_0','BAND_1') then concern:=true;notes:=array_append(notes,'비상 자금이 한 달 치 미만');end if;
  checks:=checks||jsonb_build_array(jsonb_build_object('rule_code','LOAN_PURPOSE','profile_fields',jsonb_build_array('purpose_code'),
   'outcome',case when profile->>'purpose_code' in ('SAVINGS','INVESTMENT') then 'CAUTION' when profile->>'purpose_code'='UNSPECIFIED' then 'NEED_INPUT' else 'NO_FLAG_IN_SCOPE' end,
   'reason_masked',case when profile->>'purpose_code' in ('SAVINGS','INVESTMENT') then '저축·투자 목적과 대출 거래의 관계를 다시 확인해야 합니다. 상품의 자금 용도 제한은 별도 확인 대상입니다.'
    when profile->>'purpose_code'='UNSPECIFIED' then '거래 목적을 입력하지 않았습니다.' else '대출 목적 범주를 선택했습니다. 해당 상품에서 허용하는 자금 용도까지 확인한 것은 아닙니다.' end));
  if profile->>'purpose_code' in ('SAVINGS','INVESTMENT') then concern:=true;notes:=array_append(notes,'저축·투자 목적과 대출 거래의 관계 확인 필요');end if;

  -- 같은 실행의 확정 상품 Claim에 직접 연결된 공식 자료만 상품 조건 비교에 쓴다.
  -- 최초·재검증 모두 최종 Claim 저장 뒤 이 함수가 호출된다. 참고·종료·미확인 자료와 이름이 다른 상품은 제외한다.
  for item in
   select distinct e.id,e.source_locator,e.content_hash,e.kb_snapshot_id,ss.official_id
   from public.final_claim_versions f
   join public.claims cl on cl.id=f.claim_id and cl.claim_type='PRODUCT_TERM'
   join public.claim_revisions cr on cr.id=f.claim_revision_id
   join public.claim_evidences ce on ce.final_claim_version_id=f.id and ce.relation='SUPPORT'
   join public.evidences e on e.id=ce.evidence_id and e.verification_run_id=p_run
   join kb.source_snapshots ss on ss.id=e.kb_snapshot_id
   where f.verification_run_id=p_run and f.status='VERIFIED'
    and e.citable and not e.incomplete and e.target_match and not e.reference_only and e.directness='DIRECT' and e.freshness_at_use='FRESH'
    and ss.is_complete and ss.is_citable and ss.official_id='kinfa:hessalLoan'
    and ss.canonical_url='https://www.kinfa.or.kr/financialProduct/hessalLoan.do'
    and e.source_locator->>'temporal_status' in ('NO_END_NOTICE','SCHEDULED_END')
    and e.source_locator->>'assessed_on' >= to_char(r.started_at at time zone 'Asia/Seoul','YYYY-MM-DD')
    and e.source_locator->>'assessed_on' <= to_char(statement_timestamp() at time zone 'Asia/Seoul','YYYY-MM-DD')
    and e.source_locator#>>'{profile_terms,schema_version}'='kinfa-hessal-profile-terms-v1'
    and cr.statement_masked ~ '햇살론\s*15([^0-9]|$)'
   order by e.id
  loop
   usable:=usable+1;terms:=item.source_locator->'profile_terms';
   products:=products||jsonb_build_array(jsonb_build_object('evidence_id',item.id,'snapshot_id',item.kb_snapshot_id,
    'content_hash',item.content_hash,'official_id',item.official_id,'terms',terms));
   checks:=checks||jsonb_build_array(jsonb_build_object('rule_code','LOAN_HORIZON','evidence_id',item.id,
    'profile_fields',jsonb_build_array('horizon_code'),'outcome',case when profile->>'horizon_code'='UNSPECIFIED' then 'NEED_INPUT'
      when profile->>'horizon_code'='SHORT' and terms->'term_months'='[36, 60]'::jsonb then 'CAUTION' else 'NEED_CONDITIONS' end,
    'reason_masked',case when profile->>'horizon_code'='SHORT' and terms->'term_months'='[36, 60]'::jsonb
      then '예상 기간은 1년 이내이고 확인된 대출기간은 3년 또는 5년입니다. 조기 상환 가능 여부와 비용을 확인하세요.'
      else '예상 기간과 실제 상환 계획 및 조기 상환 조건을 함께 확인해야 합니다.' end));
   if profile->>'horizon_code'='SHORT' and terms->'term_months'='[36, 60]'::jsonb then concern:=true;notes:=array_append(notes,'예상 기간보다 긴 대출기간');end if;
  end loop;
  if usable=0 then
   limits:=array_append(limits,'CURRENT_PRODUCT_CONDITIONS_UNVERIFIED');
   checks:=checks||jsonb_build_array(jsonb_build_object('rule_code','LOAN_HORIZON','profile_fields',jsonb_build_array('horizon_code'),
    'outcome','NEED_CONDITIONS','reason_masked','현재 유효한 상품 조건을 해당 Claim과 연결하지 못해 기간 비교를 보류했습니다.'));
  end if;
  checks:=checks||jsonb_build_array(jsonb_build_object('rule_code','LOAN_LIQUIDITY','profile_fields',jsonb_build_array('liquidity_need'),
   'outcome',case when profile->>'liquidity_need'='UNSPECIFIED' then 'NEED_INPUT' else 'NEED_CONDITIONS' end,
   'reason_masked',case when profile->>'liquidity_need'='HIGH' then '중간에 자금을 사용할 필요가 높습니다. 조기 상환·추가 인출 가능 여부와 수수료를 공식 계약 조건으로 확인해야 합니다.'
     else '조기 상환·추가 인출 조건을 확인하지 못해 유동성 판단을 보류했습니다.' end),
   jsonb_build_object('rule_code','LOAN_ELIGIBILITY','profile_fields',jsonb_build_array('income_band'),
    'outcome','NEED_INPUT','reason_masked','월 소득 구간만으로 연소득·신용평점 등 가입 요건을 판정하지 않습니다. 공식 창구에서 해당 요건을 확인해야 합니다.'),
   jsonb_build_object('rule_code','LOAN_AFFORDABILITY','profile_fields',jsonb_build_array('income_band','debt_burden_band'),
    'outcome','NEED_INPUT','reason_masked','대출 실행액·월 상환액·필수 지출이 없어 갚을 수 있는지 확정하지 않았습니다.'));
  limits:=limits||array['REPAYMENT_AMOUNT_MISSING','ELIGIBILITY_NOT_ASSESSED','EARLY_REPAYMENT_TERMS_MISSING','NOT_CREDIT_APPROVAL'];
  if concern then result_code:='UNCERTAIN';summary:=array_to_string(notes,' · ')||'에 대한 주의사항이 있습니다. 상환 가능 여부나 가입 승인을 판정한 결과는 아닙니다.';
  else summary:='입력한 범주에서 확인한 주의사항은 없지만, 상품 조건·월 상환액·가입 요건이 부족해 적합성을 확정하지 않았습니다.';end if;
 end if;
 return jsonb_build_object('axis','SUITABILITY','result_code',result_code,'summary_masked',summary,'limitation_codes',to_jsonb(limits),
  'policy_evaluation',jsonb_build_object('schema_version','2','policy_version','profile-policy-v2','profile_version_id',r.profile_version_id,
   'profile_content_hash',r.profile_hash,'profile_schema_version',r.profile_schema,'checks',checks,'products',products,
   'not_assessed',jsonb_build_array('CREDIT_APPROVAL','FULL_AFFORDABILITY','LOSS_TOLERANCE_FOR_NON_LOAN_PRODUCTS')));
end $$;
revoke all on function private.evaluate_profile_policy(uuid) from public,anon,authenticated,finshield_worker;

create function private.apply_profile_axis_policy()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy text; evaluated jsonb;
begin
 select m.profile_policy_version into policy from public.verification_runs r
 join private.execution_manifests m on m.id=r.execution_manifest_id where r.id=new.verification_run_id;
 if new.axis='SUITABILITY' and policy='profile-policy-v2' then
  evaluated:=private.evaluate_profile_policy(new.verification_run_id);
  new.result_code:=evaluated->>'result_code';new.summary_masked:=evaluated->>'summary_masked';
  new.limitation_codes:=array(select jsonb_array_elements_text(evaluated->'limitation_codes'));
  new.policy_evaluation:=evaluated->'policy_evaluation';
  new.content_hash:=encode(extensions.digest(evaluated::text,'sha256'),'hex');
 elsif new.policy_evaluation is not null then
  raise exception 'PROFILE_POLICY_VERSION_MISMATCH' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.apply_profile_axis_policy() from public,anon,authenticated,finshield_worker;
create trigger trg_verification_axis_results__profile_policy before insert on public.verification_axis_results
for each row execute function private.apply_profile_axis_policy();

-- 기존 security_invoker View의 소유자/RLS 조건을 그대로 보존하고 불변 Trace만 추가한다.
do $$ declare original text; changed text; begin
 original:=pg_get_viewdef('public.passport_v'::regclass,true);
 changed:=replace(original,'''limitation_codes'', a.limitation_codes','''limitation_codes'', a.limitation_codes, ''policy_evaluation'', a.policy_evaluation');
 if changed=original then raise exception 'PASSPORT_VIEW_PROFILE_PATCH_MISSING';end if;
 execute 'create or replace view public.passport_v with (security_invoker=true) as '||changed;
end $$;

create function private.read_finalized_axes(p_owner uuid,p_passport uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_agg(jsonb_build_object('axis',a.axis,'result_code',a.result_code,'summary_masked',a.summary_masked,
  'limitation_codes',a.limitation_codes,'policy_evaluation',a.policy_evaluation) order by a.axis)
 from public.evidence_passports p join public.financial_cases c on c.id=p.case_id and c.deleted_at is null
 join public.verification_axis_results a on a.verification_run_id=p.verification_run_id
 where p.id=p_passport and p.owner_id=p_owner
$$;
revoke all on function private.read_finalized_axes(uuid,uuid) from public,anon,authenticated;
grant execute on function private.read_finalized_axes(uuid,uuid) to finshield_worker;
