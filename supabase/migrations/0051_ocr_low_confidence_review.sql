-- INP-006·INP-007: OCR의 낮은 신뢰도와 위치를 저장하고 사용자 확인 전 확정을 막는다.

create or replace function private.record_input_page_review(
  p_owner uuid, p_case uuid, p_input uuid, p_pages jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare i public.case_inputs%rowtype; page jsonb; field jsonb; pid uuid; pno integer; n integer;
begin
  select * into i from public.case_inputs
   where id=p_input and owner_id=p_owner and case_id=p_case for update;
  if not found or i.input_type='TEXT' or i.input_outcome<>'ACTIVE' then
    raise exception 'OCR_REVIEW_INPUT_NOT_FOUND' using errcode='42501';
  end if;
  if jsonb_typeof(p_pages) is distinct from 'array'
    or jsonb_array_length(p_pages) not between 1 and 10
    or jsonb_array_length(p_pages)<>(select count(*) from public.case_input_pages where case_input_id=p_input)
    or (select count(distinct x->>'page_no') from jsonb_array_elements(p_pages) x)<>jsonb_array_length(p_pages) then
    raise exception 'OCR_REVIEW_PAGES_INVALID' using errcode='23514';
  end if;

  delete from public.case_input_findings
   where owner_id=p_owner and case_id=p_case and case_input_id=p_input
     and finding_type='LOW_CONFIDENCE'
     and finding_code in ('OCR_URL','OCR_INSTITUTION','OCR_PRODUCT','OCR_NUMBER');

  for page in select * from jsonb_array_elements(p_pages) loop
    if jsonb_typeof(page->'low_confidence_fields') is distinct from 'array'
      or jsonb_array_length(page->'low_confidence_fields')>100
      or jsonb_typeof(page->'text') is distinct from 'string'
      or octet_length(page->>'text')>65536 then
      raise exception 'OCR_REVIEW_PAGE_INVALID' using errcode='23514';
    end if;
    pno:=(page->>'page_no')::integer;
    n:=jsonb_array_length(page->'low_confidence_fields');
    select id into pid from public.case_input_pages
     where case_input_id=p_input and owner_id=p_owner and case_id=p_case and page_no=pno for update;
    if not found or coalesce((page->>'low_confidence_count')::integer,-1)<>n then
      raise exception 'OCR_REVIEW_PAGE_SCOPE_INVALID' using errcode='42501';
    end if;
    update public.case_input_pages set masked_text=page->>'text',low_confidence_count=n,
      locator_schema_version='ocr-review-v1' where id=pid;

    for field in select * from jsonb_array_elements(page->'low_confidence_fields') loop
      if field->>'field_kind' not in ('URL','INSTITUTION','PRODUCT','NUMBER')
        or coalesce((field->>'confidence_milli')::integer,-1) not between 0 and 899
        or jsonb_typeof(field->'bbox') is distinct from 'array'
        or jsonb_array_length(field->'bbox')<>4
        or exists(select 1 from jsonb_array_elements(field->'bbox') value where jsonb_typeof(value)<>'number')
        or coalesce((field->>'start')::integer,-1)<0
        or coalesce((field->>'end')::integer,0)<=coalesce((field->>'start')::integer,0) then
        raise exception 'OCR_REVIEW_FIELD_INVALID' using errcode='23514';
      end if;
      insert into public.case_input_findings
        (owner_id,case_id,case_input_id,page_id,finding_type,finding_code,locator,severity,resolution)
      values(p_owner,p_case,p_input,pid,'LOW_CONFIDENCE','OCR_'||(field->>'field_kind'),
        jsonb_build_object('schema_version','ocr-review-v1','page_no',pno,
          'field_kind',field->>'field_kind','confidence_milli',(field->>'confidence_milli')::integer,
          'bbox',field->'bbox','start',(field->>'start')::integer,'end',(field->>'end')::integer),
        'WARNING','OPEN');
    end loop;
  end loop;
end $$;
revoke all on function private.record_input_page_review(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.record_input_page_review(uuid,uuid,uuid,jsonb) to finshield_worker;

create or replace function private.confirm_case_claims(p_owner uuid, p_case uuid, p_selected jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.financial_cases%rowtype; cl record; rv public.claim_revisions%rowtype;
  item jsonb; text_value text; selected boolean; v_no integer; inp record; structured jsonb;
begin
  select * into c from public.financial_cases where id=p_case and owner_id=p_owner for update;
  if not found or c.deleted_at is not null then raise exception 'Case 접근 불가' using errcode='42501'; end if;
  if c.lifecycle not in ('DRAFT','INPUT_REVIEW') then raise exception '검증 시작 뒤에는 입력을 수정할 수 없다' using errcode='23514'; end if;
  if jsonb_typeof(p_selected) <> 'array' or jsonb_array_length(p_selected) not between 1 and 8 then raise exception '선택 항목 수 오류' using errcode='23514'; end if;
  if (select count(distinct x->>'claim_id') from jsonb_array_elements(p_selected) x) <> jsonb_array_length(p_selected)
    or exists (select 1 from jsonb_array_elements(p_selected) x where not exists (
      select 1 from public.claims where id=(x->>'claim_id')::uuid and case_id=p_case and owner_id=p_owner)) then
    raise exception '중복 또는 타인 Claim' using errcode='42501';
  end if;
  for cl in select * from public.claims where case_id=p_case and owner_id=p_owner order by created_at,id loop
    select * into rv from public.claim_revisions where claim_id=cl.id order by revision_no desc limit 1;
    select x into item from jsonb_array_elements(p_selected) x where x->>'claim_id'=cl.id::text;
    selected := found;
    if selected and item ? 'expected_revision_no' and (item->>'expected_revision_no')::int <> rv.revision_no then
      raise exception '다른 화면에서 항목이 수정되었다' using errcode='40001';
    end if;
    if selected and cl.source_locator->>'review_required'='true' and item->'ocr_reviewed' is distinct from 'true'::jsonb then
      raise exception 'OCR_REVIEW_REQUIRED' using errcode='23514';
    end if;
    text_value := case when selected then coalesce(item->>'statement_masked',rv.statement_masked) else rv.statement_masked end;
    structured := case when text_value=rv.statement_masked then rv.structured_value else '{"schema_version":"v1"}'::jsonb end;
    if cl.source_locator->>'review_required'='true' then structured:=structured||jsonb_build_object('ocr_reviewed',selected); end if;
    v_no := rv.revision_no + 1;
    insert into public.claim_revisions
      (owner_id,case_id,claim_id,revision_no,statement_masked,structured_value,materiality,
       user_confirmed,is_removed,edit_source,content_hash)
    values (p_owner,p_case,cl.id,v_no,text_value,structured,rv.materiality,selected,not selected,
      case when selected then 'USER_EDIT' else 'USER_REMOVE' end,
      encode(extensions.digest(text_value||':'||v_no::text,'sha256'),'hex'));
  end loop;
  for inp in select id from public.case_inputs where case_id=p_case and input_stage='MASKED' loop
    if exists (select 1 from public.claims source_claim join lateral (
      select user_confirmed,is_removed from public.claim_revisions where claim_id=source_claim.id order by revision_no desc limit 1
    ) r on true where source_claim.source_input_id=inp.id and r.user_confirmed and not r.is_removed) then
      perform private.advance_input_stage(p_owner,p_case,inp.id,'CLAIM_CONFIRMED','{}'::jsonb);
    end if;
  end loop;
end $$;
revoke all on function private.confirm_case_claims(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.confirm_case_claims(uuid,uuid,jsonb) to finshield_worker;

create or replace function private.confirm_aftercare_document(p_owner uuid,p_case uuid,p_input uuid,p_passport uuid,p_selected jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; i public.case_inputs%rowtype; c public.financial_cases%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-delete:'||p_owner::text,0));
 select * into c from public.financial_cases where id=p_case and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'CASE_NOT_FOUND' using errcode='42501';end if;
 if c.enrollment_confirmed_at is null then raise exception 'ENROLLMENT_REQUIRED' using errcode='23514';end if;
 if exists(select 1 from public.deletion_requests where target_type='ACCOUNT' and owner_id=p_owner and status<>'COMPLETED') then raise exception 'ACCOUNT_DELETING' using errcode='23514';end if;
 select * into i from public.case_inputs where id=p_input and owner_id=p_owner and case_id=p_case for update;
 if not found or i.input_purpose<>'AFTERCARE' then raise exception 'DOCUMENT_NOT_FOUND' using errcode='42501';end if;
 if jsonb_typeof(p_selected) is distinct from 'array' or jsonb_array_length(p_selected) not between 1 and 8
  or (select count(distinct x->>'id') from jsonb_array_elements(p_selected) x)<>jsonb_array_length(p_selected)
  or (select count(distinct x->>'target_claim_id') from jsonb_array_elements(p_selected) x)<>jsonb_array_length(p_selected) then raise exception 'DOCUMENT_SELECTION_INVALID' using errcode='23514';end if;
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
   or coalesce(char_length(item->>'statement_masked'),0) not between 1 and 400 then raise exception 'DOCUMENT_SELECTION_SCOPE_REJECTED' using errcode='42501';end if;
  if exists(select 1 from public.precase_document_terms d where d.id=(item->>'id')::uuid
      and d.source_locator->>'review_required'='true') and item->'ocr_reviewed' is distinct from 'true'::jsonb then
    raise exception 'OCR_REVIEW_REQUIRED' using errcode='23514';
  end if;
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
