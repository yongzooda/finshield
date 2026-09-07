-- INP-013·SEC-PRI-010·CLM-006: 외부 OCR 승인과 파일 위치를 worker 함수 경계에서 검사한다.
create or replace function private.authorize_file_ocr(p_owner uuid,p_case uuid,p_input uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare allowed boolean; consent uuid;
begin
 select i.external_ocr_consent_id into consent from public.case_inputs i
 join public.financial_cases c on c.id=i.case_id
 where i.id=p_input and i.case_id=p_case and i.owner_id=p_owner and c.deleted_at is null
 and i.input_outcome='ACTIVE' and i.input_stage='VALIDATED' and i.raw_expires_at>now() for update of i;
 allowed := found and exists(select 1 from public.processing_consents s
   where s.id=consent and s.owner_id=p_owner and s.case_id=p_case and s.case_input_id=p_input
   and s.consent_type='EXTERNAL_OCR_RAW_TRANSFER' and s.provider_code='NAVER_CLOVA_OCR' and s.decision='GRANTED'
   and not exists(select 1 from public.processing_consents newer where newer.supersedes_consent_id=s.id))
 and exists(select 1 from private.input_objects o where o.case_input_id=p_input and o.owner_id=p_owner
   and o.slot_state='UPLOADED' and o.deleted_at is null and o.access_blocked_at is null);
 insert into private.audit_events(correlation_id,event_code,actor_type,owner_ref,case_id,status_code)
 values(gen_random_uuid(),case when allowed then 'EXTERNAL_OCR_RAW_AUTHORIZED' else 'EXTERNAL_OCR_RAW_BLOCKED' end,
 'SYSTEM',p_owner,p_case,case when allowed then 'AUTHORIZED' else 'BLOCKED' end);
 return allowed;
end $$;
revoke all on function private.authorize_file_ocr(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.authorize_file_ocr(uuid,uuid,uuid) to finshield_worker;

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

-- SEC-FILE-006: 호출한 Case의 작업만 임대하고, 만료된 실행의 임대를 회수한다.
create or replace function private.claim_case_cleanup(p_owner uuid,p_case uuid)
returns setof private.file_cleanup_jobs language plpgsql security definer set search_path='' as $$
begin
 return query with picked as (
 select j.id from private.file_cleanup_jobs j where j.owner_id=p_owner and j.case_id=p_case
 and (j.status in ('QUEUED','FAILED') or (j.status='RUNNING' and j.leased_until<now()))
 and j.available_at<=now() and j.attempt_no<j.max_attempts
 and (j.leased_until is null or j.leased_until<now()) order by j.created_at limit 20 for update skip locked)
 update private.file_cleanup_jobs j set status='RUNNING',lease_token=gen_random_uuid(),leased_until=now()+interval '60 seconds',
 heartbeat_at=now(),attempt_no=j.attempt_no+1,error_code=null from picked where j.id=picked.id returning j.*;
end $$;
revoke all on function private.claim_case_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function private.claim_case_cleanup(uuid,uuid) to finshield_worker;

create or replace function private.cleanup_object_context(p_job uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.file_cleanup_jobs%rowtype; path text; bucket text;
begin
 select * into j from private.file_cleanup_jobs where id=p_job and lease_token=p_lease
 and status='RUNNING' and leased_until>now();
 if not found then raise exception '삭제 임대가 유효하지 않다' using errcode='lock_not_available'; end if;
 if j.target_type='INPUT_OBJECT' then
 select o.object_path,o.bucket_id into path,bucket from private.input_objects o
 where o.id=j.target_id and o.owner_id=j.owner_id and o.case_id=j.case_id;
 elsif j.target_type='OCR_ARTIFACT' then
 select o.storage_object_path,'finshield-quarantine' into path,bucket from private.ocr_artifacts o
 where o.id=j.target_id and o.owner_id=j.owner_id and o.case_id=j.case_id;
 end if;
 return jsonb_build_object('path',path,'bucket',bucket);
end $$;
revoke all on function private.cleanup_object_context(uuid,uuid) from public,anon,authenticated;
grant execute on function private.cleanup_object_context(uuid,uuid) to finshield_worker;
