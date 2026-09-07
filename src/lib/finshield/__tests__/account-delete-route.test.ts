import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sql: vi.fn(), start: vi.fn(), owner: vi.fn(), recent: vi.fn() }));
vi.mock("../db", () => ({ fsql: () => m.sql }));
vi.mock("workflow/api", () => ({ start: m.start }));
vi.mock("../workflows/account-deletion", () => ({ accountDeletionWorkflow: () => {} }));
vi.mock("../auth", () => ({ resolveOwner: m.owner, bearerToken: (r: Request) => r.headers.get("authorization"), UnauthenticatedError: class extends Error {} }));
vi.mock("../reauthentication", () => ({ resolveRecentlyAuthenticatedOwner: m.recent, ReauthenticationRequiredError: class extends Error {}, RequestOriginError: class extends Error {} }));
import { GET, POST } from "@/app/api/finshield/account/delete/route";
import { ReauthenticationRequiredError } from "../reauthentication";
import { setDeletionReceipt } from "../deletion-receipt";
const id = "dc674cb6-49ad-4133-9999-ccc008000001";
const key = "synthetic-receipt-key-no-secret";
const url = "https://finshield.example/api/finshield/account/delete";
function request(cookie?: string, auth = true) { return new Request(url, { method: "POST", headers: { origin: "https://finshield.example", ...(auth ? { authorization: "Bearer synthetic" } : {}), ...(cookie ? { cookie } : {}) } }); }
function receipt() { return setDeletionReceipt(new Response(), request(), id, key).headers.get("set-cookie")!; }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("DELETION_HMAC_KEY", key); m.owner.mockResolvedValue(id); m.recent.mockResolvedValue(id); m.start.mockResolvedValue({ runId: "synthetic-run" });
});
it("첫 접수 응답에 영수증을 주며 수신 전 Auth 삭제 실행을 예약하지 않는다", async () => {
  m.sql.mockResolvedValueOnce([{ state: null }]).mockResolvedValueOnce([{ id }]);
  const response = await POST(request());
  expect((await response.json()).dispatch_required).toBe(true);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(m.recent).toHaveBeenCalledOnce(); expect(m.start).not.toHaveBeenCalled();
});
it("첫 응답 유실은 기존 회원 인증으로 같은 요청의 영수증을 복원한다", async () => {
  m.sql.mockResolvedValue([{ state: { id, status: "ACCESS_BLOCKED" } }]);
  const response = await GET(request());
  expect((await response.json()).deletion_request_id).toBe(id);
  expect(response.headers.get("set-cookie")).toContain(id); expect(m.start).not.toHaveBeenCalled();
});
it("영수증 수신 뒤 예약 실패는 완료로 표시하지 않고 같은 영수증을 보존한다", async () => {
  m.sql.mockResolvedValueOnce([{ state: { id, status: "ACCESS_BLOCKED" } }]).mockResolvedValueOnce([{ ok: true }]);
  m.start.mockRejectedValueOnce(new Error("synthetic provider secret must not escape"));
  const response = await POST(request(receipt()));
  expect(response.status).toBe(503); expect(response.headers.get("set-cookie")).toContain(id);
  const body = await response.text(); expect(body).toContain("ACCESS_BLOCKED"); expect(body).not.toContain("secret");
});
it("Auth 삭제 뒤 영수증으로 완료를 복원하며 재예약하지 않는다", async () => {
  m.sql.mockResolvedValue([{ state: { id, status: "COMPLETED", completed_at: "2026-09-07T00:00:00Z" } }]);
  const response = await POST(request(receipt(), false));
  expect((await response.json()).status).toBe("COMPLETED"); expect(m.start).not.toHaveBeenCalled(); expect(m.owner).not.toHaveBeenCalled();
});
it("최근 인증 실패와 다른 Origin은 삭제 요청을 만들지 않는다", async () => {
  m.sql.mockResolvedValue([{ state: null }]); m.recent.mockRejectedValueOnce(new ReauthenticationRequiredError("본인 확인 필요"));
  expect((await POST(request())).status).toBe(403); expect(m.sql).toHaveBeenCalledTimes(1);
  m.sql.mockClear(); expect((await POST(new Request(url, { method: "POST", headers: { origin: "https://foreign.example" } }))).status).toBe(403);
  expect(m.sql).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
});
it("동일 요청의 예약 제한에 걸리면 Workflow를 다시 만들지 않는다", async () => {
  m.sql.mockResolvedValueOnce([{ state: { id, status: "ACCESS_BLOCKED" } }]).mockResolvedValueOnce([{ ok: false }]);
  expect((await POST(request(receipt()))).status).toBe(200); expect(m.start).not.toHaveBeenCalled();
});
