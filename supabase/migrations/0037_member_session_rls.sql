-- AUTH-001·SEC-AUTH-002/003: 로그아웃 뒤 남은 JWT의 직접 DB·Storage 접근 차단.
-- auth.sessions는 Supabase 관리형 표다. 업무 데이터·Refresh를 복제하지 않는다.
create or replace function public.member_session_active()
returns boolean
language plpgsql security definer stable set search_path = ''
as $$
declare
  claims jsonb;
  sid text;
  exp_text text;
begin
  claims := auth.jwt();
  sid := claims ->> 'session_id';
  exp_text := claims ->> 'exp';
  if sid is null or sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or exp_text is null or exp_text !~ '^[0-9]{1,12}$' then return false; end if;
  if exp_text::numeric <= extract(epoch from now()) then return false; end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = sid::uuid and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
  );
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.member_session_active() from public, anon, finshield_worker;
grant execute on function public.member_session_active() to authenticated;
comment on function public.member_session_active() is
  '호출 JWT의 Owner·session_id·만료와 Auth 세션 부재를 검사한다. 인자·세션 내용은 공개하지 않는다';

-- 기존 Owner·삭제 상태 정책과 AND로 결합한다. 새 허용 정책을 추가해도 우회하지 못한다.
do $$
declare item record;
begin
  for item in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('create policy member_session_required on public.%I as restrictive for all to authenticated using ((select public.member_session_active())) with check ((select public.member_session_active()))', item.relname);
  end loop;
end;
$$;

create or replace function public.storage_slot_is_open(p_bucket_id text, p_object_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.member_session_active() and exists (
    select 1
      from private.input_objects o
      join public.financial_cases c on c.id = o.case_id and c.owner_id = o.owner_id
     where o.bucket_id = p_bucket_id
       and o.object_path = p_object_name
       and o.owner_id = (select auth.uid())
       and o.slot_state = 'OPEN'
       and o.access_blocked_at is null
       and o.deleted_at is null
       and o.expires_at > now()
       and c.deleted_at is null
  )
$$;

create or replace function public.guide_channels_json(p_action_guide_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not public.member_session_active() or not exists (select 1 from public.action_guides g where g.id = p_action_guide_id and g.owner_id = (select auth.uid()))
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
                     'action_no', ch.action_no, 'display_order', ch.display_order,
                     'institution_code', reg.institution_code, 'channel_type', reg.channel_type,
                     'display_value', reg.display_value, 'valid_from', reg.valid_from, 'valid_to', reg.valid_to)
                     order by ch.display_order)
                     from public.action_guide_channels ch
                     join kb.official_channel_registry reg on reg.id = ch.official_channel_registry_id
                    where ch.action_guide_id = p_action_guide_id), '[]'::jsonb)
  end
$$;

create or replace function public.case_runs_json(p_case_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not public.member_session_active() or not exists (select 1 from public.financial_cases c
                      where c.id = p_case_id and c.owner_id = (select auth.uid()) and c.deleted_at is null)
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
                     'run_id', r.id, 'run_no', r.run_no, 'kind', r.kind, 'status', r.status,
                     'overall_result', r.overall_result, 'coverage_satisfied', r.coverage_satisfied,
                     'partial_reason_codes', r.partial_reason_codes, 'reason_code', r.reason_code,
                     'deadline_at', r.deadline_at, 'started_at', r.started_at, 'finished_at', r.finished_at) order by r.run_no)
                     from public.verification_runs r where r.case_id = p_case_id), '[]'::jsonb)
  end
$$;

create or replace function public.passport_claims_json(p_passport_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not public.member_session_active() or not exists (select 1 from public.evidence_passports p join public.financial_cases c on c.id = p.case_id
                      where p.id = p_passport_id and p.owner_id = (select auth.uid()) and c.deleted_at is null)
    then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
                     'id', f.id, 'claim_id', f.claim_id, 'status', f.status, 'reason_code', f.reason_code, 'is_material', f.is_material,
                     'cove_status', f.cove_status, 'red_team_status', f.red_team_status,
                     'decision_summary_masked', f.decision_summary_masked, 'statement_masked', rv.statement_masked,
                     'evidences', (select coalesce(jsonb_agg(jsonb_build_object(
                                             'evidence_id', e.id, 'relation', ce.relation, 'is_independent', ce.is_independent,
                                             'directness', e.directness, 'citable', e.citable, 'reference_only', e.reference_only,
                                             'incomplete', e.incomplete, 'freshness_at_use', e.freshness_at_use,
                                             'target_match', e.target_match, 'source_locator', e.source_locator,
                                             'excerpt_masked', e.excerpt_masked, 'kb_snapshot_id', e.kb_snapshot_id,
                                             'content_hash', e.content_hash, 'independence_key', e.independence_key,
                                             'created_at', e.created_at, 'title', ss.source_title,
                                             'url', ss.canonical_url, 'publisher_name', ss.publisher_name,
                                             'published_at', ss.published_at, 'fetched_at', ss.retrieved_at,
                                             'official_id', ss.official_id, 'source_version', ss.source_version,
                                             'authority_grade', ss.authority_level) order by e.created_at), '[]'::jsonb)
                                     from public.claim_evidences ce join public.evidences e on e.id = ce.evidence_id
                                     left join kb.source_snapshots ss on ss.id = e.kb_snapshot_id
                                    where ce.final_claim_version_id = f.id)) order by f.is_material desc, f.claim_id)
                     from public.evidence_passports p
                     join public.final_claim_versions f on f.verification_run_id = p.verification_run_id
                     join public.claim_revisions rv on rv.id = f.claim_revision_id
                    where p.id = p_passport_id), '[]'::jsonb)
  end
$$;


-- 정의자 View는 기반 RLS를 우회하므로 세션 조건을 직접 확인한다.
create or replace view public.run_progress_v with (security_invoker = false) as
  select r.id as run_id, r.owner_id, r.case_id, r.run_no, r.kind, r.status, r.deadline_at, r.started_at, r.finished_at,
         r.partial_reason_codes, r.reason_code,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'logical_agent_key', a.logical_agent_key, 'agent_code', a.agent_code, 'agent_version', a.agent_version,
                   'attempt_no', a.attempt_no, 'status', a.status, 'reason_code', a.reason_code,
                   'started_at', a.started_at, 'finished_at', a.finished_at,
                   'tools', (select coalesce(jsonb_agg(jsonb_build_object(
                                       'logical_tool_key', t.logical_tool_key, 'tool_code', t.tool_code, 'transport', t.transport,
                                       'status', t.status, 'candidate_count', t.candidate_count, 'selected_count', t.selected_count,
                                       'provenance_complete', t.provenance_complete, 'reason_code', t.reason_code) order by t.created_at), '[]'::jsonb)
                               from public.tool_runs t where t.agent_run_id = a.id)) order by a.created_at), '[]'::jsonb)
            from public.agent_runs a where a.verification_run_id = r.id) as agents
    from public.verification_runs r
    join public.financial_cases c on c.id = r.case_id
   where c.deleted_at is null
     and r.owner_id = (select auth.uid())
     and (select public.member_session_active());
