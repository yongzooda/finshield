/**
 * POST /api/finshield/signup — 회원가입 (S-002).
 *
 * 비밀번호는 서버가 보관하지 않는다. Supabase 에 그대로 넘기고 응답만 옮긴다.
 * 이미 있는 계정인지도 알려 주지 않는다. 계정 존재 여부를 흘리지 않기 위해서다.
 */

import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { authConfigured, finshieldEnv } from "@/lib/finshield/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PASSWORD = 10;

export async function POST(request: Request): Promise<Response> {
  if (!authConfigured()) return jsonNoStore({ error: "인증 설정이 없습니다" }, 503);
  const parsed = await readJson(request);
  if (!parsed.ok) return jsonNoStore({ error: "요청 형식이 올바르지 않습니다" }, 400);
  const email = str(parsed.value, "email");
  const password = str(parsed.value, "password");
  if (!email || !password) return jsonNoStore({ error: "이메일과 비밀번호를 입력해 주세요" }, 400);
  if (password.length < MIN_PASSWORD) {
    return jsonNoStore({ error: `비밀번호는 ${MIN_PASSWORD}자 이상으로 정해 주세요` }, 400);
  }

  const env = finshieldEnv();
  const response = await fetch(`${(env.SUPABASE_URL ?? "").replace(/\/+$/, "")}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as
    { access_token?: unknown; user?: { id?: unknown } } | null;
  if (!response.ok) {
    return jsonNoStore({ error: "가입하지 못했습니다. 잠시 뒤 다시 시도해 주세요" }, 400);
  }
  // 메일 확인이 켜져 있으면 token 없이 사용자만 온다. 그때는 확인 안내를 보낸다.
  const token = typeof body?.access_token === "string" ? body.access_token : null;
  return jsonNoStore({ access_token: token, needs_confirmation: token === null }, 200);
}
