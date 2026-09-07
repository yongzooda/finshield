import { afterEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({sql:vi.fn(),read:vi.fn(),cleanup:vi.fn().mockResolvedValue({pending:false})}));
vi.mock("../auth",()=>({bearerToken:()=>"fixture-token",resolveOwner:async()=>"00000000-0000-4000-8000-000000000001",UnauthenticatedError:class extends Error{}}));
vi.mock("../db",()=>({fsql:()=>state.sql}));
vi.mock("../rest",()=>({restSelect:state.read}));
vi.mock("../files/cleanup",()=>({cleanupCaseFiles:state.cleanup}));
import {POST} from "@/app/api/finshield/cases/[id]/delete/route";
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});
it.each(["COMPLETED","CLEANING"])("동일 삭제 요청의 응답 복원: %s",async status=>{
 vi.stubEnv("DELETION_HMAC_KEY","fixture-key-for-local-test-only");
 const id="00000000-0000-4000-8000-000000000002";
 state.sql.mockResolvedValueOnce([{id}]).mockRejectedValueOnce(Object.assign(new Error("이미 제거된 합성 Case"),{code:"23514"}));
 state.read.mockResolvedValueOnce([{status}]);
 const r=await POST(new Request("https://example.invalid/delete",{method:"POST"}),{params:Promise.resolve({id:"00000000-0000-4000-8000-000000000003"})});
 expect(await r.json()).toEqual({deletion_request_id:id,status:status==="COMPLETED"?"COMPLETED":"PENDING"});
 expect(state.read).toHaveBeenCalledWith(expect.objectContaining({token:"fixture-token",path:"deletion_requests",
  query:expect.objectContaining({id:`eq.${id}`,owner_id:"eq.00000000-0000-4000-8000-000000000001"})}));
});
