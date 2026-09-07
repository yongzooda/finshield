/**
 * GET·POST /api/finshield/notifications — 알림센터 (S-014).
 *
 * 목록은 사용자의 token 으로 PostgREST 에 묻는다. 소유권은 정책이 정한다.
 * 읽음 처리는 표를 직접 고치지 않고 제한 함수만 부른다.
 */

import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { bearerToken, resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { restSelect, RestError } from "@/lib/finshield/rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return jsonNoStore({ error: "로그인이 필요합니다" }, 401);
  try {
    // RLS 소유권 검사와 별도로 발급처에서 현재 세션이 살아 있는지 확인한다.
    await resolveOwner(request);
    const rows = await restSelect({
      token,
      path: "notifications",
      query: {
        select: "id,case_id,notification_type,title,body_masked,read_at,created_at,passport_diff_id",
        order: "created_at.desc",
        limit: "50",
      },
    });
    return jsonNoStore({ notifications: rows }, 200);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    if (error instanceof RestError) return jsonNoStore({ error: error.message }, error.status);
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await resolveOwner(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    throw error;
  }
  const parsed = await readJson(request);
  if (!parsed.ok) return jsonNoStore({ error: "요청 형식이 올바르지 않습니다" }, 400);
  const id = str(parsed.value, "notification_id") ?? "";
  if (!UUID.test(id)) return jsonNoStore({ error: "잘못된 알림입니다" }, 400);

  const rows = await fsql()`
    select private.mark_notification_read(${ownerId}::uuid, ${id}::uuid) as ok`;
  if (rows[0]?.ok !== true) return jsonNoStore({ error: "알림을 찾을 수 없습니다" }, 404);
  return jsonNoStore({ ok: true }, 200);
}
