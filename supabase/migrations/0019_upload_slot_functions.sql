-- ============================================================
-- 0019 서버가 만드는 one-use upload slot (명세 4.3, 6.1, ADR 6.1)
--
-- ADR 6.1 은 업로드 첫 단계를 "서버가 인증 사용자·Case·MIME·크기 상한을 검증하고
-- random object path 의 one-use upload slot 을 만든다" 로 정한다. 그런데 slot 을
-- 만드는 서버 함수가 없어서 Worker 역할로는 입력도 slot 도 만들 수 없었다.
-- B-STORAGE-01 을 재려다 그 사실을 확인했다.
--
-- 여기서 세 함수를 만든다. 경로는 서버가 정하고 호출자가 고르지 못한다.
-- Forward-only 다. 앞선 Migration 파일은 고치지 않는다.
-- ============================================================

-- 열린 slot 하나를 만든다. 경로는 owner/case/input/random.ext 로 서버가 짓는다.
create or replace function private.open_upload_slot(
  p_owner_id uuid, p_case_id uuid, p_input_type public.case_input_type,
  p_declared_mime text, p_size_bytes bigint, p_page_count integer default 1,
  p_ttl_seconds integer default 86400)
returns table (case_input_id uuid, object_id uuid, object_path text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   public.financial_cases%rowtype;
  v_input  uuid;
  v_object uuid := gen_random_uuid();
  v_ext    text;
  v_path   text;
  v_expires timestamptz;
begin
  if p_input_type = 'TEXT' then
    raise exception 'Text 입력에는 upload slot 이 없다' using errcode = 'check_violation';
  end if;
  if p_ttl_seconds not between 1 and 86400 then
    raise exception 'slot 수명은 24시간을 넘을 수 없다' using errcode = 'check_violation';
  end if;
  -- 선언 MIME 은 Bucket 이 허용한 것만 받는다. Magic Byte 검증은 업로드 뒤 서버가 한다.
  v_ext := case p_declared_mime
             when 'image/png' then 'png'
             when 'image/jpeg' then 'jpg'
             when 'application/pdf' then 'pdf'
             else null end;
  if v_ext is null then
    raise exception '허용하지 않는 선언 MIME 이다: %', p_declared_mime using errcode = 'check_violation';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception '크기 상한 10 MiB 를 벗어났다' using errcode = 'check_violation';
  end if;

  select * into c from public.financial_cases where id = p_case_id and owner_id = p_owner_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 가 없거나 삭제 중이다' using errcode = 'insufficient_privilege';
  end if;
  if c.lifecycle not in ('DRAFT', 'INPUT_REVIEW', 'NEED_MORE_INFORMATION') then
    raise exception '% 상태의 Case 에는 입력을 만들 수 없다', c.lifecycle using errcode = 'check_violation';
  end if;

  v_expires := now() + make_interval(secs => p_ttl_seconds);
  insert into public.case_inputs
    (owner_id, case_id, input_type, input_stage, input_outcome, pii_scan_status, raw_delete_status,
     raw_expires_at, declared_mime, page_count, size_bytes)
  values (p_owner_id, p_case_id, p_input_type, 'QUARANTINED', 'ACTIVE', 'PENDING', 'PENDING',
          v_expires, p_declared_mime, p_page_count, p_size_bytes)
  returning id into v_input;

  v_path := p_owner_id::text || '/' || p_case_id::text || '/' || v_input::text || '/' || v_object::text || '.' || v_ext;
  insert into private.input_objects
    (id, owner_id, case_id, case_input_id, input_type, bucket_id, object_path, safe_extension,
     encryption_state, slot_state, expires_at)
  values (v_object, p_owner_id, p_case_id, v_input, p_input_type, 'finshield-quarantine', v_path, v_ext,
          'UNKNOWN', 'OPEN', v_expires);

  return query select v_input, v_object, v_path, v_expires;
end;
$$;

comment on function private.open_upload_slot(uuid, uuid, public.case_input_type, text, bigint, integer, integer) is
  '서버가 만드는 one-use upload slot. 경로는 서버가 정하고 호출자가 고르지 못한다 (ADR 6.1)';

revoke all on function private.open_upload_slot(uuid, uuid, public.case_input_type, text, bigint, integer, integer)
  from public, anon, authenticated;
grant execute on function private.open_upload_slot(uuid, uuid, public.case_input_type, text, bigint, integer, integer)
  to finshield_worker;

-- 업로드가 확인된 slot 을 닫는다. 한 번만 성공하고 다시 부르면 거부한다.
create or replace function private.confirm_upload_slot(p_object_id uuid, p_magic_signature text)
returns private.input_objects
language plpgsql
security definer
set search_path = ''
as $$
declare o private.input_objects%rowtype;
begin
  select * into o from private.input_objects where id = p_object_id for update;
  if not found then
    raise exception 'slot 이 없다' using errcode = 'no_data_found';
  end if;
  if o.slot_state <> 'OPEN' or o.deleted_at is not null then
    raise exception '% slot 은 다시 확인할 수 없다', o.slot_state using errcode = 'check_violation';
  end if;
  if p_magic_signature is null or octet_length(p_magic_signature) = 0 then
    raise exception 'Magic Byte 확인 결과가 없다' using errcode = 'check_violation';
  end if;
  update private.input_objects
     set slot_state = 'UPLOADED', uploaded_at = now(), encryption_state = 'VERIFIED'
   where id = p_object_id
  returning * into o;
  update public.case_inputs set magic_signature = p_magic_signature where id = o.case_input_id;
  return o;
end;
$$;

comment on function private.confirm_upload_slot(uuid, text) is
  '업로드 확인. OPEN 인 slot 을 한 번만 UPLOADED 로 바꾼다 (ADR 6.1 4단계)';

revoke all on function private.confirm_upload_slot(uuid, text) from public, anon, authenticated;
grant execute on function private.confirm_upload_slot(uuid, text) to finshield_worker;

-- 업로드 없이 slot 을 닫는다. 닫힌 뒤에는 이미 발급된 URL·token 으로도 쓸 수 없어야 한다.
create or replace function private.close_upload_slot(p_object_id uuid, p_reason text)
returns private.input_objects
language plpgsql
security definer
set search_path = ''
as $$
declare o private.input_objects%rowtype;
begin
  select * into o from private.input_objects where id = p_object_id for update;
  if not found then
    raise exception 'slot 이 없다' using errcode = 'no_data_found';
  end if;
  if o.slot_state = 'UPLOADED' then
    raise exception '업로드가 확인된 slot 은 닫기가 아니라 Cleanup 으로 처리한다' using errcode = 'check_violation';
  end if;
  update private.input_objects
     set slot_state = 'CLOSED', access_blocked_at = coalesce(access_blocked_at, now())
   where id = p_object_id
  returning * into o;
  update public.case_inputs set input_outcome = 'CANCELLED', error_code = left(p_reason, 64)
   where id = o.case_input_id and input_outcome = 'ACTIVE';
  return o;
end;
$$;

comment on function private.close_upload_slot(uuid, text) is
  '업로드 없이 slot 을 닫는다. 닫힌 slot 경로는 storage 정책이 더 이상 통과시키지 않는다';

revoke all on function private.close_upload_slot(uuid, text) from public, anon, authenticated;
grant execute on function private.close_upload_slot(uuid, text) to finshield_worker;
