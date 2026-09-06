// ============================================================
// B-RATE-01 관측 생성기.
//
// ADR 15.1 Rate·Budget 행: 동일 cap 에 동시 예약 ≥50, cap 초과 승인 0건,
// 예약·정산 원장 불일치 0건, 429 retry time 누락 0건.
//
// 여러 연결에서 동시에 같은 상한을 두드려 원자성을 본다. Node 안에서 순서를
// 맞추지 않는다. 순서를 맞추면 DB 의 잠금이 아니라 Node 의 직렬화를 재게 된다.
// ============================================================
export const FORMULA_VERSION = "rate-budget-concurrent-ledger-v1";
export const CONCURRENCY = 60;          // ADR 15.1 최소 표본 50 을 넘긴다
export const UNIT_MICROUNITS = 100;
export const RUN_LIMIT_MICROUNITS = 2000; // 20건만 들어간다
export const RATE_LIMIT = 10;
export const RATE_WINDOW_SECONDS = 60;
export const RATE_ATTEMPTS = 40;
export const PROVIDER_MIN_INTERVAL_MS = 1000; // CLOVA 기본 1 TPS
export const PROVIDER_SLOTS = 5;

// 고정 UUID. 같은 DB 에 다시 돌려도 같은 행을 쓴다.
const IDS = Object.freeze({
  owner: "1f2e3d4c-0000-4000-8000-00000000ba01",
  profile: "1f2e3d4c-0000-4000-8000-00000000ba02",
  version: "1f2e3d4c-0000-4000-8000-00000000ba03",
  run: "1f2e3d4c-0000-4000-8000-00000000ba05",
  manifest: "1f2e3d4c-0000-4000-8000-00000000ba06",
  release: "1f2e3d4c-0000-4000-8000-00000000ba07",
});

// 예약이 걸릴 상한은 RUN 범위 하나로 좁힌다. 나머지 범위는 넉넉히 둬서
// 어느 범위가 막았는지 헷갈리지 않게 한다.
// 실행마다 새 Run 을 쓴다. 같은 DB 에 다시 돌려도 예산 Counter 가 앞 실행에 오염되지 않는다.
const hexTail = (seed) => String(seed).replace(/[^0-9a-f]/gi, "").toLowerCase().padStart(12, "0").slice(-12);
export const runIdFor = (seed) => `1f2e3d4c-0000-4000-8000-${hexTail(seed)}`;
// Case 마다 활성 INITIAL Run 은 하나뿐이라 Case 도 실행마다 새로 만든다.
export const caseIdFor = (seed) => `2f2e3d4c-0000-4000-8000-${hexTail(seed)}`;

export const fixtureSql = (runId, caseId) => `
begin;
insert into auth.users (id) values ('${IDS.owner}') on conflict (id) do nothing;
-- profiles 는 auth.users trigger 가 만든다.
insert into public.financial_profiles
  (id, owner_id, schema_version, income_band, debt_burden_band, emergency_fund_band,
   purpose_code, horizon_code, liquidity_need, loss_tolerance, completeness)
values ('${IDS.profile}', '${IDS.owner}', 'v1', 'BAND_2', 'LOW', 'BAND_1',
        'LOAN_REFINANCE', 'SHORT', 'MEDIUM', 'LOW', 'COMPLETE')
on conflict (id) do nothing;
insert into public.financial_profile_versions
  (id, owner_id, profile_id, version_no, schema_version, snapshot, completeness, content_hash, created_reason)
values ('${IDS.version}', '${IDS.owner}', '${IDS.profile}', 1, 'v1', '{"schema_version":"v1"}'::jsonb,
        'COMPLETE', repeat('a', 64), 'CASE_CREATED')
on conflict (id) do nothing;
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('${caseId}', '${IDS.owner}', 'LOAN', 'Rate 시험 Case', '${IDS.version}')
on conflict (id) do nothing;
insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
values ('EVIDENCE', 'rate-test', '{"schema_version":1}'::jsonb, '1', repeat('1', 64)),
       ('RESULT_MATRIX', 'rate-test', '{"schema_version":1}'::jsonb, '1', repeat('2', 64)),
       ('COVERAGE', 'rate-test', '{"schema_version":1}'::jsonb, '1', repeat('3', 64)),
       ('PROFILE', 'rate-test', '{"schema_version":1}'::jsonb, '1', repeat('4', 64)),
       ('PII', 'rate-test', '{"schema_version":1}'::jsonb, '1', repeat('5', 64))
on conflict (policy_type, version) do nothing;
insert into kb.kb_releases (id, version, corpus_scope, document_count, chunk_count, manifest_hash)
values ('${IDS.release}', 'rate-test', '{"schema_version":1}'::jsonb, 0, 0, repeat('6', 64))
on conflict (id) do nothing;
insert into private.execution_manifests
  (id, manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version, schema_bundle_version,
   evidence_policy_version, result_matrix_version, coverage_contract_version, profile_policy_version,
   pii_policy_version, kb_release_id, config_hash)
values ('${IDS.manifest}', 'rate-test', 'LOAN', '1', '{"schema_version":1}'::jsonb, '1', '1',
        'rate-test', 'rate-test', 'rate-test', 'rate-test', 'rate-test', '${IDS.release}', repeat('7', 64))
on conflict (id) do nothing;
insert into public.verification_runs
  (id, owner_id, case_id, run_no, kind, status, profile_version_id, execution_manifest_id, idempotency_key,
   request_hash, correlation_id, started_at, deadline_at)
values ('${runId}', '${IDS.owner}', '${caseId}', (abs(hashtext('${runId}')) % 1000000) + 1, 'INITIAL', 'RUNNING', '${IDS.version}',
        '${IDS.manifest}', 'rate-' || left(md5('${runId}'), 12), repeat('b', 64), gen_random_uuid(), now(), now() + interval '180 seconds')
on conflict (id) do nothing;
insert into private.budget_limits (scope_type, provider, model, limit_microunits, policy_version)
values ('GLOBAL_DAY', 'clova', '*', 100000000, 'r1'),
       ('OWNER_DAY', 'clova', '*', 100000000, 'r1'),
       ('CASE', 'clova', '*', 100000000, 'r1'),
       ('RUN', 'clova', 'ocr-general', ${RUN_LIMIT_MICROUNITS}, 'r1')
on conflict (scope_type, provider, model) do nothing;
commit;`;



// 동시 예약. 연결마다 하나씩 시도하고 결과만 모은다.
const concurrentReserve = async (connect, RUN_ID) => {
  const attempts = await Promise.all(Array.from({ length: CONCURRENCY }, async (_, index) => {
    const sql = connect();
    try {
      const rows = await sql`
        select private.reserve_usage_budget(${RUN_ID}::uuid, null, null, 'clova', 'ocr-general', 'p1',
          ${UNIT_MICROUNITS}::bigint, 600) as reservation_id`;
      return { index, ok: true, reservation_id: rows[0].reservation_id, hint: null };
    } catch (error) {
      // 상한 초과는 기대된 거부다. 다른 오류와 구분해 남긴다.
      return { index, ok: false, reservation_id: null, hint: String(error?.hint ?? error?.code ?? "unknown") };
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }));
  return attempts;
};

const concurrentRate = async (connect, scopeKey) => {
  const attempts = await Promise.all(Array.from({ length: RATE_ATTEMPTS }, async (_, index) => {
    const sql = connect();
    try {
      const rows = await sql`
        select * from private.consume_rate_limit('OWNER', ${scopeKey}, 'OCR_REQUEST', ${RATE_LIMIT}::integer, ${RATE_WINDOW_SECONDS}::integer)`;
      return { index, allowed: rows[0].allowed, remaining: rows[0].remaining, retry_after_seconds: rows[0].retry_after_seconds };
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }));
  return attempts;
};

export const runRateBudgetSpike = async ({ sql, connect, runId, progress = () => {} }) => {
  const RUN_ID = runId;
  await sql.unsafe("select 1");
  progress("fixture");

  // 1. 동시 예약. 상한 안에 들어가는 수만 성공해야 한다.
  const reserveAttempts = await concurrentReserve(connect, RUN_ID);
  const accepted = reserveAttempts.filter((a) => a.ok);
  const rejected = reserveAttempts.filter((a) => !a.ok);
  const [counter] = await sql`
    select limit_microunits::bigint as limit_microunits, reserved_microunits::bigint as reserved,
           consumed_microunits::bigint as consumed
      from private.usage_budget_counters
     where scope_type = 'RUN' and scope_key = ${RUN_ID} and provider = 'clova' and model = 'ocr-general'`;
  progress("reserve");

  // 2. 정산과 해제. 절반은 실제 사용, 절반은 해제한다.
  const settled = [];
  const released = [];
  for (const [order, attempt] of accepted.entries()) {
    if (order % 2 === 0) {
      // (f()).* 는 열마다 함수를 다시 부른다. from 절에서 한 번만 부른다.
      const rows = await sql`select * from private.settle_usage_budget(${attempt.reservation_id}::uuid, ${UNIT_MICROUNITS}::bigint) as r`;
      settled.push({ reservation_id: attempt.reservation_id, status: rows[0].status });
    } else {
      await sql`select private.release_usage_budget(${attempt.reservation_id}::uuid)`;
      released.push({ reservation_id: attempt.reservation_id });
    }
  }
  const [after] = await sql`
    select reserved_microunits::bigint as reserved, consumed_microunits::bigint as consumed
      from private.usage_budget_counters
     where scope_type = 'RUN' and scope_key = ${RUN_ID} and provider = 'clova' and model = 'ocr-general'`;
  const [ledger] = await sql`
    select count(*) filter (where status = 'SETTLED')::int as settled,
           count(*) filter (where status = 'RELEASED')::int as released,
           count(*) filter (where status = 'RESERVED')::int as open,
           coalesce(sum(actual_microunits) filter (where status = 'SETTLED'), 0)::bigint as actual_sum
      from private.usage_reservations where run_id = ${RUN_ID}::uuid`;
  progress("settle");

  // 3. Rate limit. 상한을 넘긴 요청은 전부 거부되고 재시도 시각을 돌려줘야 한다.
  const scopeKey = `rate-${Date.now()}`;
  const rateAttempts = await concurrentRate(connect, scopeKey);
  const allowedRate = rateAttempts.filter((a) => a.allowed);
  const deniedRate = rateAttempts.filter((a) => !a.allowed);
  progress("rate");

  // 4. Provider 직렬화. CLOVA 기본 1 TPS 를 DB 가 배분한다.
  const slots = [];
  for (let index = 0; index < PROVIDER_SLOTS; index += 1) {
    const rows = await sql`
      select * from private.acquire_provider_slot('clova', 'ocr-general', ${PROVIDER_MIN_INTERVAL_MS}::integer)`;
    slots.push({ scheduled_at: rows[0].scheduled_at, circuit_state: rows[0].circuit_state });
  }
  const gaps = slots.slice(1).map((slot, index) => Date.parse(slot.scheduled_at) - Date.parse(slots[index].scheduled_at));
  progress("provider");

  return {
    contract: {
      formula_version: FORMULA_VERSION,
      concurrency: CONCURRENCY,
      unit_microunits: UNIT_MICROUNITS,
      run_limit_microunits: RUN_LIMIT_MICROUNITS,
      rate_limit: RATE_LIMIT,
      rate_window_seconds: RATE_WINDOW_SECONDS,
      rate_attempts: RATE_ATTEMPTS,
      provider_min_interval_ms: PROVIDER_MIN_INTERVAL_MS,
      provider_slots: PROVIDER_SLOTS,
    },
    budget: {
      attempts: reserveAttempts.length,
      accepted: accepted.length,
      rejected: rejected.length,
      rejected_hints: [...new Set(rejected.map((a) => a.hint))].sort(),
      limit_microunits: Number(counter.limit_microunits),
      reserved_after_accept: Number(counter.reserved),
      consumed_after_accept: Number(counter.consumed),
      over_limit_accepts: Math.max(0, (accepted.length * UNIT_MICROUNITS) - Number(counter.limit_microunits)),
    },
    ledger: {
      settled: ledger.settled,
      released: ledger.released,
      open: ledger.open,
      actual_sum: Number(ledger.actual_sum),
      reserved_after_settle: Number(after.reserved),
      consumed_after_settle: Number(after.consumed),
      mismatch: Number(after.consumed) !== Number(ledger.actual_sum) || Number(after.reserved) !== 0 ? 1 : 0,
    },
    rate: {
      attempts: rateAttempts.length,
      allowed: allowedRate.length,
      denied: deniedRate.length,
      denied_without_retry_after: deniedRate.filter((a) => !(a.retry_after_seconds >= 1)).length,
      max_retry_after_seconds: deniedRate.reduce((max, a) => Math.max(max, a.retry_after_seconds ?? 0), 0),
    },
    provider: {
      slots: slots.length,
      circuit_states: [...new Set(slots.map((s) => s.circuit_state))].sort(),
      min_gap_ms: gaps.length === 0 ? null : Math.min(...gaps),
      gaps_ms: gaps,
    },
  };
};
