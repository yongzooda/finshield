import { expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { recordRevalidationProgress } from "../revalidate";
const dsn = process.env.FINSHIELD_TEST_DSN, adminDsn = process.env.FINSHIELD_TEST_ADMIN_DSN;
it.skipIf(!dsn || !adminDsn)("실제 DB의 진행 이벤트 계약과 화면 복원 payload가 일치한다", async () => {
 if (![dsn!,adminDsn!].every(url=>["localhost","127.0.0.1"].includes(new URL(url).hostname))) throw new Error("LOCAL_FIXTURE_DATABASE_ONLY");
 const sql=postgres(dsn!,{prepare:false,max:2}), admin=postgres(adminDsn!,{prepare:false,max:1});
 let owner:string|undefined, jobId:string|undefined;
 try {
  const [base]=await admin`select c.id,c.owner_id from public.financial_cases c where c.latest_passport_id is not null
    and c.deleted_at is null and c.lifecycle='VERIFIED' and not exists(select 1 from public.revalidation_jobs j
    where j.case_id=c.id and j.status in ('QUEUED','RUNNING')) limit 1`;
  expect(base).toBeDefined(); owner=base.owner_id;
  const [job]=await sql`select private.enqueue_revalidation(${owner!}::uuid,${base.id}::uuid,${randomUUID()},${"a".repeat(64)}) as id`;
  jobId=job.id;
  const claims=await Promise.all(['device-a','device-b'].map(worker=>sql`select * from private.claim_case_revalidation_job(${owner!}::uuid,${jobId!}::uuid,${worker},120)`));
  expect(claims.flat()).toHaveLength(1);
  const lease=claims.flat()[0];
  await recordRevalidationProgress(sql,jobId!,lease.lease_token,{type:"agent_started",agentCode:"PRODUCT_INSTITUTION"});
  await recordRevalidationProgress(sql,jobId!,lease.lease_token,{type:"agent_finished",agentCode:"PRODUCT_INSTITUTION",status:"SUCCEEDED",findings:1,toolCalls:1});
  const [restored]=await sql`select private.read_revalidation_status(${owner!}::uuid,${base.id}::uuid,${jobId!}::uuid) as job`;
  expect(restored.job.events.slice(-2).map((e:{payload:unknown})=>e.payload)).toEqual([
   expect.objectContaining({type:"agent_started",agentCode:"PRODUCT_INSTITUTION"}),
   expect.objectContaining({type:"agent_finished",status:"SUCCEEDED",findings:1,toolCalls:1})]);
  const before=restored.job.events.length;
  await admin`update private.revalidation_job_runtime set leased_until=clock_timestamp()-interval '1 second' where job_id=${jobId!}::uuid`;
  await expect(recordRevalidationProgress(sql,jobId!,lease.lease_token,{type:"agent_started",agentCode:"STALE_WORKER"})).rejects.toThrow("REVALIDATION_LEASE_LOST");
  const [again]=await sql`select private.read_revalidation_status(${owner!}::uuid,${base.id}::uuid,${jobId!}::uuid) as job`;
  expect(again.job.events).toHaveLength(before);
 } finally {
  try {if(owner&&jobId)await sql`select private.cancel_revalidation_job(${owner}::uuid,${jobId}::uuid)`;}
  finally {await sql.end();await admin.end();}
 }
});
