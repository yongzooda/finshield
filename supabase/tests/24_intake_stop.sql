-- INP-013·CLM-003: 중단 후 늦게 도착한 모델 출력이 Claim으로 남지 않는다.
\echo '텍스트 추출 취소와 늦은 응답 차단'
begin;
do $$
declare owner uuid:='00000000-0000-4000-8000-00000000000a'; c uuid; inp uuid;
begin
 c:=private.create_case(owner,'LOAN','합성 추출 취소','intake-cancel-test',repeat('a',64));
 inp:=private.create_text_input(owner,c,100,86400);
 perform fstest.expect_fail(format('select private.record_extracted_claim(%L,%L,%L,null,%L,%L,%L,%L)',owner,c,inp,'PRODUCT_TERM','연 3%%','MATERIAL','MODEL'),'마스킹 전 Claim 기록 차단');
 perform private.advance_input_stage(owner,c,inp,'VALIDATED','{}');
 perform private.advance_input_stage(owner,c,inp,'EXTRACTED','{}');
 perform private.advance_input_stage(owner,c,inp,'MASKED',jsonb_build_object('masked_text','연 3% 금리','masked_text_hash',repeat('b',64),'pii_policy_version','test'));
 perform private.record_extracted_claim(owner,c,inp,null,'PRODUCT_TERM','연 3% 금리','MATERIAL','MODEL');
 perform private.stop_case_input(owner,c,inp,'USER_CANCELLED');
 perform fstest.expect_fail(format('select private.record_extracted_claim(%L,%L,%L,null,%L,%L,%L,%L)',owner,c,inp,'PRODUCT_TERM','늦은 응답','MATERIAL','MODEL'),'중단 뒤 Claim 기록 차단');
 if (select count(*) from public.claims where case_id=c)<>1 then raise exception '중단 뒤 Claim 추가';end if;
 perform fstest.expect_fail(format('select private.reserve_finshield_model_usage(%L,%L,%L,null,null,%L,%L,100)',owner,c,inp,'claude-sonnet-5','sonnet5-usd-20260907'),'중단 뒤 모델 비용 예약 차단');
 raise notice '  통과: 마스킹 전·중단 뒤 Claim 기록과 후속 모델 예약 차단';
end $$;
do $$ begin raise notice '24_intake_stop 시험을 모두 통과했습니다'; end $$;
rollback;
