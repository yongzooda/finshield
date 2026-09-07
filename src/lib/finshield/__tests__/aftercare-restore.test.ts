import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rest:vi.fn(),owner:vi.fn(),sql:vi.fn()}));
vi.mock("../auth",()=>({resolveOwner:mocks.owner,bearerToken:()=>"synthetic-token",UnauthenticatedError:class extends Error{}}));
vi.mock("../rest",()=>({restSelect:mocks.rest}));
vi.mock("../db",()=>({fsql:()=>mocks.sql}));
import { GET } from "@/app/api/finshield/cases/[id]/aftercare/route";
const caseId="00000000-0000-4000-8000-000000000001";
const assessmentId="00000000-0000-4000-8000-000000000002";
const passportId="00000000-0000-4000-8000-000000000003";
const claimId="00000000-0000-4000-8000-000000000004";
beforeEach(()=>{vi.clearAllMocks();mocks.owner.mockResolvedValue("owner");});
it("회원 RLS가 Case를 숨기면 점검 답변 조회를 진행하지 않는다",async()=>{
 mocks.rest.mockResolvedValueOnce([]);
 const response=await GET(new Request(`http://localhost/api/${caseId}`),{params:Promise.resolve({id:caseId})});
 expect(response.status).toBe(404);expect(mocks.rest).toHaveBeenCalledTimes(1);
});
it("이전 점검의 기준 Passport·결과·비교를 재판정하지 않고 복원한다",async()=>{
 mocks.rest.mockImplementation(async({path}:{path:string})=>{
  if(path==="financial_cases")return [{id:caseId}];
  if(path==="precase_assessments")return [{id:assessmentId,assessment_no:2,base_passport_id:passportId,
    result:"ADDITIONAL_EXPLANATION",summary_masked:"당시 저장된 판단 이유",finished_at:"2026-09-07T00:00:00Z",assessment_schema_version:"aftercare-v2"}];
  if(path==="precase_answers")return [{question_code:"UNDERSTOOD_TERMS",answer_code:"NO",answer_text_masked:null},
    {question_code:"CONTRACT_MATCHES_EXPLANATION",answer_code:"DIFFERENT",answer_text_masked:null},
    {question_code:`CONTRACT_${claimId.replaceAll("-", "").toUpperCase()}`,answer_code:"DIFFERENT_TEXT",answer_text_masked:JSON.stringify({claim_id:claimId,before:"연 3%",contract:"연 15.9%",result:"DIFFERENT_TEXT"})}];
  if(path==="action_checklists")return [{action_code:"REQUEST_WRITTEN_EXPLANATION",required_material_codes:["CONTRACT"],official_channel_registry_id:null}];
  throw new Error("예상하지 않은 최신 결과 조회");
 });mocks.sql.mockResolvedValue([]);
 const response=await GET(new Request(`http://localhost/api/${caseId}`),{params:Promise.resolve({id:caseId})});
 const {assessment}=await response.json();
 expect(response.status).toBe(200);expect(assessment.base_passport_id).toBe(passportId);
 expect(assessment.result).toBe("ADDITIONAL_EXPLANATION");expect(assessment.reasons).toEqual(["당시 저장된 판단 이유"]);
 expect(assessment.comparison).toHaveLength(1);
 expect(assessment.comparison[0].contract).toBe("연 15.9%");
 expect(assessment.answers).toEqual({UNDERSTOOD_TERMS:"NO",CONTRACT_MATCHES_EXPLANATION:"DIFFERENT"});
});
