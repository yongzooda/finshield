begin;
do $$
declare old_id uuid; new_id uuid; a jsonb; b jsonb;
begin
 select id into strict old_id from private.execution_manifests where manifest_version='finshield-p0-loan-v15';
 select id into strict new_id from private.execution_manifests where manifest_version='finshield-p0-loan-v16';
 if (select count(*) from private.execution_manifest_agents where execution_manifest_id=new_id)<>7 then raise exception '일곱 Agent 누락';end if;
 if exists(select 1 from private.execution_manifest_agents m join private.agent_definitions d on d.id=m.agent_definition_id where m.execution_manifest_id=new_id and d.version<>'p0-v8') then raise exception 'Agent 버전 불일치';end if;
 if exists(select 1 from private.execution_manifest_tools m join private.tool_definitions d on d.id=m.tool_definition_id where m.execution_manifest_id=new_id and d.version<>'p0-v5') then raise exception 'Tool 버전 불일치';end if;
 select jsonb_agg(jsonb_build_array(d.tool_code,m.purpose_code,d.timeout_ms,d.max_batch_size,d.retry_limit) order by d.tool_code,m.purpose_code) into a from private.execution_manifest_tools m join private.tool_definitions d on d.id=m.tool_definition_id where m.execution_manifest_id=old_id;
 select jsonb_agg(jsonb_build_array(d.tool_code,m.purpose_code,d.timeout_ms,d.max_batch_size,d.retry_limit) order by d.tool_code,m.purpose_code) into b from private.execution_manifest_tools m join private.tool_definitions d on d.id=m.tool_definition_id where m.execution_manifest_id=new_id;
 if a is distinct from b then raise exception '허용 도구 또는 한도 변경';end if;
 if (select count(*) from private.agent_tool_allowlists l join private.agent_definitions d on d.id=l.agent_definition_id where d.version='p0-v8')<>(select count(*) from private.agent_tool_allowlists l join private.agent_definitions d on d.id=l.agent_definition_id where d.version='p0-v7') then raise exception '도구 허용 목록 누락';end if;
 raise notice '49_nested_statute_content: Agent·Tool 버전과 기존 범위 보존 통과';
end $$;
rollback;
