import { expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { confirmRevalidationTerminal, failRevalidation } from "../revalidate";

const dsn=process.env.FINSHIELD_TEST_DSN, adminDsn=process.env.FINSHIELD_TEST_ADMIN_DSN;
it.skipIf(!dsn || !adminDsn)("실제 worker 트랜잭션은 Run 오류에 Job·Lease·이벤트를 되돌리고 재시도로 함께 종결한다",async()=>{
  if (![dsn!,adminDsn!].every(url=>["localhost","127.0.0.1"].includes(new URL(url).hostname))) throw new Error("LOCAL_FIXTURE_DATABASE_ONLY");
  const sql=postgres(dsn!,{prepare:false,max:1}),admin=postgres(adminDsn!,{prepare:false,max:1});
  let jobId:string|undefined,lease:string|undefined;
  try {
    const [base]=await admin`select c.id,c.owner_id,r.execution_manifest_id,
      (select count(*)::int from public.evidence_passports p where p.case_id=c.id) as passports
      from public.financial_cases c join public.evidence_passports p on p.id=c.latest_passport_id
      join public.verification_runs r on r.id=p.verification_run_id
      where c.deleted_at is null and c.lifecycle='VERIFIED'
      and not exists(select 1 from public.revalidation_jobs j where j.case_id=c.id and j.status in ('QUEUED','RUNNING')) limit 1`;
    expect(base).toBeDefined();
    const [job]=await sql`select private.enqueue_revalidation(${base.owner_id}::uuid,${base.id}::uuid,${randomUUID()},${"a".repeat(64)}) as id`;
    jobId=job.id;
    const [claimed]=await sql`select * from private.claim_case_revalidation_job(${base.owner_id}::uuid,${jobId!}::uuid,'atomic-probe',120)`;
    lease=claimed.lease_token;
    const [run]=await sql`select private.create_verification_run(${base.owner_id}::uuid,${base.id}::uuid,
      ${base.execution_manifest_id}::uuid,${randomUUID()},${"b".repeat(64)},'REVALIDATION',${jobId!}::uuid) as id`;
    await sql`select id from private.start_verification_run(${run.id}::uuid)`;
    const ledger=async()=>{
      const [row]=await admin`select j.status as job_status,r.status as run_status,rt.lease_token,
        (select count(*)::int from public.revalidation_events e where e.revalidation_job_id=j.id and e.event_type='FAILED') as failures,
        (select count(*)::int from public.evidence_passports p where p.case_id=j.case_id) as passports
        from public.revalidation_jobs j join public.verification_runs r on r.revalidation_job_id=j.id
        join private.revalidation_job_runtime rt on rt.job_id=j.id where j.id=${jobId!}::uuid`;
      return row;
    };
    const before=await ledger();
    expect(before).toMatchObject({job_status:"RUNNING",run_status:"RUNNING",lease_token:lease,failures:0,passports:base.passports});
    // 모의 DB 대신 실제 동일 트랜잭션의 Run 쓰기 경계에서 SQL 오류를 발생시킨다.
    let injected=0;
    const faulty=new Proxy(sql,{get(target,key,receiver){
      if(key!=="begin")return Reflect.get(target,key,receiver);
      return (callback:(tx:postgres.TransactionSql)=>Promise<unknown>)=>target.begin(async tx=>{
        const query=new Proxy(tx,{apply(fn,thisArg,args){
          if(Array.isArray(args[0]) && args[0].join("").includes("private.fail_verification_run")) {
            injected++; return tx`select 1 / 0`;
          }
          return Reflect.apply(fn,thisArg,args);
        }});
        return await callback(query);
      });
    }});
    await expect(failRevalidation(faulty,jobId!,lease!,"WORKFLOW_PROBE_FAILED"))
      .rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
    expect(injected).toBe(1);
    expect(await ledger()).toEqual(before);
    // 오래된 Lease는 Run 쓰기 전에 거부된다.
    await expect(failRevalidation(sql,jobId!,randomUUID(),"STALE_WORKER"))
      .rejects.toThrow("REVALIDATION_TERMINAL_UNCONFIRMED");
    expect(await ledger()).toEqual(before);
    await expect(failRevalidation(sql,jobId!,lease!,"WORKFLOW_PROBE_FAILED")).resolves.toBe("FAILED");
    const completed=await ledger();
    expect(completed).toMatchObject({job_status:"FAILED",run_status:"FAILED",lease_token:null,failures:1,passports:base.passports});
    await expect(failRevalidation(sql,jobId!,lease!,"WORKFLOW_PROBE_FAILED")).resolves.toBe("FAILED");
    expect(await ledger()).toEqual(completed);
    // 응답 복원도 Run 원장까지 확인하며 별도 결과를 만들지 않는다.
    await expect(confirmRevalidationTerminal(sql,jobId!)).resolves.toBe("FAILED");
    expect(await ledger()).toEqual(completed);
    // 이전 버전처럼 Job만 먼저 실패한 원장도 모델 재호출 없이 복구한다.
    const [oldJob]=await sql`select private.enqueue_revalidation(${base.owner_id}::uuid,${base.id}::uuid,${randomUUID()},${"c".repeat(64)}) as id`;
    jobId=oldJob.id;
    const [oldClaim]=await sql`select * from private.claim_case_revalidation_job(${base.owner_id}::uuid,${jobId!}::uuid,'old-split-write',120)`;
    lease=oldClaim.lease_token;
    const [oldRun]=await sql`select private.create_verification_run(${base.owner_id}::uuid,${base.id}::uuid,
      ${base.execution_manifest_id}::uuid,${randomUUID()},${"d".repeat(64)},'REVALIDATION',${jobId!}::uuid) as id`;
    await sql`select id from private.start_verification_run(${oldRun.id}::uuid)`;
    await sql`select private.fail_revalidation_job(${jobId!}::uuid,${lease!}::uuid,'OLD_SPLIT_WRITE')`;
    expect(await ledger()).toMatchObject({job_status:"FAILED",run_status:"RUNNING",failures:1});
    await expect(confirmRevalidationTerminal(sql,jobId!)).resolves.toBe("FAILED");
    expect(await ledger()).toMatchObject({job_status:"FAILED",run_status:"FAILED",failures:1,passports:base.passports});
  } finally {
    try {if(jobId&&lease)await failRevalidation(sql,jobId,lease,"LOCAL_PROBE_CLEANUP");}
    finally {await sql.end();await admin.end();}
  }
});
