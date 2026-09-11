import "server-only";
import { createHmac } from "node:crypto";
import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { bearerToken } from "./auth";
import { fsql } from "./db";
import { finshieldEnv } from "./env";
import { readRefreshCookie, sameSessionOrigin, setRefreshCookie, tokenSession } from "./session-cookie";

const signupKey = (request: Request, secret: string): string => {
  const forwarded = request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHmac("sha256",secret).update(address).digest("hex");
};

export const SIGNUP_LIMITS = Object.freeze({ perAddressPerHour: 20, allPerDay: 300 });

/** AUTH-002·SEC-AUTH-005: refresh는 HttpOnly Cookie에서만 읽고 발급처가 회전한다. */
export async function sessionGrant(request: Request, kind: "login" | "signup" | "refresh"): Promise<Response> {
  if (!sameSessionOrigin(request)) return jsonNoStore({ code: "ORIGIN_REJECTED", error: "이 화면에서 다시 요청해 주세요" }, 403);
  const previous = kind === "refresh" ? tokenSession(bearerToken(request)) : null;
  let payload: Record<string, string>;
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
    const directSignup = kind === "signup" && process.env.FINSHIELD_P0_DIRECT_SIGNUP === "true";
    if (directSignup) {
      if (!env.SUPABASE_SECRET_KEY) throw new Error();
      // 심사장처럼 여러 사람이 한 주소를 함께 쓰면 주소별 시간 상한이 금방 찬다(예전 3건).
      // 주소별 시간 상한을 넉넉히 두고, 전체 하루 상한으로 대량 가입을 막는다.
      const limits = await fsql()`select allowed,retry_after_seconds from private.consume_rate_limit(
        'IP_HMAC',${signupKey(request,env.SUPABASE_SECRET_KEY)},'AUTH_SIGNUP',${SIGNUP_LIMITS.perAddressPerHour},3600)`;
      const global = limits[0]?.allowed === true ? await fsql()`select allowed,retry_after_seconds from private.consume_rate_limit(
        'GLOBAL','finshield-signup','AUTH_SIGNUP_ALL_DAY',${SIGNUP_LIMITS.allPerDay},86400)` : limits;
      if (limits[0]?.allowed !== true || global[0]?.allowed !== true) {
        const retryAfter = Number((limits[0]?.allowed !== true ? limits : global)[0]?.retry_after_seconds ?? 3600);
        const response = jsonNoStore({ code: "AUTH_SIGNUP_RATE_LIMIT",
          error: `가입 요청이 많습니다. 약 ${Math.max(1,Math.ceil(retryAfter/60))}분 후 다시 시도해 주세요.` },429);
        response.headers.set("Retry-After",String(Math.max(1,retryAfter)));
        return response;
      }
      const created = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/admin/users`, {
        method: "POST", headers: { apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, email_confirm: true }),
        signal: AbortSignal.any([request.signal,AbortSignal.timeout(15_000)]), cache: "no-store",redirect: "error",
      });
      if (!created.ok) {
        if ([400,422].includes(created.status)) {
          return jsonNoStore({ error: "이미 가입된 이메일이면 로그인해 주세요. 입력 내용도 다시 확인해 주세요." },400);
        }
        if (created.status === 429) {
          return jsonNoStore({ code: "AUTH_SIGNUP_RATE_LIMIT",error: "가입 요청이 많습니다. 잠시 후 다시 시도해 주세요." },429);
        }
        throw new Error();
      }
    }
    const path = kind === "signup" && !directSignup ? "signup"
      : `token?grant_type=${kind === "refresh" ? "refresh_token" : "password"}`;
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
      if (kind === "signup" && upstream.status === 429 && body?.error_code === "over_email_send_rate_limit") {
        return jsonNoStore({ code: "AUTH_EMAIL_RATE_LIMIT",
          error: "가입 확인 메일 발송이 지연되고 있습니다. 잠시 뒤 다시 시도하거나 로그인 없이 체험해 주세요." }, 429);
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
