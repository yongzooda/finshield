-- INP-013·CLM-003: 중단·삭제·마스킹 전 입력에 늦게 도착한 추출 결과를 기록하지 않는다.
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
  perform 1 from public.case_inputs i join public.financial_cases c on c.id=i.case_id
    where i.id=p_input_id and i.case_id=p_case_id and i.owner_id=p_owner_id
      and i.input_stage='MASKED' and i.input_outcome='ACTIVE' and c.deleted_at is null
      and i.raw_expires_at>now() and c.lifecycle in ('DRAFT','INPUT_REVIEW','NEED_MORE_INFORMATION') for update of i,c;
  if not found then
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
