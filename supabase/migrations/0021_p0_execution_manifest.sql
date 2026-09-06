-- ============================================================
-- 0021. P0 실행 Manifest seed (명세 5.4, ADR 14.2)
--
-- Agent 와 Tool 과 Allowlist 는 배포 구성이지 사용자 자료가 아니다. 그래서
-- 실행 시점에 만들지 않고 Migration 으로 심는다. finshield_worker 는 이 표에
-- 쓰기 권한이 없고, 그것이 설계다. Run 이 시작될 때 무엇이 허용됐는지를
-- 나중에 되짚으려면 값이 배포와 함께 고정돼 있어야 한다.
--
-- 이 파일은 src/lib/finshield/manifest.ts 의 선언에서 만들어졌다. 두 곳이
-- 어긋나면 Runtime 이 시작될 때 검사에서 걸린다.
-- ============================================================

insert into kb.kb_releases (version, corpus_scope, document_count, chunk_count, manifest_hash)
values ('p0-loan-corpus-v1', '{"schema_version":"1","scenario":"LOAN","scenario_version":"sunshine15-v1","document_types":["STATUTE","PRODUCT_TERMS","OFFICIAL_GUIDE","CONSUMER_WARNING"]}'::jsonb, 0, 0, '3d1ada75300180ddbc883b3e86ef3604a56fb567592bd54e260a1881d36f21d5')
on conflict (version) do nothing;

insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
values ('EVIDENCE', 'evidence-policy-v1', '{"min_independent_evidence_for_confirmed":1,"confirmed_states":["VERIFIED","CONTRADICTED"],"reference_only_can_confirm":false,"independence_key":"source_fingerprint","absence_is_not_safety":true,"zero_hit_becomes":"UNKNOWN","conflict_resolution":"preserve_both","metadata_only_directness":"CONTEXT_ONLY"}'::jsonb, '1', '632071f6a0b98cb0baea6db1973fe4102f712baf01a98bcecca918506e706d49')
on conflict (policy_type, version) do nothing;
insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
values ('RESULT_MATRIX', 'result-matrix-v1', '{"numeric_score":false,"axes":["PRODUCT_INSTITUTION","FRAUD_CHANNEL","SALES_CONDUCT","REGULATION_DISPUTE"],"material_contradicted_dominates":true,"partial_agent_marks_run":"PARTIAL"}'::jsonb, '1', '36d97ccf8e9bbcbe36b26992171ac217fd4b029c86233637b95bfd41b0e49a4f')
on conflict (policy_type, version) do nothing;
insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
values ('COVERAGE', 'coverage-contract-v1', '{"required_axes":["PRODUCT_INSTITUTION","FRAUD_CHANNEL","REGULATION_DISPUTE"],"optional_axes":["SALES_CONDUCT"],"material_claims_must_be_addressed":true}'::jsonb, '1', 'd04cbd30519c27bfb81756fc170a58ba87ed620ae7b1c8af8571ab2bd9b1e376')
on conflict (policy_type, version) do nothing;
insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
values ('PROFILE', 'profile-policy-v1', '{"skip_suspends_axes":["SUITABILITY"],"snapshot_at":"RUN_START"}'::jsonb, '1', 'a677d6a9d4182a0e4b937f36f274d8e18abbc90d28555174a3eac643743b661f')
on conflict (policy_type, version) do nothing;
insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
values ('PII', 'pii-policy-v1', '{"model_input":"masked_only","gate":"non_model","external_ocr_requires_consent":true}'::jsonb, '1', 'b3c875a9605b01ec8f867b0189274b64f24f8bf22b3961533342ac65be29acca')
on conflict (policy_type, version) do nothing;

insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('search_financial_product', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 262144,
        20, 20000, 1, '7127486e5a41b4afee02795170a5adf42b6e3324656986629ff37de590f1bd3c')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('verify_financial_institution', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 262144,
        20, 20000, 1, '2e431034296bda98203f0cce204d1d383ce8badf1d03cee4e0391980d3fe8c2f')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('get_source_snapshot', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 1048576,
        10, 20000, 1, 'f0b788bb0792ff5513ee7cccd4b3cc1c97cdade5937ebcc035e3e43d35846ac4')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('parse_url_host', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 8192,
        20, 2000, 0, '5a4e58de9d526bd9e5319089d4258b5d6d4b01689c0a43faa97a8f763939617f')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('lookup_official_channel', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 262144,
        20, 20000, 1, '734d9dfe083e6e42890043b0279267356016350da7a5d041f0994f7633e9a5ee')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('search_consumer_warning', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 524288,
        20, 20000, 1, '4ee9b8dd905e4686bc5544ace1c8eb51ed0c42b2258704260b6644f05c158753')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('analyze_risk_pattern', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 262144,
        20, 20000, 1, 'faf974221049b25657db9ef37369db51e56435cc784ff87ca54cdea594f585d0')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('check_documents', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 262144,
        20, 20000, 1, 'b841f6f7ddf7c1c0c743d9f05e52e0adf161fbd4b23c8d40e77dcbe8bad4ef88')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('lookup_statute', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 524288,
        10, 20000, 1, '287ff6737e4fe51bc8af0f2721c44bd80c73e84018ae2e33ee67b86d66b7eef6')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('search_precedent', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 524288,
        20, 20000, 1, '81acdd7ea041d47b8e79d4c1dfc1a83c271f89b34428ebdbecee2cd705be9543')
on conflict (tool_code, version) do nothing;
insert into private.tool_definitions
  (tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('search_dispute_case', 'p0-v1', 'FUNCTION'::public.tool_transport,
        'in-v1', 'out-v1', 524288,
        20, 20000, 1, 'db0e6497f7a47c2e95545881d7c6a83a6464e8634981e1c9a8554edc75c4ec15')
on conflict (tool_code, version) do nothing;

insert into private.agent_definitions
  (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
values ('PRODUCT_INSTITUTION', 'p0-v1', 'in-v1', 'out-v1',
        'product-institution-v1', 'DOMAIN', '7bd19bfe89e143ee726a679b8b27cf718858cf4629f2995d84bfbcd7d5cb9141')
on conflict (agent_code, version) do nothing;
insert into private.agent_definitions
  (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
values ('FRAUD_CHANNEL', 'p0-v1', 'in-v1', 'out-v1',
        'fraud-channel-v1', 'DOMAIN', 'c1e9a3b87da6ce77e6b0cbcbbdcfb98d44a5cdfa725b9afaa8818e2187d9ce28')
on conflict (agent_code, version) do nothing;
insert into private.agent_definitions
  (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
values ('SALES_CONDUCT', 'p0-v1', 'in-v1', 'out-v1',
        'sales-conduct-v1', 'DOMAIN', '227254504c346398a13becef98556ec3b89ce720ac44c84dfafc3d58bfaadecf')
on conflict (agent_code, version) do nothing;
insert into private.agent_definitions
  (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
values ('REGULATION_DISPUTE', 'p0-v1', 'in-v1', 'out-v1',
        'regulation-dispute-v1', 'DOMAIN', '5a3bf90dbccb6adf3de417f69136f1c1dd6223f8c3a59f359b9724f50b11bcca')
on conflict (agent_code, version) do nothing;
insert into private.agent_definitions
  (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
values ('EVIDENCE_JUDGE', 'p0-v1', 'in-v1', 'out-v1',
        'evidence-judge-v1', 'EVIDENCE_JUDGE', '38541922e21b9f9c4c85db27a9f64561b4e253de277ec02c30e6fd35a1bbc146')
on conflict (agent_code, version) do nothing;

insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'VERIFY_PRODUCT'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'PRODUCT_INSTITUTION' and ad.version = 'p0-v1'
   and td.tool_code = 'search_financial_product' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'VERIFY_INSTITUTION'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'PRODUCT_INSTITUTION' and ad.version = 'p0-v1'
   and td.tool_code = 'verify_financial_institution' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'READ_SNAPSHOT'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'PRODUCT_INSTITUTION' and ad.version = 'p0-v1'
   and td.tool_code = 'get_source_snapshot' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'PARSE_URL'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'FRAUD_CHANNEL' and ad.version = 'p0-v1'
   and td.tool_code = 'parse_url_host' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'VERIFY_CHANNEL'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'FRAUD_CHANNEL' and ad.version = 'p0-v1'
   and td.tool_code = 'lookup_official_channel' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'FIND_WARNING'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'FRAUD_CHANNEL' and ad.version = 'p0-v1'
   and td.tool_code = 'search_consumer_warning' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'ASSESS_CONDUCT'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'SALES_CONDUCT' and ad.version = 'p0-v1'
   and td.tool_code = 'analyze_risk_pattern' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'CHECK_DOCUMENTS'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'SALES_CONDUCT' and ad.version = 'p0-v1'
   and td.tool_code = 'check_documents' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'LOOKUP_STATUTE'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'REGULATION_DISPUTE' and ad.version = 'p0-v1'
   and td.tool_code = 'lookup_statute' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'SEARCH_PRECEDENT'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'REGULATION_DISPUTE' and ad.version = 'p0-v1'
   and td.tool_code = 'search_precedent' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
select ad.id, td.id, 'SEARCH_DISPUTE'
  from private.agent_definitions ad, private.tool_definitions td
 where ad.agent_code = 'REGULATION_DISPUTE' and ad.version = 'p0-v1'
   and td.tool_code = 'search_dispute_case' and td.version = 'p0-v1'
on conflict do nothing;

insert into private.execution_manifests
  (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version, schema_bundle_version,
   evidence_policy_version, result_matrix_version, coverage_contract_version, profile_policy_version,
   pii_policy_version, kb_release_id, config_hash)
select 'finshield-p0-loan-v1', 'LOAN'::public.case_scenario, 'sunshine15-v1',
       '{"schema_version":"1","judgment_model":"claude-opus-5","domain_model":"claude-opus-5"}'::jsonb, 'p0-loan-prompts-v1', 'p0-loan-schemas-v1',
       'evidence-policy-v1', 'result-matrix-v1', 'coverage-contract-v1',
       'profile-policy-v1', 'pii-policy-v1', r.id, '1b000ebb2ac5f29992221ce5fb78ffe3de0fda547ef4850a6cf78f780df669eb'
  from kb.kb_releases r where r.version = 'p0-loan-corpus-v1'
on conflict (manifest_version) do nothing;

insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select m.id, ad.id, 'PRODUCT_INSTITUTION', true
  from private.execution_manifests m, private.agent_definitions ad
 where m.manifest_version = 'finshield-p0-loan-v1' and ad.agent_code = 'PRODUCT_INSTITUTION' and ad.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'VERIFY_PRODUCT', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'search_financial_product' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'VERIFY_INSTITUTION', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'verify_financial_institution' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'READ_SNAPSHOT', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'get_source_snapshot' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select m.id, ad.id, 'FRAUD_CHANNEL', true
  from private.execution_manifests m, private.agent_definitions ad
 where m.manifest_version = 'finshield-p0-loan-v1' and ad.agent_code = 'FRAUD_CHANNEL' and ad.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'PARSE_URL', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'parse_url_host' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'VERIFY_CHANNEL', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'lookup_official_channel' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'FIND_WARNING', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'search_consumer_warning' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select m.id, ad.id, 'SALES_CONDUCT', true
  from private.execution_manifests m, private.agent_definitions ad
 where m.manifest_version = 'finshield-p0-loan-v1' and ad.agent_code = 'SALES_CONDUCT' and ad.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'ASSESS_CONDUCT', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'analyze_risk_pattern' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'CHECK_DOCUMENTS', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'check_documents' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select m.id, ad.id, 'REGULATION_DISPUTE', true
  from private.execution_manifests m, private.agent_definitions ad
 where m.manifest_version = 'finshield-p0-loan-v1' and ad.agent_code = 'REGULATION_DISPUTE' and ad.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'LOOKUP_STATUTE', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'lookup_statute' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'SEARCH_PRECEDENT', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'search_precedent' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select m.id, td.id, 'SEARCH_DISPUTE', false
  from private.execution_manifests m, private.tool_definitions td
 where m.manifest_version = 'finshield-p0-loan-v1' and td.tool_code = 'search_dispute_case' and td.version = 'p0-v1'
on conflict do nothing;
insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select m.id, ad.id, 'EVIDENCE_JUDGE', true
  from private.execution_manifests m, private.agent_definitions ad
 where m.manifest_version = 'finshield-p0-loan-v1' and ad.agent_code = 'EVIDENCE_JUDGE' and ad.version = 'p0-v1'
on conflict do nothing;
