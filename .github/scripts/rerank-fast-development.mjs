// 승인된 합성 개발 시험. Gate 채점/증거 생성·Provider 자동 재시도는 없다.
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { buildEmbedRequest, createEmbedPacer } from './provider-embed-spike.mjs';
import { documentRows, claimRows, corpusStatements } from './retrieval-corpus.mjs';
import { searchClaim, rerankCase, caseMetrics, percentile } from './retrieval-pipeline.mjs';
import { rerankFastCase } from './rerank-fast-development-ranking.mjs';
export const CAP = 50000, GLOBAL_CAP = 500000;
const sha = value => createHash('sha256').update(value).digest('hex');
const requireOk = (value, code) => { if (!value) throw new Error(code); };
export function createBudgetedCaller({ apiKey, save, globalUsage, fetchImpl = fetch }) {
  const ledger = [];
  const totals = () => ({ consumed: ledger.reduce((s,r)=>s+(r.actual??0),0), reserved: ledger.reduce((s,r)=>s+(r.actual===null?r.estimate:0),0) });
  return { ledger, totals, async call(endpoint, payload, estimate) {
    const local = totals(); const remote = await globalUsage();
    requireOk(Number.isSafeInteger(estimate) && estimate>0 && local.consumed+local.reserved+estimate<=CAP, 'DEVELOPMENT_BUDGET_EXCEEDED');
    requireOk(Number.isSafeInteger(remote)&&remote>=0&&remote+local.consumed+local.reserved+estimate<=GLOBAL_CAP,'GLOBAL_BUDGET_EXCEEDED');
    requireOk(!ledger.some(row=>row.actual===null), 'PREVIOUS_PROVIDER_RESULT_UNKNOWN');
    const row = { sequence: ledger.length+1, model: payload.model, estimate, actual:null, status:'RESERVED', started_at:new Date().toISOString() };
    ledger.push(row); save(ledger); // 원본 원장 flush 이후에만 네트워크로 보낸다.
    try {
      const started=performance.now();
      const response = await fetchImpl(`https://api.cohere.com/v2/${endpoint}`, { method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload) });
      row.http_status=response.status;
      if (!response.ok) {
        if ([400,401,403,404,413,422,429,498].includes(response.status)) {row.actual=0;row.status='REJECTED_NOT_BILLED';}
        throw new Error('PROVIDER_REJECTED');
      }
      requireOk(response.headers.get('content-type')?.includes('application/json'),'PROVIDER_RESPONSE_INVALID');
      const body = await response.json();
      const units=body?.meta?.billed_units?.[endpoint==='embed'?'input_tokens':'search_units'];
      requireOk(Number.isSafeInteger(units)&&units>=0,'PROVIDER_USAGE_UNKNOWN');
      row.units=units; row.actual=Math.ceil(units*(endpoint==='embed'?.12:2000));
      row.request_ref=sha(String(body.id??response.headers.get('x-request-id')??''));
      row.latency_ms=Math.round(performance.now()-started);row.status='SETTLED';save(ledger);
      requireOk(row.actual<=estimate,'PROVIDER_BILL_EXCEEDS_RESERVATION');
      return body;
    } catch(error) {if(row.actual===null)row.status='UNKNOWN_RESERVED';save(ledger);throw error;}
  }};
}
export async function run({root, sql, remote, apiKey, save, progress=()=>{}}) {
  requireOk(apiKey && apiKey!=='[SENSITIVE]','COHERE_KEY_MISSING');
  const fixtureBytes=readFileSync(resolve(root,'.github/fixtures/provider-embed-v5.json'));
  const fixture=JSON.parse(fixtureBytes),documents=documentRows(fixture),claims=claimRows(fixture).filter(c=>c.split==='development');
  requireOk(documents.length===240&&claims.length===20&&new Set(claims.map(c=>c.case_id)).size===4,'DEVELOPMENT_SPLIT_INVALID');
  requireOk(documents.every(d=>Buffer.byteLength(d.text)<=512)&&claims.every(c=>Buffer.byteLength(c.text)<=512),'FIXTURE_INPUT_TOO_LONG');
  const caller=createBudgetedCaller({apiKey,save,globalUsage:async()=>{
    const [r]=await remote`select coalesce(sum(consumed_microunits+reserved_microunits),0)::text as amount from private.usage_budget_counters where scope_type='GLOBAL_DAY' and provider<>'all' and period_start<=now() and period_end>now()`;
    return Number(r.amount);
  }});
  const pacer=createEmbedPacer(),vectors=new Map(),queryVectors=new Map();
  async function embed(texts,inputType) {
    await pacer.wait();
    const estimate=Math.ceil(texts.reduce((s,t)=>s+Buffer.byteLength(t)+128,0)*.12);
    const body=await caller.call('embed',buildEmbedRequest(texts,inputType),estimate);
    const v=body?.embeddings?.float;
    requireOk(Array.isArray(v)&&v.length===texts.length&&v.every(a=>Array.isArray(a)&&a.length===1024&&a.every(Number.isFinite)&&a.some(x=>x!==0)),'EMBED_VECTOR_INVALID');return v;
  }
  for(let offset=0;offset<documents.length;offset+=96){const batch=documents.slice(offset,offset+96),v=await embed(batch.map(d=>d.text),'search_document');batch.forEach((d,i)=>vectors.set(d.evidence_unit,v[i]));}
  const {releaseId,manifestId,statements}=corpusStatements({fixture,documents,embeddings:vectors,embeddingModel:'embed-v4.0',embeddingVersion:'1',dimension:1024});
  await sql.unsafe(statements.join('\n')).simple();
  for(const claim of claims)queryVectors.set(claim.key,(await embed([claim.text],'search_query'))[0]);
  const provenance=new Map(documents.map(d=>[d.snapshot_id,{unit:d.evidence_unit,fingerprint:d.source_fingerprint,authority_level:d.authority_level,effective_from:d.effective_from}]));
  const textBySnapshot=new Map(documents.map(d=>[d.snapshot_id,d.text])),byCase=new Map(),samples=[];
  for(const claim of claims){
    const rows=await searchClaim({sql,manifestId,claim,embedding:queryVectors.get(claim.key)});
    requireOk(rows.length>0&&rows.length<=40,'CANDIDATE_POOL_INVALID');
    await pacer.wait();
    const body=await caller.call('rerank',{model:'rerank-v4.0-fast',query:claim.text,documents:rows.map(r=>textBySnapshot.get(r.source_snapshot_id)),top_n:rows.length,max_tokens_per_doc:4096},2000);
    requireOk(Array.isArray(body.results)&&body.results.length===rows.length&&new Set(body.results.map(r=>r.index)).size===rows.length,'FAST_RESULT_INVALID');
    for(const r of body.results){requireOk(Number.isInteger(r.index)&&r.index>=0&&r.index<rows.length&&Number.isFinite(r.relevance_score)&&r.relevance_score>=0&&r.relevance_score<=1,'FAST_RESULT_INVALID');rows[r.index].fast_score=r.relevance_score;}
    const bucket=byCase.get(claim.case_id)??[];bucket.push({claim,rows});byCase.set(claim.case_id,bucket);
    samples.push({claim_key:claim.key,candidates:rows.map(r=>({unit:provenance.get(r.source_snapshot_id).unit,fast_score:r.fast_score,keyword_rank:r.keyword_rank,vector_distance:r.vector_distance,matched_by:r.matched_by}))});progress(samples.length);
  }
  const cases=[...byCase].map(([id,claimResults])=>{
    const relevantUnits=new Set(claimResults.flatMap(r=>r.claim.relevant_units)),criticalUnits=new Set(claimResults.flatMap(r=>r.claim.critical_units));
    const baseline=rerankCase({claimResults,provenance}),fast=rerankFastCase({claimResults,provenance});
    return {case_id:id,baseline:{...caseMetrics({relevantUnits,criticalUnits,top:baseline.top}),top_units:baseline.top.map(r=>r.unit)},fast:{...caseMetrics({relevantUnits,criticalUnits,top:fast.top}),top_units:fast.top.map(r=>r.unit),collapsed:fast.collapsed}};
  });
  const latency=caller.ledger.filter(r=>r.model==='rerank-v4.0-fast').map(r=>r.latency_ms);
  return {classification:'DEVELOPMENT_ONLY_NOT_GATE_EVIDENCE',code_sha:process.env.GITHUB_SHA,fixture_sha256:sha(fixtureBytes),split:'development',claims:20,release_id:releaseId,formula:'fast-relevance-060-authority-025-freshness-015-case-seat-v1',cases,samples,ledger:caller.ledger,usage:caller.totals(),fast_p95_ms:percentile(latency,.95)};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const root=process.env.TRUSTED_REPOSITORY??process.cwd(), output=process.env.PROBE_OUTPUT_PATH;
  requireOk(output&&process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_RUN_ATTEMPT==='1','TRUSTED_FIRST_ATTEMPT_REQUIRED');
  mkdirSync(dirname(output),{recursive:true});const fd=openSync(`${output}.ledger.jsonl`,'wx',0o600);
  const save=ledger=>{writeSync(fd,JSON.stringify({at:new Date().toISOString(),ledger})+'\n');fsyncSync(fd);};
  const sql=postgres(process.env.RETRIEVAL_DATABASE_URL,{max:1,onnotice:()=>{}}),remote=postgres(process.env.FINSHIELD_DATABASE_URL,{max:1,prepare:false,onnotice:()=>{}});
  let code=0;
  try{const result=await run({root,sql,remote,apiKey:process.env.COHERE_API_KEY,save,progress:n=>console.log(`개발 Claim ${n}/20`)});const out=openSync(output,'wx',0o600);writeSync(out,JSON.stringify(result,null,2));fsyncSync(out);closeSync(out);console.log(JSON.stringify({classification:result.classification,cases:result.cases,usage:result.usage,fast_p95_ms:result.fast_p95_ms}));}
  catch(e){console.error(`합성 Fast 시험 중단: ${/^[A-Z_]+$/.test(e.message??'')?e.message:'HARNESS_OR_PROVIDER_FAILURE'}`);code=1;}
  finally{closeSync(fd);await Promise.all([sql.end(),remote.end()]);}process.exitCode=code;
}
