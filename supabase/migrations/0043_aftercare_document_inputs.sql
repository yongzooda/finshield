-- PC-008·PC-011: 가입 후 문서는 같은 Case의 임시 입력이며 거래 전 Claim을 변경하지 않는다.
alter table public.case_inputs add column input_purpose text not null default 'PROPOSAL'
 check(input_purpose in ('PROPOSAL','AFTERCARE'));
create table public.precase_document_terms (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, case_id uuid not null,
 case_input_id uuid not null, page_id uuid not null, source_locator jsonb not null,
 original_statement_masked text not null check(char_length(original_statement_masked) between 1 and 400),
 statement_masked text not null check(char_length(statement_masked) between 1 and 400),
 claim_type text not null, materiality text not null, confirmed boolean not null default false,
 removed boolean not null default false, base_passport_id uuid, target_claim_id uuid,
 created_at timestamptz not null default now(), confirmed_at timestamptz,
 foreign key(case_id,owner_id) references public.financial_cases(id,owner_id) on delete cascade,
 foreign key(case_input_id,owner_id,case_id) references public.case_inputs(id,owner_id,case_id) on delete cascade,
 foreign key(page_id,owner_id,case_id,case_input_id) references public.case_input_pages(id,owner_id,case_id,case_input_id) on delete cascade,
 foreign key(base_passport_id,owner_id,case_id) references public.evidence_passports(id,owner_id,case_id) on delete cascade,
 foreign key(target_claim_id,owner_id,case_id) references public.claims(id,owner_id,case_id) on delete cascade,
 check(confirmed=(confirmed_at is not null)),
 check(not confirmed or (base_passport_id is not null and target_claim_id is not null and not removed))
);
create index idx_precase_document_terms__input on public.precase_document_terms(owner_id,case_id,case_input_id);
alter table public.precase_document_terms enable row level security;
alter table public.precase_document_terms force row level security;
create policy precase_document_owner on public.precase_document_terms for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.financial_cases c where c.id=case_id and c.deleted_at is null));
create policy member_session_required on public.precase_document_terms as restrictive for all to authenticated
 using((select public.member_session_active())) with check((select public.member_session_active()));
revoke all on public.precase_document_terms from public,anon,authenticated,finshield_worker;
grant select on public.precase_document_terms to authenticated;
create trigger trg_account_work_guard before insert on public.precase_document_terms for each row execute function private.guard_account_work();
create trigger trg_precase_document_delete before delete on public.precase_document_terms for each row execute function private.reject_direct_delete('public','financial_cases','case_id');

create function private.guard_input_purpose() returns trigger language plpgsql set search_path='' as $$
begin
 if new.input_purpose is distinct from old.input_purpose then raise exception 'INPUT_PURPOSE_IMMUTABLE' using errcode='23514';end if;
 return new;
end $$;
create trigger trg_input_purpose before update of input_purpose on public.case_inputs for each row execute function private.guard_input_purpose();
revoke all on function private.guard_input_purpose() from public,anon,authenticated,finshield_worker;

create or replace function private.open_aftercare_upload_slot(
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-delete:'||p_owner_id::text,0));
  select * into c from public.financial_cases where id = p_case_id and owner_id = p_owner_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 가 없거나 삭제 중이다' using errcode = 'insufficient_privilege';
  end if;
  if c.enrollment_confirmed_at is null or not exists(select 1 from public.evidence_passports where case_id=c.id) then
    raise exception 'ENROLLMENT_PASSPORT_REQUIRED' using errcode='23514';
  end if;
  if exists(select 1 from public.case_inputs where case_id=c.id and input_purpose='AFTERCARE' and input_outcome='ACTIVE'
      and input_stage in ('QUARANTINED','VALIDATED','EXTRACTED','MASKED') and raw_expires_at>now()) then
    raise exception 'AFTERCARE_DOCUMENT_ACTIVE' using errcode='55000';
  end if;

  v_expires := now() + make_interval(secs => p_ttl_seconds);
  insert into public.case_inputs
    (owner_id, case_id, input_purpose, input_type, input_stage, input_outcome, pii_scan_status, raw_delete_status,
     raw_expires_at, declared_mime, page_count, size_bytes)
  values (p_owner_id, p_case_id, 'AFTERCARE', p_input_type, 'QUARANTINED', 'ACTIVE', 'PENDING', 'PENDING',
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

comment on function private.open_aftercare_upload_slot(uuid, uuid, public.case_input_type, text, bigint, integer, integer) is
  '서버가 만드는 one-use upload slot. 경로는 서버가 정하고 호출자가 고르지 못한다 (ADR 6.1)';

revoke all on function private.open_aftercare_upload_slot(uuid, uuid, public.case_input_type, text, bigint, integer, integer)
  from public, anon, authenticated;
grant execute on function private.open_aftercare_upload_slot(uuid, uuid, public.case_input_type, text, bigint, integer, integer)
  to finshield_worker;


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
  select * into i from public.case_inputs where id = p_input_id and case_id = p_case_id and owner_id = p_owner_id for update;
  if not found then raise exception 'INPUT_NOT_FOUND' using errcode='42501';end if;
  if i.input_purpose='AFTERCARE' then
    if c.enrollment_confirmed_at is null then raise exception 'ENROLLMENT_REQUIRED' using errcode='23514';end if;
  elsif c.lifecycle not in ('DRAFT','INPUT_REVIEW','NEED_MORE_INFORMATION') then
    raise exception 'CASE_INPUT_STAGE_REJECTED' using errcode='23514';
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
    if i.input_purpose='AFTERCARE' then
      select count(*) filter(where confirmed and not removed),count(*) filter(where not confirmed and not removed)
       into n,n2 from public.precase_document_terms where case_input_id=i.id;
    else
    select count(*) filter (where not rv.is_removed and rv.user_confirmed),
           count(*) filter (where not rv.is_removed and not rv.user_confirmed)
      into n, n2
      from public.claims cl
      join lateral (select * from public.claim_revisions x where x.claim_id = cl.id order by x.revision_no desc limit 1) rv on true
     where cl.source_input_id = i.id;
    end if;
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

create or replace function private.record_file_claim(p_owner uuid,p_case uuid,p_input uuid,p_page uuid,
 p_type text,p_statement text,p_materiality text,p_locator jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; pno integer;
begin
 select p.page_no into pno from public.case_input_pages p join public.case_inputs i on i.id=p.case_input_id
 join public.financial_cases c on c.id=i.case_id
 where p.id=p_page and p.case_input_id=p_input and p.case_id=p_case and p.owner_id=p_owner
 and i.input_stage='MASKED' and i.input_outcome='ACTIVE' and c.deleted_at is null;
 if not found or jsonb_typeof(p_locator)<>'object' or (p_locator->>'page_no')::integer is distinct from pno
 or p_locator->>'schema_version' is distinct from 'v1' or p_locator->>'kind' is distinct from 'masked_text_span'
 or coalesce((p_locator->>'start')::integer,-1)<0
 or coalesce((p_locator->>'end')::integer,-1)<=coalesce((p_locator->>'start')::integer,0) then
 raise exception '파일 항목의 소유자·페이지·위치가 일치하지 않는다' using errcode='check_violation'; end if;
 if exists(select 1 from public.case_inputs where id=p_input and input_purpose='AFTERCARE') then
   insert into public.precase_document_terms(owner_id,case_id,case_input_id,page_id,source_locator,
     original_statement_masked,statement_masked,claim_type,materiality)
   values(p_owner,p_case,p_input,p_page,p_locator,p_statement,p_statement,p_type,p_materiality) returning id into cid;
   return cid;
 end if;
 -- 위치는 원본 문자가 아닌 마스킹한 페이지 텍스트의 구간이다. 원문/좌표를 모델이 만들지 않는다.
 insert into public.claims(owner_id,case_id,source_input_id,source_page_id,origin,claim_type,source_locator,extraction_method)
 values(p_owner,p_case,p_input,p_page,'EXTRACTED',p_type,p_locator,'MODEL') returning id into cid;
 insert into public.claim_revisions(owner_id,case_id,claim_id,revision_no,statement_masked,structured_value,
 materiality,user_confirmed,is_removed,edit_source,content_hash)
 values(p_owner,p_case,cid,1,p_statement,'{"schema_version":"v1"}',p_materiality,false,false,'EXTRACTION',
 encode(extensions.digest(p_statement||':1','sha256'),'hex'));
 return cid;
end $$;
revoke all on function private.record_file_claim(uuid,uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function private.record_file_claim(uuid,uuid,uuid,uuid,text,text,text,jsonb) to finshield_worker;

create function private.confirm_aftercare_document(p_owner uuid,p_case uuid,p_input uuid,p_passport uuid,p_selected jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; i public.case_inputs%rowtype; c public.financial_cases%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-delete:'||p_owner::text,0));
 select * into c from public.financial_cases where id=p_case and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'CASE_NOT_FOUND' using errcode='42501';end if;
 if c.enrollment_confirmed_at is null then raise exception 'ENROLLMENT_REQUIRED' using errcode='23514';end if;
 if exists(select 1 from public.deletion_requests where target_type='ACCOUNT' and owner_id=p_owner and status<>'COMPLETED') then
  raise exception 'ACCOUNT_DELETING' using errcode='23514';end if;
 select * into i from public.case_inputs where id=p_input and owner_id=p_owner and case_id=p_case for update;
 if not found or i.input_purpose<>'AFTERCARE' then raise exception 'DOCUMENT_NOT_FOUND' using errcode='42501';end if;
 if jsonb_typeof(p_selected) is distinct from 'array' or jsonb_array_length(p_selected) not between 1 and 8
  or (select count(distinct x->>'id') from jsonb_array_elements(p_selected) x)<>jsonb_array_length(p_selected)
  or (select count(distinct x->>'target_claim_id') from jsonb_array_elements(p_selected) x)<>jsonb_array_length(p_selected) then
  raise exception 'DOCUMENT_SELECTION_INVALID' using errcode='23514';end if;
 if i.input_stage in ('CLAIM_CONFIRMED','RAW_DELETED') then
   if (select count(*) from public.precase_document_terms where case_input_id=p_input and confirmed)=jsonb_array_length(p_selected)
    and not exists(select 1 from jsonb_array_elements(p_selected) x where not exists(
      select 1 from public.precase_document_terms d where d.case_input_id=p_input and d.id=(x->>'id')::uuid
       and d.confirmed and d.base_passport_id=p_passport and d.target_claim_id=(x->>'target_claim_id')::uuid
       and d.statement_masked=x->>'statement_masked')) then return;end if;
   raise exception 'DOCUMENT_ALREADY_FINAL' using errcode='55000';
 end if;
 if i.input_stage<>'MASKED' or i.input_outcome<>'ACTIVE' then raise exception 'DOCUMENT_NOT_READY' using errcode='55000';end if;
 for item in select * from jsonb_array_elements(p_selected) loop
  if not exists(select 1 from public.precase_document_terms where id=(item->>'id')::uuid and case_input_id=p_input)
   or not exists(select 1 from public.evidence_passports p join public.final_claim_versions f on f.verification_run_id=p.verification_run_id
    where p.id=p_passport and p.owner_id=p_owner and p.case_id=p_case and f.claim_id=(item->>'target_claim_id')::uuid)
   or coalesce(char_length(item->>'statement_masked'),0) not between 1 and 400 then
   raise exception 'DOCUMENT_SELECTION_SCOPE_REJECTED' using errcode='42501';end if;
 end loop;
 update public.precase_document_terms set removed=true where case_input_id=p_input;
 for item in select * from jsonb_array_elements(p_selected) loop
  update public.precase_document_terms set statement_masked=item->>'statement_masked',confirmed=true,removed=false,
    confirmed_at=now(),base_passport_id=p_passport,target_claim_id=(item->>'target_claim_id')::uuid where id=(item->>'id')::uuid;
 end loop;
 perform private.advance_input_stage(p_owner,p_case,p_input,'CLAIM_CONFIRMED','{}');
end $$;
revoke all on function private.confirm_aftercare_document(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.confirm_aftercare_document(uuid,uuid,uuid,uuid,jsonb) to finshield_worker;

create or replace function private.file_input_context(p_owner uuid,p_case uuid,p_input uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.case_inputs%rowtype; result jsonb;
begin
 select * into i from public.case_inputs where id=p_input and case_id=p_case and owner_id=p_owner for update;
 if not found or i.input_type='TEXT' or i.input_outcome<>'ACTIVE' or i.input_stage<>'QUARANTINED'
   or i.raw_expires_at<=now() or not exists(select 1 from public.financial_cases where id=p_case and deleted_at is null) then
   raise exception '처리 가능한 본인 입력이 아니다' using errcode='insufficient_privilege';
 end if;
 select jsonb_build_object('input_purpose',i.input_purpose,'object_id',o.id,'object_path',o.object_path,'declared_mime',i.declared_mime,'size_bytes',i.size_bytes)
 into result from private.input_objects o where o.case_input_id=i.id and o.owner_id=p_owner
   and o.slot_state='OPEN' and o.deleted_at is null and o.access_blocked_at is null;
 if result is null then raise exception '열린 업로드가 없다' using errcode='insufficient_privilege'; end if;
 return result;
end $$;
revoke all on function private.file_input_context(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.file_input_context(uuid,uuid,uuid) to finshield_worker;

-- 문서의 원문 위치·확인 결과는 점검에서 고정한다. 이후 직접 입력 수정은 문서 연결을 해제해야 한다.
create function private.guard_aftercare_document_review() returns trigger language plpgsql security definer set search_path='' as $$
declare source jsonb;
begin
 if not (new.input_masked ? 'document_sources') then return new;end if;
 if jsonb_typeof(new.input_masked->'document_sources') is distinct from 'array'
  or jsonb_array_length(new.input_masked->'document_sources')>8 then raise exception 'DOCUMENT_SOURCE_INVALID' using errcode='23514';end if;
 for source in select * from jsonb_array_elements(new.input_masked->'document_sources') loop
  if not exists(select 1 from public.precase_document_terms d join public.case_inputs i on i.id=d.case_input_id
   where d.id=(source->>'id')::uuid and d.owner_id=new.owner_id and d.case_id=new.case_id and d.confirmed and not d.removed
    and d.base_passport_id=new.base_passport_id and i.input_purpose='AFTERCARE'
    and i.input_stage in ('CLAIM_CONFIRMED','RAW_DELETED')
    and source=jsonb_build_object('id',d.id,'input_id',d.case_input_id,'target_claim_id',d.target_claim_id,
      'statement_masked',d.statement_masked,'original_statement_masked',d.original_statement_masked,'source_locator',d.source_locator)
    and exists(select 1 from jsonb_array_elements(new.input_masked->'comparison') x
      where x->>'claim_id'=d.target_claim_id::text and x->>'contract'=d.statement_masked)) then
    raise exception 'DOCUMENT_SOURCE_SCOPE_REJECTED' using errcode='42501';end if;
 end loop;
 return new;
end $$;
revoke all on function private.guard_aftercare_document_review() from public,anon,authenticated,finshield_worker;
create trigger trg_precase_document_review before insert on public.precase_review_jobs for each row execute function private.guard_aftercare_document_review();
