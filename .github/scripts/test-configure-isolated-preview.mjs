import assert from 'node:assert/strict';
import {configuration,configurePreview,PROJECT,TEAM,BRANCH,SECRET_NAMES} from './configure-isolated-preview.mjs';
const env={GITHUB_REF:'refs/heads/main',CONFIRM:'configure-isolated-preview',VERCEL_TOKEN:'synthetic',...Object.fromEntries(SECRET_NAMES.map(key=>[key,'synthetic'])),FINSHIELD_DATABASE_URL:'postgres://finshield_worker.exarejrwvjochjdminzo:synthetic@pooler.example:6543/postgres',CLOVA_OCR_INVOKE_URL:'https://fixture.apigw.ntruss.com/example/general'};
let cases=0;
for(const bad of [{GITHUB_REF:'refs/heads/feature'},{CONFIRM:'production'},{CLOVA_OCR_SECRET:''},{FINSHIELD_DATABASE_URL:'postgres://postgres:synthetic@localhost:5432/test'},{CLOVA_OCR_INVOKE_URL:'https://example.org/general'}]){assert.throws(()=>configuration({...env,...bad}));cases++;}
const payload=configuration(env);assert(payload.every(row=>row.gitBranch===BRANCH&&row.target.length===1&&row.target[0]==='preview'));assert(payload.filter(row=>SECRET_NAMES.includes(row.key)).every(row=>row.type==='sensitive'&&row.visibility==='secret'));cases+=2;
for(const project of [{id:'wrong'},{id:PROJECT,name:'finshield',accountId:TEAM,ssoProtection:null}]){let calls=0;await assert.rejects(()=>configurePreview(env,async()=>{calls++;return Response.json(project)}));assert.equal(calls,1);cases++;}
let calls=0;
const result=await configurePreview(env,async(url,opts)=>{calls++;if(calls===1)return Response.json({id:PROJECT,name:'finshield',accountId:TEAM,ssoProtection:{deploymentType:'all_except_custom_domains'}});if(calls===3)return Response.json({envs:payload});assert.equal(new URL(url).pathname,`/v10/projects/${PROJECT}/env`);assert.deepEqual(JSON.parse(opts.body),payload);return Response.json({created:payload.map(({key})=>({key}))});});
assert.equal(result.file_gateway_enabled,false);assert.equal(calls,3);cases++;
console.log(`격리 Preview 설정 계약 ${cases}건을 통과했습니다.`);
