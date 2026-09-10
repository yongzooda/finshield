// B-JOB-01·B-DEADLINE-01 합격식 계약 시험. 실제 Provider·배포를 호출하지 않는다.
// 통과 원장 하나와 변조 원장들을 넣어 합격식이 무엇을 거부하는지 고정한다.
import assert from 'node:assert/strict';
import {
  DEADLINE_BUDGETS, FAULTS, FORMULA_VERSION,
  validateDeadlineEvidenceResult, validateWorkflowFaultResult,
} from './workflow-fault-policy.mjs';

const faultBase = () => ({
  observations: {
    contract: { formula_version: FORMULA_VERSION, fault_count: FAULTS.length, real_vercel_workflow: true, deployment_environment: 'production-like' },
    faults: FAULTS.map((spec) => ({
      id: spec.id, group: spec.group, transport: spec.transport, injected: true, outcome: spec.expected,
      terminal_rows: 1, duplicate_jobs: 0, extra_model_calls: 0, passports_before: 1, passports_after: 1,
      events_for_outcome: 1, unsettled_released: 0, elapsed_ms: 1200,
    })),
    ledger: { unsettled_reservations_after_sweep: 1, orphan_running_jobs: 0, orphan_running_runs: 0, cost_reconciliation_rows: 1 },
  },
});

const deadlineBase = () => ({
  observations: {
    contract: { formula_version: FORMULA_VERSION, budgets_ms: { ...DEADLINE_BUDGETS }, real_vercel_workflow: true },
    deadlines: Object.entries(DEADLINE_BUDGETS).map(([kind, budget]) => ({
      kind, budget_ms: budget, observed_ms: budget - 5_000, aborted: true, downstream_stopped_ms: 1_400,
      terminal_status: 'PARTIAL', status_readable_from_other_session: true, partial_saved: true,
      extra_model_calls_after_abort: 0,
    })),
  },
});

const run = (validator, result) => { const errors = []; const metrics = validator(result, (e) => errors.push(e)); return { errors, metrics }; };

assert.deepEqual(run(validateWorkflowFaultResult, faultBase()).errors, []);
assert.equal(run(validateWorkflowFaultResult, faultBase()).metrics.injected, 20);
assert.deepEqual(run(validateDeadlineEvidenceResult, deadlineBase()).errors, []);

const faultMutations = [
  (r) => r.observations.contract.formula_version = 'other',
  (r) => r.observations.contract.fault_count = 19,
  (r) => r.observations.contract.real_vercel_workflow = false,
  (r) => r.observations.contract.deployment_environment = 'local',
  (r) => r.observations.faults.pop(),
  (r) => r.observations.faults.reverse(),
  (r) => r.observations.faults[0].injected = false,
  (r) => r.observations.faults[0].outcome = 'REJECTED_TERMINAL_REPLAY',
  (r) => r.observations.faults[3].outcome = 'PASS',
  (r) => r.observations.faults[5].terminal_rows = 2,
  (r) => r.observations.faults[6].duplicate_jobs = 1,
  (r) => r.observations.faults[7].extra_model_calls = 1,
  (r) => r.observations.faults[8].passports_after = 2,
  (r) => r.observations.faults[9].events_for_outcome = 2,
  (r) => r.observations.faults[10].unsettled_released = 1,
  (r) => r.observations.faults[11].elapsed_ms = -1,
  (r) => r.observations.faults[12].transport = 'db-only',
  (r) => r.observations.ledger.orphan_running_jobs = 1,
  (r) => r.observations.ledger.orphan_running_runs = 1,
  (r) => r.observations.ledger.unsettled_reservations_after_sweep = 3,
  (r) => delete r.observations.ledger.cost_reconciliation_rows,
];
for (const mutate of faultMutations) {
  const result = structuredClone(faultBase());
  mutate(result);
  assert.ok(run(validateWorkflowFaultResult, result).errors.length > 0, `변조를 거부하지 못했다: ${mutate}`);
}

const deadlineMutations = [
  (r) => r.observations.contract.budgets_ms.TEXT = 300_000,
  (r) => r.observations.contract.real_vercel_workflow = false,
  (r) => r.observations.deadlines.pop(),
  (r) => r.observations.deadlines.reverse(),
  (r) => r.observations.deadlines[0].observed_ms = DEADLINE_BUDGETS.TEXT + 1,
  (r) => r.observations.deadlines[0].aborted = false,
  (r) => r.observations.deadlines[1].downstream_stopped_ms = 2_001,
  (r) => r.observations.deadlines[1].terminal_status = 'RUNNING',
  (r) => r.observations.deadlines[2].status_readable_from_other_session = false,
  (r) => r.observations.deadlines[2].partial_saved = false,
  (r) => r.observations.deadlines[2].extra_model_calls_after_abort = 1,
  (r) => r.observations.deadlines[0].budget_ms = 999,
];
for (const mutate of deadlineMutations) {
  const result = structuredClone(deadlineBase());
  mutate(result);
  assert.ok(run(validateDeadlineEvidenceResult, result).errors.length > 0, `기한 변조를 거부하지 못했다: ${mutate}`);
}

// 완료한 종결 상태만 통과한다. 'PASS' 같은 결론 문자열은 증거가 아니다.
const declared = structuredClone(faultBase());
for (const row of declared.observations.faults) row.outcome = 'PASS';
assert.ok(run(validateWorkflowFaultResult, declared).errors.length > 0);

console.log(`Workflow 장애 ${FAULTS.length}종과 입력별 기한 계약, 변조 ${faultMutations.length + deadlineMutations.length + 1}건 거부를 확인했다.`);
