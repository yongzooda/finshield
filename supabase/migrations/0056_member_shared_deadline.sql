-- N-PERF-009·AI-005: 개별 단계의 조기 중단을 줄이고 전체 Run 기한은 유지한다.
-- 각 최대값을 모두 예약하지 않는다. 전체 AbortSignal이 항상 먼저 중단할 수 있다.
insert into private.execution_manifests
  (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version,
   schema_bundle_version, evidence_policy_version, result_matrix_version,
   coverage_contract_version, profile_policy_version, pii_policy_version, kb_release_id,
   embedding_model, embedding_dimension, config_hash)
select 'finshield-p0-loan-v10', m.scenario, m.scenario_version,
       jsonb_set(m.model_bundle, '{timeout_policy}', jsonb_build_object(
         'domainChoiceMs',8000,
         'domainDecisionMs',15000,
         'domainStageMs',25000,
         'reviewChoiceMs',8000,
         'reviewDecisionMs',15000,
         'reviewStageMs',25000,
         'judgeMs',20000,
         'judgeReserveMs',10000,
         'demoRunMs',115000)),
       m.prompt_bundle_version, m.schema_bundle_version, m.evidence_policy_version,
       m.result_matrix_version, m.coverage_contract_version, m.profile_policy_version,
       m.pii_policy_version, m.kb_release_id, m.embedding_model, m.embedding_dimension,
       encode(extensions.digest(m.config_hash||':member-shared-deadline-v1:8000:15000:25000:20000:115000','sha256'),'hex')
  from private.execution_manifests m
 where m.manifest_version='finshield-p0-loan-v9'
on conflict (manifest_version) do nothing;

insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select n.id, a.agent_definition_id, a.logical_agent_key, a.required
  from private.execution_manifest_agents a
  join private.execution_manifests m on m.id=a.execution_manifest_id
   and m.manifest_version='finshield-p0-loan-v9'
  cross join private.execution_manifests n
 where n.manifest_version='finshield-p0-loan-v10'
on conflict do nothing;

insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select n.id, t.tool_definition_id, t.purpose_code, t.required
  from private.execution_manifest_tools t
  join private.execution_manifests m on m.id=t.execution_manifest_id
   and m.manifest_version='finshield-p0-loan-v9'
  cross join private.execution_manifests n
 where n.manifest_version='finshield-p0-loan-v10'
on conflict do nothing;
