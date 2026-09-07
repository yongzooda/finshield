/**
 * 회원 확인.
 *
 * 브라우저는 Supabase 가 발급한 access token 을 들고 온다. 서버는 그 token 을
 * Supabase 에 물어 누구인지 확인한 뒤에만 소유자 식별자를 쓴다. token 안의
 * 내용을 그대로 믿지 않는다. 서명 검증을 우리가 다시 구현하는 것보다 발급처에
 * 물어보는 편이 틀릴 여지가 적다.
 *
 * 확인한 식별자는 `private.*` 함수의 소유자 인자로만 쓴다. 그 함수들이 소유권을
 * 다시 검사하므로, 여기서 틀려도 남의 Case 를 건드릴 수는 없다.
 */

import "server-only";
import { authConfigured, finshieldEnv } from "./env";

export class UnauthenticatedError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const bearerToken = (request: Request): string | null => {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
};

export const resolveOwner = async (
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new UnauthenticatedError("로그인이 필요합니다");
  if (!authConfigured()) throw new UnauthenticatedError("인증 설정이 없습니다");
  const env = finshieldEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new UnauthenticatedError("인증 설정이 없습니다");
  }
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new UnauthenticatedError("로그인이 필요합니다");
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID.test(id)) throw new UnauthenticatedError("로그인이 필요합니다");
  // 격리 Preview에만 설정한다. 서버가 확인한 합성 시험 계정 외에는 연결하지 않는다.
  const probeOwner = process.env.FINSHIELD_PROBE_OWNER_ID;
  if (probeOwner !== undefined && (!UUID.test(probeOwner) || id !== probeOwner)) {
    throw new UnauthenticatedError("현재 환경은 지정된 합성 시험 계정만 사용할 수 있습니다");
  }
  return id;
};
