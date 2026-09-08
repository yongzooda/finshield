begin;
do $$
declare m uuid; policy jsonb;
begin
 select id,model_bundle->'timeout_policy' into strict m,policy from private.execution_manifests where manifest_version='finshield-p0-loan-v9';
 if (select count(*) from private.execution_manifest_agents where execution_manifest_id=m)<>7
 or (select count(*) from private.execution_manifest_tools where execution_manifest_id=m)<>20 then raise exception 'v9 구성 누락'; end if;
 if (policy->>'domainStageMs')::int*4+(policy->>'reviewStageMs')::int*2+(policy->>'judgeMs')::int+6000>120000 then raise exception 'Text 기한 초과'; end if;
 if (select model_bundle->'timeout_policy'->>'reviewDecisionMs' from private.execution_manifests where manifest_version='finshield-p0-loan-v8')<>'8000' then raise exception '과거 실행 설정 변경'; end if;
 raise notice '41_member_review_runtime: 현재 기한·과거 구성 보존 통과';
end $$;
rollback;
