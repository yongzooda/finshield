import "server-only";
import type postgres from "postgres";
import { finshieldEnv } from "../env";
import { storageServiceHeaders } from "./service-headers";

/** SEC-FILE-006: 서버가 임대한 정확한 객체를 지운 뒤 DB의 실제 부재 검사로 종결한다. */
export async function cleanupCaseFiles(sql: ReturnType<typeof postgres>, ownerId: string, caseId: string) {
  const env = finshieldEnv();
  if (!env.SUPABASE_SECRET_KEY || !env.SUPABASE_URL) return { finished: 0, pending: true };
  const jobs = await sql`select * from private.claim_case_cleanup(${ownerId}::uuid,${caseId}::uuid)`;
  let finished = 0;
  for (const job of jobs) {
    try {
      const [row] = await sql`select private.cleanup_object_context(${job.id}::uuid,${job.lease_token}::uuid) as target`;
      const target = row.target as { path: string | null; bucket: string | null };
      if (target.path) {
        if (target.bucket !== "finshield-quarantine") throw new Error("CLEANUP_BUCKET_REJECTED");
        const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${target.bucket}`, {
          method: "DELETE", headers: { ...storageServiceHeaders(env.SUPABASE_SECRET_KEY), "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: [target.path] }), signal: AbortSignal.timeout(5000), redirect: "error",
        });
        if (!response.ok) throw new Error("STORAGE_DELETE_FAILED");
      }
      await sql`select id from private.finish_file_cleanup_job(${job.id}::uuid,${job.lease_token}::uuid,null)`;
      finished += 1;
    } catch {
      await sql`select id from private.finish_file_cleanup_job(${job.id}::uuid,${job.lease_token}::uuid,'STORAGE_DELETE_UNCONFIRMED')`;
    }
  }
  return { finished, pending: finished !== jobs.length || jobs.length === 20 };
}
