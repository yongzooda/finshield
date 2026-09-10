// B-JOB-01·B-DEADLINE-01: 사전등록 장애 20종과 입력별 기한 표본의 합격식을 결과 원장에서 다시 계산한다.
// 목록·기대 결과·산식은 docs/ops/workflow-fault-preregistration.md 와 같아야 한다.
// 원장의 'PASS' 문자열은 신뢰하지 않고 관측값에서 결론을 다시 만든다.
export const FORMULA_VERSION = 'workflow-fault-terminal-ledger-v1';

/**
 * 20종은 측정 전에 고정한다. `transport` 가 'vercel' 인 항목은 실제 배포의 전달 경계까지
 * 관측해야 하고, 'db' 인 항목은 같은 불변식을 DB 계약으로도 고정한 항목이다.
 * `expected` 는 그 장애를 주입했을 때 유일하게 허용되는 종결 상태다.
 */
export const FAULTS = Object.freeze([
  { id: 'F01', group: 'delivery', transport: 'vercel', expected: 'JOINED_EXISTING_JOB' },
  { id: 'F02', group: 'delivery', transport: 'db', expected: 'REJECTED_PAYLOAD_MISMATCH' },
  { id: 'F03', group: 'delivery', transport: 'vercel', expected: 'REJECTED_ACTIVE_JOB' },
  { id: 'F04', group: 'delivery', transport: 'vercel', expected: 'REJECTED_LEASE_HELD' },
  { id: 'F05', group: 'delivery', transport: 'db', expected: 'REJECTED_TERMINAL_REPLAY' },
  { id: 'F06', group: 'lease', transport: 'db', expected: 'REJECTED_STALE_LEASE' },
  { id: 'F07', group: 'lease', transport: 'db', expected: 'REJECTED_STALE_LEASE' },
  { id: 'F08', group: 'lease', transport: 'db', expected: 'REJECTED_ROTATED_LEASE' },
  { id: 'F09', group: 'lease', transport: 'db', expected: 'REJECTED_UNKNOWN_LEASE' },
  { id: 'F10', group: 'lease', transport: 'db', expected: 'LEASE_EXTENDED' },
  { id: 'F11', group: 'cancel', transport: 'vercel', expected: 'CANCEL_REQUESTED_NOT_TERMINAL' },
  { id: 'F12', group: 'cancel', transport: 'vercel', expected: 'CANCELLED_ONCE' },
  { id: 'F13', group: 'cancel', transport: 'db', expected: 'REJECTED_AFTER_TERMINAL' },
  { id: 'F14', group: 'cancel', transport: 'db', expected: 'CANCELLED_ONCE' },
  { id: 'F15', group: 'cancel', transport: 'vercel', expected: 'TERMINAL_RESTORED' },
  { id: 'F16', group: 'orphan', transport: 'vercel', expected: 'FAILED_RETRY_EXHAUSTED' },
  { id: 'F17', group: 'orphan', transport: 'vercel', expected: 'FAILED_PROVIDER_RESULT_UNKNOWN' },
  { id: 'F18', group: 'budget', transport: 'db', expected: 'RESERVATION_PRESERVED_THEN_SETTLED' },
  { id: 'F19', group: 'budget', transport: 'db', expected: 'REJECTED_DOUBLE_SETTLE' },
  { id: 'F20', group: 'budget', transport: 'db', expected: 'REJECTED_BUDGET_EXCEEDED' },
]);

/** ADR 4.3 의 입력별 전체 기한이다. 저장 여유는 이 값 안에서 확보한다. */
export const DEADLINE_BUDGETS = Object.freeze({ TEXT: 120_000, IMAGE: 180_000, PDF: 180_000 });

const FAULT_ROW = ['id', 'group', 'transport', 'injected', 'outcome', 'terminal_rows', 'duplicate_jobs',
  'extra_model_calls', 'passports_before', 'passports_after', 'events_for_outcome', 'unsettled_released', 'elapsed_ms'];
const DEADLINE_ROW = ['kind', 'budget_ms', 'observed_ms', 'aborted', 'downstream_stopped_ms', 'terminal_status',
  'status_readable_from_other_session', 'partial_saved', 'extra_model_calls_after_abort'];

const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const nonNegativeInt = (value) => Number.isInteger(value) && value >= 0;

/** B-JOB-01: 장애 20종의 종결 상태·원장 정합성·이전 Passport 보존을 다시 계산한다. */
export function validateWorkflowFaultResult(result, fail) {
  const o = result?.observations;
  if (!exact(o, ['contract', 'faults', 'ledger'])) { fail('Workflow 장애 관측 필드가 계약과 다릅니다.'); return null; }
  const c = o.contract;
  if (!exact(c, ['formula_version', 'fault_count', 'real_vercel_workflow', 'deployment_environment'])
    || c.formula_version !== FORMULA_VERSION || c.fault_count !== FAULTS.length
    || c.real_vercel_workflow !== true || c.deployment_environment !== 'production-like') {
    fail('장애 20종·실제 Workflow 실행 계약이 다릅니다.');
  }
  if (!Array.isArray(o.faults) || o.faults.length !== FAULTS.length) { fail('장애 표본이 정확히 20종이어야 합니다.'); return null; }
  let injected = 0;
  for (const [index, row] of o.faults.entries()) {
    const spec = FAULTS[index];
    if (!exact(row, FAULT_ROW) || row.id !== spec.id || row.group !== spec.group || row.transport !== spec.transport) {
      fail(`장애 원장 ${spec.id} 의 사전등록 항목이 다릅니다.`); continue;
    }
    if (row.injected !== true) { fail(`장애 ${spec.id} 를 실제로 주입하지 않았습니다.`); continue; }
    injected += 1;
    // 기대한 종결 상태 외에는 어떤 값도 통과시키지 않는다. 미주입·미관측을 성공으로 세지 않는다.
    if (row.outcome !== spec.expected) fail(`장애 ${spec.id} 의 종결 상태가 사전등록과 다릅니다.`);
    if (row.terminal_rows !== 1) fail(`장애 ${spec.id} 가 terminal 행 하나로 종결되지 않았습니다.`);
    if (row.duplicate_jobs !== 0) fail(`장애 ${spec.id} 가 중복 Job 을 만들었습니다.`);
    if (row.extra_model_calls !== 0) fail(`장애 ${spec.id} 복구가 모델을 다시 호출했습니다.`);
    if (!nonNegativeInt(row.passports_before) || row.passports_after !== row.passports_before) {
      fail(`장애 ${spec.id} 복구가 이전 Passport 를 바꿨습니다.`);
    }
    if (row.events_for_outcome !== 1) fail(`장애 ${spec.id} 의 종결 이벤트가 하나가 아닙니다.`);
    if (row.unsettled_released !== 0) fail(`장애 ${spec.id} 가 미확정 예약을 임의로 해제했습니다.`);
    if (!nonNegativeInt(row.elapsed_ms)) fail(`장애 ${spec.id} 의 소요 시간이 유효하지 않습니다.`);
  }
  if (injected !== FAULTS.length) fail('20종 중 실제로 주입하지 못한 장애가 있습니다.');
  const l = o.ledger;
  if (!exact(l, ['unsettled_reservations_after_sweep', 'orphan_running_jobs', 'orphan_running_runs', 'cost_reconciliation_rows'])) {
    fail('Workflow 비용·Orphan 원장 필드가 계약과 다릅니다.'); return null;
  }
  if (l.orphan_running_jobs !== 0 || l.orphan_running_runs !== 0) fail('시험 뒤 실행 중으로 남은 Job 또는 Run 이 있습니다.');
  if (!nonNegativeInt(l.unsettled_reservations_after_sweep) || !nonNegativeInt(l.cost_reconciliation_rows)) {
    fail('비용 원장 수치가 유효하지 않습니다.');
  }
  // 미확정 예약은 남을 수 있지만 반드시 재조정 행으로 설명돼야 한다.
  if (l.unsettled_reservations_after_sweep > l.cost_reconciliation_rows) {
    fail('설명되지 않은 미확정 예약이 남았습니다.');
  }
  return { faults: o.faults.length, injected, orphans: l.orphan_running_jobs + l.orphan_running_runs };
}

/** B-DEADLINE-01: Text 120초·Image/PDF 180초의 중단·조회·부분 저장을 다시 계산한다. */
export function validateDeadlineEvidenceResult(result, fail) {
  const o = result?.observations;
  if (!exact(o, ['contract', 'deadlines'])) { fail('기한 관측 필드가 계약과 다릅니다.'); return null; }
  const c = o.contract;
  if (!exact(c, ['formula_version', 'budgets_ms', 'real_vercel_workflow'])
    || c.formula_version !== FORMULA_VERSION || c.real_vercel_workflow !== true
    || JSON.stringify(c.budgets_ms) !== JSON.stringify(DEADLINE_BUDGETS)) {
    fail('입력별 기한 계약이 ADR 4.3 과 다릅니다.');
  }
  const kinds = Object.keys(DEADLINE_BUDGETS);
  if (!Array.isArray(o.deadlines) || o.deadlines.length !== kinds.length) { fail('기한 표본은 Text·Image·PDF 세 건이어야 합니다.'); return null; }
  for (const [index, row] of o.deadlines.entries()) {
    const kind = kinds[index];
    if (!exact(row, DEADLINE_ROW) || row.kind !== kind || row.budget_ms !== DEADLINE_BUDGETS[kind]) {
      fail(`기한 표본 ${kind} 의 사전등록 항목이 다릅니다.`); continue;
    }
    if (!nonNegativeInt(row.observed_ms) || row.observed_ms > row.budget_ms) fail(`${kind} 실행이 기한을 넘겼습니다.`);
    if (row.aborted !== true) fail(`${kind} 기한 초과에서 하위 호출을 중단하지 않았습니다.`);
    if (!nonNegativeInt(row.downstream_stopped_ms) || row.downstream_stopped_ms > 2000) {
      fail(`${kind} 중단 신호가 2초 안에 하위 경계로 전달되지 않았습니다.`);
    }
    if (!['FAILED', 'PARTIAL'].includes(row.terminal_status)) fail(`${kind} 이 terminal 행으로 종결되지 않았습니다.`);
    if (row.status_readable_from_other_session !== true) fail(`${kind} 종결 상태를 다른 세션에서 조회하지 못했습니다.`);
    if (row.partial_saved !== (row.terminal_status === 'PARTIAL')) fail(`${kind} 부분 저장 표시가 종결 상태와 다릅니다.`);
    if (row.extra_model_calls_after_abort !== 0) fail(`${kind} 중단 뒤에도 모델을 호출했습니다.`);
  }
  return { deadlines: o.deadlines.length };
}
