-- ============================================================
-- 0007 공용 KB 불변식 시험 (명세 6.5, 6.8, 7.1, 9.2)
-- ============================================================

\echo '16. source_snapshots, source_fetch_events'
insert into kb.source_snapshots
  (id, source_type, authority_level, publisher_name, source_title, official_id, law_name, article_no,
   retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, is_complete, is_citable)
values ('00000000-0000-4000-8000-00000000c001', 'LAW', 'A', '법제처', '금융소비자 보호에 관한 법률',
        'LAW-001', '금융소비자 보호에 관한 법률', '제19조', now(), '20260101', repeat('a', 64), repeat('b', 64),
        'FRESH', true, true);

select fstest.expect_fail($sql$
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, official_id, law_name, article_no,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, is_complete, is_citable)
  values ('LAW', 'A', '법제처', '금융소비자 보호에 관한 법률', 'LAW-001', '금융소비자 보호에 관한 법률', '제19조',
          now(), '20260101', repeat('a', 64), repeat('b', 64), 'FRESH', true, true)
$sql$, '같은 유형·식별자·버전·내용의 Snapshot 중복');

select fstest.expect_fail($sql$
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, retrieved_at, content_hash,
     source_fingerprint, freshness_status, is_complete, is_citable)
  values ('LAW', 'A', '법제처', '조문 없는 법령', now(), repeat('c', 64), repeat('c', 64), 'FRESH', true, true)
$sql$, '법령 Snapshot 에 법령명·조문 없음');

select fstest.expect_fail($sql$
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, retrieved_at, content_hash,
     source_fingerprint, freshness_status, is_complete, is_citable)
  values ('PRODUCT', 'B', '합성은행', '불완전 상품 안내', now(), repeat('d', 64), repeat('d', 64), 'FRESH', false, true)
$sql$, '본문 불완전한데 인용 가능 표시');

select fstest.expect_fail($sql$
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, retrieved_at, content_hash,
     source_fingerprint, freshness_status, is_complete, is_citable)
  values ('BLOG', 'D', '개인', '블로그 글', now(), repeat('e', 64), repeat('e', 64), 'UNKNOWN', true, false)
$sql$, '열거하지 않은 source_type');

-- null 도 같은 값으로 본다 (nulls not distinct)
insert into kb.source_snapshots
  (source_type, authority_level, publisher_name, source_title, retrieved_at, content_hash,
   source_fingerprint, freshness_status, is_complete, is_citable)
values ('GUIDE', 'C', '금융감독원', '소비자 안내', now(), repeat('f', 64), repeat('f', 64), 'FRESH', true, true);
select fstest.expect_fail($sql$
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, retrieved_at, content_hash,
     source_fingerprint, freshness_status, is_complete, is_citable)
  values ('GUIDE', 'C', '금융감독원', '소비자 안내', now(), repeat('f', 64), repeat('f', 64), 'FRESH', true, true)
$sql$, 'official_id·version 이 null 인 동일 내용 중복');

select fstest.expect_fail($sql$
  update kb.source_snapshots set is_citable = false
   where id = '00000000-0000-4000-8000-00000000c001'
$sql$, 'Snapshot UPDATE');

select fstest.expect_ok($sql$
  insert into kb.source_fetch_events
    (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at)
  values ('00000000-0000-4000-8000-00000000c001', 'law_api', 'LAW-001/20260101', 'UNCHANGED', 'FRESH', now())
$sql$, '같은 내용 재조회 사건');

select fstest.expect_fail($sql$
  insert into kb.source_fetch_events
    (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at)
  values ('00000000-0000-4000-8000-00000000c001', 'law_api', 'LAW-001/20260101', 'UNCHANGED', 'FRESH', now())
$sql$, '같은 adapter·request_key 중복');

select fstest.expect_fail($sql$
  insert into kb.source_fetch_events
    (source_adapter, request_key, outcome, freshness_status, retrieved_at)
  values ('law_api', 'LAW-999/latest', 'CHANGED', 'FRESH', now())
$sql$, 'CHANGED 인데 Snapshot 없음');

select fstest.expect_fail($sql$
  insert into kb.source_fetch_events
    (source_adapter, request_key, outcome, freshness_status)
  values ('law_api', 'LAW-998/latest', 'FAILED', 'UNKNOWN')
$sql$, 'FAILED 인데 error_code 없음');

select fstest.expect_ok($sql$
  insert into kb.source_fetch_events
    (source_adapter, request_key, outcome, freshness_status, error_code)
  values ('law_api', 'LAW-998/latest', 'FAILED', 'UNKNOWN', 'HTTP_503')
$sql$, '과거 Snapshot 없는 실패 사건');

\echo '17. kb_releases, documents, chunks'
insert into kb.kb_releases
  (id, version, corpus_scope, embedding_model, embedding_model_version, embedding_dimension,
   distance_metric, document_count, chunk_count, manifest_hash)
values ('00000000-0000-4000-8000-00000000d001', 'r1', '{"schema_version":"1","scenario":"LOAN"}'::jsonb,
        'embed-v4.0', '2026-09', 1024, 'COSINE', 1, 1, repeat('1', 64)),
       ('00000000-0000-4000-8000-00000000d002', 'r2', '{"schema_version":"1","scenario":"LOAN"}'::jsonb,
        'embed-v4.0', '2026-10', 1024, 'COSINE', 0, 0, repeat('2', 64));

select fstest.expect_fail($sql$
  insert into kb.kb_releases (version, corpus_scope, embedding_model, document_count, chunk_count, manifest_hash)
  values ('r3', '{"schema_version":"1"}'::jsonb, 'embed-v4.0', 0, 0, repeat('3', 64))
$sql$, 'Embedding 설정이 일부만 있음');

select fstest.expect_fail($sql$
  insert into kb.kb_releases (version, corpus_scope, document_count, chunk_count, manifest_hash)
  values ('r1', '{"schema_version":"1"}'::jsonb, 0, 0, repeat('3', 64))
$sql$, '같은 Release 버전 중복');

select fstest.expect_ok($sql$
  insert into kb.kb_release_sources (kb_release_id, source_snapshot_id, purpose_code)
  values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'LAW_CITATION')
$sql$, 'Release 에 Snapshot 포함');

select fstest.expect_ok($sql$
  insert into kb.kb_release_events (kb_release_id, event_type)
  values ('00000000-0000-4000-8000-00000000d001', 'PUBLISHED')
$sql$, 'Release Publish Event');

select fstest.expect_fail($sql$
  insert into kb.kb_release_events (kb_release_id, event_type)
  values ('00000000-0000-4000-8000-00000000d001', 'ARCHIVED')
$sql$, '열거하지 않은 Release event_type');

insert into kb.knowledge_documents
  (id, kb_release_id, source_snapshot_id, document_key, document_version, document_type, title, publisher,
   scenario_codes, product_codes, institution_codes, channel_codes, ingested_at, content_hash, normalization_version)
values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d001',
        '00000000-0000-4000-8000-00000000c001', 'law-19', '20260101', 'LAW',
        '금융소비자 보호에 관한 법률 제19조', '법제처', array['LOAN'], array[]::text[], array['INST_MOLEG'], array[]::text[],
        now(), repeat('a', 64), 'n1');

select fstest.expect_fail($sql$
  insert into kb.knowledge_documents
    (kb_release_id, source_snapshot_id, document_key, document_version, document_type, title, publisher,
     scenario_codes, product_codes, institution_codes, channel_codes, ingested_at, content_hash, normalization_version)
  values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'law-19', '20260101', 'LAW',
          '중복', '법제처', array['LOAN'], array[]::text[], array[]::text[], array[]::text[], now(), repeat('a', 64), 'n1')
$sql$, '같은 Release 안 문서 key·version 중복');

select fstest.expect_fail($sql$
  insert into kb.knowledge_documents
    (kb_release_id, source_snapshot_id, document_key, document_version, document_type, title, publisher,
     scenario_codes, product_codes, institution_codes, channel_codes, ingested_at, content_hash, normalization_version)
  values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'law-20', '20260101', 'LAW',
          'null 원소', '법제처', array['LOAN', null], array[]::text[], array[]::text[], array[]::text[], now(), repeat('a', 64), 'n1')
$sql$, '코드 배열에 null 원소');

insert into kb.knowledge_chunks
  (id, kb_release_id, knowledge_document_id, chunk_no, chunk_text, source_locator, metadata, token_count, content_hash)
values ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000d001',
        '00000000-0000-4000-8000-00000000e001', 1,
        '금융상품판매업자는 설명의무를 이행하고 소비자의 이해를 확인해야 한다.',
        '{"schema_version":"1","article":"19"}'::jsonb, '{"schema_version":"1","institution":"INST_MOLEG"}'::jsonb,
        24, repeat('9', 64));

-- Keyword 단계가 쓰는 실제 tsvector 경로가 동작하는지 본다.
do $$
declare n int;
begin
  select count(*) into n from kb.knowledge_chunks
   where search_vector @@ to_tsquery('simple', '설명의무를');
  if n <> 1 then raise exception 'search_vector FTS 가 동작하지 않습니다 (%)', n; end if;
  raise notice '  허용 확인: search_vector 생성과 GIN FTS 조회';
end
$$;

select fstest.expect_fail($sql$
  insert into kb.knowledge_chunks
    (kb_release_id, knowledge_document_id, chunk_no, chunk_text, source_locator, metadata, token_count, content_hash)
  values ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000e001', 2, '다른 Release',
          '{"schema_version":"1"}'::jsonb, '{"schema_version":"1"}'::jsonb, 3, repeat('8', 64))
$sql$, '다른 Release 의 문서에 Chunk 연결');

select fstest.expect_fail($sql$
  insert into kb.knowledge_chunks
    (kb_release_id, knowledge_document_id, chunk_no, chunk_text, source_locator, metadata, token_count, content_hash)
  values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e001', 1, '중복 순번',
          '{"schema_version":"1"}'::jsonb, '{"schema_version":"1"}'::jsonb, 3, repeat('8', 64))
$sql$, '같은 문서에 중복 chunk_no');

select fstest.expect_fail($sql$
  update kb.knowledge_chunks set chunk_text = '수정' where id = '00000000-0000-4000-8000-00000000f001'
$sql$, 'Chunk UPDATE');

\echo '18. knowledge_embeddings'
select fstest.expect_ok($sql$
  insert into kb.knowledge_embeddings
    (kb_release_id, knowledge_chunk_id, model_id, model_version, dimensions, distance_metric, embedding, content_hash)
  values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000f001', 'embed-v4.0', '2026-09',
          1024, 'COSINE', (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024)),
          repeat('9', 64))
$sql$, '1024차원 Embedding 적재');

select fstest.expect_fail($sql$
  insert into kb.knowledge_embeddings
    (kb_release_id, knowledge_chunk_id, model_id, model_version, dimensions, distance_metric, embedding, content_hash)
  values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000f001', 'embed-v4.0', '2026-10',
          1024, 'COSINE', (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1023)),
          repeat('9', 64))
$sql$, '1023차원 Vector');

select fstest.expect_fail($sql$
  insert into kb.knowledge_embeddings
    (kb_release_id, knowledge_chunk_id, model_id, model_version, dimensions, distance_metric, embedding, content_hash)
  values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000f001', 'other-model', 'v1',
          1024, 'COSINE', (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024)),
          repeat('9', 64))
$sql$, 'Release 가 선언하지 않은 모델의 Embedding');

select fstest.expect_fail($sql$
  insert into kb.knowledge_embeddings
    (kb_release_id, knowledge_chunk_id, model_id, model_version, dimensions, distance_metric, embedding, content_hash)
  values ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000f001', 'embed-v4.0', '2026-10',
          1024, 'COSINE', (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024)),
          repeat('9', 64))
$sql$, '다른 Release 의 Chunk 에 Embedding 연결');

-- Exact KNN 이 cosine 거리로 동작하는지 본다 (P0 는 근사 Index 없음).
do $$
declare d float;
begin
  -- 연산자는 extensions 스키마에 있다. 서버 함수도 search_path 에 기대지 않고 완전 수식한다.
  select embedding operator(extensions.<=>) (select ('[' || string_agg('0.01', ',') || ']')::extensions.vector from generate_series(1, 1024))
    into d from kb.knowledge_embeddings limit 1;
  if d is null or d > 0.000001 then raise exception 'cosine 거리 계산이 예상과 다릅니다 (%)', d; end if;
  raise notice '  허용 확인: pgvector cosine Exact KNN 연산';
end
$$;

\echo '19. official_channel_registry'
select fstest.expect_ok($sql$
  insert into kb.official_channel_registry
    (institution_code, channel_type, normalized_value, display_value, source_snapshot_id)
  values ('INST_FSS', 'PHONE', '1332', '금융감독원 1332', '00000000-0000-4000-8000-00000000c001')
$sql$, '공식 Snapshot 근거의 채널 등록');

select fstest.expect_fail($sql$
  insert into kb.official_channel_registry
    (institution_code, channel_type, normalized_value, display_value, source_snapshot_id)
  values ('INST_FSS', 'KAKAO', 'fss_official', '카카오 채널', '00000000-0000-4000-8000-00000000c001')
$sql$, '열거하지 않은 channel_type');

select fstest.expect_fail($sql$
  insert into kb.official_channel_registry
    (institution_code, channel_type, normalized_value, display_value, source_snapshot_id)
  values ('INST_FSS', 'URL', 'https://example.invalid', '가짜 URL', '00000000-0000-4000-8000-00000000ffff')
$sql$, '근거 Snapshot 없는 채널 등록');

select fstest.expect_fail($sql$
  delete from kb.official_channel_registry where institution_code = 'INST_FSS'
$sql$, '채널 Registry DELETE');

\echo '20. KB 권한'
do $$
declare n int;
begin
  set local role finshield_worker;
  select count(*) into n from kb.knowledge_chunks where search_vector @@ to_tsquery('simple', '설명의무를');
  if n <> 1 then raise exception 'Worker 가 KB 를 검색하지 못했습니다 (%)', n; end if;
  raise notice '  허용 확인: Worker 가 KB 를 검색한다';
  perform fstest.expect_ok($sql$
    insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at)
    values ('00000000-0000-4000-8000-00000000c001', 'law_api', 'LAW-001/worker', 'UNCHANGED', 'FRESH', now())
  $sql$, 'Worker 가 조회 사건을 적재한다');
  perform fstest.expect_fail($sql$
    update kb.kb_releases set document_count = 99 where id = '00000000-0000-4000-8000-00000000d001'
  $sql$, 'Worker 가 Release UPDATE');
  perform fstest.expect_fail($sql$
    delete from kb.source_fetch_events where request_key = 'LAW-001/worker'
  $sql$, 'Worker 가 조회 사건 DELETE');
end
$$;

do $$
begin
  set local role authenticated;
  perform fstest.expect_fail($sql$ select count(*) from kb.knowledge_chunks $sql$, '회원이 KB Chunk 직접 조회');
  perform fstest.expect_fail($sql$ select count(*) from kb.official_channel_registry $sql$, '회원이 채널 Registry 직접 조회');
end
$$;

do $$
begin
  set local role anon;
  perform fstest.expect_fail($sql$ select count(*) from kb.source_snapshots $sql$, '익명이 Source Snapshot 조회');
end
$$;

\echo '0007 불변식 시험을 통과했습니다.'
