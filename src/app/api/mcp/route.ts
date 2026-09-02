/**
 * POST /api/mcp — MCP 서버 공개 엔드포인트 (SR-X08).
 *
 * Streamable HTTP 전송의 **상태 없는 부분집합**을 구현한다. 요청 하나에 응답
 * 하나로 끝나므로 SSE 스트림도, 세션 ID도 발급하지 않는다 — 도구 5종이 전부
 * 읽기 전용이라 요청 사이에 이어 갈 상태가 없다. 스펙은 세션을 선택 사항으로
 * 둔다.
 *
 * ## 공개하면서 지키는 것
 *
 * **저장하지 않는다.** 이 라우트는 요청 본문을 로그에 남기지 않는다. 남기는 것은
 * 「어떤 도구가 몇 번 불렸는가」뿐이고, 그건 이미 카운터가 하는 일이다 (N-403).
 *
 * **상한을 건다.** 다섯 중 둘(`lookup_statute`·`search_precedent`)은 법제처 API를
 * 부른다. 공개해 두고 상한이 없으면 남의 호출이 우리 서비스의 조회를 밀어낸다.
 * 소비자 화면과 같은 IP 분당 상한을 그대로 적용한다.
 *
 * **CORS를 연다.** MCP Inspector 같은 브라우저 도구가 붙을 수 있어야 「공개」다.
 * 읽기 전용에 자격증명도 받지 않으므로 여는 데 따르는 위험이 없다.
 */

import { handlePayload } from "@/lib/mcp/server";
import { gate } from "@/lib/ops/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 법제처 API가 느릴 때가 있다 — 기본 10초로는 부족하다 */
export const maxDuration = 30;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-protocol-version, mcp-session-id, accept",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * GET은 서버가 먼저 말을 거는 SSE 스트림용이다. 우리는 열지 않으므로 405로
 * 돌려주되, **어디를 보면 되는지**는 알려 준다 — 스펙이 허용하는 응답이다.
 */
export function GET(): Response {
  return json(
    {
      error: "METHOD_NOT_ALLOWED",
      message: "이 서버는 상태 없는 요청-응답만 지원합니다. JSON-RPC 메시지를 POST로 보내세요.",
      docs: "https://precase.vercel.app/mcp",
    },
    405,
  );
}

export async function POST(req: Request): Promise<Response> {
  const blocked = gate(req, "REQUEST");
  if (blocked) {
    // 상한 응답에도 CORS를 붙여야 브라우저 클라이언트가 이유를 읽을 수 있다
    const body = await blocked.text();
    return new Response(body, {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON을 읽지 못했습니다" } }, 400);
  }

  const out = await handlePayload(payload);
  // 알림만 들어온 요청 — 돌려줄 것이 없다
  if (out === null) return new Response(null, { status: 202, headers: CORS });
  return json(out);
}
