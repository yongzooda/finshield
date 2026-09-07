import assert from 'node:assert/strict';
import {FORMULA_VERSION,validateHealthEvidenceResult} from './health-evidence-policy.mjs';
const row=i=>({sequence:i,strict:false,response_shape_valid:true,http_status:200,status:'degraded',db_ok:true,db_detail:null,provider_statuses:Array(4).fill('unknown'),observed_times:Array(4).fill(null),elapsed_ms:10});
const valid={observations:{contract:{formula_version:FORMULA_VERSION,requests:100,path:'/api/health',real_next_route:true,provider_network:'blocked-and-counted'},
 requests:Array.from({length:100},(_,i)=>row(i+1)),faults:[1,2].map((i)=>({...row(i),strict:i===2,http_status:503,status:'down',db_ok:false,db_detail:'UNAVAILABLE'})),
 network:{normal:{processes:1,fetch:0,http:0,https:0},fault:{processes:1,fetch:0,http:0,https:0},control:{processes:1,fetch:1,http:1,https:1}},cache_states:['unknown','available','unknown','unavailable','unknown']}};
const check=v=>{const e=[];validateHealthEvidenceResult(v,m=>e.push(m));return e;};
assert.deepEqual(check(valid),[]);
const mutations=[
 v=>v.observations.requests[0].response_shape_valid=false,
 v=>v.observations.requests.pop(),v=>v.observations.requests.push(row(101)),v=>v.observations.requests[1].sequence=1,
 v=>v.observations.requests[0].db_ok=false,v=>v.observations.requests[0].http_status=503,
 v=>v.observations.requests[0].provider_statuses[0]='available',v=>v.observations.requests[0].observed_times[0]='2026-09-07T00:00:00Z',
 v=>v.observations.requests[0].elapsed_ms=-1,v=>v.observations.faults.pop(),v=>v.observations.faults[0].http_status=200,
 v=>v.observations.faults[1].strict=false,v=>v.observations.faults[0].db_detail='합성 원문',
 v=>v.observations.network.normal.fetch=1,v=>v.observations.network.normal.http=1,v=>v.observations.network.fault.https=1,
 v=>v.observations.network.normal.processes=0,v=>v.observations.network.control.fetch=0,v=>v.observations.network.control.http=0,
 v=>v.observations.network.control.https=0,v=>v.observations.cache_states[2]='available',
 v=>v.observations.contract.real_next_route=false,v=>v.observations.contract.requests=99,
 v=>v.observations.requests[0].secret='합성 금지 필드',v=>v.observations.extra=true,
];
for(const mutate of mutations){const copy=structuredClone(valid);mutate(copy);assert.ok(check(copy).length>0);}
console.log(`Health 증거 정책 통과: 합격 원장 1건·변조 거부 ${mutations.length}건`);
