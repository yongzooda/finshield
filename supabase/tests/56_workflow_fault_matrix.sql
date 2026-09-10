-- REV-001·N-AVL-005·N-OPS-004·N-PERF-009: 사전등록 장애 20종 중 DB 경계에서
-- 결정적으로 관측할 수 있는 항목을 고정한다. 53_revalidation_fencing 이 이미
-- 덮는 Lease 만료·회전·소진 Orphan·반복 취소는 여기서 다시 세지 않는다.
-- 목록과 기대 결과는 docs/ops/workflow-fault-preregistration.md 를 따른다.
\echo '재검증 Workflow 장애 행렬 (DB 경계)'
begin;

do $$
declare
  c public.financial_cases%rowtype;
  manifest uuid;
  job uuid;
  rejoined uuid;
  run uuid;
  lease record;
  second record;
  base_passports integer;
  base_latest uuid;
  reservation uuid;
  reserved_before bigint;
  reserved_after bigint;
  status_row jsonb;
  failed boolean;
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

  -- F01 중복 전달: 같은 요청 키와 같은 본문은 새 Job 을 만들지 않고 같은 Job 으로 합류한다.
  job := private.enqueue_revalidation(c.owner_id, c.id, 'fault-duplicate', repeat('a', 64));
  rejoined := private.enqueue_revalidation(c.owner_id, c.id, 'fault-duplicate', repeat('a', 64));
  if rejoined <> job
     or (select count(*) from public.revalidation_jobs where case_id = c.id and idempotency_key = 'fault-duplicate') <> 1
     or (select count(*) from public.revalidation_events where revalidation_job_id = job and event_type = 'QUEUED') <> 1 then
    raise exception 'F01 중복 전달이 새 Job 또는 중복 이벤트를 만들었다';
  end if;

  -- F02 같은 키에 다른 본문: 조용히 합류시키지 않고 거부한다.
  failed := false;
  begin
    perform private.enqueue_revalidation(c.owner_id, c.id, 'fault-duplicate', repeat('b', 64));
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'F02 같은 키의 다른 본문이 통과했다'; end if;

  -- F03 응답 유실 뒤 새 키 재요청: 활성 Job 이 있는 동안 두 번째 Job 을 만들지 않는다.
  failed := false;
  begin
    perform private.enqueue_revalidation(c.owner_id, c.id, 'fault-response-lost', repeat('c', 64));
  exception when unique_violation then failed := true;
  end;
  if not failed
     or (select count(*) from public.revalidation_jobs where case_id = c.id and status in ('QUEUED', 'RUNNING')) <> 1 then
    raise exception 'F03 응답 유실 재요청이 두 번째 활성 Job 을 만들었다';
  end if;

  -- F04 동시 선점: 살아 있는 Lease 가 있는 동안 다른 Worker 는 선점하지 못한다.
  select * into strict lease
    from private.claim_case_revalidation_job(c.owner_id, job, 'worker-a', 120);
  if exists(select 1 from private.claim_case_revalidation_job(c.owner_id, job, 'worker-b', 120)) then
    raise exception 'F04 살아 있는 Lease 중에 두 번째 Worker 가 선점했다';
  end if;
  if (select lease_token from private.revalidation_job_runtime where job_id = job) <> lease.lease_token then
    raise exception 'F04 거부된 선점이 Lease token 을 바꿨다';
  end if;

  -- F05 오래된 Worker 의 진행 기록: 현재 Lease 만 진행 이벤트를 남긴다.
  run := private.create_verification_run(c.owner_id, c.id, manifest, 'fault-matrix-run',
    repeat('d', 64), 'REVALIDATION', job);
  perform private.start_verification_run(run);
  failed := false;
  begin
    perform private.record_revalidation_progress(job, gen_random_uuid(),
      jsonb_build_object('event_type', 'PROGRESS', 'payload', jsonb_build_object('stage', 'stale')));
  exception when others then failed := true;
  end;
  if not failed then raise exception 'F05 오래된 Lease 가 진행 기록을 남겼다'; end if;

  -- F06 실행 중 취소: 살아 있는 Lease 를 가로채 즉시 종결하지 않고 취소 요청만 남긴다.
  perform private.cancel_revalidation_job(c.owner_id, job);
  perform private.cancel_revalidation_job(c.owner_id, job);
  if (select status from public.revalidation_jobs where id = job) <> 'RUNNING'
     or (select cancel_requested_at from public.revalidation_jobs where id = job) is null
     or (select count(*) from public.revalidation_events where revalidation_job_id = job and event_type = 'CANCELLED') <> 0 then
    raise exception 'F06 실행 중 취소가 Worker 확인 없이 원장을 종결했다';
  end if;

  -- F06b Worker 확인: 취소 요청을 확인한 Worker 만 terminal 로 종결하고 이벤트는 하나만 남는다.
  perform private.settle_revalidation_cancel(job);
  perform private.settle_revalidation_cancel(job);
  if (select status from public.revalidation_jobs where id = job) <> 'FAILED'
     or (select reason_code from public.revalidation_jobs where id = job) <> 'USER_CANCELLED'
     or (select count(*) from public.revalidation_events where revalidation_job_id = job and event_type = 'CANCELLED') <> 1
     or (select lease_token from private.revalidation_job_runtime where job_id = job) is not null then
    raise exception 'F06b 취소 종결이 한 번의 terminal 원장으로 복원되지 않았다';
  end if;

  -- F07 취소 뒤 최종화: 종결된 Job 에 결과를 쓰지 못한다.
  failed := false;
  begin
    perform private.finalize_revalidation(job, lease.lease_token, run, '[]'::jsonb, '[]'::jsonb,
      null, '{}'::text[], 'p1');
  exception when others then failed := true;
  end;
  if not failed then raise exception 'F07 취소된 Job 이 최종화됐다'; end if;
  if (select count(*) from public.evidence_passports where case_id = c.id) <> base_passports
     or (select latest_passport_id from public.financial_cases where id = c.id) <> base_latest then
    raise exception 'F07 취소 복구가 이전 Passport 를 바꿨다';
  end if;

  -- F08 종결 뒤 상태 조회: 다른 세션의 조회도 같은 terminal 을 돌려준다.
  select private.read_revalidation_status(c.owner_id, c.id, job) into status_row;
  if status_row is null
     or status_row->>'job_id' <> job::text
     or status_row->>'job_status' <> 'FAILED'
     or status_row->>'reason_code' <> 'USER_CANCELLED'
     or (select count(*) from jsonb_array_elements(status_row->'events') e
          where e->>'event_type' = 'CANCELLED') <> 1 then
    raise exception 'F08 종결 Job 조회가 terminal 을 복원하지 못했다';
  end if;

  -- F09 종결 뒤 새 요청: 활성 Job 이 없으므로 새 Job 하나만 만든다.
  rejoined := private.enqueue_revalidation(c.owner_id, c.id, 'fault-after-terminal', repeat('e', 64));
  if rejoined = job
     or (select count(*) from public.revalidation_jobs where case_id = c.id and status in ('QUEUED', 'RUNNING')) <> 1 then
    raise exception 'F09 종결 뒤 재요청이 새 Job 하나로 복원되지 않았다';
  end if;
  perform private.cancel_revalidation_job(c.owner_id, rejoined);

  -- F10~F13 비용 원장: 같은 Case 의 새 Run 하나로 예약·정산 경계를 본다.
  job := private.enqueue_revalidation(c.owner_id, c.id, 'fault-budget', repeat('f', 64));
  select * into strict lease
    from private.claim_case_revalidation_job(c.owner_id, job, 'budget-worker', 120);
  run := private.create_verification_run(c.owner_id, c.id, manifest, 'fault-budget-run',
    repeat('9', 64), 'REVALIDATION', job);
  perform private.start_verification_run(run);

  -- F10 Provider 결과 미확정: 예약을 임의로 해제하지 않고 재조정 대상으로 보존한다.
  reservation := private.reserve_finshield_model_usage(c.owner_id, c.id, null, run, null,
    'claude-sonnet-5', 'fault-matrix-v1', 100);
  select reserved_microunits into strict reserved_before from private.usage_budget_counters
   where scope_type = 'RUN' and scope_key = run::text and provider = 'anthropic' and model = 'claude-sonnet-5';
  perform private.flag_usage_reconciliation(reservation, 'PROVIDER_RESULT_UNKNOWN');
  select reserved_microunits into strict reserved_after from private.usage_budget_counters
   where scope_type = 'RUN' and scope_key = run::text and provider = 'anthropic' and model = 'claude-sonnet-5';
  if reserved_after <> reserved_before then
    raise exception 'F10 불명확한 결과가 예약을 임의로 해제했다';
  end if;

  -- F11 재조정 대상 보존과 확정 뒤 정산: 미확정 예약은 RESERVED 로 남아 예산을 계속 잡고,
  -- 실제 사용량이 확인되면 그 예약으로 정산하며 재조정 표시가 풀린다.
  if (select status from private.usage_reservations where id = reservation) <> 'RESERVED'
     or not (select reconcile_required from private.usage_reservations where id = reservation) then
    raise exception 'F11 미확정 예약이 RESERVED 재조정 대상으로 남지 않았다';
  end if;
  perform private.settle_usage_budget(reservation, 60, '{}'::jsonb);
  if (select status from private.usage_reservations where id = reservation) <> 'SETTLED'
     or (select reconcile_required from private.usage_reservations where id = reservation) then
    raise exception 'F11 확정 뒤 정산이 재조정 표시를 풀지 못했다';
  end if;
  if (select reserved_microunits from private.usage_budget_counters
       where scope_type = 'RUN' and scope_key = run::text and provider = 'anthropic'
         and model = 'claude-sonnet-5') <> reserved_before - 100 then
    raise exception 'F11 정산이 예약분을 되돌리지 않았다';
  end if;

  -- F12 이중 정산: 같은 예약을 두 번 정산하지 못하고 사용량은 한 번만 반영된다.
  reservation := private.reserve_finshield_model_usage(c.owner_id, c.id, null, run, null,
    'claude-sonnet-5', 'fault-matrix-v1', 100);
  perform private.settle_usage_budget(reservation, 80, '{}'::jsonb);
  failed := false;
  begin
    perform private.settle_usage_budget(reservation, 80, '{}'::jsonb);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'F12 같은 예약이 두 번 정산됐다'; end if;
  if (select consumed_microunits from private.usage_budget_counters
       where scope_type = 'RUN' and scope_key = run::text and provider = 'anthropic'
         and model = 'claude-sonnet-5') <> 140 then
    raise exception 'F12 정산 금액이 한 번만 반영되지 않았다';
  end if;

  -- F14 만료 예약 sweep: 만료된 예약을 임의로 해제해 예산을 낙관적으로 되돌리지 않는다.
  reservation := private.reserve_finshield_model_usage(c.owner_id, c.id, null, run, null,
    'claude-sonnet-5', 'fault-matrix-v1', 100);
  update private.usage_reservations
     set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second'
   where id = reservation;
  select reserved_microunits into strict reserved_before from private.usage_budget_counters
   where scope_type = 'RUN' and scope_key = run::text and provider = 'anthropic' and model = 'claude-sonnet-5';
  perform private.sweep_usage_reservations();
  select reserved_microunits into strict reserved_after from private.usage_budget_counters
   where scope_type = 'RUN' and scope_key = run::text and provider = 'anthropic' and model = 'claude-sonnet-5';
  if reserved_after <> reserved_before
     or not (select reconcile_required from private.usage_reservations where id = reservation) then
    raise exception 'F14 만료 예약 sweep 이 예산을 임의로 되돌렸다';
  end if;

  -- F13 실행 중 예산 초과: 상한을 넘는 예약은 호출 전에 거부한다.
  failed := false;
  begin
    perform private.reserve_finshield_model_usage(c.owner_id, c.id, null, run, null,
      'claude-sonnet-5', 'fault-matrix-v1', 1000000);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'F13 상한을 넘는 예약이 통과했다'; end if;

  perform private.cancel_revalidation_job(c.owner_id, job);
  perform private.settle_revalidation_cancel(job);

  raise notice '  통과: 중복 전달·본문 불일치·응답 유실 재요청·동시 선점·오래된 진행 기록·취소 경합·상태 복원';
  raise notice '  통과: 불명확 결과 예약 보존·확정 뒤 정산·이중 정산 거부·상한 초과 거부·만료 예약 보존';
end
$$;

do $$ begin raise notice '56_workflow_fault_matrix 시험을 모두 통과했습니다'; end $$;
rollback;
