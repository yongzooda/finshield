-- B-DEMO-01·N-PERF-004: Production 실측 뒤 보정한 v6 실행 시간 제한 Manifest.
begin;

do $$
declare
  manifest_id uuid;
begin
  select id into manifest_id from private.execution_manifests
   where manifest_version='finshield-p0-loan-v6'
     and model_bundle->'timeout_policy'='{
       "domainChoiceMs":6000,
       "domainDecisionMs":9000,
       "domainStageMs":16000,
       "reviewChoiceMs":5000,
       "reviewDecisionMs":8000,
       "reviewStageMs":15000,
       "judgeMs":12000,
       "demoRunMs":110000
     }'::jsonb;
  if manifest_id is null then raise exception 'v6 모델 시간 제한 Manifest 누락'; end if;
  if (select count(*) from private.execution_manifest_agents where execution_manifest_id=manifest_id)<>7
     or (select count(*) from private.execution_manifest_tools where execution_manifest_id=manifest_id)<>19 then
    raise exception 'v6 Manifest Agent·Tool 연결 불일치';
  end if;
  raise notice '통과: v6 Domain 선택 6초·단계 16초, Agent 7개·Tool 19개';
end $$;

do $$ begin raise notice '36_demo_regulation_timeout 시험을 모두 통과했습니다'; end $$;
rollback;
