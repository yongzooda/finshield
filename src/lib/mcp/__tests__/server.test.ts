/**
 * MCP 프로토콜 처리 — 전송 없이 메시지 층만 검증한다.
 *
 * 공개 엔드포인트라 **남의 클라이언트가 붙는다.** 우리 화면만 쓸 때는 넘어갔던
 * 것들(알림에 응답하지 않기, 버전 협상, 도구 실패를 프로토콜 오류로 만들지 않기)이
 * 여기서는 곧 호환성 문제가 된다.
 */

import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSIONS,
  SERVER_INFO,
  handleMessage,
  handlePayload,
  toolList,
} from "../server";
import { MCP_TOOLS } from "../tools";

const req = (method: string, params?: Record<string, unknown>, id: string | number = 1) =>
  ({ jsonrpc: "2.0" as const, id, method, params });

describe("initialize", () => {
  it("클라이언트가 아는 버전을 그대로 돌려준다", async () => {
    const r = await handleMessage(req("initialize", { protocolVersion: "2025-03-26" }));
    expect((r?.result as { protocolVersion: string }).protocolVersion).toBe("2025-03-26");
  });

  it("모르는 버전이면 우리 기본 버전으로 협상한다", async () => {
    const r = await handleMessage(req("initialize", { protocolVersion: "1999-01-01" }));
    expect((r?.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it("도구 능력과 서버 이름을 밝힌다", async () => {
    const r = await handleMessage(req("initialize", {}));
    const res = r?.result as { capabilities: { tools: unknown }; serverInfo: typeof SERVER_INFO };
    expect(res.capabilities.tools).toBeDefined();
    expect(res.serverInfo.name).toBe("precase");
  });

  it("안내문에 판례 인용 금지 조건이 들어 있다", async () => {
    const r = await handleMessage(req("initialize", {}));
    expect((r?.result as { instructions: string }).instructions).toContain("citable");
  });
});

describe("tools/list", () => {
  it("도구 5종을 돌려준다", async () => {
    const r = await handleMessage(req("tools/list"));
    const tools = (r?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["analyze_risk_pattern", "check_documents", "lookup_statute", "search_case", "search_precedent"],
    );
  });

  it("전부 읽기 전용으로 표시된다 — 쓰기 도구가 섞이면 실패한다", () => {
    for (const t of toolList()) {
      const a = t.annotations as { readOnlyHint: boolean; destructiveHint: boolean };
      expect(a.readOnlyHint, String(t.name)).toBe(true);
      expect(a.destructiveHint, String(t.name)).toBe(false);
    }
  });

  it("외부 API를 부르는 도구만 openWorldHint가 참이다", () => {
    const byName = new Map(toolList().map((t) => [t.name as string, t]));
    for (const t of MCP_TOOLS) {
      const a = byName.get(t.name)!.annotations as { openWorldHint: boolean };
      expect(a.openWorldHint, t.name).toBe(t.callsExternalApi);
    }
  });

  it("모든 도구에 입력 스키마와 설명이 있다", () => {
    for (const t of toolList()) {
      expect(t.inputSchema, String(t.name)).toBeTruthy();
      expect(String(t.description).length, String(t.name)).toBeGreaterThan(40);
    }
  });

  it("search_precedent 설명이 부분일치 결함을 밝힌다", () => {
    const t = MCP_TOOLS.find((x) => x.name === "search_precedent")!;
    expect(t.description).toContain("부분일치");
    expect(t.description).toContain("citable");
  });
});

describe("프로토콜 규칙", () => {
  it("알림(id 없음)에는 응답하지 않는다", async () => {
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("ping에 빈 결과로 답한다", async () => {
    const r = await handleMessage(req("ping"));
    expect(r?.result).toEqual({});
  });

  it("모르는 메서드는 -32601", async () => {
    const r = await handleMessage(req("resources/list"));
    expect(r?.error?.code).toBe(-32601);
  });

  it("jsonrpc가 없으면 -32600", async () => {
    const r = await handleMessage({ method: "ping", id: 1 });
    expect(r?.error?.code).toBe(-32600);
  });

  it("없는 도구는 -32602이고 목록을 함께 준다", async () => {
    const r = await handleMessage(req("tools/call", { name: "drop_table" }));
    expect(r?.error?.code).toBe(-32602);
    expect((r?.error?.data as { available: string[] }).available).toHaveLength(5);
  });

  it("arguments가 객체가 아니면 -32602", async () => {
    const r = await handleMessage(req("tools/call", { name: "search_case", arguments: [1, 2] }));
    expect(r?.error?.code).toBe(-32602);
  });

  it("배열 요청에서 알림은 응답에 섞이지 않는다", async () => {
    const out = await handlePayload([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      req("ping", undefined, 7),
    ]);
    expect(Array.isArray(out) && out.length).toBe(1);
    expect(Array.isArray(out) && out[0].id).toBe(7);
  });

  it("알림만 있으면 돌려줄 것이 없다", async () => {
    expect(await handlePayload([{ jsonrpc: "2.0", method: "notifications/initialized" }])).toBeNull();
  });
});

describe("tools/call 실패 처리", () => {
  it("도구가 던진 오류는 프로토콜 오류가 아니라 isError 결과다", async () => {
    // 존재하지 않는 법령이면 도구 내부에서 실패하거나 null을 돌려준다.
    // 어느 쪽이든 JSON-RPC error로 새어 나오면 안 된다.
    const r = await handleMessage(
      req("tools/call", {
        name: "lookup_statute",
        arguments: { lawName: "없는법률", articleNo: "1조", basisDate: "2020-01-01" },
      }),
    );
    expect(r?.error).toBeUndefined();
    expect(r?.result).toBeTruthy();
  });
});
