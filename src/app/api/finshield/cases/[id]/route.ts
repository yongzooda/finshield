/**
 * GET /api/finshield/cases/[id] — Case 상세와 Evidence Passport (S-011·S-012·S-013).
 *
 * 서버가 발급처의 세션 유효성을 먼저 확인하고 사용자 Token으로 조회한다.
 * 소유권은 RLS가 확인하며 남의 Case에는 빈 결과를 돌려준다.
 *
 * 근거는 Claim 마다 어떤 관계로 걸렸는지 함께 준다. 화면이 판단과 근거를 이어
 * 보여 줄 수 있어야 하기 때문이다 (EV-001).
 */

import { jsonNoStore } from "@/lib/ops/http";
import { bearerToken, resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { restSelect, RestError } from "@/lib/finshield/rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return jsonNoStore({ error: "로그인이 필요합니다" }, 401);
  const { id } = await context.params;
  if (!UUID.test(id)) return jsonNoStore({ error: "잘못된 주소입니다" }, 400);

  const eq = `eq.${id}`;
  try {
    // RLS 소유권 검사와 별도로 발급처에서 현재 세션이 살아 있는지 확인한다.
    await resolveOwner(request);
    const [cases, claims, runs, finals, axes, links, evidences, passports, events,
           assessments, checklists] = await Promise.all([
      restSelect({ token, path: "financial_cases", query: {
        select: "id,scenario,lifecycle,title_masked,created_at,updated_at,"
          + "journey_stage,enrollment_confirmed_at,aftercare_status", id: eq } }),
      restSelect({ token, path: "claims", query: {
        select: "id,claim_type,source_input_id,created_at", case_id: eq, order: "created_at.asc" } }),
      restSelect({ token, path: "verification_runs", query: {
        select: "id,run_no,kind,status,overall_result,coverage_satisfied,partial_reason_codes,started_at,finished_at",
        case_id: eq, order: "run_no.desc" } }),
      restSelect({ token, path: "final_claim_versions", query: {
        select: "id,verification_run_id,claim_id,status,reason_code,cove_status,red_team_status,is_material,decision_summary_masked,created_at",
        case_id: eq, order: "created_at.asc" } }),
      restSelect({ token, path: "verification_axis_results", query: {
        select: "verification_run_id,axis,result_code,summary_masked,limitation_codes", case_id: eq } }),
      restSelect({ token, path: "claim_evidences", query: {
        select: "final_claim_version_id,evidence_id,relation,is_independent,policy_reason_code", case_id: eq } }),
      restSelect({ token, path: "evidences", query: {
        select: "id,source_locator,excerpt_masked,directness,citable,reference_only,incomplete,freshness_at_use,independence_key,selection_reason_code,content_hash,created_at,kb_snapshot_id",
        case_id: eq } }),
      restSelect({ token, path: "evidence_passports", query: {
        select: "id,verification_run_id,passport_version_no,overall_result,coverage_satisfied,passport_schema_version,manifest,payload_hash,created_at",
        case_id: eq, order: "passport_version_no.desc" } }),
      restSelect({ token, path: "case_events", query: {
        select: "event_no,event_type,actor_type,from_state,to_state,created_at",
        case_id: eq, order: "event_no.asc" } }),
      restSelect({ token, path: "precase_assessments", query: {
        select: "id,assessment_no,status,result,summary_masked,finished_at",
        case_id: eq, order: "assessment_no.desc" } }),
      restSelect({ token, path: "action_checklists", query: {
        select: "id,precase_assessment_id,action_code,status,required_material_codes,created_at",
        case_id: eq } }),
    ]);

    if (cases.length === 0) return jsonNoStore({ error: "찾을 수 없습니다" }, 404);
    return jsonNoStore({
      case: cases[0], claims, runs, final_claims: finals, axes,
      claim_evidences: links, evidences, passports, events,
      assessments, checklists,
    }, 200);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    if (error instanceof RestError) return jsonNoStore({ error: error.message }, error.status);
    throw error;
  }
}
