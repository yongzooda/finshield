begin;
do $$
declare old_id uuid; new_id uuid; old_tools jsonb; new_tools jsonb;
begin
 select id into strict old_id from private.execution_manifests where manifest_version='finshield-p0-loan-v17';
 select id into strict new_id from private.execution_manifests where manifest_version='finshield-p0-loan-v18';
 if (select count(*) from private.execution_manifest_agents where execution_manifest_id=new_id)<>7 then raise exception '새 Agent 일곱 개 연결 누락'; end if;
 if exists(select 1 from private.execution_manifest_agents ma join private.agent_definitions a on a.id=ma.agent_definition_id
  where ma.execution_manifest_id=new_id and (a.version<>'p0-v10' or a.prompt_version not like '%-v10')) then raise exception '새 프롬프트 버전 불일치'; end if;
 if exists(select 1 from private.execution_manifest_agents ma join private.agent_definitions a on a.id=ma.agent_definition_id
  where ma.execution_manifest_id=old_id and a.version<>'p0-v9') then raise exception '과거 실행 정의 변경'; end if;
 select jsonb_agg(jsonb_build_array(tool_definition_id,purpose_code,required) order by tool_definition_id,purpose_code) into old_tools from private.execution_manifest_tools where execution_manifest_id=old_id;
 select jsonb_agg(jsonb_build_array(tool_definition_id,purpose_code,required) order by tool_definition_id,purpose_code) into new_tools from private.execution_manifest_tools where execution_manifest_id=new_id;
 if old_tools is distinct from new_tools then raise exception '기존 도구 범위 변경'; end if;
 if exists(select 1 from private.execution_manifests a cross join private.execution_manifests b where a.id=old_id and b.id=new_id
  and (a.evidence_policy_version<>b.evidence_policy_version or a.result_matrix_version<>b.result_matrix_version or a.kb_release_id<>b.kb_release_id or a.model_bundle<>b.model_bundle)) then raise exception '판정 정책 또는 근거 범위 변경'; end if;
 if (select count(*) from private.agent_tool_allowlists l join private.agent_definitions a on a.id=l.agent_definition_id where a.version='p0-v10')
  <> (select count(*) from private.agent_tool_allowlists l join private.agent_definitions a on a.id=l.agent_definition_id where a.version='p0-v9') then raise exception 'Agent 도구 허용 목록 누락'; end if;
 raise notice '51_single_claim_decisions: 새 버전·일곱 Agent·허용 도구·과거 정책 보존 통과';
end $$;
rollback;
