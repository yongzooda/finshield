-- AI-007·N-OPS-003: 제품 Fast Rerank의 Manifest·예산·권한 계약.
-- 10_budget_rate_invariants 가 예산 원장을 합성 Fixture 로 갈아엎고 commit 하므로
-- Migration 이 남긴 실제 상한을 보려면 그 앞에서 실행해야 한다. 09_ 접두사가 그 자리다.
begin;
do $$
declare manifest uuid;base uuid;result jsonb;
begin
 select id into manifest from private.execution_manifests where manifest_version='finshield-p0-loan-v21'
   and model_bundle->'retrieval'='{"embedding_model":"embed-v4.0","rerank_model":"rerank-v4.0-fast","keyword_candidate_pool":20,"vector_candidate_pool":20,"max_rerank_candidates":40,"top_k":5,"max_query_bytes":8192,"max_document_bytes":32768,"max_tokens_per_document":4096,"pricing_version":"cohere-text-usd-20260907"}'::jsonb;
 if manifest is null then raise exception 'v21 Retrieval Manifest 누락';end if;
 select id into base from private.execution_manifests where manifest_version='finshield-p0-loan-v20';
 if base is null then raise exception 'v20 기준 Manifest 누락';end if;
 -- 복사 누락을 잡으려고 개수를 직접 고정하고 직전 Manifest 와 같은지도 함께 본다.
 if (select count(*) from private.execution_manifest_agents where execution_manifest_id=manifest)<>7
   or (select count(*) from private.execution_manifest_tools where execution_manifest_id=manifest)<>20
   or (select count(*) from private.execution_manifest_agents where execution_manifest_id=manifest)
      <>(select count(*) from private.execution_manifest_agents where execution_manifest_id=base)
   or (select count(*) from private.execution_manifest_tools where execution_manifest_id=manifest)
      <>(select count(*) from private.execution_manifest_tools where execution_manifest_id=base) then
   raise exception 'v21 Agent·Tool 연결 불일치';end if;
 if (select count(*) from private.budget_limits where provider='cohere' and model='rerank-v4.0-fast'
      and (scope_type,limit_microunits) in (('GLOBAL_DAY',2000000),('OWNER_DAY',500000),('CASE',500000),('RUN',100000)))<>4 then
   raise exception 'Fast 네 범위 예산 누락';end if;
 result:=private.apply_judge_rerank_budget_policy();
 if result->>'policy_version'<>'judge-readiness-20260908-v2' then raise exception 'Fast 정책 멱등 적용 실패';end if;
 if has_function_privilege('authenticated','private.reserve_precase_usage(uuid,uuid,uuid,text,text,text,bigint)','EXECUTE')
   or not has_function_privilege('finshield_worker','private.reserve_precase_usage(uuid,uuid,uuid,text,text,text,bigint)','EXECUTE') then
   raise exception '가입 후 Fast 예약 함수 권한 오류';end if;
 if position('rerank-v4.0-fast' in pg_get_functiondef('private.reserve_precase_usage(uuid,uuid,uuid,text,text,text,bigint)'::regprocedure))=0 then
   raise exception '가입 후 Fast 모델 허용 누락';end if;
 raise notice '통과: v21 Retrieval Provider·Fast 네 범위 예산·가입 후 예약 권한';
end $$;
do $$ begin raise notice '09_retrieval_fast_runtime 시험을 모두 통과했습니다';end $$;
rollback;
