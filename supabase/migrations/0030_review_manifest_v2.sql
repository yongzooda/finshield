-- AI-010·AI-011·EV-016: 과거 Manifest를 보존하고 공식 조건·채널 반증 권한과 Sonnet 실행을 새 판에 고정한다.
insert into private.tool_definitions
  (tool_code,version,transport,input_schema_version,output_schema_version,max_payload_bytes,max_batch_size,timeout_ms,retry_limit,definition_hash)
select tool_code,'p0-v2',transport,input_schema_version,output_schema_version,max_payload_bytes,max_batch_size,timeout_ms,retry_limit,
  encode(extensions.digest(definition_hash||':p0-v2','sha256'),'hex')
from private.tool_definitions where version='p0-v1';

insert into private.agent_definitions
  (agent_code,version,input_schema_version,output_schema_version,prompt_version,role,definition_hash)
select agent_code,'p0-v2',input_schema_version,output_schema_version,replace(prompt_version,'-v1','-v2'),role,
  encode(extensions.digest(definition_hash||':p0-v2:official-counter-search','sha256'),'hex')
from private.agent_definitions where version='p0-v1';

insert into private.agent_tool_allowlists(agent_definition_id,tool_definition_id,purpose_code)
select na.id,nt.id,al.purpose_code
from private.agent_tool_allowlists al
join private.agent_definitions a on a.id=al.agent_definition_id and a.version='p0-v1'
join private.tool_definitions t on t.id=al.tool_definition_id and t.version='p0-v1'
join private.agent_definitions na on na.agent_code=a.agent_code and na.version='p0-v2'
join private.tool_definitions nt on nt.tool_code=t.tool_code and nt.version='p0-v2';
insert into private.agent_tool_allowlists(agent_definition_id,tool_definition_id,purpose_code)
select a.id,t.id,v.purpose from (values
 ('search_financial_product','FIND_COUNTER_PRODUCT'),('lookup_official_channel','FIND_COUNTER_CHANNEL')) v(tool,purpose)
join private.tool_definitions t on t.tool_code=v.tool and t.version='p0-v2'
join private.agent_definitions a on a.agent_code='RED_TEAM' and a.version='p0-v2';

insert into private.execution_manifests
 (manifest_version,scenario,scenario_version,model_bundle,prompt_bundle_version,schema_bundle_version,evidence_policy_version,
 result_matrix_version,coverage_contract_version,profile_policy_version,pii_policy_version,kb_release_id,config_hash)
select 'finshield-p0-loan-v2',scenario,scenario_version,
 '{"schema_version":"1","judgment_model":"claude-sonnet-5","domain_model":"claude-sonnet-5"}'::jsonb,
 'p0-loan-prompts-v2',schema_bundle_version,evidence_policy_version,result_matrix_version,coverage_contract_version,
 profile_policy_version,pii_policy_version,kb_release_id,
 encode(extensions.digest(config_hash||':v2:claude-sonnet-5:official-counter-search','sha256'),'hex')
from private.execution_manifests where manifest_version='finshield-p0-loan-v1';

insert into private.execution_manifest_agents(execution_manifest_id,agent_definition_id,logical_agent_key,required)
select m.id,a.id,a.agent_code,true from private.execution_manifests m cross join private.agent_definitions a
where m.manifest_version='finshield-p0-loan-v2' and a.version='p0-v2';
insert into private.execution_manifest_tools(execution_manifest_id,tool_definition_id,purpose_code,required)
select distinct m.id,al.tool_definition_id,al.purpose_code,false
from private.execution_manifests m
join private.execution_manifest_agents ma on ma.execution_manifest_id=m.id
join private.agent_tool_allowlists al on al.agent_definition_id=ma.agent_definition_id
where m.manifest_version='finshield-p0-loan-v2';
