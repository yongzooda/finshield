import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  authConfigured: () => true,
  finshieldEnv: () => ({ SUPABASE_URL: "https://auth.example.invalid", SUPABASE_ANON_KEY: "fixture-public-key" }),
}));
import { DELETE } from "@/app/api/finshield/session/route";

const session = "00000000-0000-4000-8000-000000000001";
const token = (claims: object) => `fixture.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`;
const jwt = token({ session_id: session });
const request = (value: string | null = jwt, origin: string | null = "https://app.example.invalid", signal?: AbortSignal) =>
  new Request("https://app.example.invalid/api/finshield/session", {
    method: "DELETE", signal,
    headers: { ...(value ? { Authorization: `Bearer ${value}` } : {}), ...(origin ? { origin } : {}) },
  });
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it("발급처가 현재 세션 폐기를 확인한 뒤에만 완료를 응답한다", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  const response = await DELETE(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "SIGNED_OUT" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://auth.example.invalid/auth/v1/logout?scope=local", expect.objectContaining({
    method: "POST", redirect: "error", cache: "no-store",
    headers: { apikey: "fixture-public-key", Authorization: `Bearer ${jwt}` },
  }));
});

it.each([null, "null", "https://foreign.example.invalid"])("Origin %s는 외부 호출 전에 거부한다", async origin => {
  expect((await DELETE(request(jwt, origin))).status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([null, "invalid", token({}), token({ session_id: "00000000-0000-0000-0000-000000000000" }), token({ session_id: 1 })])(
  "세션 식별자가 없는 Token은 전체 세션 폐기로 내려가지 않는다 %#", async value => {
    expect((await DELETE(request(value))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it.each(["session_not_found", "user_not_found"])("응답 유실 뒤 %s를 받으면 완료 상태를 복원한다", async code => {
  fetchMock.mockRejectedValueOnce(new Error("fixture-secret-provider-error"));
  const first = await DELETE(request());
  expect(first.status).toBe(503);
  expect(await first.text()).not.toContain("fixture-secret");
  fetchMock.mockResolvedValueOnce(Response.json({ code: 403, error_code: code }, { status: 403 }));
  expect(await (await DELETE(request())).json()).toEqual({ status: "SIGNED_OUT" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([401, 403])("만료·변조 Token의 %i는 폐기 완료가 아니다", async status => {
  fetchMock.mockResolvedValue(Response.json({ code: status, error_code: "bad_jwt", msg: jwt }, { status }));
  const response = await DELETE(request());
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
});

it.each([200, 429, 500, 403])("예상 밖 %i 응답은 오류 원문을 숨기고 재시도를 허용한다", async status => {
  fetchMock.mockResolvedValue(Response.json({ code: status, error_code: "unexpected", msg: jwt }, { status }));
  const response = await DELETE(request());
  expect(response.status).toBe(503);
  const text = await response.text();
  expect(text).toContain("SIGNOUT_UNCONFIRMED");
  expect(text).not.toContain(jwt);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("요청 취소 신호를 Provider 경계로 전달하고 완료로 바꾸지 않는다", async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation(async (_url, init) => {
    controller.abort();
    expect(init.signal.aborted).toBe(true);
    throw new Error("aborted");
  });
  expect((await DELETE(request(jwt, "https://app.example.invalid", controller.signal))).status).toBe(503);
});
