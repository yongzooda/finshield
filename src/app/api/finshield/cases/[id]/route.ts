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
import { RestError } from "@/lib/finshield/rest";

import { readCaseDetail } from "@/lib/finshield/case-detail";

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

  try {
    await resolveOwner(request);
    const detail = await readCaseDetail(token, id);
    if (!detail) return jsonNoStore({ error: "찾을 수 없습니다" }, 404);
    return jsonNoStore(detail, 200);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    if (error instanceof RestError) return jsonNoStore({ error: error.message }, error.status);
    throw error;
  }
}
