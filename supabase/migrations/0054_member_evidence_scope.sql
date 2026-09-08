-- AI-005·AI-009·EV-004: 과거 실행 정의를 보존하고 회원 근거 비교의 새 버전을 추가한다.
-- 0051~0053은 별도 진행 중 Draft에 예약돼 있다. 그 기능을 이 Migration에 섞지 않는다.
insert into private.agent_definitions
 (agent_code,version,input_schema_version,output_schema_version,prompt_version,role,definition_hash)
select agent_code,'p0-v3',input_schema_version,output_schema_version,
 regexp_replace(prompt_version,'-v2$','-v3'),role,
 encode(extensions.digest(definition_hash||':member-evidence-scope-v1','sha256'),'hex')
from private.agent_definitions where version='p0-v2' on conflict do nothing;

insert into private.tool_definitions
 (tool_code,version,transport,input_schema_version,output_schema_version,max_payload_bytes,max_batch_size,timeout_ms,retry_limit,definition_hash)
select tool_code,'p0-v3',transport,input_schema_version,output_schema_version,max_payload_bytes,max_batch_size,timeout_ms,retry_limit,
 encode(extensions.digest(definition_hash||':member-evidence-scope-v1','sha256'),'hex')
from private.tool_definitions where version='p0-v2' on conflict do nothing;

insert into private.agent_tool_allowlists(agent_definition_id,tool_definition_id,purpose_code)
select na.id,nt.id,l.purpose_code
from private.agent_tool_allowlists l
join private.agent_definitions a on a.id=l.agent_definition_id and a.version='p0-v2'
join private.tool_definitions t on t.id=l.tool_definition_id and t.version='p0-v2'
join private.agent_definitions na on na.agent_code=a.agent_code and na.version='p0-v3'
join private.tool_definitions nt on nt.tool_code=t.tool_code and nt.version='p0-v3'
on conflict do nothing;
insert into private.agent_tool_allowlists(agent_definition_id,tool_definition_id,purpose_code)
select a.id,t.id,'RECHECK_WARNING' from private.agent_definitions a cross join private.tool_definitions t
where a.agent_code='COVE' and a.version='p0-v3' and t.tool_code='search_consumer_warning' and t.version='p0-v3'
on conflict do nothing;

insert into private.execution_manifests
 (manifest_version,scenario,scenario_version,model_bundle,prompt_bundle_version,schema_bundle_version,
 evidence_policy_version,result_matrix_version,coverage_contract_version,profile_policy_version,pii_policy_version,
 kb_release_id,embedding_model,embedding_dimension,config_hash)
select 'finshield-p0-loan-v8',scenario,scenario_version,model_bundle,'p0-loan-prompts-v3',schema_bundle_version,
 evidence_policy_version,result_matrix_version,coverage_contract_version,profile_policy_version,pii_policy_version,
 kb_release_id,embedding_model,embedding_dimension,
 encode(extensions.digest(config_hash||':member-evidence-scope-v1','sha256'),'hex')
from private.execution_manifests where manifest_version='finshield-p0-loan-v7'
on conflict do nothing;
insert into private.execution_manifest_agents(execution_manifest_id,agent_definition_id,logical_agent_key,required)
select n.id,na.id,ma.logical_agent_key,ma.required
from private.execution_manifest_agents ma
join private.execution_manifests old on old.id=ma.execution_manifest_id and old.manifest_version='finshield-p0-loan-v7'
join private.agent_definitions a on a.id=ma.agent_definition_id
join private.agent_definitions na on na.agent_code=a.agent_code and na.version='p0-v3'
cross join private.execution_manifests n where n.manifest_version='finshield-p0-loan-v8'
on conflict do nothing;
insert into private.execution_manifest_tools(execution_manifest_id,tool_definition_id,purpose_code,required)
select distinct m.id,l.tool_definition_id,l.purpose_code,true
from private.execution_manifests m
join private.execution_manifest_agents ma on ma.execution_manifest_id=m.id
join private.agent_tool_allowlists l on l.agent_definition_id=ma.agent_definition_id
where m.manifest_version='finshield-p0-loan-v8' on conflict do nothing;
