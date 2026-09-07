import { createHash, createHmac } from "node:crypto";
import { RetryableError } from "workflow";
import { fsql } from "../db";
import { cleanupCaseFiles, deleteQuarantineObject } from "../files/cleanup";

export async function cleanAccountStep(requestId: string): Promise<"COMPLETED" | "PROGRESS" | "PENDING"> {
  "use step";
  const sql = fsql();
  const key = process.env.DELETION_HMAC_KEY ?? "";
  if (key.length < 16) throw new RetryableError("DELETION_KEY_UNAVAILABLE", { retryAfter: "5m" });
  try {
    // 중복 Workflow도 같은 Case 요청과 Cleanup Lease를 사용한다.
    for (let batch = 0; batch < 1; batch++) {
      const [row] = await sql`select private.account_cleanup_context(${requestId}::uuid) as context`;
      const context = row.context as { status: string; owner_id: string; case_id: string | null; case_request_id: string | null; orphan_paths: string[] };
      if (context.status === "COMPLETED") return "COMPLETED";
      if (!context.case_id) {
        // Case가 모두 사라진 뒤 남은 소유자 prefix의 정확한 객체만 정리한다.
        for (const path of context.orphan_paths) {
          if (!path.startsWith(`${context.owner_id}/`)) throw new Error("CLEANUP_OWNER_REJECTED");
          await deleteQuarantineObject(path);
        }
        const [result] = await sql`select private.finish_account_deletion(${requestId}::uuid) as ok`;
        return result.ok === true ? "COMPLETED" : "PENDING";
      }
      let childId = context.case_request_id;
      if (!childId) {
        const hash = createHash("sha256").update(`${context.owner_id}:${context.case_id}:deletion-policy-v1`).digest("hex");
        const hmac = createHmac("sha256", key).update(`CASE:${context.case_id}`).digest("hex");
        const [child] = await sql`select private.request_case_deletion(${context.owner_id}::uuid,${context.case_id}::uuid,
          ${`case-delete:${context.case_id}`},${hash},${hmac},'k1','deletion-policy-v1') as id`;
        childId = child.id as string;
      }
      await cleanupCaseFiles(sql, context.owner_id, context.case_id);
      const [purged] = await sql`select private.purge_case(${childId}::uuid) as ok`;
      if (!purged.ok) return "PENDING";
    }
    return "PROGRESS";
  } catch {
    // DB·Provider 원문은 Workflow 로그에 전달하지 않는다. 실패는 완료로 바꾸지 않는다.
    throw new RetryableError("ACCOUNT_CLEANUP_UNCONFIRMED", { retryAfter: "5m" });
  }
}
cleanAccountStep.maxRetries = 8;
