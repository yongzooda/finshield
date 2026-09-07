// AUTH-001·SEC-AUTH-002/003: 실제 합성 계정의 두 세션으로 직접 접근 폐기와 정리를 확인한다.
// FINSHIELD_SESSION_RLS_LIVE=1 명시 실행만 허용한다. 자격과 경로는 출력하지 않는다.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {createStorageClient,PNG_BYTES} from '../../.github/scripts/storage-spike.mjs';
if(process.env.FINSHIELD_SESSION_RLS_LIVE!=='1') throw new Error('명시적 합성 Live 실행 설정이 필요하다');
const env=process.env, fixture=JSON.parse(readFileSync(env.FINSHIELD_AUTH_FIXTURE_PATH,'utf8'));
const base=env.SUPABASE_URL, key=env.SUPABASE_ANON_KEY;
const client=createStorageClient({baseUrl:base,anonKey:key});
const sql=postgres(env.FINSHIELD_DATABASE_URL,{max:1,prepare:false});
const report={observed_at:new Date().toISOString(),scope:'합성 세션 DB·Storage 개발 검증, Gate 미채택',scenarios:[],cleanup:null};
const sessions=[];let caseId;
const call=(token,path,init={})=>fetch(base+path,{...init,headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...init.headers},redirect:'error',signal:AbortSignal.timeout(20000)});
const rows=async(token,path)=>{const r=await call(token,path);assert.equal(r.status,200);return (await r.json()).length};
const record=(scenario,observed,expected)=>{report.scenarios.push({scenario,observed,expected});assert.equal(observed,expected,scenario)};
try{
  for(let i=0;i<2;i++)sessions.push(await client.signIn(fixture));
  const [first,second]=sessions;assert.equal(first.userId,second.userId);
  record('정상 개인정보 조회',await rows(first.token,'/rest/v1/profiles?select=id&limit=1'),1);
  const c=await sql`select private.create_case(${first.userId}::uuid,'LOAN','세션 폐기 보안 시험',${randomUUID()},${'a'.repeat(64)}) as id`;caseId=c[0].id;
  const slots=[];for(let i=0;i<2;i++)slots.push((await sql`select * from private.open_upload_slot(${first.userId}::uuid,${caseId}::uuid,'IMAGE','image/png',1024::bigint,1,3600)`)[0]);
  const resumable=await client.createResumable({token:first.token,path:slots[1].object_path,length:PNG_BYTES.length});
  record('정상 TUS URL 발급',resumable.status,201);assert.ok(resumable.location);
  record('현재 세션 로그아웃',(await call(first.token,'/auth/v1/logout?scope=local',{method:'POST'})).status,204);
  for(const view of ['profiles','financial_profiles','case_list_v','case_detail_v','run_progress_v','passport_v'])record(`폐기 JWT 직접 ${view} 조회`,await rows(first.token,`/rest/v1/${view}?select=*&limit=1`),0);
  const active=await call(first.token,'/rest/v1/rpc/member_session_active',{method:'POST',body:'{}'});record('폐기 세션 활성 RPC',await active.json(),false);
  for(const [name,arg,id] of [['case_runs_json','p_case_id',caseId],['passport_claims_json','p_passport_id',randomUUID()],['guide_channels_json','p_action_guide_id',randomUUID()]]){
    const r=await call(first.token,`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify({[arg]:id})});record(`폐기 JWT ${name} HTTP`,r.status,200);record(`폐기 JWT ${name} 결과`,(await r.json()).length,0);
  }
  const upload=await client.putObject({token:first.token,path:slots[0].object_path,bytes:PNG_BYTES});
  report.scenarios.push({scenario:'폐기 JWT Storage 본문 쓰기',status:upload.status});assert.ok([400,401,403].includes(upload.status));
  const patch=await client.patchResumable({token:first.token,location:resumable.location,bytes:PNG_BYTES});
  report.scenarios.push({scenario:'폐기 JWT 기발급 TUS 본문 쓰기',status:patch.status});assert.ok([400,401,403].includes(patch.status));
  record('다른 정상 세션 개인정보 조회',await rows(second.token,'/rest/v1/profiles?select=id&limit=1'),1);
  record('다른 정상 세션 같은 경로 업로드',(await client.putObject({token:second.token,path:slots[0].object_path,bytes:PNG_BYTES})).status,200);
}finally{
  try{
    if(caseId&&sessions[1]){
      const preview=new URL(env.FINSHIELD_PREVIEW_URL);
      const r=await fetch(`${preview.origin}/api/finshield/cases/${caseId}/delete`,{method:'POST',headers:{Authorization:`Bearer ${sessions[1].token}`,Origin:preview.origin,'Content-Type':'application/json','x-vercel-protection-bypass':env.FINSHIELD_PREVIEW_BYPASS},body:'{}',signal:AbortSignal.timeout(40000)});
      const body=await r.json();report.cleanup={http_status:r.status,status:body.status??null};assert.equal(r.status,200);assert.equal(body.status,'COMPLETED');
      const check=await rows(sessions[1].token,`/rest/v1/financial_cases?select=id&id=eq.${caseId}`);report.cleanup.case_rows=check;assert.equal(check,0);
    }
  }finally{
    report.session_cleanup=[];for(const session of sessions){const r=await call(session.token,'/auth/v1/logout?scope=local',{method:'POST'});report.session_cleanup.push(r.status);}
    await sql.end();writeFileSync(env.FINSHIELD_AUTH_REPORT_PATH,JSON.stringify(report,null,2)+'\n');
  }
}
console.log('실제 세션 폐기·다른 세션 보존·직접 RLS·Storage·합성 Case 정리 통과');
