-- AI-005·AI-012·EV-007: Claim별 인용 자격을 모델 입력에 전달하는 새 정의.
-- Tool·Evidence Policy·기존 Agent/Manifest/Passport는 변경하지 않는다.
insert into private.agent_definitions
 (agent_code,version,input_schema_version,output_schema_version,prompt_version,role,definition_hash)
select agent_code,'p0-v10',input_schema_version,output_schema_version,
 regexp_replace(prompt_version,'-v9$','-v10'),role,
 encode(extensions.digest(definition_hash||':single-claim-decisions-v1','sha256'),'hex')
from private.agent_definitions where version='p0-v9';

insert into private.agent_tool_allowlists(agent_definition_id,tool_definition_id,purpose_code)
select n.id,l.tool_definition_id,l.purpose_code
from private.agent_tool_allowlists l
join private.agent_definitions a on a.id=l.agent_definition_id and a.version='p0-v9'
join private.agent_definitions n on n.agent_code=a.agent_code and n.version='p0-v10';

insert into private.execution_manifests
 (manifest_version,scenario,scenario_version,model_bundle,prompt_bundle_version,schema_bundle_version,evidence_policy_version,
 result_matrix_version,coverage_contract_version,profile_policy_version,pii_policy_version,kb_release_id,embedding_model,embedding_dimension,config_hash)
select 'finshield-p0-loan-v18',scenario,scenario_version,model_bundle,'p0-loan-prompts-v10',schema_bundle_version,evidence_policy_version,
 result_matrix_version,coverage_contract_version,profile_policy_version,pii_policy_version,kb_release_id,embedding_model,embedding_dimension,
 encode(extensions.digest(config_hash||':single-claim-decisions-v1','sha256'),'hex')
from private.execution_manifests where manifest_version='finshield-p0-loan-v17';
insert into private.execution_manifest_agents(execution_manifest_id,agent_definition_id,logical_agent_key,required)
select n.id,na.id,a.logical_agent_key,a.required from private.execution_manifest_agents a
join private.execution_manifests m on m.id=a.execution_manifest_id and m.manifest_version='finshield-p0-loan-v17'
join private.agent_definitions old on old.id=a.agent_definition_id
join private.agent_definitions na on na.agent_code=old.agent_code and na.version='p0-v10'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v18';
insert into private.execution_manifest_tools(execution_manifest_id,tool_definition_id,purpose_code,required)
select n.id,t.tool_definition_id,t.purpose_code,t.required from private.execution_manifest_tools t
join private.execution_manifests m on m.id=t.execution_manifest_id and m.manifest_version='finshield-p0-loan-v17'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v18';
