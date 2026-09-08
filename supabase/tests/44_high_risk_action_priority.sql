begin;
do $$
declare rules jsonb;
begin
 select p.rules into strict rules from private.policy_versions p join private.execution_manifests m
  on m.result_matrix_version=p.version and p.policy_type='RESULT_MATRIX' where m.manifest_version='finshield-p0-loan-v11';
 if not (rules->'high_risk_reason_codes' ?& array['HIGH_RISK_ADVANCE_PAYMENT','HIGH_RISK_REMOTE_CONTROL'])
  or rules->>'high_risk_changes_claim_state'<>'false' then raise exception '행동 경고 정책 연결 누락';end if;
 if private.decide_overall_result(false,true,false,false,true,true,false,true)<>'MATERIAL_RISK_FOUND' then
  raise exception '고위험 행동이 정보 부족 뒤에 숨겨짐';end if;
 if private.decide_overall_result(false,false,false,false,true,true,false,true)<>'INSUFFICIENT_INFORMATION' then
  raise exception '행동 위험 없는 정보 부족을 위험으로 올림';end if;
 if exists(select 1 from private.policy_versions p where p.policy_type='RESULT_MATRIX' and p.version='result-matrix-v1' and p.rules ? 'high_risk_reason_codes') then
  raise exception '과거 정책 변경';end if;
 raise notice '44_high_risk_action_priority: 행동 요구 우선·정보 부족 보존·과거 정책 불변 통과';
end $$;
rollback;
