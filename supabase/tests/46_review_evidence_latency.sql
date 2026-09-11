begin;
do $$
declare old_id uuid; new_id uuid;
begin
 select id into strict old_id from private.execution_manifests where manifest_version='finshield-p0-loan-v12';
 select id into strict new_id from private.execution_manifests where manifest_version='finshield-p0-loan-v13';
 if (select count(*) from private.execution_manifest_agents where execution_manifest_id=new_id)<>7 then raise exception 'Agent 연결 누락'; end if;
 if exists(select 1 from private.execution_manifest_agents ma join private.agent_definitions a on a.id=ma.agent_definition_id
  where ma.execution_manifest_id=new_id and (a.version<>'p0-v5' or a.prompt_version not like '%-v5')) then raise exception '새 프롬프트 불일치'; end if;
 if exists(select 1 from private.execution_manifest_tools mt join private.tool_definitions t on t.id=mt.tool_definition_id
  where mt.execution_manifest_id=new_id and t.version<>'p0-v4') then raise exception '새 도구 불일치'; end if;
 if exists(select 1 from private.execution_manifests a cross join private.execution_manifests b where a.id=old_id and b.id=new_id
  and (a.evidence_policy_version<>b.evidence_policy_version or a.result_matrix_version<>b.result_matrix_version or a.kb_release_id<>b.kb_release_id or a.model_bundle<>b.model_bundle)) then raise exception '기존 정책 또는 예산 변경'; end if;
 if (select count(*) from private.agent_tool_allowlists l join private.agent_definitions a on a.id=l.agent_definition_id where a.version='p0-v5')<>20 then raise exception '도구 허용 목록 누락'; end if;
 if (select count(*) from private.agent_tool_allowlists l join private.agent_definitions a on a.id=l.agent_definition_id where a.version='p0-v4')<>20 then raise exception '과거 허용 목록 변경'; end if;
 raise notice '46_review_evidence_latency: 새 정의와 기존 정책 보존 통과했습니다';
end $$;
rollback;
