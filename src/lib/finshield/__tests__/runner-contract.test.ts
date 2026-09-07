import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import { createRunSession } from '../tools/runtime';
import { notLoadedYet } from '../tools/registry';
import { runDomainAgent } from '../agents/runner';

const input = {schema_version:'in-v1',agent_code:'FRAUD_CHANNEL',scenario:'LOAN',journey_stage:'PRE_TRANSACTION',masked_intake:'',claims:[{claim_ref:'C1',claim_type:'CHANNEL',statement_masked:'합성 권유의 경로를 확인한다',materiality:'MATERIAL'}]} as const;
const makeSession = () => createRunSession({sql:vi.fn() as unknown as ReturnType<typeof postgres>,ownerId:'fixture',caseId:'fixture',runId:'fixture',manifest:{manifestId:'fixture',kbReleaseId:'fixture',agentIds:{},toolIds:{}},recorder:{agentRun:async()=> 'fixture',toolRuns:async()=>new Map()}});
const output = {schema_version:'out-v1',findings:[{claim_ref:'C1',state:'UNKNOWN',relation:'CONTEXT',evidence_refs:[],summary_masked:'자료를 확인하지 못했다',limits:[]}],out_of_scope_claim_refs:[]};

describe('EV-008·AI-017 조회 실패와 검색 결과 없음 구분',()=>{
 it('미연결 자료는 성공한 0건 검색으로 보고하지 않는다',async()=>{
  const chooseTools=vi.fn(async()=>[{toolCode:'search_consumer_warning',input:{query:'합성 권유'}}]);
  const decide=vi.fn(async()=>output);
  const tool=vi.fn(notLoadedYet('WARNING_CORPUS_NOT_LOADED'));
  const result=await runDomainAgent({session:makeSession(),agentCode:'FRAUD_CHANNEL',input:{...input,claims:[...input.claims]},model:{chooseTools,decide},impls:{search_consumer_warning:tool}});
  expect(result.status).toBe('PARTIAL');
  expect(result.reasonCode).toBe('TOOL_LOOKUP_FAILED');
  expect(result.evidence).toEqual([]);
  expect(tool).toHaveBeenCalledTimes(1);
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({observations:expect.arrayContaining([expect.objectContaining({tool_code:'search_consumer_warning',provenance_complete:false,error_code:'WARNING_CORPUS_NOT_LOADED'})])}));
 });
 it('정상 검색 0건은 실패로 만들지 않으면서 같은 입력의 반복 호출을 막는다',async()=>{
  const tool=vi.fn(async()=>({items:[],provenanceComplete:true,candidateCount:0,reasonCode:'NO_MATCH'}));
  const result=await runDomainAgent({session:makeSession(),agentCode:'FRAUD_CHANNEL',input:{...input,claims:[...input.claims]},model:{chooseTools:async()=>[{toolCode:'search_consumer_warning',input:{query:'합성 권유'}}],decide:async()=>output},impls:{search_consumer_warning:tool}});
  expect(result.status).toBe('SUCCEEDED');expect(tool).toHaveBeenCalledTimes(1);
 });
});

vi.mock('../tools',async()=>{const actual=await vi.importActual<typeof import('../tools')>('../tools');return {...actual,TOOL_IMPLS:{...actual.TOOL_IMPLS,search_consumer_warning:async()=>({items:[],provenanceComplete:false,candidateCount:0,errorCode:'WARNING_CORPUS_NOT_LOADED',reasonCode:'WARNING_CORPUS_NOT_LOADED'})}};});
vi.mock('../registry',()=>({loadManifest:async()=>({manifestId:'fixture',kbReleaseId:'fixture',agentIds:{},toolIds:{}})}));
it('AI-017 실패한 반대 근거 조회의 NONE_FOUND를 최종 독립 검토로 채택하지 않는다',async()=>{
 const {runVerification}=await import('../orchestrator');
 const result=await runVerification({ctx:makeSession(),claims:[...input.claims],maskedIntake:'',journeyStage:'PRE_TRANSACTION',
  agentModel:{
   chooseTools:async({input})=>input.agent_code==='RED_TEAM'?[{toolCode:'search_consumer_warning',input:{query:'합성 권유'}}]:[],
   decide:async({input})=>input.agent_code==='RED_TEAM'?{schema_version:'out-v1',results:[{claim_ref:'C1',status:'NONE_FOUND',evidence_refs:[],note_masked:'조회 실패'}]}:input.agent_code==='COVE'?{schema_version:'out-v1',results:[{claim_ref:'C1',status:'INCONCLUSIVE',evidence_refs:[],note_masked:'자료 없음'}]}:output,
  },judgeModel:{judge:async()=>({schema_version:'out-v1',claim_results:[{claim_ref:'C1',state:'UNKNOWN',evidence_refs:[],withheld_reason:'자료 없음',rationale_masked:'자료를 확인하지 못했다'}],conflicts:[]})}});
 expect(result.redTeam).toBeNull();expect(result.partial).toBe(true);
 expect(result.agentResults.find(r=>r.agentCode==='RED_TEAM')?.status).toBe('PARTIAL');
});

it('E-011·EC-015 모델 예산 거부 뒤에 다음 Agent와 Judge를 호출하지 않는다',async()=>{
 const {runVerification}=await import('../orchestrator');
 const chooseTools=vi.fn(async()=>{throw Object.assign(new Error('budget'),{code:'MODEL_BUDGET_BLOCKED'});});
 const decide=vi.fn(), judge=vi.fn();
 const result=await runVerification({ctx:makeSession(),claims:[...input.claims],maskedIntake:'',journeyStage:'PRE_TRANSACTION',agentModel:{chooseTools,decide},judgeModel:{judge}});
 expect(chooseTools).toHaveBeenCalledTimes(1);expect(decide).not.toHaveBeenCalled();expect(judge).not.toHaveBeenCalled();
 expect(result.judgeReasonCode).toBe('TOOL_BUDGET');expect(result.judgeOutput).toBeNull();expect(result.partial).toBe(true);
});
