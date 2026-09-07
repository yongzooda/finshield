import {FORMULA_VERSION,loadQualityFixtures} from './ocr-quality-spike.mjs';
import {fileURLToPath} from 'node:url';
import {counts,expectedPage} from './ocr-quality-text.mjs';
export {FORMULA_VERSION};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify([...keys].sort());
const hashes=v=>Array.isArray(v)&&v.length<=1000&&v.every(x=>/^[a-f0-9]{64}$/.test(x));
const CASE=['id','fixture_sha256','kind','expected_pages','status','error_code','elapsed_ms','ocr_calls','parser_calls','parser_version','parser_network_attempts','pages'];
const PAGE=['page_index','text_sha256','numeric_hashes','negation_hashes','field_hashes'];
export function validateOcrEvidenceResult(result,fail,{manifest}={}){
 if(!manifest)manifest=loadQualityFixtures(fileURLToPath(new URL('../../',import.meta.url)));
 const o=result?.observations;
 if(!manifest||!exact(o,['contract','cases'])){fail('OCR 관측 또는 사전 고정 정답이 없습니다.');return;}
 const c=o.contract;
 if(!exact(c,['formula_version','fixture_version','documents','pages','synthetic_only','table_detection','parser_namespace'])||c.formula_version!==FORMULA_VERSION||c.fixture_version!==manifest.version||c.documents!==32||c.pages!==112||c.synthetic_only!==true||c.table_detection!==false||!['userns','sudo'].includes(c.parser_namespace))fail('OCR 표본·산식·격리 계약이 다릅니다.');
 if(!Array.isArray(o.cases)||o.cases.length!==manifest.fixtures.length){fail('OCR 문서 표본이 누락됐습니다.');return;}
 let supported=0;let expectedTotal=0;const numeric={tp:0,fp:0,fn:0},negation={tp:0,fp:0,fn:0},fields={tp:0,fp:0,fn:0};const latencies=[];
 for(const[fIndex,f]of manifest.fixtures.entries()){
  const r=o.cases[fIndex];expectedTotal+=f.pages.length;
  if(!exact(r,CASE)||r.id!==f.id||r.fixture_sha256!==f.sha256||r.kind!==f.kind||r.expected_pages!==f.pages.length){fail('OCR 문서·순서·내용 hash가 다릅니다.');continue;}
  if(!Number.isInteger(r.elapsed_ms)||r.elapsed_ms<0)fail('OCR 문서 지연 원장이 유효하지 않습니다.');
  if(f.kind==='scanned')latencies.push(r.elapsed_ms);
  if(r.parser_network_attempts!==0||r.parser_calls!==(['digital','scanned'].includes(f.kind)?1:0))fail('Parser 실행 또는 외부 통신 경계가 다릅니다.');
  if((r.parser_calls===0 && r.parser_version!==null)||(r.parser_calls===1 && r.status==='RESPONSE_VALID' && r.parser_version!=='6.3.289'))fail('실제 Parser 버전이 고정 계약과 다릅니다.');
  if(r.ocr_calls!==(['image','scanned'].includes(f.kind)?1:0))fail('OCR 경로를 생략하거나 불필요한 호출을 했습니다.');
  if(!Array.isArray(r.pages)){fail('페이지 원장이 없습니다.');continue;}
  if(r.status==='FAILED'){
   if(r.pages.length!==0||!/^[A-Z_]+$/.test(r.error_code??''))fail('문서 실패를 부분 성공으로 숨겼습니다.');
   continue;
  }
  if(r.status!=='RESPONSE_VALID'||r.error_code!==null||r.pages.length!==f.pages.length){fail('지원 페이지 응답 또는 실패 원장이 다릅니다.');continue;}
  for(const[i,p]of r.pages.entries()){
   if(!exact(p,PAGE)||p.page_index!==i||!/^[a-f0-9]{64}$/.test(p.text_sha256??'')||!hashes(p.numeric_hashes)||!hashes(p.negation_hashes)||!hashes(p.field_hashes)){fail('OCR 페이지 token hash 원장이 유효하지 않습니다.');continue;}
   supported++;const e=expectedPage(f.pages[i]);
   for(const[key,total]of [['numeric_hashes',numeric],['negation_hashes',negation],['field_hashes',fields]]){const n=counts(e[key],p[key]);for(const name of ['tp','fp','fn'])total[name]+=n[name];}
  }
 }
 if(expectedTotal!==112||supported/expectedTotal<.95)fail('지원 페이지 성공률이 0.95 미만입니다.');
 if(numeric.tp===0||numeric.fp||numeric.fn)fail('숫자·금리·단위·필드 위치 exact가 100% 미만입니다.');
 if(negation.tp===0||negation.fp||negation.fn)fail('부정 표현 exact가 100% 미만입니다.');
 const f1=2*fields.tp/(2*fields.tp+fields.fp+fields.fn);
 if(!Number.isFinite(f1)||f1<.98)fail('기관·상품·URL field F1이 0.98 미만입니다.');
 const p95=[...latencies].sort((a,b)=>a-b)[Math.ceil(latencies.length*.95)-1];
 if(latencies.length!==8||!Number.isInteger(p95)||p95>35000)fail('10쪽 8문서의 P95가 35초를 초과했습니다.');
 return {documents:manifest.fixtures.length,expected_pages:expectedTotal,supported_pages:supported,supported_page_rate:supported/expectedTotal,numeric,negation,fields,field_f1:f1,ten_page_p95_ms:p95};
}
