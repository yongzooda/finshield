-- AI-007·N-OPS-003: 제품 Fast Rerank의 Manifest·예산·권한 계약.
begin;
do $$
declare manifest uuid;result jsonb;
begin
 select id into manifest from private.execution_manifests where manifest_version='finshield-p0-loan-v8'
   and model_bundle->'retrieval'='{"embedding_model":"embed-v4.0","rerank_model":"rerank-v4.0-fast","keyword_candidate_pool":20,"vector_candidate_pool":20,"max_rerank_candidates":40,"top_k":5,"max_query_bytes":8192,"max_document_bytes":32768,"max_tokens_per_document":4096,"pricing_version":"cohere-text-usd-20260907"}'::jsonb;
 if manifest is null then raise exception 'v8 Retrieval Manifest 누락';end if;
 if (select count(*) from private.execution_manifest_agents where execution_manifest_id=manifest)<>7
   or (select count(*) from private.execution_manifest_tools where execution_manifest_id=manifest)<>19 then
   raise exception 'v8 Agent·Tool 연결 불일치';end if;
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
 raise notice '통과: v8 Retrieval Provider·Fast 네 범위 예산·가입 후 예약 권한';
end $$;
do $$ begin raise notice '09a_retrieval_fast_runtime 시험을 모두 통과했습니다';end $$;
rollback;
