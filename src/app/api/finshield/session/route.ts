/**
 * POST /api/finshield/session — 로그인.
 *
 * 브라우저가 Supabase 를 직접 부르게 하면 공개 키를 화면에 내보내야 한다. 그
 * 키는 원래 공개돼도 되는 값이지만, 내보내지 않아도 되는 것을 굳이 내보낼 이유가
 * 없다. 그래서 서버가 대신 물어보고 access token 만 돌려준다.
 *
 * token 은 브라우저가 메모리에만 들고 있는다. 이 서버는 세션을 저장하지 않는다.
 */

import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { finshieldEnv } from "@/lib/finshield/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  
  const parsed = await readJson(request);
  if (!parsed.ok) return jsonNoStore({ error: "요청 형식이 올바르지 않습니다" }, 400);
  const email = str(parsed.value, "email");
  const password = str(parsed.value, "password");
  if (!email || !password) return jsonNoStore({ error: "이메일과 비밀번호를 입력해 주세요" }, 400);

  const env = finshieldEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonNoStore({ error: "인증 설정이 없습니다" }, 503);
  }

  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    // 어느 쪽이 틀렸는지 알려 주지 않는다. 계정 존재 여부를 흘리지 않기 위해서다.
    return jsonNoStore({ error: "이메일이나 비밀번호가 맞지 않습니다" }, 401);
  }
  const body = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  const token = typeof body?.access_token === "string" ? body.access_token : null;
  if (!token) return jsonNoStore({ error: "로그인에 실패했습니다" }, 401);
  return jsonNoStore({ access_token: token }, 200);
}
