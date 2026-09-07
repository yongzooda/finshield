import { cleanupCaseFiles } from "@/lib/finshield/files/cleanup";
/**
 * POST /api/finshield/cases/[id]/stop — 사용자가 중단한다 (S-007, 규칙 4).
 *
 * 중단은 화면에서 물러나는 것이 아니라 원본을 지우기 시작하는 것이다. 입력
 * 원본과 중간 산출물과 Case vector 를 모두 청소 대상으로 넣는다.
 *
 * 이미 중단한 입력에 다시 요청해도 같은 결과를 돌려준다.
 */

import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await resolveOwner(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    throw error;
  }
  const { id: caseId } = await context.params;
  if (!UUID.test(caseId)) return jsonNoStore({ error: "잘못된 주소입니다" }, 400);

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonNoStore({ error: "요청 형식이 올바르지 않습니다" }, 400);
  const inputId = str(parsed.value, "input_id") ?? "";
  if (!UUID.test(inputId)) return jsonNoStore({ error: "무엇을 중단할지 알 수 없습니다" }, 400);

  try {
    const rows = await fsql()`
      select private.stop_case_input(${ownerId}::uuid, ${caseId}::uuid, ${inputId}::uuid,
        'USER_STOPPED') as cleanups`;
    await cleanupCaseFiles(fsql(),ownerId,caseId).catch(()=>undefined);
    return jsonNoStore({ ok: true, cleanup_count: Number(rows[0]?.cleanups ?? 0) }, 200);
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "");
    if (code === "42501") return jsonNoStore({ error: "이 Case 를 찾을 수 없습니다" }, 404);
    throw error;
  }
}
