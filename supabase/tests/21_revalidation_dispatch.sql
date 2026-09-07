-- REV-001·N-AVL-008: 복원·소유권·취소·만료 Lease 재선점. Provider는 호출하지 않는다.
\echo '재검증 상태 복원과 취소 불변식'
begin;
do $$
declare c public.financial_cases%rowtype; job uuid; lease record; old_lease uuid; state jsonb;
 base_count int; run uuid; manifest uuid;
begin
 select x.* into strict c from public.financial_cases x where x.owner_id='00000000-0000-4000-8000-00000000000a'
 and x.latest_passport_id is not null and x.deleted_at is null and not exists(select 1 from public.revalidation_jobs j
 where j.case_id=x.id and j.status in ('QUEUED','RUNNING')) limit 1;
 select count(*) into base_count from public.evidence_passports where case_id=c.id;
 job:=private.enqueue_revalidation(c.owner_id,c.id,'workflow-test-1',repeat('a',64));
 if private.enqueue_revalidation(c.owner_id,c.id,'workflow-test-1',repeat('a',64))<>job then raise exception '접수 중복';end if;
 state:=private.read_revalidation_status(c.owner_id,c.id,job);
 if state->>'job_status'<>'QUEUED' or jsonb_array_length(state->'claims')=0 then raise exception '접수 복원 누락';end if;
 perform fstest.expect_fail(format('select private.read_revalidation_status(%L,%L,%L)',
 '00000000-0000-4000-8000-00000000000b',c.id,job),'다른 소유자 상태 조회');
 select * into strict lease from private.claim_case_revalidation_job(c.owner_id,job,'workflow-test',120);
 if exists(select 1 from private.claim_case_revalidation_job(c.owner_id,job,'duplicate',120)) then raise exception '중복 선점';end if;
 if private.heartbeat_revalidation_job(job,gen_random_uuid(),120) then raise exception '잘못된 Lease 연장';end if;
 if not private.heartbeat_revalidation_job(job,lease.lease_token,120) then raise exception '본인 Lease 연장 실패';end if;
 perform private.cancel_revalidation_job(c.owner_id,job);
 if private.heartbeat_revalidation_job(job,lease.lease_token,120) then raise exception '취소 작업 연장';end if;
 state:=private.read_revalidation_status(c.owner_id,c.id,job);
 if state->>'job_status'<>'FAILED' or state->>'reason_code'<>'USER_CANCELLED' then raise exception '취소 미종결';end if;
 if exists(select 1 from private.claim_case_revalidation_job(c.owner_id,job,'replay',120)) then raise exception '취소 재선점';end if;

 job:=private.enqueue_revalidation(c.owner_id,c.id,'workflow-test-2',repeat('b',64));
 select * into strict lease from private.claim_case_revalidation_job(c.owner_id,job,'crashed',120);
 old_lease:=lease.lease_token;
 select execution_manifest_id into manifest from public.verification_runs where id=(select verification_run_id from public.evidence_passports where id=c.latest_passport_id);
 run:=private.create_verification_run(c.owner_id,c.id,manifest,'workflow-run-test',repeat('c',64),'REVALIDATION',job);
 perform private.start_verification_run(run);
 update private.revalidation_job_runtime set leased_until=now()-interval '1 second' where job_id=job;
 select * into strict lease from private.claim_case_revalidation_job(c.owner_id,job,'recovered',120);
 if old_lease=lease.lease_token then raise exception 'Lease 회전 누락';end if;
 if private.heartbeat_revalidation_job(job,old_lease,120) then raise exception '만료 worker 복귀';end if;
 state:=private.revalidation_context(job);
 if state->>'existing_run_id'<>run::text then raise exception '기존 Run 재생 방어 정보 누락';end if;
 perform private.fail_verification_run(run,'PROVIDER_RESULT_UNKNOWN');
 perform private.fail_revalidation_job(job,lease.lease_token,'PROVIDER_RESULT_UNKNOWN');
 if (select count(*) from public.evidence_passports where case_id=c.id)<>base_count then raise exception '실패가 이전 결과를 변경';end if;
 raise notice '  통과: 상태 복원·교차 소유자 차단·취소 종결·Lease 회전·불명확한 Provider 재호출 방지';
end $$;
rollback;
