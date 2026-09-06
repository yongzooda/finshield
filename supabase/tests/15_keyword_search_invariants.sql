-- 0018 Keyword 단계 불변식. 조사가 붙은 한국어 문장이 실제로 후보를 만드는지 본다.
\set ON_ERROR_STOP on
\echo '== 15. Keyword 검색 불변식'

begin;
set local role postgres;

create temp table kwctx (key text primary key, val uuid) on commit drop;

do $$
declare rel uuid := gen_random_uuid(); man uuid := gen_random_uuid();
        snap uuid; doc uuid; chunk uuid;
begin
  insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
  values ('EVIDENCE', 'kw-test', '{"schema_version":1}'::jsonb, '1', repeat('a', 64)),
         ('RESULT_MATRIX', 'kw-test', '{"schema_version":1}'::jsonb, '1', repeat('b', 64)),
         ('COVERAGE', 'kw-test', '{"schema_version":1}'::jsonb, '1', repeat('c', 64)),
         ('PROFILE', 'kw-test', '{"schema_version":1}'::jsonb, '1', repeat('d', 64)),
         ('PII', 'kw-test', '{"schema_version":1}'::jsonb, '1', repeat('e', 64))
  on conflict (policy_type, version) do nothing;

  insert into kb.kb_releases (id, version, corpus_scope, document_count, chunk_count, manifest_hash)
  values (rel, 'kw-test', '{"schema_version":1}'::jsonb, 1, 1, repeat('f', 64));

  insert into kb.source_snapshots (source_type, authority_level, publisher_name, source_title,
    retrieved_at, content_hash, source_fingerprint, freshness_status, is_complete, is_citable)
  values ('PRODUCT', 'A', '시험 기관', '시험 문서', now(), repeat('1', 64), repeat('2', 64), 'FRESH', true, true)
  returning id into snap;

  insert into kb.knowledge_documents (kb_release_id, source_snapshot_id, document_key, document_version,
    document_type, title, publisher, scenario_codes, product_codes, institution_codes, channel_codes,
    ingested_at, content_hash, normalization_version)
  values (rel, snap, 'kw-doc', '1', 'PRODUCT', '시험 문서', '시험 기관',
    '{}'::text[], '{}'::text[], array['INST_KW'], '{}'::text[], now(), repeat('3', 64), '1')
  returning id into doc;

  insert into kb.knowledge_chunks (kb_release_id, knowledge_document_id, chunk_no, chunk_text, source_locator, metadata, token_count, content_hash)
  values (rel, doc, 1, '합성 해달캐피탈 카드론의 약정금리는 연 7.9%에서 19.9% 사이에서 정한다.',
    '{}'::jsonb, '{"schema_version":1}'::jsonb, 20, repeat('4', 64))
  returning id into chunk;

  insert into private.execution_manifests (id, manifest_version, scenario, scenario_version, model_bundle,
    prompt_bundle_version, schema_bundle_version, evidence_policy_version, result_matrix_version,
    coverage_contract_version, profile_policy_version, pii_policy_version, kb_release_id, config_hash)
  values (man, 'kw-test', 'LOAN', '1', '{"schema_version":1}'::jsonb, '1', '1',
    'kw-test', 'kw-test', 'kw-test', 'kw-test', 'kw-test', rel, repeat('5', 64));

  insert into kwctx values ('release', rel), ('manifest', man), ('chunk', chunk);
end
$$;

\echo '1. 조사가 붙은 문장 질의'
do $$
declare n int; man uuid := (select val from kwctx where key = 'manifest');
begin
  -- 질의의 '약정금리' 는 문서의 '약정금리는' 과 다른 lexeme 이고, '상한이'·'안내받았다' 는 문서에 없다.
  -- AND 결합이면 0건이고 OR 결합이면 1건이다.
  select count(*) into n from private.search_public_knowledge(man,
    '해달캐피탈 카드론의 약정금리 상한이 연 19.9% 라고 안내받았다', null, array['INST_KW']);
  if n <> 1 then raise exception 'Keyword 단계가 문장 질의를 잡지 못했습니다 (%)', n; end if;
  raise notice '  허용 확인: 조사가 붙은 문장 질의가 Keyword 후보를 만든다';
end
$$;

\echo '2. 겹치는 낱말이 없으면 0건'
do $$
declare n int; man uuid := (select val from kwctx where key = 'manifest');
begin
  select count(*) into n from private.search_public_knowledge(man, 'zzzz qqqq wwww', null, array['INST_KW']);
  if n <> 0 then raise exception '겹치는 낱말이 없는데 후보가 생겼습니다 (%)', n; end if;
  raise notice '  거부 확인: 겹치는 낱말이 없으면 0건';
end
$$;

\echo '3. 낱말이 없는 질의는 Keyword 를 건너뛴다'
do $$
declare q tsquery;
begin
  q := private.keyword_tsquery('   ');
  if q is not null then raise exception '빈 질의가 tsquery 를 만들었습니다'; end if;
  q := private.keyword_tsquery(null);
  if q is not null then raise exception 'null 질의가 tsquery 를 만들었습니다'; end if;
  q := private.keyword_tsquery('해달캐피탈 카드론');
  if q is null then raise exception '낱말이 있는데 tsquery 가 비었습니다'; end if;
  raise notice '  경계 확인: 낱말 없는 질의는 Keyword 를 건너뛴다';
end
$$;

\echo '4. Metadata Filter 는 그대로다'
do $$
declare n int; man uuid := (select val from kwctx where key = 'manifest');
begin
  select count(*) into n from private.search_public_knowledge(man,
    '해달캐피탈 카드론의 약정금리', null, array['INST_OTHER']);
  if n <> 0 then raise exception 'Filter 가 다른 기관 문서를 통과시켰습니다 (%)', n; end if;
  raise notice '  거부 확인: 다른 기관은 Keyword 가 맞아도 통과하지 못한다';
end
$$;

rollback;
\echo '15. Keyword 검색 불변식 4건을 통과했습니다.'
