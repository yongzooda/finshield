-- SEC-FILE-006·N-SEC-012: 업로드 응답 전에 TTL Workflow를 예약하고 정확한 입력만 만료 정리한다.
create or replace function private.file_expiry_context(p_input uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('owner_id',o.owner_id,'case_id',o.case_id,'expires_at',o.expires_at,
   'pending',o.deleted_at is null or exists(select 1 from private.ocr_artifacts a where a.case_input_id=p_input and a.deleted_at is null))
 from private.input_objects o where o.case_input_id=p_input
$$;
revoke all on function private.file_expiry_context(uuid) from public,anon,authenticated;
grant execute on function private.file_expiry_context(uuid) to finshield_worker;

create or replace function private.expire_file_input(p_input uuid)
returns void language plpgsql security definer set search_path='' as $$
declare o private.input_objects%rowtype; a record;
begin
 select * into o from private.input_objects where case_input_id=p_input for update;
 if not found then return;end if;
 if o.expires_at>now() then raise exception '아직 만료되지 않은 입력' using errcode='check_violation';end if;
 if o.deleted_at is null then perform private.enqueue_file_cleanup('INPUT_OBJECT',o.id,'TTL_EXPIRED');end if;
 for a in select id from private.ocr_artifacts where case_input_id=p_input and deleted_at is null loop
   perform private.enqueue_file_cleanup('OCR_ARTIFACT',a.id,'TTL_EXPIRED');
 end loop;
end $$;
revoke all on function private.expire_file_input(uuid) from public,anon,authenticated;
grant execute on function private.expire_file_input(uuid) to finshield_worker;
