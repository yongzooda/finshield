// ============================================================
// B-RATE-01 사전 고정 합격선. 결과 파일을 다시 검사한다.
//
// ADR 15.1 Rate·Budget 행: 동일 cap 에 동시 예약 ≥50, cap 초과 승인 0건,
// 예약·정산 원장 불일치 0건, 429 retry time 누락 0건.
// ADR 4.3·10.1 의 CLOVA 기본 1 TPS 직렬화도 같은 원장이 담당한다.
// ============================================================
import {
  CONCURRENCY, FORMULA_VERSION, PROVIDER_MIN_INTERVAL_MS, PROVIDER_SLOTS,
  RATE_ATTEMPTS, RATE_LIMIT, RATE_WINDOW_SECONDS, RUN_LIMIT_MICROUNITS, UNIT_MICROUNITS,
} from "./rate-budget-spike.mjs";

export const MIN_CONCURRENT_RESERVATIONS = 50; // ADR 15.1 최소 표본
export { FORMULA_VERSION };

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

export const validateRateEvidenceResult = (result, fail) => {
  const o = result?.observations;
  if (!exactKeys(o, ["contract", "budget", "ledger", "rate", "provider"])) {
    fail("observations 는 contract·budget·ledger·rate·provider 만 가져야 합니다.");
    return;
  }

  // 1. 계약
  const c = o.contract;
  const expected = {
    formula_version: FORMULA_VERSION, concurrency: CONCURRENCY, unit_microunits: UNIT_MICROUNITS,
    run_limit_microunits: RUN_LIMIT_MICROUNITS, rate_limit: RATE_LIMIT, rate_window_seconds: RATE_WINDOW_SECONDS,
    rate_attempts: RATE_ATTEMPTS, provider_min_interval_ms: PROVIDER_MIN_INTERVAL_MS, provider_slots: PROVIDER_SLOTS,
  };
  if (!exactKeys(c, Object.keys(expected))) fail("contract 필드가 계약과 다릅니다.");
  for (const [key, value] of Object.entries(expected)) {
    if (c?.[key] !== value) fail(`contract 의 ${key} 가 고정값과 다릅니다.`);
  }
  if (CONCURRENCY < MIN_CONCURRENT_RESERVATIONS) fail(`동시 예약 표본이 ${MIN_CONCURRENT_RESERVATIONS} 에 못 미칩니다.`);

  // 2. 예산. 상한을 넘긴 승인이 하나라도 있으면 미달이다.
  const b = o.budget;
  if (!exactKeys(b, ["attempts", "accepted", "rejected", "rejected_hints", "limit_microunits",
    "reserved_after_accept", "consumed_after_accept", "over_limit_accepts"])) {
    fail("budget 필드가 계약과 다릅니다.");
  } else {
    if (b.attempts !== CONCURRENCY) fail("동시 예약 시도 수가 계약과 다릅니다.");
    if (b.accepted + b.rejected !== b.attempts) fail("승인과 거부의 합이 시도 수와 다릅니다.");
    if (b.limit_microunits !== RUN_LIMIT_MICROUNITS) fail("RUN 범위 상한이 고정값과 다릅니다.");
    if (b.accepted !== RUN_LIMIT_MICROUNITS / UNIT_MICROUNITS) fail("상한이 허용하는 수만큼 승인되지 않았습니다.");
    if (b.over_limit_accepts !== 0) fail("상한을 넘긴 승인이 있습니다.");
    if (b.reserved_after_accept !== b.accepted * UNIT_MICROUNITS) fail("예약 Counter 가 승인 수와 맞지 않습니다.");
    if (b.consumed_after_accept !== 0) fail("정산 전에 사용액이 올라갔습니다.");
    if (b.rejected < 1) fail("상한을 넘긴 시도가 하나도 거부되지 않았습니다.");
    if (!Array.isArray(b.rejected_hints) || b.rejected_hints.length !== 1 || b.rejected_hints[0] !== "BUDGET_EXCEEDED") {
      fail("거부 사유가 예산 상한 초과 하나가 아닙니다.");
    }
  }

  // 3. 원장. 예약과 정산이 정확히 대조돼야 한다.
  const l = o.ledger;
  if (!exactKeys(l, ["settled", "released", "open", "actual_sum", "reserved_after_settle", "consumed_after_settle", "mismatch"])) {
    fail("ledger 필드가 계약과 다릅니다.");
  } else {
    if (l.mismatch !== 0) fail("예약·정산 원장이 맞지 않습니다.");
    if (l.open !== 0) fail("종결되지 않은 예약이 남았습니다.");
    if (l.settled + l.released !== (o.budget?.accepted ?? -1)) fail("정산과 해제의 합이 승인 수와 다릅니다.");
    if (l.reserved_after_settle !== 0) fail("정산 뒤에도 예약액이 남았습니다.");
    if (l.consumed_after_settle !== l.actual_sum) fail("사용액 합계가 정산 원장과 다릅니다.");
    if (l.actual_sum !== l.settled * UNIT_MICROUNITS) fail("정산 금액이 건수와 맞지 않습니다.");
    if (l.settled < 1 || l.released < 1) fail("정산과 해제를 모두 관측하지 못했습니다.");
  }

  // 4. Rate. 거부는 모두 재시도 시각을 돌려줘야 한다.
  const r = o.rate;
  if (!exactKeys(r, ["attempts", "allowed", "denied", "denied_without_retry_after", "max_retry_after_seconds"])) {
    fail("rate 필드가 계약과 다릅니다.");
  } else {
    if (r.attempts !== RATE_ATTEMPTS) fail("Rate 시도 수가 계약과 다릅니다.");
    if (r.allowed !== RATE_LIMIT) fail("허용 수가 상한과 다릅니다.");
    if (r.allowed + r.denied !== r.attempts) fail("허용과 거부의 합이 시도 수와 다릅니다.");
    if (r.denied_without_retry_after !== 0) fail("재시도 시각 없이 거부한 요청이 있습니다.");
    if (!(r.max_retry_after_seconds >= 1) || r.max_retry_after_seconds > RATE_WINDOW_SECONDS) {
      fail("재시도 시각이 창 길이 범위를 벗어납니다.");
    }
  }

  // 5. Provider 직렬화. CLOVA 기본 1 TPS 를 DB 가 배분한다.
  const p = o.provider;
  if (!exactKeys(p, ["slots", "circuit_states", "min_gap_ms", "gaps_ms"])) {
    fail("provider 필드가 계약과 다릅니다.");
  } else {
    if (p.slots !== PROVIDER_SLOTS) fail("Provider 슬롯 수가 계약과 다릅니다.");
    if (!Array.isArray(p.gaps_ms) || p.gaps_ms.length !== PROVIDER_SLOTS - 1) fail("슬롯 간격 기록이 부족합니다.");
    if (!(p.min_gap_ms >= PROVIDER_MIN_INTERVAL_MS)) fail("슬롯 간격이 최소 간격보다 좁습니다.");
    if (!Array.isArray(p.circuit_states) || p.circuit_states.some((state) => !["CLOSED", "HALF_OPEN"].includes(state))) {
      fail("Circuit 상태가 정상 범위를 벗어납니다.");
    }
  }
};
