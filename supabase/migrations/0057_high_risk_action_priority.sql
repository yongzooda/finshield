-- RES-004·요구사항 2.2: 개별 사실 보류와 고위험 행동 요구 경고를 구분한다.
-- 과거 Matrix와 Passport는 그대로 남기고 새 Run에만 적용한다.
insert into private.policy_versions(policy_type,version,rules,schema_version,content_hash)
select 'RESULT_MATRIX','result-matrix-v2',rules,'1',encode(extensions.digest(rules::text,'sha256'),'hex')
from (select p.rules || '{"high_risk_reason_codes":["HIGH_RISK_ADVANCE_PAYMENT","HIGH_RISK_REMOTE_CONTROL"],"high_risk_evidence_scope":"reviewed-official-prevention-guidance","high_risk_changes_claim_state":false}'::jsonb as rules
 from private.policy_versions p where policy_type='RESULT_MATRIX' and version='result-matrix-v1') x;

insert into private.execution_manifests
 (manifest_version,scenario,scenario_version,model_bundle,prompt_bundle_version,schema_bundle_version,evidence_policy_version,
 result_matrix_version,coverage_contract_version,profile_policy_version,pii_policy_version,kb_release_id,embedding_model,embedding_dimension,config_hash)
select 'finshield-p0-loan-v11',scenario,scenario_version,model_bundle,prompt_bundle_version,schema_bundle_version,evidence_policy_version,
 'result-matrix-v2',coverage_contract_version,profile_policy_version,pii_policy_version,kb_release_id,embedding_model,embedding_dimension,
 encode(extensions.digest(config_hash||':high-risk-action-priority-v1','sha256'),'hex')
from private.execution_manifests where manifest_version='finshield-p0-loan-v10';
insert into private.execution_manifest_agents(execution_manifest_id,agent_definition_id,logical_agent_key,required)
select n.id,a.agent_definition_id,a.logical_agent_key,a.required from private.execution_manifest_agents a
join private.execution_manifests m on m.id=a.execution_manifest_id and m.manifest_version='finshield-p0-loan-v10'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v11';
insert into private.execution_manifest_tools(execution_manifest_id,tool_definition_id,purpose_code,required)
select n.id,t.tool_definition_id,t.purpose_code,t.required from private.execution_manifest_tools t
join private.execution_manifests m on m.id=t.execution_manifest_id and m.manifest_version='finshield-p0-loan-v10'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v11';
