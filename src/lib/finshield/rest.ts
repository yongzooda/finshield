/**
 * 소유자 읽기·쓰기 프록시.
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
  if (!Array.isArray(body)) throw new RestError(502, "자료 형식을 확인하지 못했습니다");
  return body;
};

/**
 * 소유자 쓰기.
 *
 * 금융 프로필은 사용자가 자기 것을 고치는 자료다. worker 역할은 이 표에 손대지
 * 못하게 막아 두었다. 그래서 여기서도 사용자의 token 을 그대로 넘기고 정책이
 * 판단하게 둔다. 서버는 값이 정해진 범주인지만 본다.
 */
export const restUpsert = async (args: {
  token: string;
  path: string;
  row: Record<string, unknown>;
  onConflict: string;
}): Promise<unknown[]> => {
  if (!authConfigured()) throw new RestError(503, "인증 설정이 없습니다");
  const env = finshieldEnv();
  const url = new URL(`${(env.SUPABASE_URL ?? "").replace(/\/+$/, "")}/rest/v1/${args.path}`);
  url.searchParams.set("on_conflict", args.onConflict);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([args.row]),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new RestError(response.status === 401 ? 401 : 502, "저장하지 못했습니다");
  }
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body)) throw new RestError(502, "자료 형식을 확인하지 못했습니다");
  return body;
};
