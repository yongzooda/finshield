import { expect, it } from "vitest";
import postgres from "postgres";
import { start } from "workflow/api";
import { revalidationWorkflow } from "../workflows/revalidate";
import { fileExpiryWorkflow } from "../workflows/file-expiry";

it("실제 Workflow HTTP 실행에서 종결 Job 재생과 없는 파일의 정리를 외부 호출 없이 마친다", async () => {
  const url=process.env.FINSHIELD_DATABASE_URL;
  if(!url || !["localhost","127.0.0.1"].includes(new URL(url).hostname)) throw new Error("격리 로컬 DB가 필요하다");
  const sql=postgres(url,{prepare:false,max:1});
  try {
    const [job]=await sql`select id,status from public.revalidation_jobs where status in ('NO_CHANGE','CHANGED') order by queued_at desc limit 1`;
    if(!job)throw new Error("SQL 불변식 시험의 종결 Job이 필요하다");
    const [before]=await sql`select count(*)::int as count from public.verification_runs where revalidation_job_id=${job.id}::uuid`;
    const replay=await start(revalidationWorkflow,[job.id as string]);
    expect(await replay.returnValue).toEqual({job_id:job.id,status:job.status});
    const absentId="00000000-0000-4000-8000-000000fffffe";
    const cleanup=await start(fileExpiryWorkflow,[absentId]);
    expect(await cleanup.returnValue).toEqual({input_id:absentId,status:"ABSENT"});
    const [after]=await sql`select count(*)::int as count from public.verification_runs where revalidation_job_id=${job.id}::uuid`;
    expect(after.count).toBe(before.count);
  } finally { await sql.end({timeout:2}); }
});
