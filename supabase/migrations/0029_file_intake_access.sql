-- INP-003·CLM-001·SEC-PRI-010: 파일 입력은 소유자·입력에 묶인 서버 함수로만 처리한다.
create or replace function private.file_input_context(p_owner uuid,p_case uuid,p_input uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.case_inputs%rowtype; result jsonb;
begin
 select * into i from public.case_inputs where id=p_input and case_id=p_case and owner_id=p_owner for update;
 if not found or i.input_type='TEXT' or i.input_outcome<>'ACTIVE' or i.input_stage<>'QUARANTINED'
   or i.raw_expires_at<=now() or not exists(select 1 from public.financial_cases where id=p_case and deleted_at is null) then
   raise exception '처리 가능한 본인 입력이 아니다' using errcode='insufficient_privilege';
 end if;
 select jsonb_build_object('object_id',o.id,'object_path',o.object_path,'declared_mime',i.declared_mime,'size_bytes',i.size_bytes)
 into result from private.input_objects o where o.case_input_id=i.id and o.owner_id=p_owner
   and o.slot_state='OPEN' and o.deleted_at is null and o.access_blocked_at is null;
 if result is null then raise exception '열린 업로드가 없다' using errcode='insufficient_privilege'; end if;
 return result;
end $$;
revoke all on function private.file_input_context(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.file_input_context(uuid,uuid,uuid) to finshield_worker;

create or replace function private.record_file_ocr_consent(p_owner uuid,p_case uuid,p_input uuid,p_granted boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare consent_id uuid;
begin
 perform private.file_input_context(p_owner,p_case,p_input);
 insert into public.processing_consents(owner_id,case_id,case_input_id,consent_type,notice_version,provider_code,data_categories,decision)
 values(p_owner,p_case,p_input,'EXTERNAL_OCR_RAW_TRANSFER','ocr-notice-v1','NAVER_CLOVA_OCR',
   array['UPLOADED_DOCUMENT_RAW'],case when p_granted then 'GRANTED' else 'DENIED' end) returning id into consent_id;
 update public.case_inputs set external_ocr_consent_id=consent_id where id=p_input;
 return consent_id;
end $$;
revoke all on function private.record_file_ocr_consent(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function private.record_file_ocr_consent(uuid,uuid,uuid,boolean) to finshield_worker;

create or replace function private.input_page_ids(p_owner uuid,p_case uuid,p_input uuid)
returns table(id uuid,page_no integer) language sql stable security definer set search_path='' as $$
 select p.id,p.page_no from public.case_input_pages p join public.financial_cases c on c.id=p.case_id
 where p.owner_id=p_owner and p.case_id=p_case and p.case_input_id=p_input and c.deleted_at is null order by p.page_no
$$;
revoke all on function private.input_page_ids(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.input_page_ids(uuid,uuid,uuid) to finshield_worker;
