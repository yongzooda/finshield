import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../env", () => ({ authConfigured: () => true, finshieldEnv: () => ({ SUPABASE_URL: "https://auth.example.invalid", SUPABASE_ANON_KEY: "public-fixture" }) }));
import { POST, PATCH, DELETE } from "@/app/api/finshield/session/route";
import { POST as signup } from "@/app/api/finshield/signup/route";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const jwt = (sid = id, sub = id, exp = 4000000000) => `header.${Buffer.from(JSON.stringify({session_id:sid,sub,exp})).toString("base64url")}.signature`;
const cookie = `__Host-finshield-refresh-${id}=private-fixture`;
const req = (method = "PATCH", origin: string | null = "https://app.example.invalid", cookies = cookie) => new Request("https://app.example.invalid/api/finshield/session", { method, headers: {
  Authorization: `Bearer ${jwt(id,id,1)}`, Cookie: cookies, ...(origin ? {Origin:origin}:{}), "Content-Type":"application/json",
}, ...(method === "POST" ? {body:JSON.stringify({email:"synthetic@example.invalid",password:"synthetic-password"})}: {}) });
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
const pair = (token = jwt()) => Response.json({access_token:token,refresh_token:"rotated-private-fixture"});

it("로그인은 Refresh를 JSON에 노출하지 않고 HTTPS 전용 Cookie로 설정한다", async()=>{
  fetchMock.mockResolvedValue(pair()); const r = await POST(req("POST"));
  expect(r.status).toBe(200); expect(await r.text()).not.toContain("rotated-private");
  expect(r.headers.get("set-cookie")).toBe(`__Host-finshield-refresh-${id}=rotated-private-fixture; Path=/; HttpOnly; SameSite=Strict; Secure`);
  expect(r.headers.get("cache-control")).toBe("no-store");
});
it("만료 Access는 세션 범위로만 쓰고 Cookie의 Refresh를 발급처에 회전 요청한다",async()=>{
 fetchMock.mockResolvedValue(pair());const r=await PATCH(req());expect(r.status).toBe(200);
 expect(fetchMock).toHaveBeenCalledOnce();const [url,init]=fetchMock.mock.calls[0];
 expect(url).toContain("grant_type=refresh_token");expect(JSON.parse(init.body)).toEqual({refresh_token:"private-fixture"});
 expect(init).toMatchObject({cache:"no-store",redirect:"error"});
});
it.each([POST,PATCH,signup])("로그인·가입·갱신은 교차 Origin에서 호출하지 않는다 %#",async handler=>{
 expect((await handler(req("POST","https://foreign.example.invalid"))).status).toBe(403);expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["",`__Host-finshield-refresh-${other}=private-fixture`,`${cookie}; ${cookie}`])("누락·다른 세션·중복 Cookie는 외부 전송 전에 거부한다 %#",async cookies=>{
 expect((await PATCH(req("PATCH",undefined,cookies))).status).toBe(401);expect(fetchMock).not.toHaveBeenCalled();
});
it.each([jwt(other),jwt(id,other)])("발급처가 다른 세션·계정을 반환해도 Cookie를 바꾸지 않는다 %#",async token=>{
 fetchMock.mockResolvedValue(pair(token));const r=await PATCH(req());expect(r.status).toBe(503);expect(r.headers.get("set-cookie")).toBeNull();expect(await r.text()).not.toContain("private-fixture");
});
it.each(["refresh_token_not_found","refresh_token_already_used","session_not_found"])('발급처의 %s 확인 뒤 해당 Cookie만 지운다',async error_code=>{
 fetchMock.mockResolvedValue(Response.json({error_code},{status:400}));const r=await PATCH(req());expect(r.status).toBe(401);expect(r.headers.get("set-cookie")).toContain("Max-Age=0");expect(r.headers.get("set-cookie")).toContain(id);
});
it.each([429,500,403])('모호한 %i는 자동 반복·Cookie 삭제·원문 노출 없이 실패한다',async status=>{
 fetchMock.mockResolvedValue(Response.json({error_code:"unknown",msg:"private-fixture"},{status}));const r=await PATCH(req());expect(r.status).toBe(503);expect(r.headers.get("set-cookie")).toBeNull();expect(await r.text()).not.toContain("private-fixture");expect(fetchMock).toHaveBeenCalledOnce();
});
it("응답 유실 때 Cookie를 보존하고 다음 명시 요청으로 회전을 복원한다",async()=>{
 fetchMock.mockRejectedValueOnce(new Error("private-fixture"));expect((await PATCH(req())).status).toBe(503);
 fetchMock.mockResolvedValueOnce(pair());expect((await PATCH(req())).status).toBe(200);expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("로그아웃이 확인되면 해당 세션의 Refresh Cookie도 폐기한다",async()=>{
 fetchMock.mockResolvedValue(new Response(null,{status:204}));const r=await DELETE(req("DELETE"));expect(r.status).toBe(200);expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
});
it("이메일 확인이 필요한 가입은 토큰·Cookie를 만들지 않는다",async()=>{
 fetchMock.mockResolvedValue(Response.json({user:{id}}));const r=await signup(req("POST"));expect(await r.json()).toEqual({access_token:null,needs_confirmation:true});expect(r.headers.get("set-cookie")).toBeNull();
});
