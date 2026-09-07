import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sql: vi.fn(), start: vi.fn(), rest: vi.fn() }));
vi.mock("../db", () => ({ fsql: () => m.sql }));
vi.mock("../auth", () => ({ resolveOwner: async () => "00000000-0000-4000-8000-000000000002", bearerToken: () => "synthetic", UnauthenticatedError: class extends Error {} }));
vi.mock("../rest", () => ({ restSelect: m.rest }));
vi.mock("../registry", () => ({ loadManifest: async () => ({ manifestId: "00000000-0000-4000-8000-000000000005" }) }));
vi.mock("workflow/api", () => ({ start: m.start }));
vi.mock("../workflows/aftercare", () => ({ aftercareWorkflow: vi.fn() }));
import { POST } from "@/app/api/finshield/cases/[id]/aftercare/route";
const id = "00000000-0000-4000-8000-000000000003";
const jobId = "00000000-0000-4000-8000-000000000004";
const params = { params: Promise.resolve({ id }) };
const request = (data: unknown) => new Request(`https://finshield.example/api/finshield/cases/${id}/aftercare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const body = { answers: { UNDERSTOOD_TERMS: "NO" }, request_key: jobId };
beforeEach(() => { vi.clearAllMocks(); m.rest.mockResolvedValue([{ passport_id: jobId, claims: [] }]); });
it("요청을 먼저 저장하며 예약 응답 유실에도 복구할 Job 식별자를 보존한다", async () => {
  m.sql.mockResolvedValueOnce([{ id: jobId }]).mockResolvedValueOnce([{ ok: true }]);
  m.start.mockRejectedValueOnce(new Error("synthetic secret must not escape"));
  const response = await POST(request(body), params); const data = await response.json();
  expect(response.status).toBe(503); expect(data.review_job_id).toBe(jobId); expect(JSON.stringify(data)).not.toContain("secret");
  expect(m.sql.mock.calls[0][0].join("")).toContain("enqueue_precase_review"); expect(m.start).toHaveBeenCalledOnce();
});
it("이미 예약한 요청의 재접수는 추가 Workflow 없이 같은 Job으로 응답한다", async () => {
  m.sql.mockResolvedValueOnce([{ id: jobId }]).mockResolvedValueOnce([{ ok: false }]);
  const response = await POST(request(body), params);
  expect(response.status).toBe(202); expect((await response.json()).review_job_id).toBe(jobId); expect(m.start).not.toHaveBeenCalled();
});
it("취소는 소유자·Case·Job 범위를 전달하고 새 모델 실행을 예약하지 않는다", async () => {
  m.sql.mockResolvedValue([]);
  expect((await POST(request({ operation: "CANCEL", job_id: jobId }), params)).status).toBe(200);
  expect(m.sql.mock.calls[0][0].join("")).toContain("stop_precase_reviews"); expect(m.start).not.toHaveBeenCalled(); expect(m.rest).not.toHaveBeenCalled();
});
it("확인한 문서와 다른 문구는 점검을 접수하지 않는다",async()=>{
 m.rest.mockResolvedValueOnce([{passport_id:jobId,claims:[{claim_id:id,statement_masked:"이전 권유"}]}]).mockResolvedValueOnce([]);
 const response=await POST(request({...body,contract_terms:{[id]:"계약 문구"},document_links:{[id]:jobId}}),params);
 expect(response.status).toBe(409);expect(m.sql).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();
});
it("문서 출처는 브라우저 본문 대신 소유자 조회 결과로 고정한다",async()=>{
 m.rest.mockResolvedValueOnce([{passport_id:jobId,claims:[{claim_id:id,statement_masked:"이전 권유"}]}]).mockResolvedValueOnce([{
  id:jobId,case_input_id:jobId,target_claim_id:id,base_passport_id:jobId,statement_masked:"계약 문구",original_statement_masked:"인식 문구",
  source_locator:{page_no:1},confirmed:true,removed:false}]);
 m.sql.mockResolvedValueOnce([{id:jobId}]).mockResolvedValueOnce([{ok:false}]);
 const response=await POST(request({...body,contract_terms:{[id]:"계약 문구"},document_links:{[id]:jobId},document_sources:[{original_statement_masked:"위조"}]}),params);
 expect(response.status).toBe(202);expect(JSON.stringify(m.sql.mock.calls)).toContain("인식 문구");expect(JSON.stringify(m.sql.mock.calls)).not.toContain("위조");
});
