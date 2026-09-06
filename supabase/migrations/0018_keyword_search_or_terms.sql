-- ============================================================
-- 0018 Keyword 단계를 낱말 OR 결합으로 바꾼다 (명세 9.3, AI-007)
--
-- 0015 의 private.search_public_knowledge 는 plainto_tsquery 를 썼다. 그 함수는
-- 모든 낱말을 AND 로 묶는다. 한국어는 조사가 붙어 같은 낱말이 다른 lexeme 이 되므로
-- 문장 형태의 Claim 질의는 어떤 문서와도 맞지 않는다. B-RETRIEVAL-01 배관 검증에서
-- gate Claim 100건 전부의 Keyword 후보가 0건이었다. 단계가 있으나 죽어 있었다.
--
-- 여기서는 질의 문장을 lexeme 으로 자른 뒤 OR 로 묶고 ts_rank 로 정렬한다. 문자열을
-- 이어 붙여 tsquery 를 만들지 않고 tsquery 의 OR 연산자로 접어 escape 문제를 없앤다.
-- Forward-only 다. 0015 파일은 고치지 않는다.
-- ============================================================

-- 질의 문장에서 만든 OR tsquery. 낱말이 없으면 null 을 돌려주고 호출부가 건너뛴다.
create or replace function private.keyword_tsquery(p_text text)
returns tsquery
language plpgsql
immutable
set search_path = ''
as $$
declare
  q     tsquery := null;
  part  tsquery;
  token text;
begin
  if p_text is null then
    return null;
  end if;
  foreach token in array tsvector_to_array(to_tsvector('simple', p_text)) loop
    -- lexeme 을 따옴표로 감싸 그대로 tsquery 로 만든다. plainto_tsquery 는 빈 낱말에서
    -- 알림을 남기므로 쓰지 않는다. 역슬래시와 따옴표만 escape 하면 문법이 닫힌다.
    -- 빈 tsquery 와 비교하면 그 캐스팅 자체가 알림을 남긴다. lexeme 길이로 거른다.
    if length(token) > 0 then
      part := ('''' || replace(replace(token, '\', '\\'), '''', '''''') || '''')::tsquery;
      q := case when q is null then part else q || part end;
    end if;
  end loop;
  return q;
end;
$$;

comment on function private.keyword_tsquery(text) is
  '질의 낱말을 OR 로 묶은 tsquery. 조사가 붙는 한국어에서 AND 결합이 항상 0건을 내는 것을 막는다 (AI-007)';

revoke all on function private.keyword_tsquery(text) from public, anon, authenticated;
grant execute on function private.keyword_tsquery(text) to finshield_worker;

create or replace function private.search_public_knowledge(
  p_execution_manifest_id uuid, p_query_text text, p_query_embedding extensions.vector,
  p_institution_codes text[] default null, p_product_codes text[] default null,
  p_channel_codes text[] default null, p_scenario_code text default null,
  p_as_of date default current_date, p_limit integer default 20)
returns table (
  chunk_id uuid, document_id uuid, source_snapshot_id uuid, kb_release_id uuid,
  document_type text, title text, publisher text, valid_from date, valid_to date,
  source_locator jsonb, chunk_text text, keyword_rank real, vector_distance double precision, matched_by text)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  m   private.execution_manifests%rowtype;
  rel kb.kb_releases%rowtype;
  kwq tsquery;
begin
  if p_limit not between 1 and 50 then
    raise exception '후보 수 상한 위반' using errcode = 'check_violation';
  end if;
  if p_query_text is null and p_query_embedding is null then
    raise exception '질의 문자열 또는 Embedding 이 필요하다' using errcode = 'check_violation';
  end if;
  select * into m from private.execution_manifests where id = p_execution_manifest_id;
  if not found then
    raise exception '실행 Manifest 가 없다' using errcode = 'no_data_found';
  end if;
  select * into rel from kb.kb_releases where id = m.kb_release_id;
  if p_query_embedding is not null and (rel.embedding_model is null or m.embedding_model is null) then
    raise exception 'Release 에 Embedding 설정이 없어 Vector 검색을 할 수 없다' using errcode = 'check_violation';
  end if;
  kwq := private.keyword_tsquery(p_query_text);
  return query
    with filtered as (
      select d.id, d.source_snapshot_id, d.kb_release_id, d.document_type, d.title, d.publisher, d.valid_from, d.valid_to
        from kb.knowledge_documents d
       where d.kb_release_id = m.kb_release_id
         and (p_institution_codes is null or d.institution_codes && p_institution_codes)
         and (p_product_codes is null or d.product_codes && p_product_codes)
         and (p_channel_codes is null or d.channel_codes && p_channel_codes)
         and (p_scenario_code is null or p_scenario_code = any(d.scenario_codes))
         and (d.valid_from is null or d.valid_from <= p_as_of)
         and (d.valid_to is null or d.valid_to >= p_as_of)),
    kw as (
      select c.id as cid, ts_rank(c.search_vector, kwq) as rank
        from kb.knowledge_chunks c join filtered d on d.id = c.knowledge_document_id
       where kwq is not null and c.search_vector @@ kwq
       order by rank desc, c.id limit p_limit),
    vec as (
      select e.knowledge_chunk_id as cid, (e.embedding operator(extensions.<=>) p_query_embedding) as distance
        from kb.knowledge_embeddings e
        join kb.knowledge_chunks c on c.id = e.knowledge_chunk_id
        join filtered d on d.id = c.knowledge_document_id
       where p_query_embedding is not null
         and e.kb_release_id = m.kb_release_id
         and e.model_id = rel.embedding_model and e.model_version = rel.embedding_model_version
       order by distance limit p_limit),
    merged as (
      select coalesce(kw.cid, vec.cid) as cid, kw.rank, vec.distance,
             case when kw.cid is not null and vec.cid is not null then 'KEYWORD_AND_VECTOR'
                  when kw.cid is not null then 'KEYWORD' else 'VECTOR' end as matched_by
        from kw full outer join vec on vec.cid = kw.cid)
    select c.id, d.id, d.source_snapshot_id, d.kb_release_id, d.document_type, d.title, d.publisher,
           d.valid_from, d.valid_to, c.source_locator, left(c.chunk_text, 4000), mg.rank, mg.distance, mg.matched_by
      from merged mg
      join kb.knowledge_chunks c on c.id = mg.cid
      join filtered d on d.id = c.knowledge_document_id
     order by mg.distance nulls last, mg.rank desc nulls last, c.id;
end;
$$;

comment on function private.search_public_knowledge(uuid, text, extensions.vector, text[], text[], text[], text, date, integer) is
  'Manifest 가 고정한 Release 안에서 Metadata Filter → Keyword(OR 결합)·Vector 후보를 Provenance 와 함께 돌려준다 (명세 9.3)';

revoke all on function private.search_public_knowledge(uuid, text, extensions.vector, text[], text[], text[], text, date, integer)
  from public, anon, authenticated;
grant execute on function private.search_public_knowledge(uuid, text, extensions.vector, text[], text[], text[], text, date, integer)
  to finshield_worker;
