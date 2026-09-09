import { FatalError, RetryableError } from "workflow";
import { fsql } from "../db";
import { loadManifest } from "../registry";
import { loadRunInput } from "../run-input";
import { runVerification } from "../orchestrator";
import { createAgentModel, createJudgeModel } from "../agents/model-adapter";
import { confirmRevalidationTerminal, dispatchNotifications, failRevalidation, finalizeRevalidation, recordRevalidationProgress } from "../revalidate";

type Context={owner_id:string;case_id:string;status:string;existing_run_id:string|null;leased_until:string|null;cancel_requested:boolean};
export async function executeRevalidationStep(jobId:string) {
  "use step";
  const sql=fsql();
  const [row]=await sql`select private.revalidation_context(${jobId}::uuid) as context`;
  const context=row?.context as Context|null;
  if(!context)throw new FatalError("REVALIDATION_NOT_FOUND");
  // Step 결과 응답만 유실됐어도 DB의 완료 기록을 먼저 읽어 외부 호출을 반복하지 않는다.
  if(!["QUEUED","RUNNING"].includes(context.status))return {job_id:jobId,status:await confirmRevalidationTerminal(sql,jobId)};
  const [job]=await sql`select * from private.claim_case_revalidation_job(${context.owner_id}::uuid,${jobId}::uuid,'workflow',180)`;
  if(!job){
    const [fresh]=await sql`select private.revalidation_context(${jobId}::uuid) as context`;
    if(fresh?.context && !["QUEUED","RUNNING"].includes(fresh.context.status))return {job_id:jobId,status:await confirmRevalidationTerminal(sql,jobId)};
    throw new RetryableError("REVALIDATION_LEASE_BUSY",{retryAfter:"30s"});
  }
  const lease=job.lease_token as string;
  // Provider가 호출됐는지 알 수 없는 중단은 자동 재호출하지 않는다. 앞선 결과는 보존한다.
  const [claimedContext]=await sql`select private.revalidation_context(${jobId}::uuid) as context`;
  const existingRunId=claimedContext?.context?.existing_run_id as string|null;
  if(existingRunId){
    const status=await failRevalidation(sql,jobId,lease,"PROVIDER_RESULT_UNKNOWN");
    return {job_id:jobId,status};
  }
  const abort=new AbortController();let runId:string|null=null;let progressWrites=Promise.resolve();let pulseBusy=false;
  const pulse=setInterval(()=>{
    if(pulseBusy)return;pulseBusy=true;
    void sql`select private.heartbeat_revalidation_job(${jobId}::uuid,${lease}::uuid,180) as ok`
      .then(rows=>{if(!rows[0]?.ok)abort.abort();}).catch(()=>abort.abort()).finally(()=>{pulseBusy=false;});
  },2000);
  let stage = "MANIFEST";
  try{
    const manifest=await loadManifest(sql);
    stage = "CREATE_RUN";
    const [created]=await sql`select private.create_verification_run(${context.owner_id}::uuid,${context.case_id}::uuid,
      ${manifest.manifestId}::uuid,${`workflow-run:${jobId}`},${"0".repeat(64)},'REVALIDATION',${jobId}::uuid) as id`;
    runId=created.id as string;
    stage = "START_RUN";
    await sql`select id from private.start_verification_run(${runId}::uuid)`;
    stage = "LOAD_INPUT";
    const input=await loadRunInput(sql,context.owner_id,context.case_id,runId);
    stage = "VERIFY";
    const result=await runVerification({ctx:{sql,ownerId:context.owner_id,caseId:context.case_id,runId,manifest,
      signal:AbortSignal.any([abort.signal,AbortSignal.timeout(Math.max(1,Date.parse(input.deadline_at)-Date.now()-6000))])},
      claims:input.claims,maskedIntake:"",journeyStage:input.journey_stage,agentModel:createAgentModel({sql,ownerId:context.owner_id,caseId:context.case_id,runId}),judgeModel:createJudgeModel({sql,ownerId:context.owner_id,caseId:context.case_id,runId}),
      progress:event=>{progressWrites=progressWrites.then(async()=>{
        await recordRevalidationProgress(sql,jobId,lease,event);
      }).catch(()=>{abort.abort();});}});
    await progressWrites;abort.signal.throwIfAborted();
    const [beat]=await sql`select private.heartbeat_revalidation_job(${jobId}::uuid,${lease}::uuid,180) as ok`;
    if(!beat.ok)throw new Error("LEASE_LOST");
    stage = "FINALIZE";
    const saved=await finalizeRevalidation({sql,jobId,leaseToken:lease,runId,claims:input.claims,run:result,hasProfile:input.profile_completeness==="COMPLETE"});
    if(!saved.ok)throw new Error("FINALIZE_FAILED");
    await dispatchNotifications(sql).catch(()=>0);
    return {job_id:jobId,status:await confirmRevalidationTerminal(sql,jobId)};
  }catch{
    // 원문·Provider 응답·SQL 메시지 대신 고정된 실패 경계를 DB 작업 기록에 남긴다.
    const status=await failRevalidation(sql,jobId,lease,`WORKFLOW_${stage}_FAILED`);
    return {job_id:jobId,status};
  }finally{clearInterval(pulse);}
}
executeRevalidationStep.maxRetries=8;
