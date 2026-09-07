import "server-only";
import { restSelect } from "./rest";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];

/** S-011·PASS-001: 회원에게 허용된 View만 읽고 화면의 표시 구조로 변환한다. */
export async function readCaseDetail(token: string, caseId: string) {
  const eq = `eq.${caseId}`;
  const cases = await restSelect({ token, path: "case_detail_v", query: { select: "*", id: eq } });
  if (!cases.length) return null;
  const detail = cases[0] as Row;
  const [rawPassports, claims, assessments, checklists] = await Promise.all([
    restSelect({ token, path: "passport_v", query: { select: "*", case_id: eq, order: "passport_version_no.desc" } }),
    restSelect({ token, path: "claims", query: { select: "id,claim_type,source_input_id,source_locator,created_at", case_id: eq, order: "created_at.asc" } }),
    restSelect({ token, path: "precase_assessments", query: { select: "id,assessment_no,status,result,summary_masked,finished_at", case_id: eq, order: "assessment_no.desc" } }),
    restSelect({ token, path: "action_checklists", query: { select: "id,precase_assessment_id,action_code,status,required_material_codes,created_at", case_id: eq } }),
  ]);
  const passports = rows(rawPassports);
  const finals: Row[] = [];
  const links: Row[] = [];
  const evidence = new Map<unknown, Row>();
  const axes: Row[] = [];
  for (const passport of passports) {
    for (const claim of rows(passport.claims)) {
      const id = claim.id ?? `${passport.verification_run_id}:${claim.claim_id}`;
      const { evidences, ...final } = claim;
      finals.push({ ...final, id, verification_run_id: passport.verification_run_id });
      for (const item of rows(evidences)) {
        const { relation, is_independent, evidence_id, ...source } = item;
        links.push({ final_claim_version_id: id, evidence_id, relation, is_independent });
        evidence.set(evidence_id, { ...source, id: evidence_id });
      }
    }
    axes.push(...rows(passport.axis_results).map(axis => ({ ...axis, verification_run_id: passport.verification_run_id })));
  }
  return {
    case: detail, claims,
    runs: rows(detail.runs).map(row => ({ ...row, id: row.run_id })).reverse(),
    final_claims: finals, axes, claim_evidences: links, evidences: [...evidence.values()],
    passports: passports.map(passport => ({ ...passport, id: passport.passport_id })),
    events: rows(detail.timeline), assessments, checklists,
  };
}
