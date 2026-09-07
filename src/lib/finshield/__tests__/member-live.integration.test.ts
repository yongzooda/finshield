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
it.skipIf(process.env.FINSHIELD_LIVE_PROBE!=='1').each([
 {name:'single',text:'햇살론15는 연 3% 고정금리다.'},
 {name:'multi',text:'서민금융진흥원의 햇살론15 상품입니다. 햇살론15는 연 3% 고정금리이며 한도는 최대 3천만원입니다. 서민금융진흥원 상담 전화는 1397입니다.'},
])('합성 $name의 실제 모델·공식 도구·예산·저장 연결',async({name,text})=>{
 const url=process.env.FINSHIELD_DATABASE_URL!;
 if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('격리 로컬 DB만 사용할 수 있다');
 const sql=postgres(url,{prepare:false,max:1});
 const rows:unknown[]=[];
 const ownerId='00000000-0000-4000-8000-00000000000a';
 await sql`set role finshield_worker`;
 const intake=await startIntake({sql,ownerId,rawText:text,titleMasked:'합성 단일 금리 근거 연결 시험',extractClaims:createClaimExtractor()});
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
 writeFileSync(`/tmp/finshield-member-live-${name}.json`,JSON.stringify({caseId:intake.caseId,runId}),{mode:0o600});
 const base=createAgentModel({sql,ownerId,caseId:intake.caseId,runId});
 const model={usage:base.usage,chooseTools:async(args:Parameters<typeof base.chooseTools>[0])=>{const t=Date.now();try{const out=await base.chooseTools(args);rows.push({phase:'choose',ms:Date.now()-t,calls:out});return out;}catch(e){rows.push({phase:'choose',ms:Date.now()-t,error:(e as Error).name});throw e;}},decide:async(args:Parameters<typeof base.decide>[0])=>{const t=Date.now();try{const out=await base.decide(args);rows.push({phase:'decide',ms:Date.now()-t,output:out});return out;}catch(e){rows.push({phase:'decide',ms:Date.now()-t,error:(e as Error).name});throw e;}}};
 try{
 const claims=pinned.claims;
 const result=await runVerification({ctx:session,claims,maskedIntake:'',journeyStage:'PRE_TRANSACTION',agentModel:model,judgeModel:createJudgeModel({sql,ownerId,caseId:intake.caseId,runId})});
 const finals=buildFinalClaims({claims:claims.map(c=>({...c,claimId:c.claim_id})),run:result});
 const usage=await sql`select status,coalesce(sum(actual_microunits),0)::text as cost_microunits,count(*)::int as calls from private.usage_reservations where run_id=${runId}::uuid group by status`;
 const agentUsage=await sql`select agent_code,input_tokens,output_tokens,cost_microunits from public.agent_runs where verification_run_id=${runId}::uuid`;
 const saved=await finalizeRun({sql,runId,ownerId,claims:claims.map(c=>({...c,claimId:c.claim_id})),run:result,hasProfile:false});
 writeFileSync(`/tmp/finshield-member-live-${name}.json`,JSON.stringify({caseId:intake.caseId,runId,saved,usage,agentUsage,agents:result.agentResults,cove:result.cove,redTeam:result.redTeam,judge:result.judgeOutput,judgeReason:result.judgeReasonCode,finals,rows},null,2),{mode:0o600});
 expect(saved.ok).toBe(true);
 expect(result.judgeOutput).not.toBeNull();
 if(name==='single') expect(finals[0].status).toBe('CONTRADICTED');
 else { expect(finals.length).toBeGreaterThanOrEqual(3); expect(finals.some(claim=>claim.status==='CONTRADICTED')).toBe(true); }
 expect(usage.some(row=>row.status==='SETTLED' && Number(row.cost_microunits)>0)).toBe(true);
 expect(agentUsage.some(row=>row.agent_code==='EVIDENCE_JUDGE' && row.output_tokens>0)).toBe(true);

 }finally{await sql.end({timeout:2});}
},140000);
