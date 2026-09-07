/**
 * 헬스체크 엄격 모드 (N-302).
 *
 * 무료 감시 도구는 본문을 파싱하지 못하고 상태코드만 본다. 기본 규칙(degraded → 200)
 * 아래에서는 **일부 장애가 초록불로 보고된다.** `?strict=1`이 그 구멍을 막는다.
 */

import { describe, expect, it, vi } from "vitest";
import type { HealthReport } from "@/lib/finshield/health-status.mjs";

const report = vi.hoisted(() => ({ current: null as HealthReport | null }));
vi.mock("@/lib/finshield/health-status.mjs", async importOriginal => ({
  ...await importOriginal<object>(), checkHealth: async () => report.current,
}));

const { GET } = await import("../route");

function set(status: HealthReport["status"]) {
  report.current = {
    status,
    checks: [{ name: "db", ok: status === "ok", ms: 1 }],
  } as HealthReport;
}

describe("기본 — 사람이 읽는 경로", () => {
  it("ok는 200", async () => {
    set("ok");
    expect((await GET(new Request("https://x/api/health"))).status).toBe(200);
  });

  it("degraded는 200 — 일부 장애에서도 예방 축·데모는 살아 있다", async () => {
    set("degraded");
    expect((await GET(new Request("https://x/api/health"))).status).toBe(200);
  });

  it("down은 503", async () => {
    set("down");
    expect((await GET(new Request("https://x/api/health"))).status).toBe(503);
  });
});

describe("?strict=1 — 감시자가 읽는 경로", () => {
  it("ok는 200", async () => {
    set("ok");
    expect((await GET(new Request("https://x/api/health?strict=1"))).status).toBe(200);
  });

  it("degraded는 503 — 이게 이 모드의 존재 이유다", async () => {
    set("degraded");
    expect((await GET(new Request("https://x/api/health?strict=1"))).status).toBe(503);
  });

  it("down은 503", async () => {
    set("down");
    expect((await GET(new Request("https://x/api/health?strict=1"))).status).toBe(503);
  });

  it("본문은 두 경로가 같다 — 상태코드만 달라진다", async () => {
    set("degraded");
    const a = await (await GET(new Request("https://x/api/health"))).json();
    set("degraded");
    const b = await (await GET(new Request("https://x/api/health?strict=1"))).json();
    expect(a).toEqual(b);
  });
});
