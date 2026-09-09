import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({sql:vi.fn(),start:vi.fn(),owner:vi.fn()}));
vi.mock("../db",()=>({fsql:()=>m.sql}));
vi.mock("../auth",()=>({resolveOwner:m.owner,UnauthenticatedError:class extends Error{}}));
vi.mock("workflow/api",()=>({start:m.start}));
vi.mock("../workflows/revalidate",()=>({revalidationWorkflow:vi.fn()}));
import {GET,POST} from "@/app/api/finshield/cases/[id]/revalidate/route";
const id="10000000-0000-4000-8000-000000000001",job="10000000-0000-4000-8000-000000000002";
const context={params:Promise.resolve({id})};
beforeEach(()=>{vi.clearAllMocks();m.owner.mockResolvedValue("owner");m.start.mockResolvedValue({runId:"workflow"});});
function queued(until:string|null){m.sql.mockResolvedValueOnce([{job:{job_id:job,job_status:"RUNNING"}}]).mockResolvedValueOnce([{context:{leased_until:until}}]);}
it("유효한 다른 Worker가 실행 중이면 새 Workflow를 보내지 않는다",async()=>{
 queued(new Date(Date.now()+120000).toISOString());
 const response=await POST(new Request(`https://example.com/api/${id}`,{method:"POST"}),context);
 expect(response.status).toBe(202);expect(m.start).not.toHaveBeenCalled();
});
it.each([null,new Date(0).toISOString()])("임대가 없거나 만료된 같은 Job은 새 Job 없이 처리 연결을 복구한다",async until=>{
 queued(until);const response=await POST(new Request(`https://example.com/api/${id}`,{method:"POST"}),context);
 expect(await response.json()).toEqual({job_id:job});expect(m.start).toHaveBeenCalledWith(expect.any(Function),[job]);expect(m.sql).toHaveBeenCalledTimes(2);
});
it("새로고침은 복구 필요를 표시하고 읽기만 한다",async()=>{
 queued(new Date(0).toISOString());const response=await GET(new Request(`https://example.com/api/${id}`),context);
 expect((await response.json()).job).toMatchObject({job_id:job,recovery_required:true});expect(m.start).not.toHaveBeenCalled();
});
