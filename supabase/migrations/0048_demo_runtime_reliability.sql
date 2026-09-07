-- B-DEMO-01·N-PERF-004: Demo Seed 최신성 사건과 실제 모델 시간 제한을 함께 고정한다.
-- 0047의 사칭 안내 재조회 사건은 같은 내용의 중복 Snapshot 중 Seed가 가리키지
-- 않은 행에 연결됐다. 검증한 본문 Hash가 같은 Seed Snapshot에 새 사건을 남긴다.

insert into kb.source_fetch_events
  (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select s.id, 'kinfa_official_page',
       'kinfa:declare-center:2026-09-07T19:39:47.125Z:demo-seed-v1:'||s.id::text,
       'UNCHANGED', 'FRESH', '2026-09-07T19:39:47.125Z', '2026-09-08T19:39:47.125Z'
  from kb.source_snapshots s
 where s.official_id='kinfa:declare-center'
   and s.source_version='2026-09-05'
   and s.content_hash='0b7ff634837f01e9df7a760bd8ca72e6cc4cf80f9a205354ae686fb3e029d1b2'
on conflict (source_adapter, request_key) do nothing;

insert into private.execution_manifests
  (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version,
   schema_bundle_version, evidence_policy_version, result_matrix_version,
   coverage_contract_version, profile_policy_version, pii_policy_version, kb_release_id,
   embedding_model, embedding_dimension, config_hash)
select 'finshield-p0-loan-v5', m.scenario, m.scenario_version,
       m.model_bundle || jsonb_build_object('timeout_policy', jsonb_build_object(
         'domainChoiceMs',4000,
         'domainDecisionMs',9000,
         'domainStageMs',15000,
         'reviewChoiceMs',5000,
         'reviewDecisionMs',8000,
         'reviewStageMs',15000,
         'judgeMs',12000,
         'demoRunMs',110000)),
       m.prompt_bundle_version, m.schema_bundle_version, m.evidence_policy_version,
       m.result_matrix_version, m.coverage_contract_version, m.profile_policy_version,
       m.pii_policy_version, m.kb_release_id, m.embedding_model, m.embedding_dimension,
       encode(extensions.digest(m.config_hash||':demo-runtime-v2:4000:9000:15000:5000:8000:15000:12000:110000','sha256'),'hex')
  from private.execution_manifests m
 where m.manifest_version='finshield-p0-loan-v4'
on conflict (manifest_version) do nothing;

insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select n.id, a.agent_definition_id, a.logical_agent_key, a.required
  from private.execution_manifest_agents a
  join private.execution_manifests m on m.id=a.execution_manifest_id
   and m.manifest_version='finshield-p0-loan-v4'
  cross join private.execution_manifests n
 where n.manifest_version='finshield-p0-loan-v5'
on conflict do nothing;

insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select n.id, t.tool_definition_id, t.purpose_code, t.required
  from private.execution_manifest_tools t
  join private.execution_manifests m on m.id=t.execution_manifest_id
   and m.manifest_version='finshield-p0-loan-v4'
  cross join private.execution_manifests n
 where n.manifest_version='finshield-p0-loan-v5'
on conflict do nothing;
