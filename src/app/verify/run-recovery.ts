export type InitialRunRecovery =
  | { kind: "PASSPORT"; passportId: string }
  | { kind: "RETRY"; reasonCode: string | null }
  | { kind: "PENDING" }
  | { kind: "UNKNOWN" };

type Detail = {
  runs?: { id?: string; run_id?: string; kind?: string; status?: string; reason_code?: string | null }[];
  passports?: { id?: string; passport_id?: string; verification_run_id?: string }[];
};

/** N-AVL-008: Stream이 끊겨도 저장 원장을 기준으로 완료·실패를 구분한다. */
export function resolveInitialRunRecovery(detail: Detail, runId: string): InitialRunRecovery {
  const run = detail.runs?.find(item => (item.id ?? item.run_id) === runId && item.kind === "INITIAL");
  if (!run) return { kind: "UNKNOWN" };
  if (run.status === "COMPLETED" || run.status === "PARTIAL") {
    const passport = detail.passports?.find(item => item.verification_run_id === runId);
    const passportId = passport?.id ?? passport?.passport_id;
    return passportId ? { kind: "PASSPORT", passportId } : { kind: "PENDING" };
  }
  if (run.status === "QUEUED" || run.status === "RUNNING") return { kind: "PENDING" };
  if (run.status === "FAILED" || run.status === "CANCELLED") {
    return { kind: "RETRY", reasonCode: run.reason_code ?? null };
  }
  return { kind: "UNKNOWN" };
}
