import type { FinalClaim } from "./finalize";

/**
 * 저장하는 최종 항목의 근거 연결을 화면의 근거 ref 로 옮긴다 (PASS-001).
 *
 * 판단 Agent 의 인용만 보내면 독립 재확인·반대 근거·공시 근거가 검증 직후 화면에서 빠져
 * 저장된 기록과 달라진다. 이 실행에서 만들지 않은 근거 ID 는 버린다.
 */
export function finalEvidenceRefs(evidences: FinalClaim["evidences"], evidenceIds: Map<string, string>) {
  const refOf = new Map([...evidenceIds].map(([ref, id]) => [id, ref]));
  const linked = evidences.flatMap((link) => {
    const ref = refOf.get(link.evidence_id);
    return ref ? [{ ref, relation: link.relation }] : [];
  });
  return {
    evidence_refs: linked.map((link) => link.ref),
    relations: Object.fromEntries(linked.map((link) => [link.ref, link.relation])) as Record<string, string>,
  };
}
