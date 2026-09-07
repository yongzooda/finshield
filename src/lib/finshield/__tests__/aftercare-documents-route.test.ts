import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({sql:vi.fn(),cleanup:vi.fn(),rest:vi.fn()}));
vi.mock("../auth",()=>({resolveOwner:async()=>"00000000-0000-4000-8000-000000000001",bearerToken:()=>"synthetic",UnauthenticatedError:class extends Error{}}));
vi.mock("../db",()=>({fsql:()=>m.sql}));
vi.mock("../rest",()=>({restSelect:m.rest}));
vi.mock("../files/cleanup",()=>({cleanupCaseFiles:m.cleanup}));
import {GET,POST} from "@/app/api/finshield/cases/[id]/aftercare/documents/route";
const caseId="00000000-0000-4000-8000-000000000002",inputId="00000000-0000-4000-8000-000000000003";
const params={params:Promise.resolve({id:caseId})};
const body={input_id:inputId,base_passport_id:"00000000-0000-4000-8000-000000000004",claims:[{
 id:"00000000-0000-4000-8000-000000000005",target_claim_id:"00000000-0000-4000-8000-000000000006",statement_masked:"연 7%이며 중도상환수수료는 없습니다"}]};
const request=(data:unknown=body)=>new Request(`https://finshield.example/api/finshield/cases/${caseId}/aftercare/documents`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
beforeEach(()=>{vi.clearAllMocks();m.sql.mockResolvedValue([]);m.cleanup.mockResolvedValue({pending:false});});
it("문서 확인을 먼저 고정하고 실제 원본 정리를 시도한다",async()=>{
 const response=await POST(request(),params);expect(response.status).toBe(200);
 expect(m.sql.mock.calls[0][0].join("")).toContain("confirm_aftercare_document");
 expect(m.cleanup).toHaveBeenCalledOnce();expect(m.sql.mock.invocationCallOrder[0]).toBeLessThan(m.cleanup.mock.invocationCallOrder[0]);
});
it("정리 실패는 확인 결과를 되돌리지 않으며 삭제 완료라고 응답하지 않는다",async()=>{
 m.cleanup.mockRejectedValueOnce(new Error("synthetic storage failure"));
 const response=await POST(request(),params);expect(await response.json()).toEqual({status:"CONFIRMED",input_id:inputId});
});
it("다른 Case 문서 거부는 삭제를 실행하지 않는다",async()=>{
 m.sql.mockRejectedValueOnce(Object.assign(new Error("private detail"),{code:"42501"}));
 const response=await POST(request(),params);expect(response.status).toBe(404);expect(await response.text()).not.toContain("private detail");expect(m.cleanup).not.toHaveBeenCalled();
});
it("확인 응답 유실은 같은 항목 재시도를 안내한다",async()=>{
 m.sql.mockRejectedValueOnce(new Error("synthetic lost response"));const response=await POST(request(),params);
 expect(response.status).toBe(503);expect(await response.text()).toContain("같은 항목");expect(m.cleanup).not.toHaveBeenCalled();
});
it("자유 문구의 연락처는 모델과 DB 경계 전에 가린다",async()=>{
 await POST(request({...body,claims:[{...body.claims[0],statement_masked:"문의는 010-1234-5678 입니다"}]}),params);
 expect(JSON.stringify(m.sql.mock.calls)).not.toContain("010-1234-5678");
});
it("다른 사용자의 문서 목록은 Case RLS 뒤에서 읽지 않는다",async()=>{
 m.rest.mockResolvedValueOnce([]);expect((await GET(request(),params)).status).toBe(404);expect(m.rest).toHaveBeenCalledOnce();
});
it("재조회는 같은 Case 임시 입력과 저장된 마스킹 항목만 조회한다",async()=>{
 m.rest.mockResolvedValueOnce([{id:caseId}]).mockResolvedValueOnce([{id:inputId,input_stage:"CLAIM_CONFIRMED"}]).mockResolvedValueOnce([{id:body.claims[0].id}]);
 const response=await GET(request(),params);expect(response.status).toBe(200);
 expect(m.rest.mock.calls[1][0].query.input_purpose).toBe("eq.AFTERCARE");
 expect(m.rest.mock.calls[2][0].query.case_input_id).toBe(`in.(${inputId})`);expect(m.sql).not.toHaveBeenCalled();
});
