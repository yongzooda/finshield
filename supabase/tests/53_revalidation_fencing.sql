-- REV-001·N-AVL-005·N-OPS-004: 만료 Lease, 회전, 재시도 소진 Orphan의 실제 DB 불변식.
\echo '재검증 현재 Lease와 Orphan 종결 불변식'
begin;

do $$
declare
  c public.financial_cases%rowtype;
  manifest uuid;
  job uuid;
  run uuid;
  lease record;
  renewed record;
  old_lease uuid;
  base_passports integer;
  base_latest uuid;
  i integer;
begin
  select x.* into strict c
    from public.financial_cases x
   where x.owner_id = '00000000-0000-4000-8000-00000000000a'
     and x.latest_passport_id is not null and x.deleted_at is null
     and not exists (
       select 1 from public.revalidation_jobs j
        where j.case_id = x.id and j.status in ('QUEUED', 'RUNNING'))
   limit 1;
  select execution_manifest_id into strict manifest
    from public.verification_runs
   where id = (select verification_run_id from public.evidence_passports where id = c.latest_passport_id);
  select count(*)::integer into base_passports from public.evidence_passports where case_id = c.id;
  base_latest := c.latest_passport_id;

  -- 1. 임대가 만료되면 새 Worker 선점 전이라도 옛 Worker의 실패·최종화를 모두 거부한다.
  job := private.enqueue_revalidation(c.owner_id, c.id, 'fencing-expired', repeat('1', 64));
  select * into strict lease
    from private.claim_case_revalidation_job(c.owner_id, job, 'old-worker', 10);
  old_lease := lease.lease_token;
  run := private.create_verification_run(c.owner_id, c.id, manifest, 'fencing-expired-run',
    repeat('2', 64), 'REVALIDATION', job);
  perform private.start_verification_run(run);
  update private.revalidation_job_runtime set leased_until = clock_timestamp() + interval '10 milliseconds' where job_id = job;
  perform pg_sleep(0.02);

  begin
    perform private.fail_revalidation_job(job, old_lease, 'STALE_WORKER', null);
    raise exception '만료 Lease가 Job 실패 쓰기에 성공했다';
  exception when lock_not_available then null;
  end;
  begin
    perform private.finalize_revalidation(job, old_lease, run, '[]'::jsonb, '[]'::jsonb,
      null, '{}'::text[], 'p1');
    raise exception '만료 Lease가 최종화에 성공했다';
  exception when lock_not_available then null;
  end;
  if (select status from public.revalidation_jobs where id = job) <> 'RUNNING'
     or (select status from public.verification_runs where id = run) <> 'RUNNING' then
    raise exception '만료 Worker 거부가 원장을 바꿨다';
  end if;

  -- 2. 재선점은 token을 회전하고, 옛 token은 heartbeat·최종화 모두 거부한다.
  select * into strict renewed
    from private.claim_case_revalidation_job(c.owner_id, job, 'new-worker', 10);
  if renewed.lease_token = old_lease or renewed.attempt_no <> 2 then
    raise exception 'Lease 회전 또는 attempt 증가가 누락됐다';
  end if;
  if private.heartbeat_revalidation_job(job, old_lease, 10) then
    raise exception '오래된 Worker heartbeat가 성공했다';
  end if;
  begin
    perform private.finalize_revalidation(job, old_lease, run, '[]'::jsonb, '[]'::jsonb,
      null, '{}'::text[], 'p1');
    raise exception '회전된 옛 Lease가 최종화에 성공했다';
  exception when lock_not_available then null;
  end;
  if not private.heartbeat_revalidation_job(job, renewed.lease_token, 10) then
    raise exception '현재 Worker heartbeat가 실패했다';
  end if;

  -- Provider 결과가 불명확한 기존 Run은 재호출하지 않고 Run·Job을 함께 실패시킨다.
  perform private.fail_verification_run(run, 'PROVIDER_RESULT_UNKNOWN', null);
  perform private.fail_revalidation_job(job, renewed.lease_token, 'PROVIDER_RESULT_UNKNOWN', null);
  if (select status from public.revalidation_jobs where id = job) <> 'FAILED'
     or (select status from public.verification_runs where id = run) <> 'FAILED'
     or (select lease_token from private.revalidation_job_runtime where job_id = job) is not null then
    raise exception '현재 Lease의 Run·Job 종결 원장이 맞지 않는다';
  end if;
  if (select count(*) from public.revalidation_events where revalidation_job_id = job and event_type = 'FAILED') <> 1 then
    raise exception '실패 이벤트가 정확히 한 번 남지 않았다';
  end if;
  if exists(select 1 from private.claim_case_revalidation_job(c.owner_id, job, 'terminal-replay', 10)) then
    raise exception '종결 Job이 재선점됐다';
  end if;

  -- 3. Run이 없는 Job은 max attempt를 소진한 다음 선점에서 FAILED로 회수된다.
  job := private.enqueue_revalidation(c.owner_id, c.id, 'orphan-without-run', repeat('3', 64));
  for i in 1..3 loop
    select * into strict lease
      from private.claim_case_revalidation_job(c.owner_id, job, 'retry-worker-' || i, 10);
    if lease.attempt_no <> i then raise exception 'attempt 번호가 순서대로 증가하지 않았다'; end if;
    update private.revalidation_job_runtime set leased_until = now() - interval '1 second' where job_id = job;
  end loop;
  if exists(select 1 from private.claim_case_revalidation_job(c.owner_id, job, 'exhausted-worker', 10)) then
    raise exception '소진 Job이 다시 선점됐다';
  end if;
  if (select status from public.revalidation_jobs where id = job) <> 'FAILED'
     or (select reason_code from public.revalidation_jobs where id = job) <> 'WORKFLOW_RETRY_EXHAUSTED'
     or (select lease_token from private.revalidation_job_runtime where job_id = job) is not null then
    raise exception 'Run 없는 소진 Orphan이 정확히 종결되지 않았다';
  end if;
  if (select count(*) from public.revalidation_events where revalidation_job_id = job and event_type = 'FAILED') <> 1 then
    raise exception '소진 Orphan 실패 이벤트가 중복되거나 누락됐다';
  end if;

  -- 4. Run이 있는 소진 Orphan은 Provider 결과 미확정으로 Run·Job을 함께 종결한다.
  job := private.enqueue_revalidation(c.owner_id, c.id, 'orphan-with-run', repeat('4', 64));
  select * into strict lease
    from private.claim_case_revalidation_job(c.owner_id, job, 'provider-worker', 10);
  run := private.create_verification_run(c.owner_id, c.id, manifest, 'orphan-with-run-id',
    repeat('5', 64), 'REVALIDATION', job);
  perform private.start_verification_run(run);
  update private.revalidation_job_runtime
     set attempt_no = max_attempts, leased_until = now() - interval '1 second'
   where job_id = job;
  if exists(select 1 from private.claim_case_revalidation_job(c.owner_id, job, 'orphan-sweeper', 10)) then
    raise exception '기존 Run이 있는 소진 Job이 재선점됐다';
  end if;
  if (select status from public.revalidation_jobs where id = job) <> 'FAILED'
     or (select reason_code from public.revalidation_jobs where id = job) <> 'PROVIDER_RESULT_UNKNOWN'
     or (select status from public.verification_runs where id = run) <> 'FAILED' then
    raise exception '기존 Run이 있는 소진 Orphan 원장이 맞지 않는다';
  end if;
  if (select count(*) from public.evidence_passports where case_id = c.id) <> base_passports
     or (select latest_passport_id from public.financial_cases where id = c.id) <> base_latest then
    raise exception '실패 복구가 이전 Passport를 바꿨다';
  end if;

  -- 5. Lease 전 취소와 반복 취소는 같은 terminal 행·이벤트 하나로 복원된다.
  job := private.enqueue_revalidation(c.owner_id, c.id, 'queued-cancel', repeat('6', 64));
  perform private.cancel_revalidation_job(c.owner_id, job);
  perform private.cancel_revalidation_job(c.owner_id, job);
  if (select status from public.revalidation_jobs where id = job) <> 'FAILED'
     or (select reason_code from public.revalidation_jobs where id = job) <> 'USER_CANCELLED'
     or (select count(*) from public.revalidation_events where revalidation_job_id = job and event_type = 'CANCELLED') <> 1 then
    raise exception '반복 취소가 같은 terminal 원장으로 복원되지 않았다';
  end if;

  if exists(
    select 1 from public.revalidation_events e
     where e.revalidation_job_id in (
       select id from public.revalidation_jobs where case_id = c.id and idempotency_key in
         ('fencing-expired', 'orphan-without-run', 'orphan-with-run', 'queued-cancel'))
     group by e.revalidation_job_id, e.event_no having count(*) <> 1) then
    raise exception '이벤트 번호가 Job 안에서 중복됐다';
  end if;

  raise notice '  통과: 만료 Lease 쓰기 거부·회전·현재 heartbeat·재생·소진 Orphan·Passport 보존·반복 취소';
end
$$;

do $$ begin raise notice '53_revalidation_fencing 시험을 모두 통과했습니다'; end $$;
rollback;
