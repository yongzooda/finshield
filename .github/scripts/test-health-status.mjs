import assert from 'node:assert/strict';
import { createProviderStatusCache, checkHealth, healthHttpStatus, CACHE_TTL_MS, PROVIDERS } from '../../src/lib/finshield/health-status.mjs';
let time=1_800_000_000_000; const cache=createProviderStatusCache(()=>time);
assert.ok(cache.snapshot().every(p=>p.status==='unknown'&&p.cache_state==='unobserved'));
for(const provider of PROVIDERS)cache.observe(provider,true);
assert.ok(cache.snapshot().every(p=>p.status==='available'));
time+=CACHE_TTL_MS-1;assert.ok(cache.snapshot().every(p=>p.status==='available'));
time++;assert.ok(cache.snapshot().every(p=>p.status==='unknown'&&p.cache_state==='expired'));
cache.observe('clova',false);assert.equal(cache.snapshot().find(p=>p.provider==='clova').status,'unavailable');
time--;assert.equal(cache.snapshot().find(p=>p.provider==='clova').status,'unknown');
assert.throws(()=>cache.observe('unknown-provider',true));assert.throws(()=>cache.observe('clova','true'));
let network=0,db=0;const original=globalThis.fetch;
globalThis.fetch=()=>{network++;throw new Error('외부 Provider 전송 금지');};
try {
 const rows=await Promise.all(Array.from({length:100},async()=>{
  const report=await checkHealth({cache,databaseCheck:async()=>{db++;}});
  assert.equal(healthHttpStatus(report),200);assert.equal(healthHttpStatus(report,true),503);
  return report;
 }));
 assert.equal(db,100);assert.equal(network,0);assert.equal(rows.length,100);
 const failed=await checkHealth({cache,databaseCheck:async()=>{throw new Error('합성 비밀 URL과 진술');}});
 assert.equal(healthHttpStatus(failed),503);assert.equal(healthHttpStatus(failed,true),503);
 assert.equal(JSON.stringify(failed).includes('비밀'),false);
 let aborted=false;
 const timeout=await checkHealth({cache,timeoutMs:5,databaseCheck:signal=>new Promise((_,reject)=>{
  signal.addEventListener('abort',()=>{aborted=true;reject(new Error('합성 시간 초과'));},{once:true});
 })});
 assert.equal(healthHttpStatus(timeout),503);assert.equal(timeout.checks[0].detail,'TIMEOUT');assert.equal(aborted,true);
 for(const provider of PROVIDERS)cache.observe(provider,true);
 const ready=await checkHealth({cache,databaseCheck:async()=>{}});
 assert.equal(healthHttpStatus(ready,true),200);assert.equal(network,0);
}finally{globalThis.fetch=original;}
console.log('Health 계약 통과: 요청 100회·외부 전송 0회·DB 오류와 시간 초과·Cache 만료·엄격 모드');
