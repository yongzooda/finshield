/**
 * GET /api/finshield/cases — 내 Case 목록 (S-005).
 *
 * 서버가 발급처의 세션 유효성을 확인한 뒤 사용자 Token으로 RLS 소유권 검사를 적용한다.
 */

import { casePage, casePageQuery, readCaseCursor } from "@/lib/finshield/case-pagination";
import { jsonNoStore } from "@/lib/ops/http";
import { bearerToken, resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { restSelect, RestError } from "@/lib/finshield/rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return jsonNoStore({ error: "로그인이 필요합니다" }, 401);
  try {
    // RLS 소유권 검사와 별도로 발급처에서 현재 세션이 살아 있는지 확인한다.
    await resolveOwner(request);
    const rows = await restSelect({
      token,
      path: "financial_cases",
      query: casePageQuery(readCaseCursor(new URL(request.url).searchParams.get("cursor"))),
    });
    return jsonNoStore(casePage(rows), 200);
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CASE_CURSOR") return jsonNoStore({ error: "기록 목록을 처음부터 다시 열어 주세요" }, 400);
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    if (error instanceof RestError) return jsonNoStore({ error: error.message }, error.status);
    throw error;
  }
}
