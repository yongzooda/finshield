import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ begin: vi.fn(), start: vi.fn() }));
vi.mock("../db", () => ({ fsql: () => ({ begin: m.begin }) }));
vi.mock("../auth", () => ({ resolveOwner: async () => "synthetic-owner", UnauthenticatedError: class extends Error {} }));
vi.mock("../env", () => ({ finshieldEnv: () => ({ SUPABASE_SECRET_KEY: "synthetic" }) }));
vi.mock("../files/cleanup", () => ({ cleanupCaseFiles: vi.fn() }));
vi.mock("workflow/api", () => ({ start: m.start }));
vi.mock("../workflows/file-expiry", () => ({ fileExpiryWorkflow: vi.fn() }));
import { POST } from "@/app/api/finshield/files/slot/route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("FINSHIELD_FILE_GATEWAY_ENABLED", "true"); vi.stubEnv("FINSHIELD_PARSER_SNAPSHOT_ID", "synthetic"); });
it("탈퇴 접수와 업로드가 경합하면 경로와 Workflow 없이 복구 안내를 반환한다", async () => {
  m.begin.mockRejectedValueOnce(new Error("ACCOUNT_DELETING"));
  const response = await POST(new Request("https://finshield.example/api/finshield/files/slot", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mime: "image/png", size: 68 }),
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "ACCOUNT_DELETING" });
  expect(m.start).not.toHaveBeenCalled();
});
