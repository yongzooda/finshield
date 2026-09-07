import { expect, it, vi } from "vitest";
import type postgres from "postgres";
import { failRevalidation } from "../revalidate";
type Sql = ReturnType<typeof postgres>;

it.each(["RUNNING", "QUEUED", "unexpected", null])("실패 RPC가 끊기고 DB가 %s이면 종결을 꾸미지 않는다", async (status) => {
  const sql=vi.fn().mockRejectedValueOnce(new Error("private database detail"))
    .mockResolvedValueOnce([{context:status ? {status} : null}]);
  await expect(failRevalidation(sql as unknown as Sql,"job","lease","WORKFLOW_FAILED"))
    .rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
});
it.each(["FAILED", "NO_CHANGE", "CHANGED"])("응답만 유실되면 저장된 %s를 반환한다", async (status) => {
  const sql=vi.fn().mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValueOnce([{context:{status}}]);
  await expect(failRevalidation(sql as unknown as Sql,"job","lease","WORKFLOW_FAILED")).resolves.toBe(status);
});
it("실패 쓰기가 성공해도 확인 조회가 끊기면 비밀 없는 재시도 오류를 낸다", async () => {
  const sql=vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("secret database detail"));
  await expect(failRevalidation(sql as unknown as Sql,"job","lease","WORKFLOW_FAILED"))
    .rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
});
