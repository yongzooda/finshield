-- ============================================================
-- 0007 Source Snapshot·공용 Knowledge Base (명세 6.5 앞부분, 6.8, 15절 6번 묶음)
--
-- 대상: kb.source_snapshots, kb.source_fetch_events, kb.kb_releases,
--       kb.kb_release_sources, kb.kb_release_events,
--       kb.knowledge_documents, kb.knowledge_document_events,
--       kb.knowledge_chunks, kb.knowledge_embeddings,
--       kb.official_channel_registry
--
-- public.case_source_snapshots 는 Case 소유 근거라 Evidence 묶음(8번)에서
-- 만든다. 평가·신뢰센터 표는 13번 묶음이다.
--
-- 공용 KB 는 Publish 뒤 수정하지 않는다 (명세 6.8). 철회·교체는 Event 와
-- 새 Release 로 기록한다. 따라서 열 개 표 모두 UPDATE·DELETE 를 막는다.
--
-- Vector 는 ADR 5.2 가 승인한 Cohere embed-v4.0 1024차원 cosine 이며 P0 는
-- Exact KNN 이라 근사 Index 를 만들지 않는다. Keyword 는 Postgres tsvector
-- 이고 사전등록 4.1 에 따라 응용 코드 근사로 대체하지 않는다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum (명세 4.1)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'authority_level') then
    create type public.authority_level as enum ('A', 'B', 'C', 'D');
  end if;
  if not exists (select 1 from pg_type where typname = 'freshness_status') then
    create type public.freshness_status as enum ('FRESH', 'STALE', 'UNKNOWN');
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. kb.source_snapshots (명세 6.5)
--    원문 내용·버전이 바뀔 때만 새 행을 만든다. 같은 내용의 재조회와
--    실패는 source_fetch_events 에 쌓는다.
-- ------------------------------------------------------------
create table if not exists kb.source_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  source_type        text not null,
  authority_level    public.authority_level not null,
  publisher_name     text not null,
  source_title       text not null,
  canonical_url      text,
  official_id        text,
  law_name           text,
  article_no         text,
  published_at       timestamptz,
  effective_from     date,
  effective_to       date,
  retrieved_at       timestamptz not null,
  source_version     text,
  content_hash       text not null,
  source_fingerprint text not null,
  freshness_status   public.freshness_status not null,
  fresh_until        timestamptz,
  license_code       text,
  license_url        text,
  is_complete        boolean not null,
  is_citable         boolean not null,
  created_at         timestamptz not null default now(),

  -- 같은 원문·버전·내용은 하나다. null 도 같은 값으로 본다 (명세 6.5).
  constraint uq_source_snapshots__identity
    unique nulls not distinct (source_type, official_id, source_version, content_hash),

  constraint ck_source_snapshots__source_type
    check (source_type in ('LAW', 'DISCLOSURE', 'PRODUCT', 'INSTITUTION',
                           'ALERT', 'DISPUTE', 'TERMS', 'GUIDE')),
  constraint ck_source_snapshots__text_len
    check (octet_length(publisher_name) between 1 and 256
           and octet_length(source_title) between 1 and 512
           and (canonical_url is null or octet_length(canonical_url) <= 2048)
           and (official_id is null or octet_length(official_id) <= 128)
           and (law_name is null or octet_length(law_name) <= 256)
           and (article_no is null or octet_length(article_no) <= 64)
           and (source_version is null or octet_length(source_version) <= 64)
           and (license_code is null or octet_length(license_code) <= 64)
           and (license_url is null or octet_length(license_url) <= 2048)),
  constraint ck_source_snapshots__effective_range
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint ck_source_snapshots__content_hash
    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_source_snapshots__source_fingerprint
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  -- 법령 Typed Citation 은 법령명과 조문이 함께 있어야 한다 (명세 11.3).
  constraint ck_source_snapshots__law_citation
    check (source_type <> 'LAW' or (law_name is not null and article_no is not null)),
  -- 본문이 불완전하면 인용 가능으로 표시하지 않는다.
  constraint ck_source_snapshots__citable_requires_complete
    check (not is_citable or is_complete)
);

comment on table kb.source_snapshots is
  '공용 공식 Source 의 불변 조회 버전. 같은 source_fingerprint 는 독립 근거 하나로 센다 (명세 6.5)';

create index if not exists idx_source_snapshots__type_official
  on kb.source_snapshots (source_type, official_id);
create index if not exists idx_source_snapshots__fingerprint
  on kb.source_snapshots (source_fingerprint);

-- ------------------------------------------------------------
-- 3. kb.source_fetch_events (명세 6.5)
-- ------------------------------------------------------------
create table if not exists kb.source_fetch_events (
  id                 uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid,
  source_adapter     text not null,
  request_key        text not null,
  outcome            text not null,
  freshness_status   public.freshness_status not null,
  retrieved_at       timestamptz,
  fresh_until        timestamptz,
  error_code         text,
  created_at         timestamptz not null default now(),

  constraint fk_source_fetch_events__snapshot
    foreign key (source_snapshot_id) references kb.source_snapshots (id),
  constraint uq_source_fetch_events__adapter_key unique (source_adapter, request_key),

  constraint ck_source_fetch_events__outcome
    check (outcome in ('UNCHANGED', 'CHANGED', 'NOT_FOUND', 'FAILED')),
  constraint ck_source_fetch_events__text_len
    check (octet_length(source_adapter) between 1 and 64
           and octet_length(request_key) between 1 and 512
           and (error_code is null or octet_length(error_code) <= 64)),
  -- 비교할 과거 Snapshot 이 없는 NOT_FOUND·FAILED 에서만 null 을 허용한다.
  constraint ck_source_fetch_events__snapshot_presence
    check (source_snapshot_id is not null or outcome in ('NOT_FOUND', 'FAILED')),
  -- 성공 조회는 조회 시각이 있어야 한다.
  constraint ck_source_fetch_events__retrieved_at
    check (outcome in ('NOT_FOUND', 'FAILED') or retrieved_at is not null),
  -- 실패 사건은 Sanitized 오류 Code 를 남긴다.
  constraint ck_source_fetch_events__error_code
    check (outcome <> 'FAILED' or error_code is not null)
);

comment on table kb.source_fetch_events is
  'Append-only Source 조회 사건. NO_CHANGE 도 새 조회를 증명한다 (명세 6.5)';

create index if not exists idx_source_fetch_events__snapshot_created
  on kb.source_fetch_events (source_snapshot_id, created_at desc);

-- ------------------------------------------------------------
-- 4. kb.kb_releases (명세 6.8)
-- ------------------------------------------------------------
create table if not exists kb.kb_releases (
  id                      uuid primary key default gen_random_uuid(),
  version                 text not null,
  corpus_scope            jsonb not null,
  embedding_model         text,
  embedding_model_version text,
  embedding_dimension     integer,
  distance_metric         text,
  document_count          integer not null,
  chunk_count             integer not null,
  manifest_hash           text not null,
  created_at              timestamptz not null default now(),

  constraint uq_kb_releases__version unique (version),
  constraint uq_kb_releases__id_embedding unique (id, embedding_model, embedding_model_version, embedding_dimension),

  constraint ck_kb_releases__version_len check (octet_length(version) between 1 and 64),
  constraint ck_kb_releases__corpus_scope_object check (jsonb_typeof(corpus_scope) = 'object'),
  constraint ck_kb_releases__corpus_scope_schema check (corpus_scope ? 'schema_version'),
  constraint ck_kb_releases__embedding_dimension
    check (embedding_dimension is null or embedding_dimension > 0),
  constraint ck_kb_releases__distance_metric
    check (distance_metric is null or distance_metric in ('COSINE', 'INNER_PRODUCT', 'L2')),
  -- Embedding 설정은 함께 있거나 함께 없다.
  constraint ck_kb_releases__embedding_pairing
    check ((embedding_model is null) = (embedding_model_version is null)
           and (embedding_model is null) = (embedding_dimension is null)
           and (embedding_model is null) = (distance_metric is null)),
  constraint ck_kb_releases__counts
    check (document_count >= 0 and chunk_count >= 0),
  constraint ck_kb_releases__manifest_hash check (manifest_hash ~ '^[0-9a-f]{64}$')
);

comment on table kb.kb_releases is
  '공용 KB 배포 단위. 서로 다른 Embedding 모델·차원의 Vector 를 한 순위에서 비교하지 않는다 (명세 6.8)';

-- ------------------------------------------------------------
-- 5. kb.kb_release_sources, kb.kb_release_events (명세 6.8)
-- ------------------------------------------------------------
create table if not exists kb.kb_release_sources (
  kb_release_id      uuid not null,
  source_snapshot_id uuid not null,
  purpose_code       text not null,
  created_at         timestamptz not null default now(),

  constraint pk_kb_release_sources primary key (kb_release_id, source_snapshot_id, purpose_code),
  constraint fk_kb_release_sources__release
    foreign key (kb_release_id) references kb.kb_releases (id),
  constraint fk_kb_release_sources__snapshot
    foreign key (source_snapshot_id) references kb.source_snapshots (id),
  constraint ck_kb_release_sources__purpose_code
    check (purpose_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

create table if not exists kb.kb_release_events (
  id            uuid primary key default gen_random_uuid(),
  kb_release_id uuid not null,
  event_type    text not null,
  reason_code   text,
  created_at    timestamptz not null default now(),

  constraint fk_kb_release_events__release
    foreign key (kb_release_id) references kb.kb_releases (id),
  constraint ck_kb_release_events__event_type
    check (event_type in ('PUBLISHED', 'RETIRED', 'WITHDRAWN')),
  constraint ck_kb_release_events__reason_code_len
    check (reason_code is null or octet_length(reason_code) <= 64)
);

create index if not exists idx_kb_release_events__release_created
  on kb.kb_release_events (kb_release_id, created_at desc);

-- ------------------------------------------------------------
-- 6. kb.knowledge_documents, kb.knowledge_document_events (명세 6.8)
-- ------------------------------------------------------------
create table if not exists kb.knowledge_documents (
  id                    uuid primary key default gen_random_uuid(),
  kb_release_id         uuid not null,
  source_snapshot_id    uuid not null,
  document_key          text not null,
  document_version      text not null,
  document_type         text not null,
  title                 text not null,
  publisher             text not null,
  scenario_codes        text[] not null,
  product_codes         text[] not null,
  institution_codes     text[] not null,
  channel_codes         text[] not null,
  valid_from            date,
  valid_to              date,
  license_code          text,
  source_url            text,
  ingested_at           timestamptz not null,
  content_hash          text not null,
  normalization_version text not null,
  created_at            timestamptz not null default now(),

  constraint fk_knowledge_documents__release
    foreign key (kb_release_id) references kb.kb_releases (id),
  constraint fk_knowledge_documents__snapshot
    foreign key (source_snapshot_id) references kb.source_snapshots (id),

  constraint uq_knowledge_documents__release_key_version
    unique (kb_release_id, document_key, document_version),
  constraint uq_knowledge_documents__id_release unique (id, kb_release_id),

  constraint ck_knowledge_documents__document_type
    check (document_type in ('LAW', 'DISCLOSURE', 'PRODUCT', 'INSTITUTION', 'ALERT',
                             'DISPUTE', 'TERMS', 'GUIDE', 'PRECASE_CASE', 'PRECASE_GUIDE')),
  constraint ck_knowledge_documents__text_len
    check (octet_length(document_key) between 1 and 128
           and octet_length(document_version) between 1 and 64
           and octet_length(title) between 1 and 512
           and octet_length(publisher) between 1 and 256
           and (license_code is null or octet_length(license_code) <= 64)
           and (source_url is null or octet_length(source_url) <= 2048)
           and octet_length(normalization_version) between 1 and 32),
  -- 배열에 null 원소를 두지 않는다. 빈 배열은 허용한다 (필터 미적용).
  constraint ck_knowledge_documents__arrays_no_null
    check (array_position(scenario_codes, null) is null
           and array_position(product_codes, null) is null
           and array_position(institution_codes, null) is null
           and array_position(channel_codes, null) is null),
  constraint ck_knowledge_documents__valid_range
    check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint ck_knowledge_documents__content_hash check (content_hash ~ '^[0-9a-f]{64}$')
);

comment on table kb.knowledge_documents is
  '공용 문서 버전. PreCase 유래 자산은 PRECASE_* 유형이며 유사 사례는 reference_only 정책을 유지한다 (명세 6.8)';

-- Metadata Filter (명세 8절): Release·유형·기간 B-tree, 코드 배열 GIN
create index if not exists idx_knowledge_documents__filter
  on kb.knowledge_documents (kb_release_id, document_type, valid_from, valid_to);
create index if not exists idx_knowledge_documents__institution_codes
  on kb.knowledge_documents using gin (institution_codes);
create index if not exists idx_knowledge_documents__product_codes
  on kb.knowledge_documents using gin (product_codes);
create index if not exists idx_knowledge_documents__channel_codes
  on kb.knowledge_documents using gin (channel_codes);
-- Fuzzy (명세 8절): 제목·기관명 trigram
create index if not exists idx_knowledge_documents__title_trgm
  on kb.knowledge_documents using gin (title extensions.gin_trgm_ops);
create index if not exists idx_knowledge_documents__publisher_trgm
  on kb.knowledge_documents using gin (publisher extensions.gin_trgm_ops);

create table if not exists kb.knowledge_document_events (
  id                    uuid primary key default gen_random_uuid(),
  knowledge_document_id uuid not null,
  event_type            text not null,
  reason_code           text,
  created_at            timestamptz not null default now(),

  constraint fk_knowledge_document_events__document
    foreign key (knowledge_document_id) references kb.knowledge_documents (id),
  constraint ck_knowledge_document_events__event_type
    check (event_type in ('PUBLISHED', 'SUPERSEDED', 'WITHDRAWN')),
  constraint ck_knowledge_document_events__reason_code_len
    check (reason_code is null or octet_length(reason_code) <= 64)
);

create index if not exists idx_knowledge_document_events__document_created
  on kb.knowledge_document_events (knowledge_document_id, created_at desc);

-- ------------------------------------------------------------
-- 7. kb.knowledge_chunks (명세 6.8)
--    search_vector 는 chunk_text 에서 simple 구성으로 생성한다. 한국어
--    형태소 사전이 없는 Postgres 에서 결정적으로 재현되는 유일한 구성이며,
--    사전등록 4.1 이 요구하는 실제 tsvector 경로다. 형태소 품질 보완은
--    문서 제목·기관명 trigram 과 Vector 단계가 맡는다.
-- ------------------------------------------------------------
create table if not exists kb.knowledge_chunks (
  id                    uuid primary key default gen_random_uuid(),
  kb_release_id         uuid not null,
  knowledge_document_id uuid not null,
  chunk_no              integer not null,
  chunk_text            text not null,
  source_locator        jsonb not null,
  metadata              jsonb not null,
  search_vector         tsvector generated always as (to_tsvector('simple', chunk_text)) stored,
  token_count           integer not null,
  content_hash          text not null,
  created_at            timestamptz not null default now(),

  -- 다른 Release 의 Document 와 Chunk 를 조합하지 못한다.
  constraint fk_knowledge_chunks__document_release
    foreign key (knowledge_document_id, kb_release_id)
    references kb.knowledge_documents (id, kb_release_id),

  constraint uq_knowledge_chunks__document_chunk_no unique (knowledge_document_id, chunk_no),
  constraint uq_knowledge_chunks__id_release unique (id, kb_release_id),

  constraint ck_knowledge_chunks__chunk_no check (chunk_no > 0),
  constraint ck_knowledge_chunks__chunk_text_len
    check (octet_length(chunk_text) between 1 and 32768),
  constraint ck_knowledge_chunks__source_locator_object
    check (jsonb_typeof(source_locator) = 'object'),
  constraint ck_knowledge_chunks__metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint ck_knowledge_chunks__metadata_schema
    check (metadata ? 'schema_version'),
  constraint ck_knowledge_chunks__token_count check (token_count >= 0),
  constraint ck_knowledge_chunks__content_hash check (content_hash ~ '^[0-9a-f]{64}$')
);

comment on table kb.knowledge_chunks is
  '검색 Chunk. 문서 개정은 Chunk UPDATE 가 아니라 새 Document version 과 새 Chunk 다 (명세 6.8)';
comment on column kb.knowledge_chunks.search_vector is
  'simple 구성 tsvector. 사전등록 4.1 의 Keyword 단계가 쓰는 실제 FTS 경로';

-- Keyword (명세 8절)
create index if not exists idx_knowledge_chunks__search_vector
  on kb.knowledge_chunks using gin (search_vector);
create index if not exists idx_knowledge_chunks__release_document
  on kb.knowledge_chunks (kb_release_id, knowledge_document_id, chunk_no);

-- ------------------------------------------------------------
-- 8. kb.knowledge_embeddings (명세 6.8, ADR 5.2)
--    차원은 ADR 이 승인한 1024 로 고정한다. 모델·차원이 바뀌면 이 표를
--    UPDATE 하지 않고 새 Release 와 새 물리 컬럼·표를 Migration 으로 만든다.
--    P0 는 Exact KNN 이라 근사 Index 를 두지 않는다.
-- ------------------------------------------------------------
create table if not exists kb.knowledge_embeddings (
  id                 uuid primary key default gen_random_uuid(),
  kb_release_id      uuid not null,
  knowledge_chunk_id uuid not null,
  model_id           text not null,
  model_version      text not null,
  dimensions         integer not null,
  distance_metric    text not null,
  embedding          extensions.vector(1024) not null,
  content_hash       text not null,
  created_at         timestamptz not null default now(),

  -- 다른 Release 의 Chunk 와 Embedding 을 조합하지 못한다.
  constraint fk_knowledge_embeddings__chunk_release
    foreign key (knowledge_chunk_id, kb_release_id)
    references kb.knowledge_chunks (id, kb_release_id),
  -- Release 가 선언한 모델·버전·차원과 일치해야 한다.
  constraint fk_knowledge_embeddings__release_model
    foreign key (kb_release_id, model_id, model_version, dimensions)
    references kb.kb_releases (id, embedding_model, embedding_model_version, embedding_dimension),

  constraint uq_knowledge_embeddings__chunk_model
    unique (knowledge_chunk_id, model_id, model_version),

  constraint ck_knowledge_embeddings__dimensions check (dimensions = 1024),
  constraint ck_knowledge_embeddings__distance_metric
    check (distance_metric in ('COSINE', 'INNER_PRODUCT', 'L2')),
  constraint ck_knowledge_embeddings__text_len
    check (octet_length(model_id) between 1 and 64
           and octet_length(model_version) between 1 and 64),
  constraint ck_knowledge_embeddings__content_hash check (content_hash ~ '^[0-9a-f]{64}$')
);

comment on table kb.knowledge_embeddings is
  '공용 Chunk Embedding. vector(1024) 는 ADR 5.2 승인값이며 P0 는 Exact KNN 이다 (명세 6.8)';

create index if not exists idx_knowledge_embeddings__release_chunk
  on kb.knowledge_embeddings (kb_release_id, knowledge_chunk_id);

-- ------------------------------------------------------------
-- 9. kb.official_channel_registry (명세 6.8)
--    모델이 만든 URL·전화번호를 넣을 수 없다. 적재 경로는 검증된
--    서버·배치로 제한한다.
-- ------------------------------------------------------------
create table if not exists kb.official_channel_registry (
  id                 uuid primary key default gen_random_uuid(),
  institution_code   text not null,
  channel_type       text not null,
  normalized_value   text not null,
  display_value      text not null,
  source_snapshot_id uuid not null,
  valid_from         date,
  valid_to           date,
  created_at         timestamptz not null default now(),

  constraint fk_official_channel_registry__snapshot
    foreign key (source_snapshot_id) references kb.source_snapshots (id),
  constraint uq_official_channel_registry__version
    unique nulls not distinct (institution_code, channel_type, normalized_value, valid_from),

  constraint ck_official_channel_registry__institution_code
    check (institution_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_official_channel_registry__channel_type
    check (channel_type in ('URL', 'PHONE', 'BRANCH', 'REPORTING')),
  constraint ck_official_channel_registry__value_len
    check (octet_length(normalized_value) between 1 and 512
           and octet_length(display_value) between 1 and 512),
  constraint ck_official_channel_registry__valid_range
    check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

comment on table kb.official_channel_registry is
  '승인된 공식 채널 버전. 모델 출력이 아니라 공식 Snapshot 을 근거로만 적재한다 (명세 6.8)';

create index if not exists idx_official_channel_registry__lookup
  on kb.official_channel_registry (institution_code, channel_type, normalized_value);

-- ------------------------------------------------------------
-- 10. 불변성 Trigger (명세 6.8)
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'source_snapshots', 'source_fetch_events', 'kb_releases', 'kb_release_sources',
    'kb_release_events', 'knowledge_documents', 'knowledge_document_events',
    'knowledge_chunks', 'knowledge_embeddings', 'official_channel_registry'
  ] loop
    execute format('drop trigger if exists trg_%s__reject_update on kb.%I', t, t);
    execute format('create trigger trg_%s__reject_update before update on kb.%I '
                   'for each row execute function private.reject_update()', t, t);
    execute format('drop trigger if exists trg_%s__reject_delete on kb.%I', t, t);
    execute format('create trigger trg_%s__reject_delete before delete on kb.%I '
                   'for each row execute function private.reject_delete()', t, t);
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 11. RLS 와 Grant (명세 7.1, 9.2)
--     회원·익명은 kb 를 직접 읽지 않는다. 조회는 제한 RPC 가 맡는다.
--     서버·Worker 는 검색과 적재를 하므로 SELECT·INSERT 만 연다.
--     UPDATE·DELETE 는 Trigger 가 어차피 막는다.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'source_snapshots', 'source_fetch_events', 'kb_releases', 'kb_release_sources',
    'kb_release_events', 'knowledge_documents', 'knowledge_document_events',
    'knowledge_chunks', 'knowledge_embeddings', 'official_channel_registry'
  ] loop
    execute format('alter table kb.%I enable row level security', t);
    execute format('alter table kb.%I force row level security', t);
    execute format('drop policy if exists %s__worker_read on kb.%I', t, t);
    execute format('create policy %s__worker_read on kb.%I for select to finshield_worker using (true)', t, t);
    execute format('drop policy if exists %s__worker_insert on kb.%I', t, t);
    execute format('create policy %s__worker_insert on kb.%I for insert to finshield_worker with check (true)', t, t);
    execute format('grant select, insert on kb.%I to finshield_worker', t);
    execute format('revoke all on kb.%I from anon, authenticated', t);
  end loop;
end
$$;
