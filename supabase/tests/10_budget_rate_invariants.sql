-- ============================================================
-- 0014 Budget·Rate·Audit·Cache·Circuit 시험 (명세 6.9, 6.11, 7.2, ADR 10)
--
-- 09 가 Case c9 를 Purge 했다. 여기서는 Case c8 과 Run 하나로 예산 원장을 돈다.
-- ============================================================

\echo '53. 준비: Case·Run·예산 상한'
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('00000000-0000-4000-8000-0000000000c8', '00000000-0000-4000-8000-00000000000a', 'LOAN', '예산 시험 Case',
        '00000000-0000-4000-8000-0000000000d1');
insert into public.verification_runs
  (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, idempotency_key,
   request_hash, correlation_id, started_at, deadline_at)
values ('00000000-0000-4000-8000-00000000bb40', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000c8', 1, 'INITIAL', 'RUNNING',
        '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000aa01', 'k40', repeat('a', 64),
        gen_random_uuid(), now(), now() + interval '120 seconds');

-- 상한 설정이 없으면 예약은 무제한이 아니라 거부다 (fail-closed).
select fstest.expect_fail($sql$
  select private.reserve_usage_budget('00000000-0000-4000-8000-00000000bb40', null, null,
    'anthropic', 'claude-sonnet-5', 'price-2026-09', 1000)
$sql$, '상한 설정 없는 범위의 예약');

insert into private.budget_limits (scope_type, provider, model, limit_microunits, policy_version)
values ('GLOBAL_DAY', 'anthropic', '*', 100000, 'b1'),
       ('OWNER_DAY', 'anthropic', '*', 10000, 'b1'),
       ('CASE', 'anthropic', '*', 5000, 'b1'),
       ('RUN', 'anthropic', 'claude-sonnet-5', 2500, 'b1');

select fstest.expect_fail($sql$
  insert into private.budget_limits (scope_type, provider, model, limit_microunits, policy_version)
  values ('TEAM', 'anthropic', '*', 1, 'b1')
$sql$, '열거하지 않은 예산 범위');

\echo '54. 원자 예약·상한·정산·해제·대조'
do $$
declare r1 uuid; r2 uuid; n int; c record; res private.usage_reservations%rowtype;
begin
  r1 := private.reserve_usage_budget('00000000-0000-4000-8000-00000000bb40', null, null,
          'anthropic', 'claude-sonnet-5', 'price-2026-09', 1000);
  r2 := private.reserve_usage_budget('00000000-0000-4000-8000-00000000bb40', null, null,
          'anthropic', 'claude-sonnet-5', 'price-2026-09', 1000);
  select count(*) into n from private.usage_reservation_counters where reservation_id in (r1, r2);
  if n <> 8 then raise exception '예약이 네 범위 Counter 에 반영되지 않았습니다 (%)', n; end if;
  select reserved_microunits, consumed_microunits, limit_microunits into c
    from private.usage_budget_counters where scope_type = 'RUN' and scope_key = '00000000-0000-4000-8000-00000000bb40';
  if c.reserved_microunits <> 2000 or c.limit_microunits <> 2500 then
    raise exception 'RUN Counter 가 예약을 반영하지 않았습니다 (% / %)', c.reserved_microunits, c.limit_microunits;
  end if;
  raise notice '  허용 확인: 예약이 day·owner·case·run 네 범위를 원자적으로 잡는다';

  perform fstest.expect_fail($sql$
    select private.reserve_usage_budget('00000000-0000-4000-8000-00000000bb40', null, null,
      'anthropic', 'claude-sonnet-5', 'price-2026-09', 600)
  $sql$, 'RUN 상한 2500 을 넘는 세 번째 예약 (2000 + 600)');
  -- 상한 안에서는 아직 예약할 수 있다.
  perform private.release_usage_budget(
    private.reserve_usage_budget('00000000-0000-4000-8000-00000000bb40', null, null,
      'anthropic', 'claude-sonnet-5', 'price-2026-09', 500));

  res := private.settle_usage_budget(r1, 700,
           '{"input_tokens":1200,"output_tokens":300,"elapsed_ms":2100,"status_category":"OK","retry_count":0,"provider_request_ref":"req_abc123"}'::jsonb);
  if res.status <> 'SETTLED' or res.actual_microunits <> 700 or res.input_tokens <> 1200 then
    raise exception '정산 결과가 다릅니다';
  end if;
  select reserved_microunits, consumed_microunits into c
    from private.usage_budget_counters where scope_type = 'RUN' and scope_key = '00000000-0000-4000-8000-00000000bb40';
  if c.reserved_microunits <> 1000 or c.consumed_microunits <> 700 then
    raise exception '정산이 Counter 에 반영되지 않았습니다 (% / %)', c.reserved_microunits, c.consumed_microunits;
  end if;
  perform fstest.expect_fail(format($sql$ select private.settle_usage_budget(%L, 1) $sql$, r1), '중복 정산');
  perform fstest.expect_fail(format($sql$ select private.release_usage_budget(%L) $sql$, r1), '정산된 예약 해제');
  raise notice '  허용 확인: 정산은 reserved 를 돌려주고 consumed 에 실제 비용을 더한다';

  -- 예상 초과 정산은 기록하되 경보를 남긴다.
  res := private.settle_usage_budget(r2, 1300, '{"status_category":"OK"}'::jsonb);
  select count(*) into n from private.outbox_events where event_type = 'BUDGET_OVERRUN' and aggregate_id = r2;
  if n <> 1 then raise exception 'BUDGET_OVERRUN 경보가 없습니다'; end if;
  raise notice '  허용 확인: 예상 초과 정산 경보';

  -- timeout: 예약 유지 + 대조 표시. 만료 Sweeper 도 해제하지 않는다.
  r1 := private.reserve_usage_budget('00000000-0000-4000-8000-00000000bb40', null, null,
          'anthropic', 'claude-sonnet-5', 'price-2026-09', 400, 10);
  if not private.flag_usage_reconciliation(r1, 'PROVIDER_TIMEOUT') then raise exception '대조 표시 실패'; end if;
  update private.usage_reservations set created_at = now() - interval '2 seconds', expires_at = now() - interval '1 second', reconcile_required = false where id = r1;
  select coalesce(jsonb_object_agg(kind, affected), '{}'::jsonb) as m into c from private.sweep_usage_reservations();
  if (c.m ->> 'RESERVATION_EXPIRED')::int <> 1 then raise exception 'Sweeper 집계가 다릅니다: %', c.m; end if;
  select * into res from private.usage_reservations where id = r1;
  if res.status <> 'RESERVED' or not res.reconcile_required then
    raise exception '만료 예약이 해제되거나 대조 표시가 없습니다';
  end if;
  raise notice '  허용 확인: 사용량 불명확 예약은 유지한 채 대조 대상으로 남는다';
end
$$;

select fstest.expect_fail($sql$
  select private.reserve_usage_budget('00000000-0000-4000-8000-00000000bb40', null, null,
    'anthropic', 'claude-sonnet-5', 'price-2026-09', 0)
$sql$, '0 비용 예약');
select fstest.expect_fail($sql$
  update private.usage_budget_counters set reserved_microunits = -1
$sql$, 'Counter 음수');

\echo '55. Rate 소비·Provider 직렬화·Circuit'
do $$
declare r record; i int; t1 timestamptz; t2 timestamptz; c private.provider_circuits%rowtype;
begin
  for i in 1..3 loop
    select * into r from private.consume_rate_limit('OWNER', '00000000-0000-4000-8000-00000000000a', 'CREATE_RUN', 3, 60);
    if not r.allowed then raise exception '% 번째 요청이 거부됐습니다', i; end if;
  end loop;
  select * into r from private.consume_rate_limit('OWNER', '00000000-0000-4000-8000-00000000000a', 'CREATE_RUN', 3, 60);
  if r.allowed or r.retry_after_seconds < 1 then raise exception '4 번째 요청이 허용됐거나 재시도 시각이 없습니다'; end if;
  select * into r from private.consume_rate_limit('OWNER', '00000000-0000-4000-8000-00000000000b', 'CREATE_RUN', 3, 60);
  if not r.allowed then raise exception '다른 사용자 창이 섞였습니다'; end if;
  raise notice '  허용 확인: 창 안 3회 허용, 4회째 거부와 retry_after, 사용자 분리';

  select scheduled_at into t1 from private.acquire_provider_slot('clova_ocr', '*', 1000);
  select scheduled_at into t2 from private.acquire_provider_slot('clova_ocr', '*', 1000);
  if t2 < t1 + interval '1 second' then raise exception '1 TPS 직렬화가 되지 않았습니다 (% → %)', t1, t2; end if;
  raise notice '  허용 확인: Provider 1 TPS 직렬화 시각 배정';

  for i in 1..4 loop
    c := private.record_provider_outcome('clova_ocr', '*', false, 'HTTP_503', 5, 60);
  end loop;
  if c.state <> 'CLOSED' or c.failure_count <> 4 then raise exception '임계 전 상태가 다릅니다'; end if;
  c := private.record_provider_outcome('clova_ocr', '*', false, 'HTTP_503', 5, 60);
  if c.state <> 'OPEN' or c.open_until is null then raise exception '5 회 실패 뒤 OPEN 이 아닙니다'; end if;
  perform fstest.expect_fail($sql$ select * from private.acquire_provider_slot('clova_ocr', '*', 1000) $sql$,
    'OPEN Circuit 에서 슬롯 요청');
  update private.provider_circuits set opened_at = now() - interval '2 seconds', open_until = now() - interval '1 second' where provider_code = 'clova_ocr';
  select circuit_state into r from private.acquire_provider_slot('clova_ocr', '*', 1000);
  if r.circuit_state <> 'HALF_OPEN' then raise exception 'open_until 뒤 HALF_OPEN 이 아닙니다 (%)', r.circuit_state; end if;
  c := private.record_provider_outcome('clova_ocr', '*', false, 'HTTP_503', 5, 60);
  if c.state <> 'OPEN' then raise exception 'HALF_OPEN 실패 뒤 다시 OPEN 이 아닙니다'; end if;
  update private.provider_circuits set opened_at = now() - interval '2 seconds', open_until = now() - interval '1 second' where provider_code = 'clova_ocr';
  perform private.acquire_provider_slot('clova_ocr', '*', 1000);
  c := private.record_provider_outcome('clova_ocr', '*', true);
  if c.state <> 'CLOSED' or c.failure_count <> 0 then raise exception '성공 뒤 CLOSED 가 아닙니다'; end if;
  raise notice '  허용 확인: Circuit CLOSED → OPEN → HALF_OPEN → 성공 시 CLOSED';
end
$$;

\echo '56. Source Cache 와 감사'
do $$
declare e private.source_cache_entries%rowtype; r record;
begin
  e := private.upsert_source_cache('law_go_kr', 'LAW-001', 'FRESH', '00000000-0000-4000-8000-00000000c001',
         now() + interval '1 hour', now() + interval '1 day');
  select * into r from private.read_source_cache('law_go_kr', 'LAW-001');
  if r.effective_status <> 'FRESH' then raise exception 'FRESH 가 아닙니다 (%)', r.effective_status; end if;
  -- 재조회 실패는 마지막 Snapshot 을 지우지 않고 STALE 판단 근거로 남긴다.
  e := private.upsert_source_cache('law_go_kr', 'LAW-001', 'ERROR', null, null, now() + interval '1 day', 'HTTP_504');
  select * into r from private.read_source_cache('law_go_kr', 'LAW-001');
  if r.source_snapshot_id is null or r.effective_status <> 'STALE' or r.last_error_code <> 'HTTP_504' then
    raise exception '오류 뒤 STALE 판단이 다릅니다 (% %)', r.effective_status, r.last_error_code;
  end if;
  e := private.upsert_source_cache('law_go_kr', 'LAW-999', 'EMPTY', null, null, now() + interval '1 hour');
  select * into r from private.read_source_cache('law_go_kr', 'LAW-999');
  if r.effective_status <> 'EMPTY' then raise exception '0건 상태가 다릅니다 (%)', r.effective_status; end if;
  raise notice '  허용 확인: Cache FRESH → 오류 뒤 STALE, 0건은 EMPTY';
end
$$;
select fstest.expect_fail($sql$
  select private.upsert_source_cache('law_go_kr', 'LAW-002', 'FRESH', null, now() + interval '1 hour', now() + interval '1 day')
$sql$, 'Snapshot 없는 FRESH');
select fstest.expect_fail($sql$
  select private.upsert_source_cache('law_go_kr', 'LAW-003', 'ERROR', null, null, now() + interval '1 day')
$sql$, 'Code 없는 ERROR');

select fstest.expect_ok($sql$
  select private.log_audit_event(gen_random_uuid(), 'RUN_STARTED', 'WORKER', '200',
    '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c8', '00000000-0000-4000-8000-00000000bb40')
$sql$, 'Code 와 ID 만 있는 감사 기록');
select fstest.expect_fail($sql$
  select private.log_audit_event(gen_random_uuid(), 'RUN_STARTED', 'WORKER', '200', null, null, null, null, null,
    'user said: 010-1234-5678')
$sql$, '자유 문자열이 섞인 error_code');
select fstest.expect_fail($sql$
  select private.log_audit_event(gen_random_uuid(), 'run started for 홍길동', 'WORKER', '200')
$sql$, '자유 문자열 event_code');
select fstest.expect_fail($sql$
  update private.audit_events set status_code = '500'
$sql$, '감사 기록 UPDATE');

\echo '57. Retention 과 권한'
do $$
declare r record;
begin
  -- 감사 행은 UPDATE 할 수 없으므로 오래된 행을 직접 넣어 Retention 을 본다.
  insert into private.audit_events (correlation_id, event_code, actor_type, status_code, created_at)
  values (gen_random_uuid(), 'RUN_FINISHED', 'WORKER', '200', now() - interval '91 days');
  update private.rate_limit_buckets set window_end = now() - interval '25 hours', window_start = now() - interval '26 hours';
  select coalesce(jsonb_object_agg(kind, affected), '{}'::jsonb) as m into r from private.sweep_budget_audit_retention();
  if (r.m ->> 'AUDIT_90D')::int <> 1 or (r.m ->> 'RATE_BUCKET_24H')::int < 1 then
    raise exception 'Retention 집계가 다릅니다: %', r.m;
  end if;
  raise notice '  허용 확인: 감사 90일·Rate 24시간 Retention';
end
$$;

do $$
declare n int; r record;
begin
  set local role finshield_worker;
  select count(*) into n from private.usage_budget_counters;
  if n < 4 then raise exception 'Worker 가 Counter 를 읽지 못했습니다 (%)', n; end if;
  select * into r from private.consume_rate_limit('GLOBAL', 'global', 'HEALTH', 10, 60);
  if not r.allowed then raise exception 'Worker Rate 소비 실패'; end if;
  perform fstest.expect_fail($sql$ update private.usage_budget_counters set consumed_microunits = 0 $sql$,
    'Worker 가 Counter 를 직접 감소');
  perform fstest.expect_fail($sql$ delete from private.audit_events $sql$, 'Worker 가 감사 기록 DELETE');
  perform fstest.expect_fail($sql$ insert into private.budget_limits (scope_type, provider, model, limit_microunits, policy_version)
    values ('RUN', 'cohere', '*', 1, 'b1') $sql$, 'Worker 가 예산 상한 INSERT');
  raise notice '  허용 확인: Worker 는 읽기와 함수만, 감소·삭제·상한 변경은 거부';
end
$$;

do $$
begin
  set local role authenticated;
  perform fstest.expect_fail($sql$ select count(*) from private.usage_budget_counters $sql$, '회원이 예산 Counter 조회');
  perform fstest.expect_fail($sql$ select * from private.consume_rate_limit('GLOBAL', 'global', 'HEALTH', 10, 60) $sql$,
    '회원이 Rate 함수 호출');
end
$$;

-- Case 삭제 Cascade 로 예약·Join 이 정리되고 Counter 는 남는다 (집계 보존).
do $$
declare n int;
begin
  delete from public.financial_cases where id = '00000000-0000-4000-8000-0000000000c8';
  select count(*) into n from private.usage_reservations;
  if n <> 0 then raise exception 'Case 삭제 뒤 예약이 남았습니다 (%)', n; end if;
  select count(*) into n from private.usage_budget_counters where scope_type = 'GLOBAL_DAY';
  if n <> 1 then raise exception '일 단위 Counter 가 사라졌습니다'; end if;
  raise notice '  허용 확인: Case Cascade 로 예약 제거, 집계 Counter 보존';
end
$$;

\echo '0014 불변식 시험을 통과했습니다.'
