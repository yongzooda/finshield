import "server-only";
import { jsonNoStore } from "@/lib/ops/http";
import { bearerToken } from "./auth";
import { authConfigured, finshieldEnv } from "./env";
import { setRefreshCookie, tokenSession } from "./session-cookie";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** AUTH-001·SEC-WEB-001: 현재 세션만 폐기한다. JWT 검증은 Supabase가 수행한다. */
export async function signOutSession(request: Request): Promise<Response> {
  const target = new URL(request.url);
  const expectedOrigin = `${target.protocol}//${request.headers.get("host") ?? target.host}`;
  if (request.headers.get("origin") !== expectedOrigin) {
    return jsonNoStore({ code: "ORIGIN_REJECTED", error: "이 화면에서 로그아웃을 다시 요청해 주세요" }, 403);
  }
  const token = bearerToken(request);
  // session_id가 없으면 Supabase의 local 로그아웃도 전체 세션 폐기로 내려갈 수 있다.
  // 이 파싱은 범위 제한일 뿐 신원 확인이 아니다. 서명·만료는 발급처가 검사한다.
  try {
    if (!token || token.length > 16384 || token.split(".").length !== 3) throw new Error();
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (typeof claims.session_id !== "string" || !UUID.test(claims.session_id)
      || claims.session_id === NIL_UUID) throw new Error();
  } catch {
    return jsonNoStore({ code: "SESSION_REQUIRED", error: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요" }, 401);
  }
  if (!authConfigured()) return jsonNoStore({ code: "AUTH_UNAVAILABLE", error: "인증 설정이 없습니다" }, 503);

  try {
    const env = finshieldEnv();
    const response = await fetch(`${env.SUPABASE_URL!.replace(/\/+$/, "")}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      cache: "no-store",
      redirect: "error",
    });
    if (response.status === 204) return setRefreshCookie(jsonNoStore({ status: "SIGNED_OUT" }), request, tokenSession(token)!.id, null);
    const body = await response.json().catch(() => null);
    // 응답이 유실된 첫 요청을 반복하면 발급처에 세션이 이미 없을 수 있다.
    if (response.status === 403 && ["session_not_found", "user_not_found"].includes(body?.error_code)) {
      return setRefreshCookie(jsonNoStore({ status: "SIGNED_OUT" }), request, tokenSession(token)!.id, null);
    }
    if ([401, 403].includes(response.status) && ["bad_jwt", "no_authorization"].includes(body?.error_code)) {
      return jsonNoStore({ code: "SESSION_EXPIRED", error: "로그인이 만료됐습니다. 서버 로그아웃은 확인하지 못했습니다" }, 401);
    }
  } catch {
    // 응답 유실·Provider 오류에 원문이나 Token을 싣지 않고 같은 요청의 재시도를 허용한다.
  }
  return jsonNoStore({ code: "SIGNOUT_UNCONFIRMED", error: "서버 로그아웃을 확인하지 못했습니다. 다시 시도해 주세요" }, 503);
}
