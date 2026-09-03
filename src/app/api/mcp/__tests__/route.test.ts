/** P0 공개 MCP 차단 계약 (E-017, E-021, N-QLT-010). */

import { describe, expect, it, vi } from "vitest";
import { GET, OPTIONS, POST } from "../route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("P0 공개 MCP 비활성", () => {
  it("GET·OPTIONS·POST가 모두 404다", async () => {
    expect(GET().status).toBe(404);
    expect(OPTIONS().status).toBe(404);
    const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(404);
  });

  it("응답은 비활성 상태만 알리고 캐시하지 않는다", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(await res.json()).toEqual({ ok: false, error: "MCP_DISABLED" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("깨진 JSON도 parsing하지 않고 404다", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(404);
  });

  it("POST request body를 읽지 않는다", () => {
    const req = new Request("http://localhost/api/mcp", { method: "POST", body: "{}" });
    const parse = vi.spyOn(req, "json");
    expect(POST(req).status).toBe(404);
    expect(parse).not.toHaveBeenCalled();
  });
});
