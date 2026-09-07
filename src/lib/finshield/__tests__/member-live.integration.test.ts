import {it,expect} from 'vitest';
import postgres from 'postgres';
import {createAgentModel,createJudgeModel,createClaimExtractor} from '../agents/model-adapter';
import {runVerification} from '../orchestrator';
import {buildFinalClaims,finalizeRun} from '../finalize';
import {startIntake} from '../intake';
import {loadManifest} from '../registry';
import {loadRunInput} from '../run-input';
import {randomUUID,createHash} from 'node:crypto';
import {createRunSession} from '../tools/runtime';
import {writeFileSync} from 'node:fs';
it.skipIf(process.env.FINSHIELD_LIVE_PROBE!=='1')('합성 한 항목의 실제 모델·도구 지연 진단',async()=>{
 const url=process.env.FINSHIELD_DATABASE_URL!;
 if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('격리 로컬 DB만 사용할 수 있다');
 const sql=postgres(url,{prepare:false,max:1});
 const rows:unknown[]=[];
 const ownerId='00000000-0000-4000-8000-00000000000a';
 await sql`set role finshield_worker`;
 const intake=await startIntake({sql,ownerId,rawText:'햇살론15는 연 3% 고정금리다.',titleMasked:'합성 단일 금리 근거 연결 시험',extractClaims:createClaimExtractor()});
 if(!intake.ok)throw new Error('합성 입력이 차단됐다');
 const manifest=await loadManifest(sql);
 const selected=intake.claims.map(c=>({claim_id:c.claimId,expected_revision_no:1}));
 const runId=await sql.begin(async tx=>{
  await tx`select private.confirm_case_claims(${ownerId}::uuid,${intake.caseId}::uuid,${JSON.stringify(selected)}::text::jsonb)`;
  await tx`select private.transition_financial_case(${ownerId}::uuid,${intake.caseId}::uuid,'INPUT_REVIEW'::public.case_lifecycle,'USER','CLAIMS_CONFIRMED')`;
  const created=await tx`select private.create_verification_run(${ownerId}::uuid,${intake.caseId}::uuid,${manifest.manifestId}::uuid,${randomUUID()},${createHash('sha256').update(JSON.stringify(selected)).digest('hex')},'INITIAL'::public.verification_run_kind,null) as id`;
  return created[0].id as string;
 });
 const pinned=await loadRunInput(sql,ownerId,intake.caseId,runId);
 await sql`select id from private.start_verification_run(${runId}::uuid)`;
 const session=createRunSession({sql,ownerId,caseId:intake.caseId,runId,manifest,signal:AbortSignal.timeout(110000)});
 writeFileSync('/tmp/finshield-member-live-probe.json',JSON.stringify({caseId:intake.caseId,runId}),{mode:0o600});
 const base=createAgentModel();
 const model={chooseTools:async(args:Parameters<typeof base.chooseTools>[0])=>{const t=Date.now();try{const out=await base.chooseTools(args);rows.push({phase:'choose',ms:Date.now()-t,calls:out});return out;}catch(e){rows.push({phase:'choose',ms:Date.now()-t,error:(e as Error).name});throw e;}},decide:async(args:Parameters<typeof base.decide>[0])=>{const t=Date.now();try{const out=await base.decide(args);rows.push({phase:'decide',ms:Date.now()-t,output:out});return out;}catch(e){rows.push({phase:'decide',ms:Date.now()-t,error:(e as Error).name});throw e;}}};
 try{
 const claims=pinned.claims;
 const result=await runVerification({ctx:session,claims,maskedIntake:'',journeyStage:'PRE_TRANSACTION',agentModel:model,judgeModel:createJudgeModel()});
 const finals=buildFinalClaims({claims:claims.map(c=>({...c,claimId:c.claim_id})),run:result});
 const saved=await finalizeRun({sql,runId,claims:claims.map(c=>({...c,claimId:c.claim_id})),run:result,hasProfile:false});
 writeFileSync('/tmp/finshield-member-live-probe.json',JSON.stringify({caseId:intake.caseId,runId,saved,agents:result.agentResults,cove:result.cove,redTeam:result.redTeam,judge:result.judgeOutput,judgeReason:result.judgeReasonCode,finals,rows},null,2),{mode:0o600});
 expect(saved.ok).toBe(true);
 expect(result.judgeOutput).not.toBeNull();
 expect(finals[0].status).toBe('CONTRADICTED');

 }finally{await sql.end({timeout:2});}
},140000);
