// N-QLT-010: 고정된 FinShield 실험 브랜치에만 서버 연결을 준비한다.
// 값·응답 본문·서버 오류를 출력하지 않고 Production과 공유 Preview 설정을 건드리지 않는다.
import { pathToFileURL } from 'node:url';
export const PROJECT = 'prj_aBYCkjjqdix6jKB14gQPtqtBoeOQ';
export const TEAM = 'team_ey0VM6Dm21aC2HUDWs37dPjs';
export const BRANCH = 'codex/p0-audit-contract-spike';
export const SECRET_NAMES = ['ANTHROPIC_API_KEY','FINSHIELD_DATABASE_URL','SUPABASE_SECRET_KEY','CLOVA_OCR_INVOKE_URL','CLOVA_OCR_SECRET'];
export function configuration(env) {
  if (env.GITHUB_REF !== 'refs/heads/main' || env.CONFIRM !== 'configure-isolated-preview') throw new Error('PREVIEW_CONTEXT_REJECTED');
  if (!env.VERCEL_TOKEN || SECRET_NAMES.some(name => !env[name])) throw new Error('PREVIEW_CREDENTIAL_MISSING');
  const db = new URL(env.FINSHIELD_DATABASE_URL);
  if (db.port !== '6543' || decodeURIComponent(db.username) !== 'finshield_worker.exarejrwvjochjdminzo') throw new Error('PREVIEW_DATABASE_REJECTED');
  const ocr = new URL(env.CLOVA_OCR_INVOKE_URL);
  if (ocr.protocol !== 'https:' || !ocr.hostname.endsWith('.apigw.ntruss.com') || !ocr.pathname.endsWith('/general')) throw new Error('PREVIEW_OCR_REJECTED');
  const shared = { target:['preview'],gitBranch:BRANCH,comment:'격리 합성 검증용 연결. 서비스 출시 상태와 구분한다.' };
  return [
    ...SECRET_NAMES.map(key=>({...shared,key,value:env[key],type:'sensitive',visibility:'secret'})),
    ...Object.entries({SUPABASE_URL:'https://exarejrwvjochjdminzo.supabase.co',
      SUPABASE_ANON_KEY:'sb_publishable_y73DhXc6aH-dkt6HYO9MpQ_6kfVCiZY',
      FINSHIELD_FILE_GATEWAY_ENABLED:'false'}).map(([key,value])=>({...shared,key,value,type:'encrypted',visibility:'config'})),
  ];
}
export async function configurePreview(env, fetchImpl=fetch) {
  const payload=configuration(env);
  const request=async (path,init={})=>{
    const response=await fetchImpl(`https://api.vercel.com${path}`,{...init,headers:{Authorization:`Bearer ${env.VERCEL_TOKEN}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`PREVIEW_HTTP_${response.status}`);
    return response.json();
  };
  const project=await request(`/v9/projects/${PROJECT}?teamId=${TEAM}`);
  if(project.id!==PROJECT||project.name!=='finshield'||project.accountId!==TEAM
    ||!['all','all_except_custom_domains'].includes(project.ssoProtection?.deploymentType))throw new Error('PREVIEW_PROTECTION_REQUIRED');
  const result=await request(`/v10/projects/${PROJECT}/env?teamId=${TEAM}&upsert=true`,{method:'POST',body:JSON.stringify(payload)});
  if(result.error||result.errors?.length||result.failed?.length)throw new Error('PREVIEW_ENV_REJECTED');
  const stored=await request(`/v9/projects/${PROJECT}/env?teamId=${TEAM}`);
  if(!Array.isArray(stored.envs)||!payload.every(expected=>stored.envs.some(actual=>actual.key===expected.key && actual.gitBranch===BRANCH && actual.target?.length===1 && actual.target[0]==='preview' && (!SECRET_NAMES.includes(expected.key)||actual.type==='sensitive'||actual.visibility==='secret'))))throw new Error('PREVIEW_ENV_VERIFY_FAILED');
  return {target:'preview',branch:BRANCH,configured_keys:payload.map(row=>row.key),file_gateway_enabled:false};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(await configurePreview(process.env)));}
  catch(error){console.error(/^PREVIEW_[A-Z0-9_]+$/.test(error.message)?error.message:'PREVIEW_CONFIGURATION_FAILED');process.exitCode=1;}
}
