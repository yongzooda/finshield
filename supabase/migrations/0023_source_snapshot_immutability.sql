-- ============================================================
-- 0023. 출처 Snapshot 기록을 불변 규칙에 맞춘다 (명세 8절)
--
-- 0022 의 record_source_snapshot 은 같은 identity 를 만나면 조회 시각을
-- 갱신하려 했다. 그런데 kb.source_snapshots 는 불변 표라 UPDATE 자체가 막힌다.
-- Snapshot 은 그 시점의 원문을 고정한 값이므로 나중에 손대면 안 되는 것이 맞다.
--
-- 그래서 이미 있는 identity 면 그 행을 그대로 쓰고 조회 사실만 fetch event 로
-- 남긴다. 같은 원문을 몇 번 조회했는지는 event 가 말하고, 원문이 무엇이었는지는
-- Snapshot 이 말한다. 두 축을 섞지 않는다.
--
-- 조회 기록은 (adapter, request_key) 로 유일하고 수정되지 않는다. 그래서 부르는
-- 쪽이 실행마다 다른 key 를 준다. 어느 Run 이 어떤 출처를 봤는지가 그렇게 남는다.
-- ============================================================

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
  v_outcome text;
begin
  if p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception '본문 해시 형식이 아니다' using errcode = 'check_violation';
  end if;
  if p_source_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception '출처 지문 형식이 아니다' using errcode = 'check_violation';
  end if;
  if p_fresh_seconds is null or p_fresh_seconds not between 1 and 604800 then
    raise exception '신선도 수명이 범위를 벗어났다' using errcode = 'check_violation';
  end if;

  select id into v_id from kb.source_snapshots
   where source_type = p_source_type
     and official_id is not distinct from p_official_id
     and source_version is not distinct from p_source_version
     and content_hash = p_content_hash;

  if v_id is null then
    insert into kb.source_snapshots
      (source_type, authority_level, publisher_name, source_title, canonical_url, official_id,
       law_name, article_no, published_at, effective_from, retrieved_at, source_version,
       content_hash, source_fingerprint, freshness_status, license_code, is_complete, is_citable)
    values (p_source_type, p_authority_level, p_publisher_name, p_source_title, p_canonical_url,
            p_official_id, p_law_name, p_article_no, p_published_at, p_effective_from, now(),
            p_source_version, p_content_hash, p_source_fingerprint, p_freshness, p_license_code,
            p_is_complete, p_is_citable)
    returning id into v_id;
    v_outcome := 'CHANGED';
  else
    -- 원문이 그대로다. Snapshot 은 손대지 않고 조회했다는 사실만 남긴다.
    v_outcome := 'UNCHANGED';
  end if;

  insert into kb.source_fetch_events
    (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
  values (v_id, p_adapter, p_request_key, v_outcome, p_freshness, now(),
          now() + make_interval(secs => p_fresh_seconds))
  -- 조회 기록도 불변이다. 같은 요청 key 가 이미 있으면 그 사실이 이미 남은 것이다.
  on conflict (source_adapter, request_key) do nothing;
  return v_id;
end;
$$;
revoke all on function private.record_source_snapshot(text, public.authority_level, text, text, text, text,
  text, text, timestamptz, date, text, text, text, public.freshness_status, text, boolean, boolean,
  text, text, integer) from public, anon, authenticated;
grant execute on function private.record_source_snapshot(text, public.authority_level, text, text, text, text,
  text, text, timestamptz, date, text, text, text, public.freshness_status, text, boolean, boolean,
  text, text, integer) to finshield_worker;
