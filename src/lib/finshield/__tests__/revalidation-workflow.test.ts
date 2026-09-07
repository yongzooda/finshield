import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({sql:vi.fn(), run:vi.fn(),fail:vi.fn(),confirm:vi.fn()}));
vi.mock("../db",()=>({fsql:()=>mocks.sql}));
vi.mock("../orchestrator",()=>({runVerification:mocks.run}));
vi.mock("../revalidate",()=>({confirmRevalidationTerminal:mocks.confirm,failRevalidation:mocks.fail,finalizeRevalidation:vi.fn(),dispatchNotifications:vi.fn()}));
import { executeRevalidationStep } from "../workflows/revalidation-step";

beforeEach(()=>vi.resetAllMocks());
it("완료 응답만 유실된 Step을 다시 받아도 Provider를 호출하지 않는다",async()=>{
 mocks.sql.mockResolvedValue([{context:{status:"NO_CHANGE"}}]);
 mocks.confirm.mockResolvedValue("NO_CHANGE");
 await expect(executeRevalidationStep("00000000-0000-4000-8000-000000000001")).resolves.toMatchObject({status:"NO_CHANGE"});
 expect(mocks.run).not.toHaveBeenCalled();expect(mocks.sql).toHaveBeenCalledTimes(1);
});
it("만료 Lease를 되찾았지만 기존 Run의 Provider 성공 여부가 불명확하면 재호출하지 않는다",async()=>{
 mocks.sql.mockResolvedValueOnce([{context:{status:"RUNNING",owner_id:"owner",case_id:"case"}}])
 .mockResolvedValueOnce([{lease_token:"lease"}])
 .mockResolvedValueOnce([{context:{existing_run_id:"previous-run"}}])
 .mockResolvedValueOnce([]);
 mocks.fail.mockResolvedValue("FAILED");
 await expect(executeRevalidationStep("job")).resolves.toMatchObject({status:"FAILED"});
 expect(mocks.run).not.toHaveBeenCalled();
 expect(mocks.fail).toHaveBeenCalledWith(mocks.sql,"job","lease","PROVIDER_RESULT_UNKNOWN");
});
it("Lease 선점 전에 취소된 작업은 Provider 없이 종료한다",async()=>{
 mocks.confirm.mockResolvedValue("FAILED");
 mocks.sql.mockResolvedValueOnce([{context:{status:"QUEUED",owner_id:"owner",case_id:"case"}}])
 .mockResolvedValueOnce([]).mockResolvedValueOnce([{context:{status:"FAILED",reason_code:"USER_CANCELLED"}}]);
 await expect(executeRevalidationStep("job")).resolves.toMatchObject({status:"FAILED"});
 expect(mocks.run).not.toHaveBeenCalled();
});

it("실패 쓰기 뒤에도 DB 종결을 확인하지 못하면 Step 성공으로 저장하지 않는다",async()=>{
 mocks.sql.mockResolvedValueOnce([{context:{status:"RUNNING",owner_id:"owner",case_id:"case"}}])
 .mockResolvedValueOnce([{lease_token:"lease"}])
 .mockResolvedValueOnce([{context:{existing_run_id:"previous-run"}}])
 .mockResolvedValueOnce([]);
 mocks.fail.mockRejectedValueOnce(new Error("REVALIDATION_TERMINAL_UNCONFIRMED"));
 await expect(executeRevalidationStep("job")).rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
 expect(mocks.run).not.toHaveBeenCalled();
});
it("이전 완료와 실패 쓰기가 경합하면 실제 완료 상태를 보존한다",async()=>{
 mocks.sql.mockResolvedValueOnce([{context:{status:"RUNNING",owner_id:"owner",case_id:"case"}}])
 .mockResolvedValueOnce([{lease_token:"lease"}])
 .mockResolvedValueOnce([{context:{existing_run_id:"previous-run"}}])
 .mockResolvedValueOnce([]);
 mocks.fail.mockResolvedValueOnce("NO_CHANGE");
 await expect(executeRevalidationStep("job")).resolves.toMatchObject({status:"NO_CHANGE"});
 expect(mocks.run).not.toHaveBeenCalled();
});

it("종결 Job에 활성 Run이 남고 복구가 실패하면 Step을 성공 처리하지 않는다",async()=>{
 mocks.sql.mockResolvedValue([{context:{status:"FAILED"}}]);
 mocks.confirm.mockRejectedValue(new Error("REVALIDATION_TERMINAL_UNCONFIRMED"));
 await expect(executeRevalidationStep("job")).rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
 expect(mocks.run).not.toHaveBeenCalled();
});
