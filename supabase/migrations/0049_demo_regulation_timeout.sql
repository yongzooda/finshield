-- B-DEMO-01·N-PERF-004: 실제 공개 Demo에서 4초를 넘긴 Domain 도구 선택 여유를 보정한다.

insert into private.execution_manifests
  (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version,
   schema_bundle_version, evidence_policy_version, result_matrix_version,
   coverage_contract_version, profile_policy_version, pii_policy_version, kb_release_id,
   embedding_model, embedding_dimension, config_hash)
select 'finshield-p0-loan-v6', m.scenario, m.scenario_version,
       jsonb_set(m.model_bundle, '{timeout_policy}', jsonb_build_object(
         'domainChoiceMs',6000,
         'domainDecisionMs',9000,
         'domainStageMs',16000,
         'reviewChoiceMs',5000,
         'reviewDecisionMs',8000,
         'reviewStageMs',15000,
         'judgeMs',12000,
         'demoRunMs',110000)),
       m.prompt_bundle_version, m.schema_bundle_version, m.evidence_policy_version,
       m.result_matrix_version, m.coverage_contract_version, m.profile_policy_version,
       m.pii_policy_version, m.kb_release_id, m.embedding_model, m.embedding_dimension,
       encode(extensions.digest(m.config_hash||':demo-regulation-choice-v1:6000:9000:16000','sha256'),'hex')
  from private.execution_manifests m
 where m.manifest_version='finshield-p0-loan-v5'
on conflict (manifest_version) do nothing;

insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select n.id, a.agent_definition_id, a.logical_agent_key, a.required
  from private.execution_manifest_agents a
  join private.execution_manifests m on m.id=a.execution_manifest_id
   and m.manifest_version='finshield-p0-loan-v5'
  cross join private.execution_manifests n
 where n.manifest_version='finshield-p0-loan-v6'
on conflict do nothing;

insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select n.id, t.tool_definition_id, t.purpose_code, t.required
  from private.execution_manifest_tools t
  join private.execution_manifests m on m.id=t.execution_manifest_id
   and m.manifest_version='finshield-p0-loan-v5'
  cross join private.execution_manifests n
 where n.manifest_version='finshield-p0-loan-v6'
on conflict do nothing;
