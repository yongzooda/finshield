-- ============================================================
-- 0024. CoVe 와 Red Team Agent (명세 5.4, 규칙 3)
--
-- 규칙 3 은 CoVe 를 초기 결론을 다시 읽는 self-review 로 만들지 말라고 한다.
-- 초기 Query 와 결론에서 분리된 검색으로 Material Claim 을 다시 확인해야 한다.
-- Red Team 은 초기 결론을 뒤집을 공식 반대 근거를 찾는다.
--
-- 0016 의 finalize_verification_run 은 Material Claim 을 VERIFIED 나
-- CONTRADICTED 로 확정하려면 CoVe CONFIRMED 를 요구한다. 두 Agent 가 없으면
-- 확정 자체가 불가능하다.
--
-- Tool 과 정책과 Manifest 는 0021 이 이미 심었다. 여기서는 Agent 와 연결만 더한다.
-- ============================================================

insert into private.agent_definitions
  (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
values ('COVE', 'p0-v1', 'in-v1', 'out-v1',
        'cove-v1', 'COVE', 'e0caa28b8b39453a30703a2d52b8257b09713adf1cdbd719e6cfe1ad9ab3f75a')
on conflict (agent_code, version) do nothing;
insert into private.agent_definitions
  (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
values ('RED_TEAM', 'p0-v1', 'in-v1', 'out-v1',
        'red-team-v1', 'RED_TEAM', '0b4fb4cfe1e2589fd700c400b8b65dea78d56cc99276d950f75dab764d44683c')
on conflict (agent_code, version) do nothing;

insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'RECHECK_STATUTE'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'COVE' and ad.version = 'p0-v1'
   and td.tool_code = 'lookup_statute' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'RECHECK_PRODUCT'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'COVE' and ad.version = 'p0-v1'
   and td.tool_code = 'search_financial_product' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'RECHECK_CHANNEL'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'COVE' and ad.version = 'p0-v1'
   and td.tool_code = 'lookup_official_channel' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'FIND_COUNTER_STATUTE'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'RED_TEAM' and ad.version = 'p0-v1'
   and td.tool_code = 'lookup_statute' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'FIND_COUNTER_WARNING'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'RED_TEAM' and ad.version = 'p0-v1'
   and td.tool_code = 'search_consumer_warning' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'FIND_COUNTER_DISPUTE'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'RED_TEAM' and ad.version = 'p0-v1'
   and td.tool_code = 'search_dispute_case' and td.version = 'p0-v1'
on conflict do nothing;

insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select m.id, ad.id, 'COVE', true
  from private.execution_manifests m, private.agent_definitions ad
 where m.manifest_version = 'finshield-p0-loan-v1' and ad.agent_code = 'COVE' and ad.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'RECHECK_STATUTE', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'lookup_statute' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'RECHECK_PRODUCT', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'search_financial_product' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'RECHECK_CHANNEL', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'lookup_official_channel' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select m.id, ad.id, 'RED_TEAM', true
  from private.execution_manifests m, private.agent_definitions ad
 where m.manifest_version = 'finshield-p0-loan-v1' and ad.agent_code = 'RED_TEAM' and ad.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'FIND_COUNTER_STATUTE', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'lookup_statute' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'FIND_COUNTER_WARNING', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'search_consumer_warning' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'FIND_COUNTER_DISPUTE', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'search_dispute_case' and td.version = 'p0-v1'
on conflict do nothing;
