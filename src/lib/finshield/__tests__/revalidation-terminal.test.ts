import { expect, it, vi } from "vitest";
import type postgres from "postgres";
import { confirmRevalidationTerminal, failRevalidation } from "../revalidate";
type Sql = ReturnType<typeof postgres>;

const connection = () => {
  const tx=vi.fn();
  const begin=vi.fn(async (callback: (query: unknown) => unknown) => callback(tx));
  return {tx,begin,sql:{begin} as unknown as Sql};
};
it.each(["RUNNING", "QUEUED", "unexpected", null])("실패 쓰기가 끊기고 DB가 %s이면 종결을 꾸미지 않는다", async (status) => {
  const {sql,begin,tx}=connection();
  begin.mockRejectedValueOnce(new Error("private database detail"));
  tx.mockResolvedValueOnce([{context:status ? {status} : null}]);
  await expect(failRevalidation(sql,"job","lease","WORKFLOW_FAILED"))
    .rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
});
it.each(["FAILED", "NO_CHANGE", "CHANGED"])("응답만 유실되면 저장된 %s를 반환한다", async (status) => {
  const {sql,begin,tx}=connection();
  begin.mockRejectedValueOnce(new Error("response lost"));
  tx.mockResolvedValueOnce([{context:{status}}]).mockResolvedValue([]);
  await expect(failRevalidation(sql,"job","lease","WORKFLOW_FAILED")).resolves.toBe(status);
});
it("실패 쓰기가 성공해도 확인 조회가 끊기면 비밀 없는 재시도 오류를 낸다", async () => {
  const {sql,begin}=connection();
  begin.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("secret database detail"));
  await expect(failRevalidation(sql,"job","lease","WORKFLOW_FAILED"))
    .rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
});
it("과거 FAILED Job의 활성 Run을 복구하고 종결을 확인한다", async () => {
  const {sql,tx}=connection();
  tx.mockResolvedValueOnce([{context:{status:"FAILED"}}]).mockResolvedValueOnce([{id:"orphan"}])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  await expect(confirmRevalidationTerminal(sql,"job")).resolves.toBe("FAILED");
  expect(tx.mock.calls[2][0].join("")).toContain("private.fail_verification_run");
  expect(tx.mock.calls[2].slice(1)).toEqual(["orphan","WORKFLOW_INTERRUPTED"]);
});
it.each(["NO_CHANGE","CHANGED"])("%s에 활성 Run이 남으면 기존 결과를 건드리지 않고 미확정으로 반환한다", async status => {
  const {sql,tx}=connection();
  tx.mockResolvedValueOnce([{context:{status}}]).mockResolvedValueOnce([{id:"unexpected-active"}]);
  await expect(confirmRevalidationTerminal(sql,"job")).rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
  expect(tx.mock.calls.some(call=>call[0].join("").includes("fail_verification_run"))).toBe(false);
});
it("FAILED Run 복구도 실패하면 종결 응답 대신 재시도 오류를 낸다", async () => {
  const {sql,tx}=connection();
  tx.mockResolvedValueOnce([{context:{status:"FAILED"}}]).mockResolvedValueOnce([{id:"orphan"}])
    .mockRejectedValueOnce(new Error("private detail"));
  await expect(confirmRevalidationTerminal(sql,"job")).rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
});
