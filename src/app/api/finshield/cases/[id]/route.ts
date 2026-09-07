/**
 * GET /api/finshield/cases/[id] — Case 상세와 Evidence Passport (S-011·S-012·S-013).
 *
 * 소유권 판단은 데이터베이스 정책이 한다. 서버는 사용자의 token 을 그대로 실어
 * 넘길 뿐이다. 남의 Case 를 물어도 정책이 빈 결과를 돌려준다.
 *
 * 근거는 Claim 마다 어떤 관계로 걸렸는지 함께 준다. 화면이 판단과 근거를 이어
 * 보여 줄 수 있어야 하기 때문이다 (EV-001).
 */

import { jsonNoStore } from "@/lib/ops/http";
import { bearerToken } from "@/lib/finshield/auth";
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
    const detail = await readCaseDetail(token, id);
    if (!detail) return jsonNoStore({ error: "찾을 수 없습니다" }, 404);
    return jsonNoStore(detail, 200);
  } catch (error) {
    if (error instanceof RestError) return jsonNoStore({ error: error.message }, error.status);
    throw error;
  }
}
