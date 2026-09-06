begin;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'PRODUCT' and official_id is not distinct from 'data.go.kr:15094787:햇살론15:202602:1'
     and source_version is not distinct from '202602' and content_hash = 'f36b3ae850b677cbffb32ae7f6bc575894561df0d0e567c96299601b2b7c8305'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'PRODUCT', 'A', '금융위원회', '햇살론15 (1, 기준 202602)', 'https://www.data.go.kr/data/15094787/openapi.do', 'data.go.kr:15094787:햇살론15:202602:1', '2026-02-01'::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, '202602', 'f36b3ae850b677cbffb32ae7f6bc575894561df0d0e567c96299601b2b7c8305', 'e140c20a0e6e35fb1aa8209ceeb12c6b676d1c70ae1a891c3e0a29ad91be05fd', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15094787/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_fsc_small_loan', 'data.go.kr:15094787:햇살론15:202602:1',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:1:140229acbd36'
     and source_version is not distinct from null and content_hash = '61c24bf6cca6361250bd10572a456613d0fb53fc94d7ec12f576d1340da54e08'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '국민은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:1:140229acbd36', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '61c24bf6cca6361250bd10572a456613d0fb53fc94d7ec12f576d1340da54e08', '4eb98191232419941f18287cd7521c78287dc8756c4d93c8e402a6c756dcce01', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:1:140229acbd36',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:2:a860cee373e6'
     and source_version is not distinct from null and content_hash = '18baba2c3012f2805af76e23522711f103441616c6693aeca1f0c064db55eec8'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '기업은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:2:a860cee373e6', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '18baba2c3012f2805af76e23522711f103441616c6693aeca1f0c064db55eec8', '1e55244667285d346ba79f97cf66d6113e4dd3e026a34e8971be42827e35f2d3', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:2:a860cee373e6',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:3:50b6b106eaab'
     and source_version is not distinct from null and content_hash = '6bed085cb1555b627e4ad45d3b3a2b78bc730687426e617ffee490d47e6324bb'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '하나은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:3:50b6b106eaab', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '6bed085cb1555b627e4ad45d3b3a2b78bc730687426e617ffee490d47e6324bb', '34c171c3a5dd10c16f95ac8199f26602f8cf04dc758a5cbf630071702659ad8b', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:3:50b6b106eaab',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:4:c19f50cd97f2'
     and source_version is not distinct from null and content_hash = '46888815fac2183dddd9cdab586f1f845057de7d4f8d79370a14e8e027fc41f8'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '경남은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:4:c19f50cd97f2', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '46888815fac2183dddd9cdab586f1f845057de7d4f8d79370a14e8e027fc41f8', '588d7f5446098c2336f9bbfa5960be6609c4c16d828941943e733c18225e4a22', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:4:c19f50cd97f2',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:5:49a1e09a9096'
     and source_version is not distinct from null and content_hash = '79ffb14b4044fe5606118817f76039fb65a0d59991aad593f47e891d4c83c85d'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '광주은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:5:49a1e09a9096', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '79ffb14b4044fe5606118817f76039fb65a0d59991aad593f47e891d4c83c85d', '88376260ec410822f88d0c5f92476c31cb3d0a4b5d560511d2cba0e9f4b8ffcc', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:5:49a1e09a9096',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:6:55f77ddfa163'
     and source_version is not distinct from null and content_hash = '4f50318d96e0369af525eb0bd108292bddfe955ab63001ecf3f9b4dc8b453ef0'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '농협은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:6:55f77ddfa163', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '4f50318d96e0369af525eb0bd108292bddfe955ab63001ecf3f9b4dc8b453ef0', 'e65a04a3288a2c06e0585bead428a6bef037f21354bc59fbbd284288e26a6daa', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:6:55f77ddfa163',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:7:b7907f5ae223'
     and source_version is not distinct from null and content_hash = '1c9072f2557cbbc304eb341a405074fd1bbdf429aa1fe9b960f34278689da267'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '대구은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:7:b7907f5ae223', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '1c9072f2557cbbc304eb341a405074fd1bbdf429aa1fe9b960f34278689da267', 'a20d910a9d744785d01b589109ce9440b7bc337b83357f354998b439152c9e76', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:7:b7907f5ae223',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:8:52ab328a3911'
     and source_version is not distinct from null and content_hash = '125ee20d763ede712893a630a4111b74bb1b1e37a3e8b6eaefeebdbc5113c035'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '부산은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:8:52ab328a3911', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '125ee20d763ede712893a630a4111b74bb1b1e37a3e8b6eaefeebdbc5113c035', '7d47feba25d4f906a5d398df1a4fff67980f01db34e786c37cfbdd6ac694d85d', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:8:52ab328a3911',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:9:aa265f9b9aa5'
     and source_version is not distinct from null and content_hash = 'ee65bd86a934f4f0969ca7e61e8dca559c91ebd846595f2b12e5a6da791b5c37'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '수협은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:9:aa265f9b9aa5', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, 'ee65bd86a934f4f0969ca7e61e8dca559c91ebd846595f2b12e5a6da791b5c37', '784140331e3047e4c3d50e6bad330e0aa7cf53d3376c8e93af69052e0947e1bb', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:9:aa265f9b9aa5',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:10:664bb1cb8c07'
     and source_version is not distinct from null and content_hash = 'a983758a4bd2c3a0ae31331d51abbbca3a14495955cd6fa217c654a9b8b2ecae'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '신한은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:10:664bb1cb8c07', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, 'a983758a4bd2c3a0ae31331d51abbbca3a14495955cd6fa217c654a9b8b2ecae', 'e7a4c21c6d76740e656e91d2ca911c0b68318e4b95a87c2a3296371f3fa4a027', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:10:664bb1cb8c07',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:11:392538c7e03b'
     and source_version is not distinct from null and content_hash = 'dc4e393a34547443719836ec86eddd1ad722889a658fc8a86998c2f40104c988'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '우리은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:11:392538c7e03b', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, 'dc4e393a34547443719836ec86eddd1ad722889a658fc8a86998c2f40104c988', '2006ef23417f738fd4bd40688d2b9fc0f9f181bd69087605609d29c290df8890', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:11:392538c7e03b',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:12:3b33518ce05c'
     and source_version is not distinct from null and content_hash = 'ed344f42204eda21942a59788413491469b6640ce714f846fef6e1c44013a327'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '전북은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:12:3b33518ce05c', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, 'ed344f42204eda21942a59788413491469b6640ce714f846fef6e1c44013a327', 'b1ee3a8369ef43c638763788d3d3e122444434c71cac351b7522b4b282e9c652', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:12:3b33518ce05c',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:13:685b493e75e3'
     and source_version is not distinct from null and content_hash = '1d1c05a15ca3c702d4b3db7a62476a66e97c1ca22266d46578bde5c194236adf'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '제주은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:13:685b493e75e3', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '1d1c05a15ca3c702d4b3db7a62476a66e97c1ca22266d46578bde5c194236adf', '9aa5d7bdf6878610eec2500dbc235330441770d3c24b6ae986896c3472f46c09', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:13:685b493e75e3',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:14:984cb6310416'
     and source_version is not distinct from null and content_hash = 'cc1464a29a766062b154e8d426ec0e5200b9b4fef4090811fcc3a3f60c5bb8b9'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '씨티은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:14:984cb6310416', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, 'cc1464a29a766062b154e8d426ec0e5200b9b4fef4090811fcc3a3f60c5bb8b9', '2bda21e995930d1284a603def9a0f8d85fb689c5ad7b73b2c2ffb4a5a4ec18fc', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:14:984cb6310416',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:15:d6cd2d7c07b4'
     and source_version is not distinct from null and content_hash = '55a1047a5a9b32ebe53be2ae0e8eef3d02d228667ad475d018d08c329575ccf2'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', 'SC제일은행 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:15:d6cd2d7c07b4', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '55a1047a5a9b32ebe53be2ae0e8eef3d02d228667ad475d018d08c329575ccf2', '69d87ec4872b62863e5cee2dfe7e7f9f50fa4ef561da71996b64b66f8a1997d6', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:15:d6cd2d7c07b4',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'INSTITUTION' and official_id is not distinct from 'data.go.kr:15074508:16:530320937b92'
     and source_version is not distinct from null and content_hash = '944248cd5631ada32a7cd7a48f0ac1989fc88d619f95ff8e627a629e833959dc'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'INSTITUTION', 'A', '서민금융진흥원', '카카오뱅크 햇살론15 취급기관', 'https://www.data.go.kr/data/15074508/openapi.do', 'data.go.kr:15074508:16:530320937b92', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, null, '944248cd5631ada32a7cd7a48f0ac1989fc88d619f95ff8e627a629e833959dc', 'd80069a0e226517c1a4c4eeed3844aeea35996720d41f50df655da1dfc360ca6', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.data.go.kr/data/15074508/openapi.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'data_go_kr_kinfa_handling_agency', 'data.go.kr:15074508:16:530320937b92',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'GUIDE' and official_id is not distinct from 'kinfa:hessalLoan'
     and source_version is not distinct from '2026-09-05' and content_hash = '662082e600e11650dd4db148c2d28f0fff56a9b47a7b3fb05983256f3cd9a838'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'GUIDE', 'A', '서민금융진흥원', '햇살론15 공식 상품 안내 (서민금융진흥원)', 'https://www.kinfa.or.kr/financialProduct/hessalLoan.do', 'kinfa:hessalLoan', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05', '662082e600e11650dd4db148c2d28f0fff56a9b47a7b3fb05983256f3cd9a838', '9a5716c2a1db73da43583764781c3e11710718265ff1e2ee0cdbfffc6ac717f5', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.kinfa.or.kr/financialProduct/hessalLoan.do', false, false
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'kinfa_official_page', 'kinfa:hessalLoan:2026-09-05',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

with existing as (
  select id from kb.source_snapshots
   where source_type = 'GUIDE' and official_id is not distinct from 'kinfa:declare-center'
     and source_version is not distinct from '2026-09-05' and content_hash = '0b7ff634837f01e9df7a760bd8ca72e6cc4cf80f9a205354ae686fb3e029d1b2'
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select 'GUIDE', 'A', '서민금융진흥원', '서민금융 사칭 신고센터 (서민금융진흥원)', 'https://www.kinfa.or.kr/cyber/customerServiceCenter/customerDeclareCenter.do', 'kinfa:declare-center', null::timestamptz,
         '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05', '0b7ff634837f01e9df7a760bd8ca72e6cc4cf80f9a205354ae686fb3e029d1b2', '2b0d6b89aac64065b806af64d5d2c87ea3da5b5a33192e3bfebbeb853cd2a648', 'FRESH',
         '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours',
         'DATA_GO_KR_NO_RESTRICTION', 'https://www.kinfa.or.kr/cyber/customerServiceCenter/customerDeclareCenter.do', true, true
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), 'kinfa_official_page', 'kinfa:declare-center:2026-09-05',
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       '2026-09-05T17:30:50.912Z'::timestamptz, '2026-09-05T17:30:50.912Z'::timestamptz + interval '24 hours'
on conflict (source_adapter, request_key) do nothing;

insert into kb.official_channel_registry (institution_code, channel_type, normalized_value, display_value, source_snapshot_id, valid_from)
select 'INST_KINFA', 'PHONE', '1397', '서민금융콜센터 1397 (국번 없이)', (select id from kb.source_snapshots where source_type = 'GUIDE' and official_id = 'kinfa:declare-center' order by retrieved_at desc limit 1), '2026-09-05'::date
 where exists (select 1 from kb.source_snapshots where source_type = 'GUIDE' and official_id = 'kinfa:declare-center' order by retrieved_at desc limit 1)
on conflict (institution_code, channel_type, normalized_value, valid_from) do nothing;
insert into kb.official_channel_registry (institution_code, channel_type, normalized_value, display_value, source_snapshot_id, valid_from)
select 'INST_KINFA', 'REPORTING', 'https://www.kinfa.or.kr/cyber/customerServiceCenter/customerDeclareCenter.do', '서민금융 사칭 신고센터', (select id from kb.source_snapshots where source_type = 'GUIDE' and official_id = 'kinfa:declare-center' order by retrieved_at desc limit 1), '2026-09-05'::date
 where exists (select 1 from kb.source_snapshots where source_type = 'GUIDE' and official_id = 'kinfa:declare-center' order by retrieved_at desc limit 1)
on conflict (institution_code, channel_type, normalized_value, valid_from) do nothing;
commit;
