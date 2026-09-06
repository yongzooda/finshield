/**
 * GET /api/finshield/cases — 내 Case 목록 (S-005).
 *
 * 소유권 판단은 RLS 가 한다. 서버는 사용자의 token 을 그대로 실어 넘길 뿐이다.
 */

import { jsonNoStore } from "@/lib/ops/http";
import { bearerToken } from "@/lib/finshield/auth";
import { restSelect, RestError } from "@/lib/finshield/rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return jsonNoStore({ error: "로그인이 필요합니다" }, 401);
  try {
    const rows = await restSelect({
      token,
      path: "financial_cases",
      query: {
        select: "id,scenario,lifecycle,title_masked,created_at,updated_at",
        order: "created_at.desc",
        limit: "50",
      },
    });
    return jsonNoStore({ cases: rows }, 200);
  } catch (error) {
    if (error instanceof RestError) return jsonNoStore({ error: error.message }, error.status);
    throw error;
  }
}
