import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ process: vi.fn(), stop: vi.fn().mockResolvedValue([]), cleanup: vi.fn().mockResolvedValue({pending:false}) }));
vi.mock("../auth", () => ({ resolveOwner: async () => "00000000-0000-4000-8000-000000000001", UnauthenticatedError: class extends Error {} }));
vi.mock("../db", () => ({ fsql: () => state.stop }));
vi.mock("../agents/model-adapter", () => ({ createClaimExtractor: () => vi.fn() }));
vi.mock("../files/process", async importOriginal => ({ ...await importOriginal<object>(), processFileInput: state.process }));
vi.mock("../files/cleanup", () => ({ cleanupCaseFiles: state.cleanup }));
import { POST } from "@/app/api/finshield/files/process/route";
import { FileInputConflictError } from "../files/process";
afterEach(() => vi.clearAllMocks());
const request = () => new Request("https://example.invalid/api/finshield/files/process", { method:"POST", headers:{"Content-Type":"application/json"},
  body:JSON.stringify({case_id:"00000000-0000-4000-8000-000000000002",input_id:"00000000-0000-4000-8000-000000000003",ocr_consent:true}) });
it("처리 도중 DB 제약 오류가 나면 중단·원본 정리를 실행한다", async () => {
  state.process.mockRejectedValueOnce(Object.assign(new Error("합성 DB 계약 오류"), {code:"23514"}));
  expect((await POST(request())).status).toBe(422);
  expect(state.stop).toHaveBeenCalledOnce(); expect(state.cleanup).toHaveBeenCalledOnce();
});
it("중복 slot 소비만 409로 응답하고 먼저 실행 중인 입력을 취소하지 않는다", async () => {
  state.process.mockRejectedValueOnce(new FileInputConflictError());
  expect((await POST(request())).status).toBe(409);
  expect(state.stop).not.toHaveBeenCalled(); expect(state.cleanup).not.toHaveBeenCalled();
});
