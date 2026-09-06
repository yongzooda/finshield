/**
 * 소유자 읽기 프록시.
 *
 * 자기 Case 를 읽는 것은 RLS 가 이미 막고 열어 준다. 그래서 서버가 대신 판단하지
 * 않고 사용자의 token 을 그대로 실어 PostgREST 에 넘긴다. 정책이 자기 행만
 * 돌려준다. 서버가 소유권을 다시 계산하면 정책과 코드가 갈라질 자리가 생긴다.
 *
 * 공개 키는 서버가 들고 있고 브라우저로 내보내지 않는다.
 */

import "server-only";
import { authConfigured, finshieldEnv } from "./env";

export class RestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const restSelect = async (args: {
  token: string;
  path: string;
  query: Record<string, string>;
}): Promise<unknown[]> => {
  if (!authConfigured()) throw new RestError(503, "인증 설정이 없습니다");
  const env = finshieldEnv();
  const url = new URL(`${(env.SUPABASE_URL ?? "").replace(/\/+$/, "")}/rest/v1/${args.path}`);
  for (const [key, value] of Object.entries(args.query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${args.token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // 내부 사정을 화면에 흘리지 않는다. 상태만 옮긴다.
    throw new RestError(response.status === 401 ? 401 : 502, "자료를 읽지 못했습니다");
  }
  const body = await response.json().catch(() => null);
  return Array.isArray(body) ? body : [];
};
