import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { buildFinalClaims } from "@/lib/finshield/finalize";
import { heartbeat, dispatchNotifications } from "@/lib/finshield/revalidate";
import type { OrchestratedRun } from "@/lib/finshield/orchestrator";
import type { ConfirmedClaim } from "@/lib/finshield/schemas";

const claims: (ConfirmedClaim & { claimId: string })[] = [1, 2].map((n) => ({
  claimId: `claim-${n}`, claim_ref: `C${n}`, claim_type: "PRODUCT_TERM",
  statement_masked: `합성 조건 ${n}`, materiality: "MATERIAL",
}));

const run = (): OrchestratedRun => ({
  agentResults: [], evidence: [], evidenceIds: new Map([["E1", "evidence-1"]]),
  findings: claims.map((c, i) => ({
    claim_ref: c.claim_ref, agent_code: "PRODUCT_INSTITUTION", state: i === 0 ? "VERIFIED" : "CONTRADICTED",
    relation: i === 0 ? "SUPPORT" : "CONTRADICT", evidence_refs: ["E1"], summary_masked: "합성 근거 대조", limits: [],
  })),
  judgeOutput: {
    schema_version: "out-v1", conflicts: [],
    claim_results: claims.map((c, i) => ({
      claim_ref: c.claim_ref, state: i === 0 ? "VERIFIED" : "CONTRADICTED",
      evidence_refs: ["E1"], withheld_reason: null, rationale_masked: "합성 근거 대조",
    })),
  },
  judgeReasonCode: null, partial: false,
  cove: { schema_version: "out-v1", results: claims.map((c, i) => ({ claim_ref: c.claim_ref, status: i === 0 ? "CONFIRMED" : "REFUTED", evidence_refs: ["E1"], note_masked: "합성 독립 대조" })) },
  redTeam: { schema_version: "out-v1", results: claims.map((c) => ({ claim_ref: c.claim_ref, status: "NONE_FOUND", evidence_refs: [], note_masked: "합성 반대 근거 미발견" })) },
});

describe("EV-003·D-007·EC-029 최종화 실패 안전 계약", () => {
  it("동일 Evidence의 관계는 Claim마다 독립적으로 저장한다", () => {
    const finals = buildFinalClaims({ claims, run: run() });
    expect(finals[0].evidences[0].relation).toBe("SUPPORT");
    expect(finals[1].evidences[0].relation).toBe("CONTRADICT");
  });

  it("Red Team 기술 실패를 반대 근거 미발견으로 바꾸지 않는다", () => {
    const failed = run();
    failed.redTeam = null;
    failed.agentResults = [{ agentCode: "RED_TEAM", status: "FAILED", reasonCode: "MODEL_CALL_FAILED", toolCalls: 0 }];
    failed.partial = true;
    const [final] = buildFinalClaims({ claims, run: failed });
    expect(final.red_team_status).toBe("FAILED");
    expect(final.status).toBe("WITHHELD");
  });
});

describe("REV-001·N-AVL-005 Lease·Outbox 계약", () => {
  it("Heartbeat 실패를 Worker에 전달해 후속 작업을 중단시킨다", async () => {
    const sql = vi.fn(async () => { throw new Error("합성 Lease 만료"); });
    await expect(heartbeat(sql as unknown as ReturnType<typeof postgres>, "job", "lease")).rejects.toThrow();
  });

  it("알림 복구는 제한된 DB 배치에 소유자를 전달하고 생성 수를 반환한다", async () => {
    const sql = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => [{ result: { delivered: 2, failed: 1 } }]);
    expect(await dispatchNotifications(sql as unknown as ReturnType<typeof postgres>, "owner")).toBe(2);
    expect(sql).toHaveBeenCalledOnce();
    expect(sql.mock.calls[0]).toContain("owner");
  });
});

it("한쪽 근거뿐인 모델 충돌은 보류해 다른 항목의 저장을 막지 않고 양쪽 근거 충돌은 보존한다", () => {
  const checked = run();
  checked.cove = null;
  checked.judgeOutput!.claim_results[0].state = "CONFLICT";
  const [oneSided] = buildFinalClaims({ claims, run: checked });
  expect(oneSided).toMatchObject({ status: "UNKNOWN", reason_code: "CONFLICT_EVIDENCE_INCOMPLETE", cove_status: "FAILED" });
  expect(oneSided.evidences).toHaveLength(1);
  checked.redTeam!.results[0] = { claim_ref: "C1", status: "COUNTER_EVIDENCE", evidence_refs: ["E2"], note_masked: "별도 반대 자료" };
  checked.evidenceIds.set("E2", "evidence-2");
  const [twoSided] = buildFinalClaims({ claims, run: checked });
  expect(twoSided.status).toBe("CONFLICT");
  expect(twoSided.evidences.map(e => e.relation)).toEqual(["SUPPORT", "CONTRADICT"]);
});
