import { expect, it } from "vitest";
import { finalEvidenceRefs } from "../final-evidence";

it("저장하는 최종 항목의 근거 연결을 화면 ref 로 옮기고 관계를 지킨다", () => {
  const ids = new Map([["E1", "id-1"], ["E2", "id-2"], ["E3", "id-3"]]);
  const result = finalEvidenceRefs([
    { evidence_id: "id-1", relation: "SUPPORT" },
    { evidence_id: "id-3", relation: "CONTRADICT" },
    { evidence_id: "id-2", relation: "CONTEXT" },
    { evidence_id: "다른 실행의 근거", relation: "SUPPORT" },
  ], ids);
  expect(result.evidence_refs).toEqual(["E1", "E3", "E2"]);
  expect(result.relations).toEqual({ E1: "SUPPORT", E3: "CONTRADICT", E2: "CONTEXT" });
});
