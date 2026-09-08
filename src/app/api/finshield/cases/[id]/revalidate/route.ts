/** REV-001: 요청은 Job을 접수하고, 실행은 브라우저 수명과 분리한다. */
import { createHash, randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { revalidationWorkflow } from "@/lib/finshield/workflows/revalidate";
import { jsonNoStore } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = { params: Promise<{ id: string }> };

async function handle(request: Request, context: Params): Promise<Response> {
  try {
    const ownerId = await resolveOwner(request);
    const { id: caseId } = await context.params;
    if (!UUID.test(caseId)) return jsonNoStore({ error: "잘못된 주소입니다" }, 400);
    const sql = fsql();
    const requestedJob = new URL(request.url).searchParams.get("job_id");
    if (requestedJob && !UUID.test(requestedJob)) return jsonNoStore({ error: "잘못된 작업입니다" }, 400);
    const [current] = await sql`select private.read_revalidation_status(${ownerId}::uuid,${caseId}::uuid,${requestedJob}::uuid) as job`;
    let recoveryRequired=false;
    if(current.job?.job_status === "RUNNING"){
      const [row]=await sql`select private.revalidation_context(${current.job.job_id}::uuid) as context`;
      const expires=Date.parse(row?.context?.leased_until??"");
      recoveryRequired=!Number.isFinite(expires)||expires<=Date.now();
    }
    if (request.method === "GET") return jsonNoStore({ job: current.job ? {...current.job,recovery_required:recoveryRequired} : null });
    if (request.method === "DELETE") {
      if (!requestedJob || !current.job) return jsonNoStore({ error: "작업을 찾을 수 없습니다" }, 404);
      await sql`select id from private.cancel_revalidation_job(${ownerId}::uuid,${requestedJob}::uuid)`;
      return jsonNoStore({ accepted: true });
    }
    const token = request.headers.get("Idempotency-Key") ?? randomUUID();
    if (!UUID.test(token)) return jsonNoStore({ error: "잘못된 요청 식별자입니다" }, 400);
    let jobId: string;
    if (current.job && ["QUEUED", "RUNNING"].includes(current.job.job_status)) {
      // 접수 응답이 유실됐거나 시작 연결이 실패한 경우 같은 Job만 다시 전달한다.
      jobId = current.job.job_id;
      if (current.job.job_status === "RUNNING" && !recoveryRequired) return jsonNoStore({ job_id: jobId }, 202);
    } else {
      const [enqueued] = await sql`select private.enqueue_revalidation(${ownerId}::uuid,${caseId}::uuid,
        ${`reval:${caseId}:${token}`},${createHash("sha256").update(`${caseId}:${token}`).digest("hex")}) as id`;
      jobId = enqueued.id as string;
    }
    try {
      await start(revalidationWorkflow, [jobId]);
    } catch {
      return jsonNoStore({ job_id: jobId, error: "작업은 접수됐지만 실행 연결을 재시도해야 합니다" }, 503);
    }
    return jsonNoStore({ job_id: jobId }, 202);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    const code = String((error as { code?: string })?.code ?? "");
    if (code === "42501") return jsonNoStore({ error: "이 기록을 찾을 수 없습니다" }, 404);
    if (code === "23514" || code === "23505") return jsonNoStore({ error: "현재 기록 상태에서는 새 재검증을 시작할 수 없습니다" }, 409);
    return jsonNoStore({ error: "재검증 상태를 처리하지 못했습니다" }, 503);
  }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
