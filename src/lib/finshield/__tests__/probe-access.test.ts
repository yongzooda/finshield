import { afterEach, expect, it, vi } from "vitest";
import { resolveOwner } from "../auth";

vi.mock("../env", () => ({ authConfigured: () => true, finshieldEnv: () => ({
  SUPABASE_URL: "https://auth.example.org", SUPABASE_ANON_KEY: "synthetic-public-key",
}) }));
afterEach(() => vi.unstubAllEnvs());
const owner = "00000000-0000-4000-8000-00000000000a";
const request = new Request("https://preview.example.org/api/finshield/cases", { headers: { Authorization: "Bearer synthetic" } });
it("지정된 합성 계정도 발급처가 확인한 ID와 일치해야 한다", async () => {
  vi.stubEnv("FINSHIELD_PROBE_OWNER_ID", owner);
  await expect(resolveOwner(request, async () => Response.json({ id: owner }))).resolves.toBe(owner);
  await expect(resolveOwner(request, async () => Response.json({ id: "00000000-0000-4000-8000-00000000000b" }))).rejects.toThrow("합성 시험 계정");
});
it("비어 있거나 잘못된 격리 설정은 전체 사용자 허용으로 바뀌지 않는다", async () => {
  for (const value of ["", "all", "*"]) {
    vi.stubEnv("FINSHIELD_PROBE_OWNER_ID", value);
    await expect(resolveOwner(request, async () => Response.json({ id: owner }))).rejects.toThrow("합성 시험 계정");
  }
});
