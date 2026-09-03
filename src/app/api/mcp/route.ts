/**
 * P0 공개 MCP 차단 (E-017, E-021, N-QLT-010).
 *
 * 현재 MCP 구현은 인증·64 KiB body·Batch 20·동시 5·호출별 quota 계약을
 * 충족하지 않는다. ADR-001에 따라 P1 보안·conformance Gate 전까지 모든
 * method를 404로 닫는다. 내부 Function Registry는 이 HTTP route를 사용하지 않는다.
 */

import { env } from "@/lib/env";
import { jsonNoStore } from "@/lib/ops/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mcpUnavailable(): Response {
  // Env schema도 false만 허용한다. 둘 중 하나가 단독으로 바뀌어도 route는 열리지 않는다.
  if (env.PUBLIC_MCP_ENABLED !== "false") {
    throw new Error("PUBLIC_MCP_ENABLED must remain false during the P0 gate");
  }
  return jsonNoStore({ ok: false, error: "MCP_DISABLED" }, 404);
}

export function OPTIONS(): Response {
  return mcpUnavailable();
}

export function GET(): Response {
  return mcpUnavailable();
}

export function POST(request: Request): Response {
  void request;
  return mcpUnavailable();
}
