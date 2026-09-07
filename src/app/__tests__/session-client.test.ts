import { afterEach, beforeEach, expect, it, vi } from "vitest";
const id="00000000-0000-4000-8000-000000000001";
const jwt=(sid=id,exp=Math.floor(Date.now()/1000)+3600)=>`header.${Buffer.from(JSON.stringify({session_id:sid,sub:sid,exp})).toString("base64url")}.signature`;
let client: typeof import("../session-client");
const fetchMock=vi.fn();
beforeEach(async()=>{
 vi.resetModules();fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);
 const map=new Map<string,string>();vi.stubGlobal("sessionStorage",{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)});
 client=await import("../session-client");
});
afterEach(()=>vi.unstubAllGlobals());
it("동시 보호 요청 20개는 갱신 한 번을 기다린 뒤 새 Token을 사용한다",async()=>{
 const expired=jwt(id,1),fresh=jwt();client.writeSessionToken(expired);
 fetchMock.mockImplementation(async(path,init)=>path.endsWith("/session")?Response.json({access_token:fresh}):Response.json({authorization:new Headers(init.headers).get("authorization")}));
 const rs=await Promise.all(Array.from({length:20},()=>client.sessionFetch("/api/finshield/cases",expired)));
 expect(fetchMock.mock.calls.filter(([p])=>p.endsWith("/session"))).toHaveLength(1);
 for(const r of rs)expect(await r.json()).toEqual({authorization:`Bearer ${fresh}`});
 expect(client.readSessionToken()).toBe(fresh);
});
it("갱신 전송 실패는 쓰기를 보내지 않고 명시 요청 때 복구한다",async()=>{
 const old=jwt(id,1);client.writeSessionToken(old);fetchMock.mockRejectedValueOnce(new Error("network"));
 expect((await client.sessionFetch("/api/finshield/profile",old,{method:"PUT",body:"fixture"})).status).toBe(503);expect(fetchMock).toHaveBeenCalledOnce();expect(client.readSessionToken()).toBe(old);
 fetchMock.mockResolvedValueOnce(Response.json({access_token:jwt()})).mockResolvedValueOnce(Response.json({saved:true}));
 expect((await client.sessionFetch("/api/finshield/profile",old,{method:"PUT",body:"fixture"})).status).toBe(200);expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("보호 쓰기의 401·전송 실패는 자동으로 재전송하지 않는다",async()=>{
 const token=jwt();client.writeSessionToken(token);fetchMock.mockResolvedValueOnce(new Response(null,{status:401}));
 expect((await client.sessionFetch("/api/finshield/intake",token,{method:"POST"})).status).toBe(401);expect(fetchMock).toHaveBeenCalledOnce();
});
it("로그아웃 뒤 도착한 갱신은 Access를 복원하거나 쓰기를 보내지 않는다",async()=>{
 const token=jwt(id,1);client.writeSessionToken(token);let finish!:(r:Response)=>void;
 fetchMock.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
 const pending=client.sessionFetch("/api/finshield/profile",token,{method:"PUT"});
 client.writeSessionToken(null);finish(Response.json({access_token:jwt()}));
 expect((await pending).status).toBe(409);expect(client.readSessionToken()).toBeNull();expect(fetchMock).toHaveBeenCalledOnce();
});
it("다른 계정 로그인 뒤 이전 갱신 응답은 새 세션을 덮지 않는다",async()=>{
 const token=jwt(id,1);client.writeSessionToken(token);let finish!:(r:Response)=>void;
 fetchMock.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const pending=client.sessionFetch("/api/finshield/cases",token);
 const other=jwt("other-session");client.writeSessionToken(other);finish(Response.json({access_token:jwt()}));
 expect((await pending).status).toBe(409);expect(client.readSessionToken()).toBe(other);
});
it("명확한 만료는 저장 Token을 지워 같은 보호 화면의 로그인으로 돌아간다",async()=>{
 const token=jwt(id,1);client.writeSessionToken(token);fetchMock.mockResolvedValueOnce(new Response(null,{status:401}));
 expect((await client.sessionFetch("/api/finshield/cases",token)).status).toBe(401);expect(client.readSessionToken()).toBeNull();expect(sessionStorage.getItem("finshield_token")).toBeNull();
});
it("로그아웃은 진행 중 갱신을 기다린 뒤 새 Token으로 현재 세션을 폐기한다",async()=>{
 const old=jwt(id,1),fresh=jwt();client.writeSessionToken(old);
 fetchMock.mockResolvedValueOnce(Response.json({access_token:fresh})).mockResolvedValueOnce(Response.json({status:"SIGNED_OUT"}));
 const pending=client.freshSessionToken(old);const close=client.closeSession(old);await pending;expect((await close).status).toBe(200);
 expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${fresh}`);expect(client.readSessionToken()).toBeNull();
});
it.each(["https://foreign.example.invalid/api/finshield/cases","//foreign.example.invalid/api/finshield/cases","/api/other"])('범위 밖 %s에는 Token을 싣지 않는다',async path=>{
 const token=jwt();client.writeSessionToken(token);await expect(client.sessionFetch(path,token)).rejects.toThrow("SESSION_PATH_REJECTED");expect(fetchMock).not.toHaveBeenCalled();
});
