import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {probeNetworkNamespace} from './file-safety-spike.mjs';
import {inspectFile} from './file-safety-inspector.mjs';
import {linesFromBoxes,observePage} from './ocr-quality-text.mjs';
export const FORMULA_VERSION='ocr-page-field-exact-v1';
export const FIXTURE_DIR='.github/fixtures/ocr-quality-v2';
// 이미 노출돼 실패로 끝난 첫 평가셋이다. 재사용 여부를 코드로 막으려고 경로만 남긴다.
export const EXPOSED_FIXTURE_DIR='.github/fixtures/ocr-quality-v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error(code);};
export function loadQualityFixtures(repository) {
 const manifest=JSON.parse(readFileSync(resolve(repository,FIXTURE_DIR,'manifest.json'),'utf8'));
 if(manifest.version!=='ocr-quality-v2'||manifest.synthetic_only!==true||manifest.documents!==32||manifest.pages!==112||manifest.fixtures?.length!==32)fail('FIXTURE_INVALID');
 // 산식과 합격선은 그대로 두고 표본만 바꾼다. 노출된 가족이 하나라도 섞이면 거부한다.
 if(manifest.previous_version!=='ocr-quality-v1'||!Array.isArray(manifest.reused_families)||manifest.reused_families.length!==0)fail('FIXTURE_PREREGISTRATION_INVALID');
 const exposed=JSON.parse(readFileSync(resolve(repository,EXPOSED_FIXTURE_DIR,'manifest.json'),'utf8'));
 const exposedFamilies=new Set(exposed.fixtures.map(f=>f.family));
 const seen=new Set();const kinds={text:0,image:0,digital:0,scanned:0};const shapes={tld:0,host:0};const families=new Set();let pages=0;
 for(const f of manifest.fixtures){
  if(!/^[a-z]+-(text\.txt|image\.png|digital\.pdf|scanned\.pdf)$/.test(f.path)||seen.has(f.path)||!(f.kind in kinds))fail('FIXTURE_PATH_INVALID');
  if(exposedFamilies.has(f.family))fail('FIXTURE_FAMILY_EXPOSED');
  if(!(f.url_shape in shapes))fail('FIXTURE_URL_SHAPE_INVALID');
  const bytes=readFileSync(resolve(repository,FIXTURE_DIR,f.path));seen.add(f.path);kinds[f.kind]++;pages+=f.pages.length;
  if(!families.has(f.family)){families.add(f.family);shapes[f.url_shape]++;}
  if(bytes.length!==f.bytes||bytes.length>10485760||hash(bytes)!==f.sha256||f.pages.length!==({text:1,image:1,digital:2,scanned:10})[f.kind])fail('FIXTURE_HASH_INVALID');
  for(const p of f.pages)if(!p.text||Object.keys(p.fields).sort().join(',')!=='institution,product,url')fail('FIXTURE_LABEL_INVALID');
  for(const p of f.pages)if(!/^https:\/\/([a-z]+\.example\/loan|www\.example\.com\/[a-z]+)$/.test(p.fields.url))fail('FIXTURE_URL_RESERVED_ONLY');
 }
 if(pages!==112||Object.values(kinds).some(n=>n!==8)||families.size!==8)fail('FIXTURE_COVERAGE_INVALID');
 if(shapes.tld!==manifest.url_shapes?.tld||shapes.host!==manifest.url_shapes?.host||shapes.tld!==4||shapes.host!==4)fail('FIXTURE_URL_SHAPE_MIX_INVALID');
 return manifest;
}
function parsePdf(repository, fixture, namespace) {
 const scripts=resolve(repository,'.github/scripts'), fixtures=resolve(repository,FIXTURE_DIR), parser=resolve(repository,'.github/fixtures/file-safety-parser');
 const args=['--permission',`--allow-fs-read=${fixtures}`,`--allow-fs-read=${scripts}`,`--allow-fs-read=${parser}/node_modules`,'--max-old-space-size=256','--import',resolve(scripts,'file-safety-guard.mjs'),resolve(scripts,'ocr-quality-worker.mjs'),resolve(fixtures,fixture.path),parser];
 const clean=['env','-i',`PATH=${process.env.PATH??'/usr/bin:/bin'}`,process.execPath,...args];
 const command=namespace.mode==='sudo'?'sudo':'unshare';
 const commandArgs=namespace.mode==='sudo'?['-n','unshare','--net','--','setpriv',`--reuid=${process.getuid()}`,`--regid=${process.getgid()}`,'--clear-groups',...clean]:['--map-root-user','--net','--',...clean];
 const r=spawnSync(command,commandArgs,{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 if(r.status!==0||r.error||r.signal)fail('PARSER_FAILED');let raw;try{raw=JSON.parse(r.stdout);}catch{fail('PARSER_RESPONSE_INVALID');}
 if(raw.parser_version!=='6.3.289'||raw.network_attempts!==0||raw.permission_model!==true||JSON.stringify(raw.environment_keys)!=='["PATH"]'||raw.pages?.length!==fixture.pages.length||raw.pages.some(p=>typeof p!=='string'||p.length>12000))fail('PARSER_ISOLATION_INVALID');
 return raw;
}
export function ocrPages(raw,requestId,fixture){
 if(raw?.version!=='V2'||raw.requestId!==requestId||raw.images?.length!==fixture.pages.length)fail('OCR_RESPONSE_INVALID');
 const pages=Array(fixture.pages.length).fill(null);
 for(const image of raw.images){
  const i=fixture.kind==='image'?0:image.convertedImageInfo?.pageIndex;
  if(!Number.isInteger(i)||i<0||i>=pages.length||pages[i]!==null||image.inferResult!=='SUCCESS'||!Array.isArray(image.fields)||image.fields.length===0||image.fields.length>15000)fail('OCR_PAGE_INVALID');
  const boxes=image.fields.map(field=>{
   const vertices=field.boundingPoly?.vertices;
   if(typeof field.inferText!=='string'||!field.inferText||field.inferText.length>12000||vertices?.length!==4||vertices.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)))fail('OCR_FIELD_INVALID');
   const xs=vertices.map(v=>v.x),ys=vertices.map(v=>v.y);
   return {text:field.inferText,x:Math.min(...xs),y:Math.min(...ys),height:Math.max(...ys)-Math.min(...ys)};
  });
  pages[i]=linesFromBoxes(boxes);
 }
 if(pages.some(p=>p===null))fail('OCR_PAGE_MISSING');return pages;
}
async function clova(bytes,fixture,{endpoint,secret}){
 const url=new URL(endpoint);
 if(!secret||url.protocol!=='https:'||!url.hostname.endsWith('.apigw.ntruss.com')||!url.pathname.endsWith('/general')||url.username||url.password||url.search||url.hash)fail('OCR_CONFIG_INVALID');
 const requestId=randomUUID();const r=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),headers:{'Content-Type':'application/json','X-OCR-SECRET':secret},body:JSON.stringify({version:'V2',requestId,timestamp:Date.now(),lang:'ko',enableTableDetection:false,images:[{format:fixture.kind==='image'?'png':'pdf',name:fixture.id,data:bytes.toString('base64')}]})});
 if(!r.ok||!r.body)fail(r.status===429?'OCR_RATE_LIMITED':'OCR_HTTP_FAILED');
 const reader=r.body.getReader();const chunks=[];let size=0;
 try{for(;;){const{value,done}=await reader.read();if(done)break;size+=value.length;if(size>4*1024*1024)fail('OCR_RESPONSE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel();}
 let raw;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('OCR_JSON_INVALID');}
 return ocrPages(raw,requestId,fixture);
}
export async function runOcrQualitySpike({repository,endpoint,secret}){
 const manifest=loadQualityFixtures(repository);const namespace=probeNetworkNamespace();if(!namespace.available)fail('PARSER_NAMESPACE_REQUIRED');
 const cases=[];
 for(const fixture of manifest.fixtures){
  const started=Date.now();const record={id:fixture.id,fixture_sha256:fixture.sha256,kind:fixture.kind,expected_pages:fixture.pages.length,status:'FAILED',error_code:null,elapsed_ms:0,ocr_calls:0,parser_calls:0,parser_version:null,parser_network_attempts:0,pages:[]};
  try{
   const bytes=readFileSync(resolve(repository,FIXTURE_DIR,fixture.path));let pages;
   if(fixture.kind==='text')pages=[bytes.toString('utf8')];
   else {
    const mime=fixture.kind==='image'?'image/png':'application/pdf';
    if(inspectFile({bytes,declaredMime:mime,filename:fixture.path}).verdict!=='ACCEPT')fail('FILE_REJECTED');
    if(fixture.kind!=='image'){
     record.parser_calls=1;const parsed=parsePdf(repository,fixture,namespace);record.parser_version=parsed.parser_version;pages=parsed.pages;
     if(fixture.kind==='digital'&&pages.some(p=>p.trim().length<10))fail('DIGITAL_TEXT_MISSING');
     if(fixture.kind==='scanned'&&pages.some(p=>p.trim().length!==0))fail('SCANNED_TEXT_PRESENT');
    }
    if(fixture.kind==='image'||fixture.kind==='scanned'){record.ocr_calls=1;pages=await clova(bytes,fixture,{endpoint,secret});}
   }
   record.pages=pages.map((text,index)=>({page_index:index,...observePage(text)}));record.status='RESPONSE_VALID';
  }catch(error){record.error_code=error?.name==='TimeoutError'||error?.name==='AbortError'?'OCR_TIMEOUT':/^[A-Z_]+$/.test(error?.message??'')?error.message:'OCR_TRANSPORT_UNKNOWN';}
  record.elapsed_ms=Date.now()-started;cases.push(record);
  if(record.ocr_calls)await delay(1100);
 }
 return {contract:{formula_version:FORMULA_VERSION,fixture_version:manifest.version,documents:32,pages:112,synthetic_only:true,table_detection:false,parser_namespace:namespace.mode},cases};
}
