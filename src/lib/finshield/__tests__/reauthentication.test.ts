import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({owner:vi.fn(),token:vi.fn()}));
vi.mock("../auth",()=>({resolveOwner:mocks.owner,bearerToken:mocks.token}));
import{resolveRecentlyAuthenticatedOwner,ReauthenticationRequiredError,RequestOriginError}from"../reauthentication";
const now=1800000000,owner="00000000-0000-4000-8000-000000000001";
const request=(origin:string|null="https://example.invalid")=>new Request("https://example.invalid/delete",{method:"POST",headers:origin===null?{}:{origin}});
const token=(payload:object)=>"fixture."+Buffer.from(JSON.stringify(payload)).toString("base64url")+".fixture";
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(now*1000);mocks.owner.mockResolvedValue(owner);});
afterEach(()=>vi.useRealTimers());
it.each([0,299,300])("발급처가 검증한 %i초 전 비밀번호 인증은 허용한다",async age=>{
 mocks.token.mockReturnValue(token({sub:owner,is_anonymous:false,amr:[{method:"password",timestamp:now-age}]}));
 await expect(resolveRecentlyAuthenticatedOwner(request())).resolves.toBe(owner);
});
it.each([null,"null","https://foreign.invalid"])("다른 Origin 또는 누락 %s는 인증·삭제 전에 거부한다",async origin=>{
 await expect(resolveRecentlyAuthenticatedOwner(request(origin))).rejects.toBeInstanceOf(RequestOriginError);
 expect(mocks.owner).not.toHaveBeenCalled();
});
it.each([
 {amr:[{method:"password",timestamp:now-301}],iat:now},
 {amr:[{method:"token_refresh",timestamp:now}],iat:now},
 {amr:[{method:"password",timestamp:now+31}]},
 {amr:[{method:"password",timestamp:String(now)}]},
 {amr:[]},{},{amr:[{method:"recovery",timestamp:now}]},
 {amr:[{method:"password",timestamp:now}],sub:"other"},
 {amr:[{method:"password",timestamp:now}],is_anonymous:true},
])("오래된 인증·갱신·비밀번호 없는 인증은 재인증을 요구한다 %#",async extra=>{
 mocks.token.mockReturnValue(token({sub:owner,is_anonymous:false,...extra}));
 await expect(resolveRecentlyAuthenticatedOwner(request())).rejects.toBeInstanceOf(ReauthenticationRequiredError);
});
it("발급처가 거부한 JWT의 인증 시각은 읽지 않는다",async()=>{
 mocks.owner.mockRejectedValueOnce(new Error("AUTH_REJECTED"));
 await expect(resolveRecentlyAuthenticatedOwner(request())).rejects.toThrow("AUTH_REJECTED");expect(mocks.token).not.toHaveBeenCalled();
});
it.each([null,"broken","a.not-json.b"])("깨진 Token %s는 재인증을 요구한다",async value=>{
 mocks.token.mockReturnValue(value);await expect(resolveRecentlyAuthenticatedOwner(request())).rejects.toBeInstanceOf(ReauthenticationRequiredError);
});
