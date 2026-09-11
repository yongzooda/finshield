begin;
do $$
declare m uuid; p jsonb;
begin
 select id,model_bundle->'timeout_policy' into strict m,p from private.execution_manifests where manifest_version='finshield-p0-loan-v10';
 if (select count(*) from private.execution_manifest_agents where execution_manifest_id=m)<>7 or (select count(*) from private.execution_manifest_tools where execution_manifest_id=m)<>20 then raise exception 'v10 연결 누락'; end if;
 if p->>'demoRunMs'<>'115000' then raise exception '전체 Demo 기한 변경'; end if;
 if (select model_bundle->'timeout_policy'->>'judgeMs' from private.execution_manifests where manifest_version='finshield-p0-loan-v9')<>'12000' then raise exception '과거 설정 변경'; end if;
 raise notice '42_member_shared_deadline: 연결·전체 Demo 기한·과거 설정 보존 통과했습니다';
end $$;
rollback;
