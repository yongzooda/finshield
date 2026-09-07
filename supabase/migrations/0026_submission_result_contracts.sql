-- EV-002·PASS-001: 본인 Passport에 연결된 공식 출처의 표시값만 제공한다.
-- 기존 RLS와 내부 실행 표의 SELECT 거부는 보존한다.

create or replace function public.passport_claims_json(p_passport_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.evidence_passports p join public.financial_cases c on c.id = p.case_id
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
revoke all on function public.passport_claims_json(uuid) from public, anon;
grant execute on function public.passport_claims_json(uuid) to authenticated, finshield_worker;
