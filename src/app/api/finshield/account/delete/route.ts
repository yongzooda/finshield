import { createHash, createHmac } from "node:crypto";
import { start } from "workflow/api";
import { fsql } from "@/lib/finshield/db";
import { bearerToken, resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { resolveRecentlyAuthenticatedOwner, ReauthenticationRequiredError, RequestOriginError } from "@/lib/finshield/reauthentication";
import { deletionReceipt, setDeletionReceipt } from "@/lib/finshield/deletion-receipt";
import { accountDeletionWorkflow } from "@/lib/finshield/workflows/account-deletion";
import { jsonNoStore } from "@/lib/ops/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Status = { id: string; status: string; completed_at: string | null };

function sameOrigin(request: Request) {
  const url = new URL(request.url);
  return request.headers.get("origin") === `${url.protocol}//${request.headers.get("host") ?? url.host}`;
}
async function existing(request: Request, key: string): Promise<Status | null> {
  // 다른 계정으로 로그인한 탭에서는 이전 계정의 영수증을 사용하지 않는다.
  if (bearerToken(request)) {
    try {
      const owner = await resolveOwner(request);
      const [row] = await fsql()`select private.account_deletion_status(${owner}::uuid,null::uuid) as state`;
      return row.state as Status | null;
    } catch (error) { if (!(error instanceof UnauthenticatedError)) throw error; }
  }
  const id = deletionReceipt(request, key);
  if (!id) return null;
  const [row] = await fsql()`select private.account_deletion_status(null::uuid,${id}::uuid) as state`;
  return row.state as Status | null;
}
function reply(request: Request, key: string, state: Status, dispatched = true, dispatchRequired = false) {
  return setDeletionReceipt(jsonNoStore({ deletion_request_id: state.id, status: state.status,
    completed_at: state.completed_at, dispatch_required: dispatchRequired, ...(dispatched ? {} : { error: "삭제 실행을 예약하지 못했습니다. 같은 요청을 다시 이어서 처리할 수 있습니다." }) }, dispatched ? 200 : 503), request, state.id, key);
}
export async function GET(request: Request) {
  const key = process.env.DELETION_HMAC_KEY ?? "";
  if (key.length < 16) return jsonNoStore({ error: "삭제 기능 설정을 확인 중입니다" }, 503);
  try {
    const state = await existing(request, key);
    return state ? reply(request, key, state) : jsonNoStore({ status: "NONE" });
  } catch { return jsonNoStore({ error: "삭제 상태를 확인하지 못했습니다" }, 503); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonNoStore({ code: "ORIGIN_REJECTED", error: "이 화면에서 다시 요청해 주세요" }, 403);
  const key = process.env.DELETION_HMAC_KEY ?? "";
  if (key.length < 16) return jsonNoStore({ error: "삭제 기능 설정을 확인 중입니다" }, 503);
  try {
    let state = await existing(request, key);
    if (!state) {
      const owner = await resolveRecentlyAuthenticatedOwner(request);
      const hash = createHash("sha256").update(`${owner}:ACCOUNT:deletion-policy-v1`).digest("hex");
      const hmac = createHmac("sha256", key).update(`ACCOUNT:${owner}`).digest("hex");
      const [row] = await fsql()`select private.request_account_deletion(${owner}::uuid,${hash},${hmac}) as id`;
      state = { id: row.id as string, status: "ACCESS_BLOCKED", completed_at: null };
    }
    if (state.status === "COMPLETED") return reply(request, key, state);
    // 영수증이 전달되기 전에는 Auth 삭제를 예약하지 않는다. 첫 응답 유실도 회원 인증으로 복구한다.
    if (deletionReceipt(request, key) !== state.id) return reply(request, key, state, true, true);
    const [dispatch] = await fsql()`select private.claim_account_deletion_dispatch(${state.id}::uuid) as ok`;
    if (!dispatch.ok) return reply(request, key, state);
    // start 응답 유실 시 동일한 DB 요청으로 합류한다. 정리와 Auth 종결은 DB에서 멱등 처리한다.
    try { await start(accountDeletionWorkflow, [state.id]); }
    catch { return reply(request, key, state, false); }
    return reply(request, key, state);
  } catch (error) {
    if (error instanceof ReauthenticationRequiredError) return jsonNoStore({ code: "REAUTHENTICATION_REQUIRED", error: error.message }, 403);
    if (error instanceof RequestOriginError) return jsonNoStore({ code: "ORIGIN_REJECTED", error: error.message }, 403);
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    return jsonNoStore({ error: "탈퇴 접수 결과를 확인하지 못했습니다. 상태를 확인한 뒤 다시 시도해 주세요." }, 503);
  }
}
