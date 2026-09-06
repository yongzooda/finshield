-- ============================================================
-- 0022. Text 입력 생성 (명세 6.2, SCP-007)
--
-- P0 는 Text·Image·PDF 세 경로를 모두 받는다. Image·PDF 는 0019 의
-- open_upload_slot 이 입력을 만들지만 Text 에는 그런 경로가 없었다.
-- worker 는 public.case_inputs 에 직접 쓰지 못하므로 함수가 필요하다.
--
-- 여기서 만드는 입력은 QUARANTINED 로 시작한다. 마스킹 결과를 바로 적어 넣지
-- 않는다. PII Gate 를 지난 뒤 advance_input_stage 가 한 칸씩 올리는 것이
-- 제품 경로이고, 그 경로를 건너뛰면 어디서 걸러졌는지 기록이 남지 않는다.
-- ============================================================

create or replace function private.create_text_input(
  p_owner_id uuid, p_case_id uuid, p_size_bytes bigint, p_ttl_seconds integer default 86400)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.financial_cases%rowtype;
  v_input uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds not between 1 and 86400 then
    raise exception '원문 수명은 24시간을 넘을 수 없다' using errcode = 'check_violation';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception '크기 상한 10 MiB 를 벗어났다' using errcode = 'check_violation';
  end if;

  select * into c from public.financial_cases
   where id = p_case_id and owner_id = p_owner_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 가 없거나 삭제 중이다' using errcode = 'insufficient_privilege';
  end if;
  if c.lifecycle not in ('DRAFT', 'INPUT_REVIEW', 'NEED_MORE_INFORMATION') then
    raise exception '% 상태의 Case 에는 입력을 만들 수 없다', c.lifecycle using errcode = 'check_violation';
  end if;

  insert into public.case_inputs
    (owner_id, case_id, input_type, input_stage, input_outcome, pii_scan_status, raw_delete_status,
     size_bytes, raw_expires_at)
  values (p_owner_id, p_case_id, 'TEXT'::public.case_input_type, 'QUARANTINED'::public.input_stage,
          'ACTIVE'::public.input_outcome, 'PENDING', 'PENDING'::public.raw_delete_status,
          p_size_bytes, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_input;

  perform private.append_case_event(p_owner_id, p_case_id, 'CASE_INPUT_CREATED', 'USER', null, null,
            jsonb_build_object('case_input_id', v_input, 'input_type', 'TEXT'),
            'input-created:' || v_input::text);
  return v_input;
end;
$$;
revoke all on function private.create_text_input(uuid, uuid, bigint, integer) from public, anon, authenticated;
grant execute on function private.create_text_input(uuid, uuid, bigint, integer) to finshield_worker;

-- ------------------------------------------------------------
-- 2. 실행 중 조회한 공식 출처 기록 (명세 8절, ADR 5.4)
--
-- Tool 이 법령이나 공시를 실제로 조회하면 그 시점의 Snapshot 이 남아야 근거가
-- 될 수 있다. kb 표는 적재 역할의 것이라 worker 가 직접 쓰지 못하므로 함수로 연다.
--
-- 같은 원문을 다시 가져와도 행이 늘지 않는다. identity 가 같으면 조회 시각과
-- 신선도만 갱신하고 같은 id 를 돌려준다. 그래야 같은 출처를 두 번 센 것처럼
-- 보이지 않는다 (EV-006).
-- ------------------------------------------------------------
create or replace function private.record_source_snapshot(
  p_source_type text, p_authority_level public.authority_level, p_publisher_name text,
  p_source_title text, p_canonical_url text, p_official_id text, p_law_name text, p_article_no text,
  p_published_at timestamptz, p_effective_from date, p_source_version text, p_content_hash text,
  p_source_fingerprint text, p_freshness public.freshness_status, p_license_code text,
  p_is_complete boolean, p_is_citable boolean, p_adapter text, p_request_key text,
  p_fresh_seconds integer default 3600)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing uuid;
begin
  if p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception '본문 해시 형식이 아니다' using errcode = 'check_violation';
  end if;
  if p_fresh_seconds is null or p_fresh_seconds not between 1 and 604800 then
    raise exception '신선도 수명이 범위를 벗어났다' using errcode = 'check_violation';
  end if;

  select id into v_existing from kb.source_snapshots
   where source_type = p_source_type and official_id is not distinct from p_official_id
     and source_version is not distinct from p_source_version and content_hash = p_content_hash;

  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id,
     law_name, article_no, published_at, effective_from, retrieved_at, source_version,
     content_hash, source_fingerprint, freshness_status, license_code, is_complete, is_citable)
  values (p_source_type, p_authority_level, p_publisher_name, p_source_title, p_canonical_url,
          p_official_id, p_law_name, p_article_no, p_published_at, p_effective_from, now(),
          p_source_version, p_content_hash, p_source_fingerprint, p_freshness, p_license_code,
          p_is_complete, p_is_citable)
  on conflict (source_type, official_id, source_version, content_hash)
    do update set retrieved_at = now(), freshness_status = excluded.freshness_status
  returning id into v_id;

  -- 조회 결과가 기존 Snapshot 과 같으면 UNCHANGED, 새 내용이면 CHANGED 다.
  -- identity 가 같아 갱신만 된 경우와 새로 만든 경우를 나눠 적는다.
  insert into kb.source_fetch_events
    (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
  values (v_id, p_adapter, p_request_key, case when v_existing is null then 'CHANGED' else 'UNCHANGED' end, p_freshness, now(),
          now() + make_interval(secs => p_fresh_seconds));
  return v_id;
end;
$$;
revoke all on function private.record_source_snapshot(text, public.authority_level, text, text, text, text,
  text, text, timestamptz, date, text, text, text, public.freshness_status, text, boolean, boolean,
  text, text, integer) from public, anon, authenticated;
grant execute on function private.record_source_snapshot(text, public.authority_level, text, text, text, text,
  text, text, timestamptz, date, text, text, text, public.freshness_status, text, boolean, boolean,
  text, text, integer) to finshield_worker;
