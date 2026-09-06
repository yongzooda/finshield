-- ============================================================
-- 0020. 입력 산출물 등록과 중단 경로 (명세 6.2, 6.4, 10.4)
--
-- worker 는 NOBYPASSRLS 이고 소유자 표에 직접 쓰지 못한다. 그래서 페이지·OCR
-- 임시물·Case vector 를 만드는 경로가 함수로 있어야 한다. 지금까지는 없었다.
--
-- advance_input_stage 의 CLAIM_CONFIRMED 분기는 원본과 OCR 임시물만 청소에
-- 넣고 Case vector 를 빠뜨렸다. ADR 15.1 물리 삭제 행은 case vector 잔존까지
-- 0건을 요구하고, finish_file_cleanup_job 은 vector 가 남아 있으면 원본 삭제
-- 축을 종결하지 못한다. 그래서 같은 분기에서 vector 도 청소에 넣는다.
--
-- 사용자 중단 경로도 없었다. 명세 6.4 는 Claim 확인·사용자 중단·Case 삭제 중
-- 가장 먼저 온 시점에 지우라고 요구한다. Case 삭제는 request_case_deletion 이
-- 이미 하고, 중단은 이 Migration 이 채운다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 페이지 등록 (명세 6.2)
-- ------------------------------------------------------------
create or replace function private.register_input_pages(
  p_owner_id uuid, p_case_id uuid, p_input_id uuid, p_page_count integer,
  p_parse_status text default 'SUCCEEDED', p_locator_schema_version text default 'v1')
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.case_inputs%rowtype;
  n integer;
begin
  if p_page_count is null or p_page_count not between 1 and 10 then
    raise exception '페이지 수는 1..10 이어야 한다' using errcode = 'check_violation';
  end if;
  select * into i from public.case_inputs
   where id = p_input_id and case_id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception '입력이 없거나 소유자·Case 가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if i.input_outcome <> 'ACTIVE' then
    raise exception '% 입력에는 페이지를 등록할 수 없다', i.input_outcome using errcode = 'check_violation';
  end if;

  select count(*) into n from public.case_input_pages where case_input_id = p_input_id;
  if n > 0 then
    raise exception '이미 페이지가 등록된 입력이다' using errcode = 'unique_violation';
  end if;

  return query
    with inserted as (
      insert into public.case_input_pages
        (owner_id, case_id, case_input_id, page_no, parse_status, locator_schema_version)
      select p_owner_id, p_case_id, p_input_id, g, p_parse_status, p_locator_schema_version
        from generate_series(1, p_page_count) as g
      returning id)
    select id from inserted;
end;
$$;
revoke all on function private.register_input_pages(uuid, uuid, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function private.register_input_pages(uuid, uuid, uuid, integer, text, text)
  to finshield_worker;

-- ------------------------------------------------------------
-- 2. OCR 임시물 등록 (명세 6.2, 6.4)
--    수명은 만들 때 정하고 24시간을 넘지 못한다.
-- ------------------------------------------------------------
create or replace function private.register_ocr_artifact(
  p_owner_id uuid, p_case_id uuid, p_input_id uuid, p_page_id uuid,
  p_provider_code text, p_object_path text, p_ttl_seconds integer default 3600)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds not between 1 and 86400 then
    raise exception '임시물 수명은 24시간을 넘을 수 없다' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.case_input_pages
                  where id = p_page_id and case_input_id = p_input_id
                    and case_id = p_case_id and owner_id = p_owner_id) then
    raise exception '페이지가 없거나 소유자·Case·입력이 다르다' using errcode = 'insufficient_privilege';
  end if;

  insert into private.ocr_artifacts
    (owner_id, case_id, case_input_id, page_id, provider_code, storage_object_path, status, expires_at)
  values (p_owner_id, p_case_id, p_input_id, p_page_id, p_provider_code, p_object_path, 'AVAILABLE',
          now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.register_ocr_artifact(uuid, uuid, uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function private.register_ocr_artifact(uuid, uuid, uuid, uuid, text, text, integer)
  to finshield_worker;

-- ------------------------------------------------------------
-- 3. Case vector 등록 (명세 6.2, 10.4)
--    사용자 문서 Embedding 은 공용 Knowledge Base 와 섞지 않는다.
-- ------------------------------------------------------------
create or replace function private.register_case_embedding(
  p_owner_id uuid, p_case_id uuid, p_input_id uuid, p_page_id uuid,
  p_model_id text, p_model_version text, p_embedding extensions.vector,
  p_masked_content_hash text, p_ttl_seconds integer default 3600)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds not between 1 and 86400 then
    raise exception 'vector 수명은 24시간을 넘을 수 없다' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.case_inputs
                  where id = p_input_id and case_id = p_case_id and owner_id = p_owner_id) then
    raise exception '입력이 없거나 소유자·Case 가 다르다' using errcode = 'insufficient_privilege';
  end if;

  insert into private.case_embeddings
    (owner_id, case_id, case_input_id, page_id, model_id, model_version, dimensions,
     embedding, masked_content_hash, expires_at)
  values (p_owner_id, p_case_id, p_input_id, p_page_id, p_model_id, p_model_version, 1024,
          p_embedding, p_masked_content_hash, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.register_case_embedding(uuid, uuid, uuid, uuid, text, text, extensions.vector, text, integer)
  from public, anon, authenticated;
grant execute on function private.register_case_embedding(uuid, uuid, uuid, uuid, text, text, extensions.vector, text, integer)
  to finshield_worker;

-- ------------------------------------------------------------
-- 4. 사용자 중단 (명세 6.4)
--    중단 즉시 slot 을 닫고 원본·임시물·vector 를 청소에 넣는다.
--    마지막 처리 단계는 보존하고 결과 축만 CANCELLED 로 바꾼다 (명세 6.2).
-- ------------------------------------------------------------
create or replace function private.stop_case_input(
  p_owner_id uuid, p_case_id uuid, p_input_id uuid, p_reason text default 'USER_STOPPED')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.case_inputs%rowtype;
  r record;
  n integer := 0;
begin
  select * into i from public.case_inputs
   where id = p_input_id and case_id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception '입력이 없거나 소유자·Case 가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if i.input_outcome <> 'ACTIVE' then
    return 0;
  end if;

  update public.case_inputs set input_outcome = 'CANCELLED' where id = i.id;

  for r in select id from private.input_objects where case_input_id = i.id and deleted_at is null loop
    perform private.enqueue_file_cleanup('INPUT_OBJECT', r.id, 'USER_STOPPED'); n := n + 1;
  end loop;
  for r in select id from private.ocr_artifacts where case_input_id = i.id and deleted_at is null loop
    perform private.enqueue_file_cleanup('OCR_ARTIFACT', r.id, 'USER_STOPPED'); n := n + 1;
  end loop;
  for r in select id from private.case_embeddings where case_input_id = i.id loop
    perform private.enqueue_file_cleanup('CASE_EMBEDDING', r.id, 'USER_STOPPED'); n := n + 1;
  end loop;

  perform private.append_case_event(p_owner_id, p_case_id, 'CASE_INPUT_STOPPED', 'USER', null, null,
            jsonb_build_object('case_input_id', i.id, 'reason_code', p_reason, 'cleanup_jobs', n),
            'input-stopped:' || i.id::text);
  return n;
end;
$$;
revoke all on function private.stop_case_input(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.stop_case_input(uuid, uuid, uuid, text) to finshield_worker;

-- ------------------------------------------------------------
-- 5. advance_input_stage 재정의 (명세 6.2, 6.4)
--    CLAIM_CONFIRMED 분기가 Case vector 를 청소에 넣지 않던 것을 고친다.
--    나머지 본문은 0015 와 같다.
-- ------------------------------------------------------------
create or replace function private.advance_input_stage(
  p_owner_id uuid, p_case_id uuid, p_input_id uuid, p_to public.input_stage, p_patch jsonb default '{}'::jsonb)
returns public.case_inputs
language plpgsql
security definer
set search_path = ''
as $$
declare
  c  public.financial_cases%rowtype;
  i  public.case_inputs%rowtype;
  v_pos_from integer;
  v_pos_to   integer;
  r  record;
  n  integer;
  n2 integer;
begin
  if jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'patch 는 object 여야 한다' using errcode = 'check_violation';
  end if;
  select * into c from public.financial_cases where id = p_case_id and owner_id = p_owner_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 가 없거나 삭제 중이다' using errcode = 'insufficient_privilege';
  end if;
  if c.lifecycle not in ('DRAFT', 'INPUT_REVIEW', 'NEED_MORE_INFORMATION') then
    raise exception '% 상태의 Case 에서는 입력을 진행할 수 없다', c.lifecycle using errcode = 'check_violation';
  end if;
  select * into i from public.case_inputs where id = p_input_id and case_id = p_case_id and owner_id = p_owner_id for update;
  if not found then
    raise exception '입력이 없거나 Case 가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if i.input_outcome <> 'ACTIVE' then
    raise exception '% 입력은 전진할 수 없다', i.input_outcome using errcode = 'check_violation';
  end if;
  v_pos_from := array_position(enum_range(null::public.input_stage), i.input_stage);
  v_pos_to := array_position(enum_range(null::public.input_stage), p_to);
  if v_pos_to <> v_pos_from + 1 then
    raise exception '입력 단계는 한 번에 한 단계만 전진한다: % → %', i.input_stage, p_to using errcode = 'check_violation';
  end if;

  if p_to = 'VALIDATED' then
    if i.input_type in ('IMAGE', 'PDF') then
      if not exists (select 1 from private.input_objects o
                      where o.case_input_id = i.id and o.slot_state = 'UPLOADED' and o.deleted_at is null) then
        raise exception '업로드가 확인된 객체가 없어 VALIDATED 로 갈 수 없다' using errcode = 'check_violation';
      end if;
      if p_patch ->> 'detected_mime' is null or p_patch ->> 'magic_signature' is null then
        raise exception 'MIME·Magic Byte 검증 결과가 없다' using errcode = 'check_violation';
      end if;
      update public.case_inputs
         set detected_mime = p_patch ->> 'detected_mime', magic_signature = p_patch ->> 'magic_signature',
             declared_mime = coalesce(p_patch ->> 'declared_mime', declared_mime)
       where id = i.id;
    end if;
  elsif p_to = 'EXTRACTED' then
    if i.input_type in ('IMAGE', 'PDF') then
      select count(*) filter (where parse_status = 'SUCCEEDED'),
             count(*) filter (where parse_status = 'PENDING')
        into n, n2 from public.case_input_pages p where p.case_input_id = i.id;
      if n < 1 or n2 > 0 then
        raise exception '성공한 페이지가 없거나 처리 중인 페이지가 있다' using errcode = 'check_violation';
      end if;
    end if;
  elsif p_to = 'MASKED' then
    if p_patch ->> 'masked_text' is null or p_patch ->> 'masked_text_hash' is null or p_patch ->> 'pii_policy_version' is null then
      raise exception '마스킹 결과·Hash·PII 정책 버전이 필요하다' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.case_input_findings f
                where f.case_input_id = i.id and f.severity = 'BLOCKING' and f.resolution = 'OPEN') then
      raise exception '해결되지 않은 BLOCKING 발견이 있어 MASKED 로 갈 수 없다' using errcode = 'check_violation';
    end if;
    update public.case_inputs
       set pii_scan_status = 'PASSED', pii_policy_version = p_patch ->> 'pii_policy_version',
           masked_text = p_patch ->> 'masked_text', masked_text_hash = p_patch ->> 'masked_text_hash',
           input_stage = 'MASKED'
     where id = i.id;
  elsif p_to = 'CLAIM_CONFIRMED' then
    -- 이 입력의 모든 Claim 최신 revision 이 확정 또는 제거여야 하고 확정이 하나 이상이어야 한다.
    select count(*) filter (where not rv.is_removed and rv.user_confirmed),
           count(*) filter (where not rv.is_removed and not rv.user_confirmed)
      into n, n2
      from public.claims cl
      join lateral (select * from public.claim_revisions x where x.claim_id = cl.id order by x.revision_no desc limit 1) rv on true
     where cl.source_input_id = i.id;
    if n < 1 then
      raise exception '사용자가 확정한 Claim 이 없다' using errcode = 'check_violation';
    end if;
    if n2 > 0 then
      raise exception '확정되지 않은 Claim 이 남아 있다' using errcode = 'check_violation';
    end if;
    update public.case_inputs set claim_confirmed_at = coalesce(claim_confirmed_at, now()) where id = i.id;
    -- 규칙 4: Claim 확인 즉시 원본 삭제를 시도한다.
    for r in select id from private.input_objects where case_input_id = i.id and deleted_at is null loop
      perform private.enqueue_file_cleanup('INPUT_OBJECT', r.id, 'CLAIM_CONFIRMED');
    end loop;
    for r in select id from private.ocr_artifacts where case_input_id = i.id and deleted_at is null loop
      perform private.enqueue_file_cleanup('OCR_ARTIFACT', r.id, 'CLAIM_CONFIRMED');
    end loop;
    -- ADR 15.1 물리 삭제 행은 case vector 잔존까지 0건을 요구한다. 그리고
    -- finish_file_cleanup_job 은 vector 가 남아 있으면 삭제 축을 종결하지 못한다.
    for r in select id from private.case_embeddings where case_input_id = i.id loop
      perform private.enqueue_file_cleanup('CASE_EMBEDDING', r.id, 'CLAIM_CONFIRMED');
    end loop;
    perform private.append_case_event(p_owner_id, c.id, 'CASE_INPUT_CLAIMS_CONFIRMED', 'USER', null, null,
              jsonb_build_object('case_input_id', i.id, 'confirmed_claims', n), 'claims-confirmed:' || i.id::text);
  elsif p_to = 'RAW_DELETED' then
    if i.raw_delete_status <> 'SUCCEEDED' then
      raise exception '원본 삭제가 확인되지 않아 RAW_DELETED 로 갈 수 없다' using errcode = 'check_violation';
    end if;
  end if;

  update public.case_inputs set input_stage = p_to where id = i.id returning * into i;
  return i;
end;
$$;
revoke all on function private.advance_input_stage(uuid, uuid, uuid, public.input_stage, jsonb)
  from public, anon, authenticated;
grant execute on function private.advance_input_stage(uuid, uuid, uuid, public.input_stage, jsonb)
  to finshield_worker;

-- ------------------------------------------------------------
-- 6. Claim 기록과 확정 (명세 6.3)
--    worker 는 소유자 표에 직접 쓰지 못하므로 추출 Agent 도 함수로만 쓴다.
--    Revision 은 덮어쓰지 않고 새 번호로 쌓는다 (규칙 5).
-- ------------------------------------------------------------
create or replace function private.record_extracted_claim(
  p_owner_id uuid, p_case_id uuid, p_input_id uuid, p_page_id uuid,
  p_claim_type text, p_statement_masked text, p_materiality text default 'MATERIAL',
  p_extraction_method text default 'RULE', p_structured_value jsonb default '{"schema_version":"v1"}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim uuid;
begin
  if not exists (select 1 from public.case_inputs
                  where id = p_input_id and case_id = p_case_id and owner_id = p_owner_id) then
    raise exception '입력이 없거나 소유자·Case 가 다르다' using errcode = 'insufficient_privilege';
  end if;
  if p_page_id is not null and not exists (select 1 from public.case_input_pages
                  where id = p_page_id and case_input_id = p_input_id) then
    raise exception '페이지가 이 입력의 것이 아니다' using errcode = 'insufficient_privilege';
  end if;

  insert into public.claims
    (owner_id, case_id, source_input_id, source_page_id, origin, claim_type,
     source_locator, extraction_method)
  values (p_owner_id, p_case_id, p_input_id, p_page_id, 'EXTRACTED', p_claim_type,
          jsonb_build_object('schema_version', 'v1', 'case_input_id', p_input_id), p_extraction_method)
  returning id into v_claim;

  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked, structured_value,
     materiality, user_confirmed, is_removed, edit_source, content_hash)
  values (p_owner_id, p_case_id, v_claim, 1, p_statement_masked, p_structured_value,
          p_materiality, false, false, 'EXTRACTION',
          encode(extensions.digest(p_statement_masked || ':1', 'sha256'), 'hex'));
  return v_claim;
end;
$$;
revoke all on function private.record_extracted_claim(uuid, uuid, uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function private.record_extracted_claim(uuid, uuid, uuid, uuid, text, text, text, text, jsonb)
  to finshield_worker;

create or replace function private.confirm_claim(
  p_owner_id uuid, p_case_id uuid, p_claim_id uuid, p_is_removed boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  last public.claim_revisions%rowtype;
  v_no integer;
begin
  if not exists (select 1 from public.claims
                  where id = p_claim_id and case_id = p_case_id and owner_id = p_owner_id) then
    raise exception 'Claim 이 없거나 소유자·Case 가 다르다' using errcode = 'insufficient_privilege';
  end if;
  select * into last from public.claim_revisions
   where claim_id = p_claim_id order by revision_no desc limit 1;
  if not found then
    raise exception 'Revision 이 없는 Claim 은 확정할 수 없다' using errcode = 'check_violation';
  end if;
  if last.user_confirmed and not p_is_removed then
    return last.revision_no;
  end if;
  v_no := last.revision_no + 1;

  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked, structured_value,
     materiality, user_confirmed, is_removed, edit_source, content_hash)
  values (p_owner_id, p_case_id, p_claim_id, v_no, last.statement_masked, last.structured_value,
          last.materiality, not p_is_removed, p_is_removed,
          case when p_is_removed then 'USER_REMOVE' else 'USER_EDIT' end,
          encode(extensions.digest(last.statement_masked || ':' || v_no::text, 'sha256'), 'hex'));
  return v_no;
end;
$$;
revoke all on function private.confirm_claim(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function private.confirm_claim(uuid, uuid, uuid, boolean) to finshield_worker;
