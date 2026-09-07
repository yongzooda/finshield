import "server-only";
import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { bearerToken } from "./auth";
import { finshieldEnv } from "./env";
import { readRefreshCookie, sameSessionOrigin, setRefreshCookie, tokenSession } from "./session-cookie";

/** AUTH-002·SEC-AUTH-005: refresh는 HttpOnly Cookie에서만 읽고 발급처가 회전한다. */
export async function sessionGrant(request: Request, kind: "login" | "signup" | "refresh"): Promise<Response> {
  if (!sameSessionOrigin(request)) return jsonNoStore({ code: "ORIGIN_REJECTED", error: "이 화면에서 다시 요청해 주세요" }, 403);
  const previous = kind === "refresh" ? tokenSession(bearerToken(request)) : null;
  let payload: object;
  if (kind === "refresh") {
    const refresh = previous && readRefreshCookie(request, previous.id);
    if (!refresh) return jsonNoStore({ code: "SESSION_EXPIRED", error: "다시 로그인해 주세요" }, 401);
    payload = { refresh_token: refresh };
  } else {
    const parsed = await readJson(request, 16 * 1024);
    if (!parsed.ok) return parsed.response;
    const email = str(parsed.value, "email"); const password = str(parsed.value, "password");
    if (!email || !password) return jsonNoStore({ error: "이메일과 비밀번호를 입력해 주세요" }, 400);
    if (kind === "signup" && password.length < 10) return jsonNoStore({ error: "비밀번호는 10자 이상으로 정해 주세요" }, 400);
    payload = { email, password };
  }
  try {
    const env = finshieldEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error();
    const path = kind === "signup" ? "signup" : `token?grant_type=${kind === "refresh" ? "refresh_token" : "password"}`;
    const upstream = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/${path}`, {
      method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      cache: "no-store", redirect: "error",
    });
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      // 불명확한 응답·제한·장애는 Cookie를 지우거나 자동 재호출하지 않는다.
      if (kind === "refresh" && [400, 401, 403].includes(upstream.status)
        && ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "user_not_found", "session_expired"].includes(body?.error_code)) {
        return setRefreshCookie(jsonNoStore({ code: "SESSION_EXPIRED", error: "로그인이 만료됐습니다. 다시 로그인해 주세요" }, 401), request, previous!.id, null);
      }
      if (kind !== "refresh" && [400, 401, 422].includes(upstream.status)) {
        return jsonNoStore({ error: kind === "login" ? "이메일이나 비밀번호가 맞지 않습니다" : "가입하지 못했습니다. 입력 내용을 확인해 주세요" }, kind === "login" ? 401 : 400);
      }
      throw new Error();
    }
    if (kind === "signup" && body?.user && !body?.access_token && !body?.refresh_token) {
      return jsonNoStore({ access_token: null, needs_confirmation: true });
    }
    const session = tokenSession(typeof body?.access_token === "string" ? body.access_token : null);
    if (!session || typeof session.owner !== "string" || !Number.isFinite(session.expires)
      || typeof body?.refresh_token !== "string" || (previous && (previous.id !== session.id || previous.owner !== session.owner))) throw new Error();
    // Provider가 반환한 Access Token만 앱 응답에 싣는다. Refresh는 JSON/HTML에 포함하지 않는다.
    return setRefreshCookie(jsonNoStore({ access_token: body.access_token, expires_at: session.expires,
      ...(kind === "signup" ? { needs_confirmation: false } : {}) }), request, session.id, body.refresh_token);
  } catch {
    return jsonNoStore({ code: "SESSION_UNCONFIRMED", error: "인증 서버의 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요" }, 503);
  }
}
