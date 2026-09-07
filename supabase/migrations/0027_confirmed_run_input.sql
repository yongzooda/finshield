-- CLM-003·SEC-PRI-010: 수정·선택은 원장에 먼저 남기고 검증은 고정된 Revision만 읽는다.
create or replace function private.confirm_case_claims(p_owner uuid, p_case uuid, p_selected jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.financial_cases%rowtype; cl record; rv public.claim_revisions%rowtype;
  item jsonb; text_value text; selected boolean; v_no integer; inp record;
begin
  select * into c from public.financial_cases where id=p_case and owner_id=p_owner for update;
  if not found or c.deleted_at is not null then
    raise exception 'Case 접근 불가' using errcode='insufficient_privilege';
  end if;
  if c.lifecycle not in ('DRAFT','INPUT_REVIEW') then
    raise exception '검증 시작 뒤에는 입력을 수정할 수 없다' using errcode='check_violation';
  end if;
  if jsonb_typeof(p_selected) <> 'array' or jsonb_array_length(p_selected) not between 1 and 8 then
    raise exception '선택 항목 수 오류' using errcode='check_violation';
  end if;
  if (select count(distinct x->>'claim_id') from jsonb_array_elements(p_selected) x) <> jsonb_array_length(p_selected)
    or exists (select 1 from jsonb_array_elements(p_selected) x where not exists (
      select 1 from public.claims where id=(x->>'claim_id')::uuid and case_id=p_case and owner_id=p_owner)) then
    raise exception '중복 또는 타인 Claim' using errcode='insufficient_privilege';
  end if;
  for cl in select * from public.claims where case_id=p_case and owner_id=p_owner order by created_at,id loop
    select * into rv from public.claim_revisions where claim_id=cl.id order by revision_no desc limit 1;
    select x into item from jsonb_array_elements(p_selected) x where x->>'claim_id'=cl.id::text;
    selected := found;
    if selected and item ? 'expected_revision_no' and (item->>'expected_revision_no')::int <> rv.revision_no then
      raise exception '다른 화면에서 항목이 수정되었다' using errcode='serialization_failure';
    end if;
    text_value := case when selected then coalesce(item->>'statement_masked',rv.statement_masked) else rv.statement_masked end;
    v_no := rv.revision_no + 1;
    insert into public.claim_revisions
      (owner_id,case_id,claim_id,revision_no,statement_masked,structured_value,materiality,
       user_confirmed,is_removed,edit_source,content_hash)
    values (p_owner,p_case,cl.id,v_no,text_value,
      case when text_value=rv.statement_masked then rv.structured_value else '{"schema_version":"v1"}'::jsonb end,
      rv.materiality,selected,not selected,case when selected then 'USER_EDIT' else 'USER_REMOVE' end,
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

create or replace function private.read_run_input(p_owner uuid,p_case uuid,p_run uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('journey_stage',c.journey_stage,'deadline_at',r.deadline_at,
    'profile_version_id',r.profile_version_id,
    'profile_completeness',(select completeness from public.financial_profile_versions where id=r.profile_version_id),
    'claims',(select jsonb_agg(jsonb_build_object('claim_id',cl.id,'claim_type',cl.claim_type,
      'statement_masked',rv.statement_masked,'materiality',rc.materiality) order by cl.created_at,cl.id)
      from public.verification_run_claims rc join public.claims cl on cl.id=rc.claim_id
      join public.claim_revisions rv on rv.id=rc.claim_revision_id
      where rc.verification_run_id=r.id and rc.selected_for_verification))
  from public.verification_runs r join public.financial_cases c on c.id=r.case_id
  where r.id=p_run and r.case_id=p_case and r.owner_id=p_owner and c.deleted_at is null
$$;
revoke all on function private.read_run_input(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.read_run_input(uuid,uuid,uuid) to finshield_worker;
