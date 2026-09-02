/**
 * MCP 엔드포인트의 HTTP 계약.
 *
 * 프로토콜 처리는 `lib/mcp/server`에서 따로 검증한다. 여기서 보는 것은 **전송
 * 계층의 약속**이다 — 알림에는 본문 없이 202, 브라우저 클라이언트가 붙을 수
 * 있게 CORS, 스트림을 열지 않으니 GET은 405.
 */

import { describe, expect, it } from "vitest";
import { GET, OPTIONS, POST } from "../route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("전송 계층", () => {
  it("tools/list를 JSON으로 돌려준다", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(5);
  });

  it("응답을 캐시하지 않는다", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("알림에는 본문 없이 202", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("깨진 JSON은 400과 -32700", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });

  it("GET은 405이고 어디를 보면 되는지 알려준다", async () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(((await res.json()) as { docs: string }).docs).toContain("/mcp");
  });

  it("CORS 프리플라이트가 열려 있다", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
  });

  it("모든 응답에 CORS 헤더가 붙는다 — 붙지 않으면 브라우저가 이유를 못 읽는다", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
