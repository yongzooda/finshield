import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import YAML from 'yaml';
const pr=process.argv[2];
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const metadata=JSON.parse(execFileSync('gh',['api',`repos/yongzooda/finshield/pulls/${pr}`],{encoding:'utf8'}));
const token=execFileSync('gh',['auth','token'],{encoding:'utf8'}).trim();
const eventPath=`/tmp/finshield-local-pr-${pr}.json`;
writeFileSync(eventPath,JSON.stringify({pull_request:metadata}));
const config=YAML.parse(readFileSync('.github/workflows/pr-check.yml','utf8'));
const env={...process.env,...Object.fromEntries(Object.entries(config.jobs.check.env).map(([k,v])=>[k,String(v)])),GITHUB_TOKEN:token,GH_TOKEN:token,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:'yongzooda/finshield',GITHUB_EVENT_PATH:eventPath,GITHUB_SHA:head,VALIDATION_HEAD_SHA:head,VALIDATION_PR_NUMBER:pr,HEAD_SHA:metadata.head.sha,REPOSITORY:'yongzooda/finshield'};
for(const step of config.jobs.check.steps){
 if(!step.run)continue;
 console.log(`검사 시작: ${step.name??step.run}`);
 const r=spawnSync('bash',['-e','-c',step.run],{env,stdio:'inherit'});
 if(r.status!==0){console.error(`검사 실패: ${step.name??step.run}`);process.exit(r.status??1);}
}
console.log(`로컬에서 필수 검사 전체 통과: PR ${pr}, merge candidate ${head}`);
