/**
 * MCP JSON-RPC 처리 — 전송(HTTP)과 분리한 순수 계층.
 *
 * ## 왜 SDK를 안 쓰나
 *
 * 공식 SDK의 HTTP 전송은 Node의 `IncomingMessage`/`ServerResponse`를 받는데,
 * Next App Router의 라우트 핸들러는 Web `Request`/`Response`만 준다. 어댑터를
 * 하나 더 얹는 것보다 **상태 없는 요청-응답 서버**를 직접 처리하는 편이 짧고,
 * 마감 전에 의존성 하나를 덜 늘린다.
 *
 * 상태를 두지 않는다 — 세션 ID를 발급하지 않고, 서버가 먼저 말을 거는 스트림도
 * 열지 않는다. 도구 5종이 전부 읽기 전용이라 요청 사이에 이어 갈 상태가 없다.
 *
 * 이 모듈은 HTTP를 모른다. 메시지를 받아 메시지를 돌려줄 뿐이라 테스트가 쉽다.
 */

import "server-only";
import { MCP_TOOLS, TOOL_BY_NAME } from "./tools";

/** 지원하는 프로토콜 버전 — 앞의 것이 기본값이다 */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const SERVER_INFO = {
  name: "precase",
  title: "프리케이스 — 불완전판매 판단 근거 도구",
  version: "1.0.0",
} as const;

/** JSON-RPC 오류 코드 */
export const RPC = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

type Id = string | number | null;

export type RpcRequest = {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
};

export type RpcResponse = {
  jsonrpc: "2.0";
  id: Id;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function ok(id: Id, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: Id, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

/** 알림(id 없음)에는 응답하지 않는다 — 스펙 요구 */
function isNotification(m: RpcRequest): boolean {
  return m.id === undefined;
}

function negotiate(requested: unknown): string {
  return typeof requested === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : PROTOCOL_VERSIONS[0];
}

export function toolList(): Array<Record<string, unknown>> {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      // 다섯 개 전부 읽기 전용이다. 이 표시는 장식이 아니라 계약이다
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: t.callsExternalApi,
    },
  }));
}

/**
 * 도구를 부른다.
 *
 * **도구가 실패해도 JSON-RPC 오류로 만들지 않는다.** 스펙대로 결과 안에
 * `isError: true`로 담아 모델이 읽고 대응할 수 있게 한다. 프로토콜 오류
 * (없는 도구·잘못된 인자 모양)만 JSON-RPC 오류다.
 */
async function callTool(params: Record<string, unknown> | undefined, id: Id): Promise<RpcResponse> {
  const name = typeof params?.name === "string" ? params.name : "";
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) {
    return fail(id, RPC.INVALID_PARAMS, `그런 도구가 없습니다: ${name || "(이름 없음)"}`, {
      available: MCP_TOOLS.map((t) => t.name),
    });
  }

  const rawArgs = params?.arguments;
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    return fail(id, RPC.INVALID_PARAMS, "arguments는 객체여야 합니다");
  }

  try {
    const out = await tool.run((rawArgs ?? {}) as Record<string, unknown>);
    // 결과가 null인 도구가 있다 — 「찾지 못했다」와 「실패했다」는 다르므로 그대로 전한다
    return ok(id, {
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      structuredContent: { result: out ?? null },
      isError: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return ok(id, {
      content: [{ type: "text", text: `도구 실행에 실패했습니다: ${message}` }],
      isError: true,
    });
  }
}

/** 메시지 하나를 처리한다. 알림이면 null을 돌려준다 */
export async function handleMessage(msg: unknown): Promise<RpcResponse | null> {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    return fail(null, RPC.INVALID_REQUEST, "JSON-RPC 메시지가 아닙니다");
  }
  const m = msg as RpcRequest;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return fail(m.id ?? null, RPC.INVALID_REQUEST, "jsonrpc와 method가 필요합니다");
  }

  const id = m.id ?? null;

  switch (m.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negotiate(m.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: [
          "불완전판매 분쟁의 판단 근거를 꺼내 오는 읽기 전용 도구 5종입니다.",
          "",
          "두 가지를 지켜 주세요.",
          "1. search_precedent의 citable이 false이면 그 판례를 인용하지 마세요. 법제처 검색이 부분일치로 동작해 무관한 사건이 상위에 옵니다.",
          "2. analyze_risk_pattern의 granularity를 확인하세요. 요청한 조합에 표본이 없으면 더 넓은 축의 집계가 돌아옵니다.",
          "",
          "도구가 돌려주지 않은 조문·판례·사례·통계를 만들어 쓰지 마세요. 근거 없는 수치는 이 영역에서 사람에게 손해를 입힙니다.",
        ].join("\n"),
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: toolList() });

    case "tools/call":
      return callTool(m.params, id);

    default:
      // 알림은 모르는 것이어도 조용히 넘긴다 (notifications/initialized 등)
      if (isNotification(m)) return null;
      return fail(id, RPC.METHOD_NOT_FOUND, `지원하지 않는 메서드입니다: ${m.method}`);
  }
}

/** 단일 메시지와 배열(구버전 일괄 요청) 둘 다 받는다 */
export async function handlePayload(payload: unknown): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return fail(null, RPC.INVALID_REQUEST, "빈 배열입니다");
    const out = (await Promise.all(payload.map(handleMessage))).filter(
      (r): r is RpcResponse => r !== null,
    );
    return out.length > 0 ? out : null;
  }
  return handleMessage(payload);
}
