import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadQualityFixtures,ocrPages,EXPOSED_FIXTURE_DIR} from './ocr-quality-spike.mjs';
import {observePage,counts,linesFromBoxes} from './ocr-quality-text.mjs';
import {validateOcrEvidenceResult} from './ocr-evidence-policy.mjs';
const manifest=loadQualityFixtures(process.cwd());
const base={observations:{contract:{formula_version:'ocr-page-field-exact-v1',fixture_version:manifest.version,documents:32,pages:112,synthetic_only:true,table_detection:false,parser_namespace:'userns'},cases:manifest.fixtures.map(f=>({id:f.id,fixture_sha256:f.sha256,kind:f.kind,expected_pages:f.pages.length,status:'RESPONSE_VALID',error_code:null,elapsed_ms:1000,ocr_calls:['image','scanned'].includes(f.kind)?1:0,parser_calls:['digital','scanned'].includes(f.kind)?1:0,parser_version:['digital','scanned'].includes(f.kind)?'6.3.289':null,parser_network_attempts:0,pages:f.pages.map((p,i)=>({page_index:i,...observePage(p.text)}))}))}};
const validate=r=>{const errors=[];const metrics=validateOcrEvidenceResult(r,e=>errors.push(e),{manifest});return {errors,metrics};};
assert.deepEqual(validate(base).errors,[]);assert.equal(validate(base).metrics.field_f1,1);
const mutations=[r=>r.observations.cases[2].parser_version='6.0.0',r=>r.observations.cases.pop(),r=>r.observations.cases.reverse(),r=>r.observations.contract.documents=31,r=>r.observations.contract.pages=100,r=>r.observations.contract.parser_namespace='none',r=>r.observations.contract.synthetic_only=false,r=>r.observations.contract.table_detection=true,r=>r.observations.cases[0].fixture_sha256='0'.repeat(64),r=>r.observations.cases[0].pages.pop(),r=>r.observations.cases[0].pages[0].page_index=1,r=>r.observations.cases[0].pages[0].numeric_hashes.pop(),r=>r.observations.cases[0].pages[0].negation_hashes.pop(),r=>r.observations.cases[0].pages[0].numeric_hashes.push('0'.repeat(64)),r=>r.observations.cases[3].elapsed_ms=35001,r=>r.observations.cases[3].parser_network_attempts=1,r=>r.observations.cases[3].ocr_calls=0,r=>r.observations.cases[2].parser_calls=0,r=>r.observations.cases[0].ocr_calls=1,r=>r.observations.cases[0].error_code='unknown raw text',r=>r.observations.cases[0].pages[0].numeric_hashes=['not-a-hash'],r=>{r.observations.cases[3].status='FAILED';r.observations.cases[3].pages=[];r.observations.cases[3].error_code='OCR_TIMEOUT';},r=>{for(const c of r.observations.cases)c.pages.forEach(p=>p.field_hashes=[]);},r=>r.observations.cases[0].pages[0].raw_text='원문 금지'];
for(const mutate of mutations){const r=structuredClone(base);mutate(r);assert.ok(validate(r).errors.length>0);}
const swapped=structuredClone(base);const f=manifest.fixtures[0];swapped.observations.cases[0].pages[0]={page_index:0,...observePage(f.pages[0].text.replace('연 금리:', '임시 금리:').replace('보증료율:', '연 금리:').replace('임시 금리:', '보증료율:'))};assert.ok(validate(swapped).errors.length>0);
// 사전등록 계약: 노출된 v1 가족을 재사용하지 않고 주소 형태를 4대4로 고정한다.
const exposed=new Set(JSON.parse(readFileSync(resolve(process.cwd(),EXPOSED_FIXTURE_DIR,'manifest.json'),'utf8')).fixtures.map(f=>f.family));
const v2Families=new Set(manifest.fixtures.map(f=>f.family));
assert.equal(v2Families.size,8);
assert.equal([...v2Families].filter(name=>exposed.has(name)).length,0);
assert.deepEqual(manifest.url_shapes,{tld:4,host:4});
assert.equal(manifest.reused_families.length,0);
for(const fixture of manifest.fixtures)for(const page of fixture.pages)assert.match(page.fields.url,/^https:\/\/([a-z]+\.example\/loan|www\.example\.com\/[a-z]+)$/);
assert.deepEqual(counts(['a','a'],['a','b']),{expected:2,predicted:2,tp:1,fp:1,fn:1});
assert.equal(linesFromBoxes([{text:'은행',x:50,y:10,height:10},{text:'기관:',x:0,y:11,height:10}]),'기관: 은행');
assert.throws(()=>ocrPages({version:'V2',requestId:'id',images:[]},'id',manifest.fixtures[1]));
console.log(`OCR 합성 32문서·112쪽 계약과 ${mutations.length+1}개 원장 변조 거부를 확인했다.`);
