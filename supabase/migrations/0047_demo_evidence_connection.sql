-- B-DEMO-01·AI-006·EV-009: 공개 Live Demo가 승인된 공식 자료의 본문을 실제로 조회한다.
-- 원본 API 응답은 main의 B-SOURCE-03 run 34156392378에서 다시 확인했다.
-- 기존 Snapshot·Release·Manifest는 수정하지 않고 새 Release와 Manifest를 추가한다.

insert into kb.source_snapshots
  (source_type, authority_level, publisher_name, source_title, canonical_url, official_id,
   published_at, retrieved_at, source_version, content_hash, source_fingerprint,
   freshness_status, fresh_until, license_code, license_url, is_complete, is_citable)
values
  ('PRODUCT', 'A', '금융위원회', '햇살론15 (1, 기준 202602)',
   'https://www.data.go.kr/data/15094787/openapi.do',
   'data.go.kr:15094787:햇살론15:202602:1', '2026-02-01T00:00:00Z',
   '2026-09-07T19:39:47.125Z', '202602',
   'f36b3ae850b677cbffb32ae7f6bc575894561df0d0e567c96299601b2b7c8305',
   'e140c20a0e6e35fb1aa8209ceeb12c6b676d1c70ae1a891c3e0a29ad91be05fd',
   'FRESH', '2026-09-08T19:39:47.125Z', 'DATA_GO_KR_NO_RESTRICTION',
   'https://www.data.go.kr/data/15094787/openapi.do', true, true),
  ('GUIDE', 'A', '서민금융진흥원', '서민금융 사칭 신고센터 (서민금융진흥원)',
   'https://www.kinfa.or.kr/cyber/customerServiceCenter/customerDeclareCenter.do',
   'kinfa:declare-center', null, '2026-09-07T19:39:47.125Z', '2026-09-05',
   '0b7ff634837f01e9df7a760bd8ca72e6cc4cf80f9a205354ae686fb3e029d1b2',
   '2b0d6b89aac64065b806af64d5d2c87ea3da5b5a33192e3bfebbeb853cd2a648',
   'FRESH', '2026-09-08T19:39:47.125Z', 'DATA_GO_KR_NO_RESTRICTION',
   'https://www.kinfa.or.kr/cyber/customerServiceCenter/customerDeclareCenter.do', true, true)
on conflict (source_type, official_id, source_version, content_hash) do nothing;

-- 같은 레코드의 재조회도 새 사건이다. 조회 시각을 request_key에 넣어 이전
-- CHANGED 사건과 충돌하지 않게 하고, 원문이 같았다는 사실을 UNCHANGED로 남긴다.
insert into kb.source_fetch_events
  (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select id, 'data_go_kr_fsc_small_loan',
       'data.go.kr:15094787:햇살론15:202602:1:2026-09-07T19:39:47.125Z',
       'UNCHANGED', 'FRESH', '2026-09-07T19:39:47.125Z', '2026-09-08T19:39:47.125Z'
  from kb.source_snapshots
 where source_type='PRODUCT' and official_id='data.go.kr:15094787:햇살론15:202602:1'
   and source_version='202602'
   and content_hash='f36b3ae850b677cbffb32ae7f6bc575894561df0d0e567c96299601b2b7c8305'
on conflict (source_adapter, request_key) do nothing;

insert into kb.source_fetch_events
  (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select id, 'kinfa_official_page', 'kinfa:declare-center:2026-09-07',
       'UNCHANGED', 'FRESH', '2026-09-07T19:39:47.125Z', '2026-09-08T19:39:47.125Z'
  from kb.source_snapshots
 where source_type='GUIDE' and official_id='kinfa:declare-center'
   and source_version='2026-09-05'
   and content_hash='0b7ff634837f01e9df7a760bd8ca72e6cc4cf80f9a205354ae686fb3e029d1b2'
on conflict (source_adapter, request_key) do nothing;

insert into kb.kb_releases
  (version, corpus_scope, document_count, chunk_count, manifest_hash)
values
  ('p0-judge-demo-corpus-v1',
   '{"schema_version":"1","scenario":"LOAN","scenario_version":"sunshine15-v1","document_types":["PRODUCT","GUIDE"],"source_evidence_run":34156392378,"retrieval_gate_adopted":false}'::jsonb,
   2, 2, '5c94d99eeb0cc216e3b832c6ba941267af24d23d437c62767a83b448e946a767')
on conflict (version) do nothing;

insert into kb.kb_release_sources (kb_release_id, source_snapshot_id, purpose_code)
select r.id, s.id,
       case when s.source_type='PRODUCT' then 'PRODUCT_BASELINE' else 'IMPERSONATION_BASELINE' end
  from kb.kb_releases r
  join kb.source_snapshots s on
       (s.source_type='PRODUCT' and s.official_id='data.go.kr:15094787:햇살론15:202602:1'
        and s.source_version='202602'
        and s.content_hash='f36b3ae850b677cbffb32ae7f6bc575894561df0d0e567c96299601b2b7c8305')
    or (s.source_type='GUIDE' and s.official_id='kinfa:declare-center'
        and s.source_version='2026-09-05'
        and s.content_hash='0b7ff634837f01e9df7a760bd8ca72e6cc4cf80f9a205354ae686fb3e029d1b2')
 where r.version='p0-judge-demo-corpus-v1'
on conflict do nothing;

insert into kb.knowledge_documents
  (kb_release_id, source_snapshot_id, document_key, document_version, document_type,
   title, publisher, scenario_codes, product_codes, institution_codes, channel_codes,
   valid_from, source_url, ingested_at, content_hash, normalization_version)
select r.id, s.id, 'data-go-kr-hessal15-202602', '202602', 'PRODUCT',
       s.source_title, s.publisher_name, array['LOAN'], array['HESSAL15'], array['INST_KINFA'],
       array[]::text[], '2026-02-01', s.canonical_url, '2026-09-07T19:39:47.125Z',
       '225a4b751827cb99ff76760b7e9fafac61440d4fb8a39708cc5a28d566629db4',
       'public-record-fields-v1'
  from kb.kb_releases r
  join kb.source_snapshots s on s.source_type='PRODUCT'
   and s.official_id='data.go.kr:15094787:햇살론15:202602:1'
   and s.source_version='202602'
   and s.content_hash='f36b3ae850b677cbffb32ae7f6bc575894561df0d0e567c96299601b2b7c8305'
 where r.version='p0-judge-demo-corpus-v1'
on conflict (kb_release_id, document_key, document_version) do nothing;

insert into kb.knowledge_documents
  (kb_release_id, source_snapshot_id, document_key, document_version, document_type,
   title, publisher, scenario_codes, product_codes, institution_codes, channel_codes,
   valid_from, source_url, ingested_at, content_hash, normalization_version)
select r.id, s.id, 'kinfa-impersonation-guide', '2026-09-05', 'GUIDE',
       s.source_title, s.publisher_name, array['LOAN'], array['HESSAL15'], array['INST_KINFA'],
       array['SMS','URL','APP'], '2026-09-05', s.canonical_url, '2026-09-07T19:39:47.125Z',
       'aa6330036f7e0b9edaecbd568ffe45ee99676a46b6e1b677ee9153f431f88921',
       'official-page-section-v1'
  from kb.kb_releases r
  join kb.source_snapshots s on s.source_type='GUIDE' and s.official_id='kinfa:declare-center'
   and s.source_version='2026-09-05'
   and s.content_hash='0b7ff634837f01e9df7a760bd8ca72e6cc4cf80f9a205354ae686fb3e029d1b2'
 where r.version='p0-judge-demo-corpus-v1'
on conflict (kb_release_id, document_key, document_version) do nothing;

insert into kb.knowledge_chunks
  (kb_release_id, knowledge_document_id, chunk_no, chunk_text, source_locator, metadata,
   token_count, content_hash)
select d.kb_release_id, d.id, 1,
       '햇살론15. 기준년월 202602. 대출한도 2000만원. 금리구분 고정금리. 대출금리 15.9%. 최대 대출기간 3년 또는 5년. 상환방법 원리금균등분할상환. 대상 근로자, 사업자, 연금소득자 등. 제공기관 서민금융진흥원. 중도상환수수료 없음. 취급기관 서민금융통합지원센터 47개 및 대출협약은행 12개. 가입방법 1397 사전상담, 서민금융진흥원 및 은행 모바일 앱, 은행 지점 및 서민금융통합지원센터 방문. 상품 존재 여부 Y. 관리기한 상시.',
       '{"schema_version":"1","kind":"data_go_kr_record","official_id":"data.go.kr:15094787:햇살론15:202602:1","field_scope":["basYm","finPrdNm","lnLmt","irtCtg","irt","maxTotLnTrm","rdptMthd","trgt","ofrInstNm","jnMthd","rpymdCfe","hdlInst","prdExisYn","mgmDln"]}'::jsonb,
       '{"schema_version":"1","current_transaction_proof":false,"source_evidence_run":34156392378}'::jsonb,
       120, '225a4b751827cb99ff76760b7e9fafac61440d4fb8a39708cc5a28d566629db4'
  from kb.knowledge_documents d join kb.kb_releases r on r.id=d.kb_release_id
 where r.version='p0-judge-demo-corpus-v1' and d.document_key='data-go-kr-hessal15-202602'
on conflict (knowledge_document_id, chunk_no) do nothing;

insert into kb.knowledge_chunks
  (kb_release_id, knowledge_document_id, chunk_no, chunk_text, source_locator, metadata,
   token_count, content_hash)
select d.kb_release_id, d.id, 1,
       '사칭유형: 서민금융진흥원·서민금융통합지원센터, 미소금융·햇살론 등 서민금융지원제도 명칭·로고를 사칭한 SNS 채널 및 불법광고. 서민금융 지원제도 관련 불법 전화 영업 및 문자 메시지 발송. 서민금융 사칭 애플리케이션. 피해 시 금융감독원 불법사금융 피해 신고센터 또는 금융감독원 콜센터 1332로 신고.',
       '{"schema_version":"1","kind":"html_section","section":"사칭유형 및 유의사항","official_id":"kinfa:declare-center"}'::jsonb,
       '{"schema_version":"1","current_transaction_proof":false,"source_evidence_run":34156392378}'::jsonb,
       85, 'aa6330036f7e0b9edaecbd568ffe45ee99676a46b6e1b677ee9153f431f88921'
  from kb.knowledge_documents d join kb.kb_releases r on r.id=d.kb_release_id
 where r.version='p0-judge-demo-corpus-v1' and d.document_key='kinfa-impersonation-guide'
on conflict (knowledge_document_id, chunk_no) do nothing;

insert into kb.kb_release_events (kb_release_id, event_type, reason_code)
select id, 'PUBLISHED', 'JUDGE_DEMO_CURATED_SCOPE'
  from kb.kb_releases r
 where r.version='p0-judge-demo-corpus-v1'
   and not exists(select 1 from kb.kb_release_events e where e.kb_release_id=r.id and e.event_type='PUBLISHED')
on conflict do nothing;

insert into private.execution_manifests
  (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version,
   schema_bundle_version, evidence_policy_version, result_matrix_version,
   coverage_contract_version, profile_policy_version, pii_policy_version, kb_release_id,
   embedding_model, embedding_dimension, config_hash)
select 'finshield-p0-loan-v4', m.scenario, m.scenario_version, m.model_bundle,
       m.prompt_bundle_version, m.schema_bundle_version, m.evidence_policy_version,
       m.result_matrix_version, m.coverage_contract_version, m.profile_policy_version,
       m.pii_policy_version, r.id, null, null,
       encode(extensions.digest(m.config_hash||':'||r.manifest_hash,'sha256'),'hex')
  from private.execution_manifests m
  join kb.kb_releases r on r.version='p0-judge-demo-corpus-v1'
 where m.manifest_version='finshield-p0-loan-v3'
on conflict (manifest_version) do nothing;

insert into private.execution_manifest_agents
  (execution_manifest_id, agent_definition_id, logical_agent_key, required)
select n.id, a.agent_definition_id, a.logical_agent_key, a.required
  from private.execution_manifest_agents a
  join private.execution_manifests m on m.id=a.execution_manifest_id
   and m.manifest_version='finshield-p0-loan-v3'
  cross join private.execution_manifests n
 where n.manifest_version='finshield-p0-loan-v4'
on conflict do nothing;

insert into private.execution_manifest_tools
  (execution_manifest_id, tool_definition_id, purpose_code, required)
select n.id, t.tool_definition_id, t.purpose_code, t.required
  from private.execution_manifest_tools t
  join private.execution_manifests m on m.id=t.execution_manifest_id
   and m.manifest_version='finshield-p0-loan-v3'
  cross join private.execution_manifests n
 where n.manifest_version='finshield-p0-loan-v4'
on conflict do nothing;
