// ADR 15.1의 Health 표본과 외부 전송·DB 장애 조건을 결과 원장에서 재계산한다.
import {FORMULA_VERSION,REQUIRED_REQUESTS,HEALTH_PATH} from './health-spike.mjs';
export {FORMULA_VERSION};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify([...keys].sort());
const ROW=['sequence','strict','response_shape_valid','http_status','status','db_ok','db_detail','provider_statuses','observed_times','elapsed_ms'];
export function validateHealthEvidenceResult(result,fail){
 const o=result?.observations;
 if(!exact(o,['contract','requests','faults','network','cache_states'])){fail('Health 관측 필드가 계약과 다릅니다.');return;}
 const c=o.contract;
 if(!exact(c,['formula_version','requests','path','real_next_route','provider_network'])||c.formula_version!==FORMULA_VERSION||c.requests!==REQUIRED_REQUESTS||c.path!==HEALTH_PATH||c.real_next_route!==true||c.provider_network!=='blocked-and-counted')fail('실제 Next Route·100회·전송 계측 계약이 다릅니다.');
 if(!Array.isArray(o.requests)||o.requests.length!==REQUIRED_REQUESTS)fail('Health 요청은 정확히 100건이어야 합니다.');
 for(const [i,r]of (Array.isArray(o.requests)?o.requests:[]).entries()){
  if(!exact(r,ROW)||r.response_shape_valid!==true||r.sequence!==i+1||r.strict!==false||r.http_status!==200||r.status!=='degraded'||r.db_ok!==true||r.db_detail!==null)fail('정상 DB 요청의 원장·순서·HTTP 상태가 다릅니다.');
  if(JSON.stringify(r.provider_statuses)!==JSON.stringify(Array(4).fill('unknown'))||JSON.stringify(r.observed_times)!==JSON.stringify(Array(4).fill(null)))fail('미관측 Provider를 정상 또는 최근 관측으로 표시했습니다.');
  if(!Number.isInteger(r.elapsed_ms)||r.elapsed_ms<0)fail('Health 소요 시간이 유효하지 않습니다.');
 }
 if(!Array.isArray(o.faults)||o.faults.length!==2)fail('DB 장애는 기본·엄격 모드 두 경로로 측정해야 합니다.');
 for(const [i,r]of (Array.isArray(o.faults)?o.faults:[]).entries()){
  if(!exact(r,ROW)||r.response_shape_valid!==true||r.sequence!==i+1||r.strict!==(i===1)||r.http_status!==503||r.status!=='down'||r.db_ok!==false||!['TIMEOUT','UNAVAILABLE'].includes(r.db_detail))fail('DB 장애를 정상 HTTP로 표현했거나 오류 원장을 잃었습니다.');
  if(JSON.stringify(r.provider_statuses)!==JSON.stringify(Array(4).fill('unknown'))||JSON.stringify(r.observed_times)!==JSON.stringify(Array(4).fill(null)))fail('DB 장애에서 Provider 조회 상태를 만들어서는 안 됩니다.');
  if(!Number.isInteger(r.elapsed_ms)||r.elapsed_ms<0)fail('DB 장애 소요 시간이 유효하지 않습니다.');
 }
 if(!exact(o.network,['normal','fault','control']))fail('HTTP 전송 계측 그룹이 다릅니다.');
 for(const name of ['normal','fault','control']){
  const n=o.network?.[name];
  if(!exact(n,['processes','fetch','http','https'])||!Number.isInteger(n.processes)||n.processes<1){fail('계측 preload 실행 기록이 없습니다.');continue;}
  for(const key of ['fetch','http','https'])if(n[key] !== (name==='control'?1:0))fail(name==='control'?'계측기가 전송 시도를 검출하지 못했습니다.':'Health가 외부 HTTP 전송을 시도했습니다.');
 }
 if(JSON.stringify(o.cache_states)!==JSON.stringify(['unknown','available','unknown','unavailable','unknown']))fail('미관측·정상·만료·실패·시계 역행 Cache 상태가 다릅니다.');
}
