-- B-DEMO-01·N-PERF-004: Seed 최신성 사건과 v5 실행 시간 제한 Manifest.
begin;

do $$
declare
  manifest_id uuid;
  old_agent_count int;
  new_agent_count int;
  old_tool_count int;
  new_tool_count int;
begin
  if not exists(
    select 1
      from kb.source_snapshots s
      join kb.source_fetch_events e on e.source_snapshot_id=s.id
     where s.official_id='kinfa:declare-center'
       and s.source_version='2026-09-05'
       and s.content_hash='0b7ff634837f01e9df7a760bd8ca72e6cc4cf80f9a205354ae686fb3e029d1b2'
       and e.request_key like 'kinfa:declare-center:%:demo-seed-v1:%'
       and e.outcome='UNCHANGED' and e.freshness_status='FRESH'
       and e.fresh_until>e.retrieved_at
  ) then raise exception 'Seed 사칭 안내 재조회 사건 누락'; end if;

  select id into manifest_id from private.execution_manifests
   where manifest_version='finshield-p0-loan-v5'
     and model_bundle->'timeout_policy'='{
       "domainChoiceMs":4000,
       "domainDecisionMs":9000,
       "domainStageMs":15000,
       "reviewChoiceMs":5000,
       "reviewDecisionMs":8000,
       "reviewStageMs":15000,
       "judgeMs":12000,
       "demoRunMs":110000
     }'::jsonb;
  if manifest_id is null then raise exception 'v5 모델 시간 제한 Manifest 누락'; end if;

  select count(*) into old_agent_count from private.execution_manifest_agents a
   join private.execution_manifests m on m.id=a.execution_manifest_id
    and m.manifest_version='finshield-p0-loan-v4';
  select count(*) into new_agent_count from private.execution_manifest_agents
   where execution_manifest_id=manifest_id;
  select count(*) into old_tool_count from private.execution_manifest_tools t
   join private.execution_manifests m on m.id=t.execution_manifest_id
    and m.manifest_version='finshield-p0-loan-v4';
  select count(*) into new_tool_count from private.execution_manifest_tools
   where execution_manifest_id=manifest_id;
  if new_agent_count<>old_agent_count or new_tool_count<>old_tool_count then
    raise exception 'v5 Manifest Agent·Tool 연결 불일치: agents %/%, tools %/%',
      new_agent_count,old_agent_count,new_tool_count,old_tool_count;
  end if;
  raise notice '통과: Seed 사칭 안내 최신성, v5 시간 제한, Agent·Tool 연결';
end $$;

do $$ begin raise notice '35_demo_runtime_reliability 시험을 모두 통과했습니다'; end $$;
rollback;
