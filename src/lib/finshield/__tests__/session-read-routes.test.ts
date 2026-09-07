import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ owner: vi.fn(), select: vi.fn() }));
vi.mock("../auth", () => ({
  bearerToken: () => "fixture-revoked-token",
  resolveOwner: mocks.owner,
  UnauthenticatedError: class extends Error {},
}));
vi.mock("../rest", () => ({ restSelect: mocks.select, RestError: class extends Error {} }));
import { UnauthenticatedError } from "../auth";
import { GET as cases } from "@/app/api/finshield/cases/route";
import { GET as detail } from "@/app/api/finshield/cases/[id]/route";
import { GET as profile } from "@/app/api/finshield/profile/route";
import { GET as notifications } from "@/app/api/finshield/notifications/route";

const context = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) };
const request = new Request("https://app.example.invalid/api/finshield/cases");
beforeEach(() => vi.clearAllMocks());
it.each([cases, detail, profile, notifications])("폐기된 세션은 RLS 조회 전에 거부한다 %#", async handler => {
  mocks.owner.mockRejectedValue(new UnauthenticatedError("로그인이 필요합니다"));
  const response = await handler(request, context);
  expect(response.status).toBe(401);
  expect(mocks.select).not.toHaveBeenCalled();
});
it("살아 있는 세션은 인증 뒤 원래 사용자 Token으로 RLS 조회한다", async () => {
  mocks.owner.mockResolvedValue("fixture-owner");
  mocks.select.mockImplementation(async args => {
    expect(mocks.owner).toHaveBeenCalledOnce();
    expect(args.token).toBe("fixture-revoked-token");
    return [];
  });
  expect((await cases(request)).status).toBe(200);
  expect(mocks.select).toHaveBeenCalledOnce();
});
