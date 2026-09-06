// B-RATE-01 계약 시험. 외부 호출 없이 fixture SQL·정책을 확인한다.
import assert from "node:assert/strict";
import {
  CONCURRENCY, PROVIDER_MIN_INTERVAL_MS, PROVIDER_SLOTS, RATE_ATTEMPTS, RATE_LIMIT, RATE_WINDOW_SECONDS,
  RUN_LIMIT_MICROUNITS, UNIT_MICROUNITS, caseIdFor, fixtureSql, runIdFor,
} from "./rate-budget-spike.mjs";
import { FORMULA_VERSION, MIN_CONCURRENT_RESERVATIONS, validateRateEvidenceResult } from "./rate-evidence-policy.mjs";

let passed = 0;
let rejected = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------- 1. 표본과 상수 ----------
ok(CONCURRENCY >= MIN_CONCURRENT_RESERVATIONS, `동시 예약 표본이 ${MIN_CONCURRENT_RESERVATIONS} 이상이어야 한다`);
ok(RUN_LIMIT_MICROUNITS % UNIT_MICROUNITS === 0, "상한이 예약 단위로 나눠떨어져야 한다");
ok(RUN_LIMIT_MICROUNITS / UNIT_MICROUNITS < CONCURRENCY, "상한이 동시 시도보다 작아야 거부를 관측할 수 있다");
ok(RATE_ATTEMPTS > RATE_LIMIT, "Rate 시도가 상한보다 많아야 거부를 관측할 수 있다");
ok(PROVIDER_SLOTS >= 2, "슬롯 간격을 재려면 슬롯이 둘 이상이어야 한다");

// ---------- 2. fixture SQL ----------
const runId = runIdFor("1a2b3c");
const caseId = caseIdFor("1a2b3c");
ok(UUID.test(runId) && UUID.test(caseId), "Run·Case 식별자가 UUID 형식이어야 한다");
ok(runId !== caseId, "Run 과 Case 는 다른 식별자여야 한다");
ok(runIdFor("1a2b3c") === runId, "같은 seed 는 같은 식별자를 만들어야 한다");
ok(runIdFor("9z9z9z") !== runId, "다른 seed 는 다른 식별자를 만들어야 한다");
const sql = fixtureSql(runId, caseId);
ok(sql.startsWith("\nbegin;") || sql.trim().startsWith("begin;"), "fixture 는 한 트랜잭션이어야 한다");
ok(sql.trim().endsWith("commit;"), "fixture 는 commit 으로 끝나야 한다");
for (const table of ["auth.users", "public.financial_profiles", "public.financial_profile_versions",
  "public.financial_cases", "private.execution_manifests", "public.verification_runs", "private.budget_limits"]) {
  ok(sql.includes(`insert into ${table}`), `${table} fixture 가 있어야 한다`);
}
ok(!sql.includes("insert into public.profiles"), "profiles 는 auth trigger 가 만들어야 한다");
ok(sql.includes(runId) && sql.includes(caseId), "fixture 가 실행별 식별자를 써야 한다");
ok(sql.includes(`'RUN', 'clova', 'ocr-general', ${RUN_LIMIT_MICROUNITS}`), "RUN 범위 상한이 고정값이어야 한다");
ok(!/on conflict/.test(sql) === false, "fixture 는 다시 돌려도 안전해야 한다");

// ---------- 3. 정책 ----------
const good = () => ({
  schema_version: 3, blocker_id: "B-RATE-01", requirements_blob_sha: "a".repeat(40), adr_decision_sha256: "b".repeat(64),
  code_under_test_sha: "c".repeat(40), workflow_head_sha: "c".repeat(40), scope_sha256: "d".repeat(64),
  run: { id: 1, attempt: 1 }, environment: {}, redactions_applied: true,
  observations: {
    contract: {
      formula_version: FORMULA_VERSION, concurrency: CONCURRENCY, unit_microunits: UNIT_MICROUNITS,
      run_limit_microunits: RUN_LIMIT_MICROUNITS, rate_limit: RATE_LIMIT, rate_window_seconds: RATE_WINDOW_SECONDS,
      rate_attempts: RATE_ATTEMPTS, provider_min_interval_ms: PROVIDER_MIN_INTERVAL_MS, provider_slots: PROVIDER_SLOTS,
    },
    budget: {
      attempts: CONCURRENCY, accepted: RUN_LIMIT_MICROUNITS / UNIT_MICROUNITS,
      rejected: CONCURRENCY - (RUN_LIMIT_MICROUNITS / UNIT_MICROUNITS), rejected_hints: ["BUDGET_EXCEEDED"],
      limit_microunits: RUN_LIMIT_MICROUNITS, reserved_after_accept: RUN_LIMIT_MICROUNITS,
      consumed_after_accept: 0, over_limit_accepts: 0,
    },
    ledger: {
      settled: 10, released: 10, open: 0, actual_sum: 10 * UNIT_MICROUNITS,
      reserved_after_settle: 0, consumed_after_settle: 10 * UNIT_MICROUNITS, mismatch: 0,
    },
    rate: {
      attempts: RATE_ATTEMPTS, allowed: RATE_LIMIT, denied: RATE_ATTEMPTS - RATE_LIMIT,
      denied_without_retry_after: 0, max_retry_after_seconds: 11,
    },
    provider: {
      slots: PROVIDER_SLOTS, circuit_states: ["CLOSED"], min_gap_ms: PROVIDER_MIN_INTERVAL_MS,
      gaps_ms: Array.from({ length: PROVIDER_SLOTS - 1 }, () => PROVIDER_MIN_INTERVAL_MS),
    },
  },
});
const check = (result) => { const errors = []; validateRateEvidenceResult(result, (m) => errors.push(m)); return errors; };
assert.deepEqual(check(good()), [], "기준 결과는 정책을 통과해야 한다");
passed += 1;

const rejects = (name, mutate) => {
  const result = good();
  mutate(result.observations);
  assert.ok(check(result).length > 0, `정책이 '${name}' 를 거부해야 한다`);
  rejected += 1;
};
rejects("산식 변경", (o) => { o.contract.formula_version = "other"; });
rejects("동시 표본 축소", (o) => { o.contract.concurrency = 10; });
rejects("상한 완화", (o) => { o.contract.run_limit_microunits = 999999; });
rejects("Rate 상한 변경", (o) => { o.contract.rate_limit = 1000; });
rejects("최소 간격 완화", (o) => { o.contract.provider_min_interval_ms = 1; });
rejects("상한 초과 승인", (o) => { o.budget.over_limit_accepts = 1; });
rejects("승인 수 초과", (o) => { o.budget.accepted += 1; o.budget.rejected -= 1; });
rejects("거부 없음", (o) => { o.budget.rejected = 0; o.budget.accepted = CONCURRENCY; });
rejects("예약 Counter 불일치", (o) => { o.budget.reserved_after_accept += 100; });
rejects("정산 전 사용액", (o) => { o.budget.consumed_after_accept = 100; });
rejects("예상 밖 거부 사유", (o) => { o.budget.rejected_hints = ["OTHER"]; });
rejects("원장 불일치", (o) => { o.ledger.mismatch = 1; });
rejects("종결되지 않은 예약", (o) => { o.ledger.open = 1; });
rejects("정산 뒤 남은 예약액", (o) => { o.ledger.reserved_after_settle = 100; });
rejects("사용액 합계 불일치", (o) => { o.ledger.consumed_after_settle = 999; });
rejects("정산 금액과 건수 불일치", (o) => { o.ledger.actual_sum = 999; });
rejects("해제 관측 없음", (o) => { o.ledger.released = 0; o.ledger.settled = 20; o.ledger.actual_sum = 20 * UNIT_MICROUNITS; o.ledger.consumed_after_settle = 20 * UNIT_MICROUNITS; });
rejects("재시도 시각 없는 거부", (o) => { o.rate.denied_without_retry_after = 1; });
rejects("Rate 허용 수 초과", (o) => { o.rate.allowed = RATE_LIMIT + 5; });
rejects("재시도 시각이 창을 넘김", (o) => { o.rate.max_retry_after_seconds = RATE_WINDOW_SECONDS + 1; });
rejects("재시도 시각 0", (o) => { o.rate.max_retry_after_seconds = 0; });
rejects("슬롯 간격 위반", (o) => { o.provider.min_gap_ms = 10; });
rejects("슬롯 기록 부족", (o) => { o.provider.gaps_ms = [PROVIDER_MIN_INTERVAL_MS]; });
rejects("알 수 없는 Circuit 상태", (o) => { o.provider.circuit_states = ["OPEN"]; });
rejects("observations 키 추가", (o) => { o.extra = 1; });

console.log(`B-RATE-01 계약 시험 통과: 합격 ${passed}건, 정책 거부 ${rejected}건.`);
