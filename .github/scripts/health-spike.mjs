import {spawn} from 'node:child_process';
import {mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {CACHE_TTL_MS,createProviderStatusCache,PROVIDERS} from '../../src/lib/finshield/health-status.mjs';

export const FORMULA_VERSION='health-no-provider-http-v1';
export const REQUIRED_REQUESTS=100;
export const HEALTH_PATH='/api/health';
const sumAudit=directory=>{
 const files=readdirSync(directory).filter(p=>p.startsWith('network-')&&p.endsWith('.json'));
 const totals={processes:files.length,fetch:0,http:0,https:0};
 for(const file of files){const row=JSON.parse(readFileSync(join(directory,file),'utf8'));for(const key of ['fetch','http','https'])totals[key]+=row[key];}
 return totals;
};
const freePort=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const stop=async child=>{
 if(child.exitCode!==null||child.signalCode!==null||!child.pid)return;
 const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');
 await Promise.race([exited,delay(2500)]);if(child.exitCode===null)child.kill('SIGKILL');await exited;
};
async function nextServer({repository,dsn,audit,port}) {
 const child=spawn(process.execPath,['--import',join(repository,'.github/scripts/health-network-audit.mjs'),join(repository,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
  cwd:repository,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'',HEALTH_AUDIT_DIRECTORY:audit,FINSHIELD_DATABASE_URL:dsn},stdio:'ignore'});
 child.on('error',()=>{});
 const base=`http://127.0.0.1:${port}`;
 try {
  for(let i=0;i<80;i++){
   if(child.exitCode!==null)throw new Error('HEALTH_SERVER_EXITED');
   const r=await fetch(base+'/api/runtime-manifest',{signal:AbortSignal.timeout(500)}).catch(()=>null);
   if(r?.ok)return {child,base};await delay(100);
  }
  throw new Error('HEALTH_SERVER_START_TIMEOUT');
 }catch(e){await stop(child);throw e;}
}
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify([...keys].sort());
async function measure(base,sequence,strict=false){
 const started=performance.now();const r=await fetch(base+HEALTH_PATH+(strict?'?strict=1':''),{signal:AbortSignal.timeout(5000)});
 const b=await r.json();
 const shape=exact(b,['status','checks','providers','checkedAt'])&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(b.checkedAt)
  &&Array.isArray(b.checks)&&b.checks.length===1&&exact(b.checks[0],b.checks[0].ok?['name','ok','ms']:['name','ok','ms','detail'])
  &&Array.isArray(b.providers)&&b.providers.length===4&&b.providers.every((p,i)=>exact(p,['provider','status','observed_at','cache_state'])&&p.provider===PROVIDERS[i]&&p.cache_state==='unobserved');
 return {sequence,strict,response_shape_valid:Boolean(shape),http_status:r.status,status:b.status,db_ok:b.checks?.length===1&&b.checks[0].name==='db'?b.checks[0].ok:null,
  db_detail:b.checks?.[0]?.detail??null,provider_statuses:b.providers?.map(p=>p.status)??[],
  observed_times:b.providers?.map(p=>p.observed_at)??[],elapsed_ms:Math.round(performance.now()-started)};
}
export async function runHealthSpike({repository,dsn}){
 const url=new URL(dsn);
 if(!['localhost','127.0.0.1'].includes(url.hostname)&&!(url.hostname.endsWith('.pooler.supabase.com')&&url.username==='finshield_worker.exarejrwvjochjdminzo'))throw new Error('FINSHIELD_HEALTH_DATABASE_ONLY');
 const directory=mkdtempSync(join(tmpdir(),'finshield-health-'));const normal=join(directory,'normal'),fault=join(directory,'fault'),control=join(directory,'control');
 const {mkdirSync}=await import('node:fs');for(const p of [normal,fault,control])mkdirSync(p);
 let healthy,broken;
 try {
  const observer=spawn(process.execPath,['--import',join(repository,'.github/scripts/health-network-audit.mjs'),'--input-type=module','--eval',
   "import {request as httpRequest} from 'node:http';import {request as httpsRequest} from 'node:https';for(const call of [()=>fetch('https://example.invalid'),()=>httpRequest('http://example.invalid'),()=>httpsRequest('https://example.invalid')]){try{await call();}catch{}}"],
   {env:{...process.env,HEALTH_AUDIT_DIRECTORY:control},stdio:'ignore'});
  await new Promise((resolve,reject)=>{observer.once('error',reject);observer.once('exit',code=>code===0?resolve():reject(new Error('HEALTH_OBSERVER_FAILED')));});
  healthy=await nextServer({repository,dsn,audit:normal,port:await freePort()});
  const requests=[];for(let i=1;i<=REQUIRED_REQUESTS;i++)requests.push(await measure(healthy.base,i));
  await stop(healthy.child);
  const refusedPort=await freePort();
  broken=await nextServer({repository,dsn:`postgres://health_fixture:fixture@127.0.0.1:${refusedPort}/health`,audit:fault,port:await freePort()});
  const faults=[await measure(broken.base,1),await measure(broken.base,2,true)];await stop(broken.child);
  let clock=1_800_000_000_000;const cache=createProviderStatusCache(()=>clock);
  const read=()=>cache.snapshot().find(p=>p.provider==='clova').status;
  const cacheStates=[read()];cache.observe('clova',true);cacheStates.push(read());clock+=CACHE_TTL_MS;cacheStates.push(read());cache.observe('clova',false);cacheStates.push(read());clock--;cacheStates.push(read());
  return {contract:{formula_version:FORMULA_VERSION,requests:REQUIRED_REQUESTS,path:HEALTH_PATH,real_next_route:true,provider_network:'blocked-and-counted'},
   requests,faults,network:{normal:sumAudit(normal),fault:sumAudit(fault),control:sumAudit(control)},cache_states:cacheStates};
 }finally{
  if(healthy)await stop(healthy.child);if(broken)await stop(broken.child);rmSync(directory,{recursive:true,force:true});
 }
}
