-- AI-005·AI-009: 새 Manifest의 독립 안내 조회와 과거 구성 불변성.
begin;
do $$
declare current_id uuid; old_id uuid;
begin
 select id into strict current_id from private.execution_manifests where manifest_version='finshield-p0-loan-v8';
 select id into strict old_id from private.execution_manifests where manifest_version='finshield-p0-loan-v7';
 if (select count(*) from private.execution_manifest_agents where execution_manifest_id=current_id)<>7
 or (select count(*) from private.execution_manifest_tools where execution_manifest_id=current_id)<>20 then
   raise exception 'v8 실행 구성 누락';
 end if;
 if (select count(*) from private.execution_manifest_tools where execution_manifest_id=old_id)<>19 then
   raise exception '과거 v7 실행 구성이 바뀜';
 end if;
 if not exists(select 1 from private.agent_tool_allowlists l join private.agent_definitions a on a.id=l.agent_definition_id
  join private.tool_definitions t on t.id=l.tool_definition_id where a.agent_code='COVE' and a.version='p0-v3'
  and t.tool_code='search_consumer_warning' and t.version='p0-v3' and l.purpose_code='RECHECK_WARNING') then
   raise exception 'CoVe 독립 안내 조회 권한 누락';
 end if;
 if (select model_bundle from private.execution_manifests where id=current_id)
   is distinct from (select model_bundle from private.execution_manifests where id=old_id) then
   raise exception '모델 또는 시간 예산 변경';
 end if;
 raise notice '40_member_evidence_scope: 새 구성·CoVe·과거 구성·예산 보존 통과했습니다';
end $$;
rollback;
