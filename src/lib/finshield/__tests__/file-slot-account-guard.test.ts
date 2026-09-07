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
it("가입 후 파일은 새 Case를 만들지 않고 같은 Case의 임시 Slot과 TTL을 예약한다",async()=>{
 const caseId="00000000-0000-4000-8000-000000000002";
 const sql=vi.fn().mockResolvedValue([{case_input_id:"input",object_path:"owned/path",expires_at:"2026-09-09"}]);
 m.begin.mockImplementationOnce(async fn=>fn(sql));m.start.mockResolvedValueOnce({id:"workflow"});
 const response=await POST(new Request("https://finshield.example/api/finshield/files/slot",{
  method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({case_id:caseId,mime:"application/pdf",size:100}),
 }));
 expect(response.status).toBe(200);expect((await response.json()).case_id).toBe(caseId);
 expect(sql).toHaveBeenCalledOnce();expect(sql.mock.calls[0][0].join("")).toContain("open_aftercare_upload_slot");
 expect(m.start).toHaveBeenCalledOnce();
});
