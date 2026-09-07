import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { uploadFile } from "../upload-file";

it.skipIf(process.env.FINSHIELD_UPLOAD_SESSION_LIVE!=="1")("보호 Preview의 실제 TUS 경계마다 Cookie를 갱신하고 파일·Case를 정리한다",async()=>{
 const url="https://finshield-git-codex-p0-audit-contract-spike-yongzoodas-projects.vercel.app";
 const credentials=JSON.parse(readFileSync(process.env.FINSHIELD_AUTH_FIXTURE_PATH!,"utf8"));
 const target=JSON.parse(readFileSync(process.env.FINSHIELD_PREVIEW_FIXTURE_PATH!,"utf8"));
 const headers={Origin:url,"Content-Type":"application/json","x-vercel-protection-bypass":target.bypass};
 let token="",cookie="",caseId="";let renewals=0;
 const report:Record<string,unknown>={schema_version:"upload-session-development-v1",observed_at:new Date().toISOString(),scope:"합성 PNG·실제 보호 Preview Slot/Workflow 예약·TUS·Cookie 회전·삭제, OCR/모델/자연 만료는 미측정",checks:{},outcome:"FAIL"};
 const checks=report.checks as Record<string,unknown>;
 const request=(path:string,method:string,body?:unknown)=>fetch(url+path,{method,headers:{...headers,...(token?{Authorization:`Bearer ${token}`,Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30_000)});
 const accept=async(r:Response)=>{expect(r.status).toBe(200);const b=await r.json();expect(typeof b.access_token==="string"&&r.headers.has("set-cookie")).toBe(true);token=b.access_token;cookie=r.headers.get("set-cookie")!.split(";")[0];};
 try{
  const manifest=await(await request("/api/runtime-manifest","GET")).json();expect(manifest.vercel_commit_sha).toBe(process.env.FINSHIELD_EXPECTED_SHA);report.sha=manifest.vercel_commit_sha;report.deployment_id=manifest.vercel_deployment_id;
  await accept(await request("/api/finshield/session","POST",{email:credentials.email,password:credentials.password}));
  const c=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString());expect(c.sub===credentials.ownerId).toBe(true);const amr=JSON.stringify(c.amr);
  const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlXcAAAAASUVORK5CYII=","base64");
  const file=new File([bytes],"synthetic.png",{type:"image/png"});
  const opened=await request("/api/finshield/files/slot","POST",{mime:file.type,size:file.size});checks.slot_status=opened.status;expect(opened.status).toBe(200);const slot=await opened.json();caseId=slot.case_id;
  expect(slot.supabase_url).toBe("https://exarejrwvjochjdminzo.supabase.co");
  await uploadFile({file,supabaseUrl:slot.supabase_url,publishableKey:slot.publishable_key,objectPath:slot.object_path,signal:AbortSignal.timeout(60_000),token:async()=>{
   const oldCookie=cookie;await accept(await request("/api/finshield/session","PATCH"));expect(cookie!==oldCookie).toBe(true);expect(JSON.stringify(JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString()).amr)===amr).toBe(true);renewals++;return token;
  },onProgress:(sent,total)=>{checks.uploaded_bytes=sent;checks.total_bytes=total;}});
  checks.refresh_boundaries=renewals;expect(renewals).toBe(2);expect(checks.uploaded_bytes).toBe(file.size);report.outcome="PASS";
 }catch{throw new Error("실제 TUS 세션 검증 실패: 비밀 없는 보고서 참조");}
 finally{
  if(caseId){const deleted=await request(`/api/finshield/cases/${caseId}/delete`,"POST");checks.delete_status=deleted.status;const result=await deleted.json();checks.delete_result=result.status;if(deleted.status!==200||result.status!=="COMPLETED")report.outcome="FAIL";
   checks.deleted_case_status=(await request(`/api/finshield/cases/${caseId}`,"GET")).status;if(checks.deleted_case_status!==404)report.outcome="FAIL";}
  if(token){checks.session_cleanup=(await request("/api/finshield/session","DELETE")).status;if(checks.session_cleanup!==200)report.outcome="FAIL";}
  if(process.env.FINSHIELD_UPLOAD_SESSION_REPORT_PATH)writeFileSync(process.env.FINSHIELD_UPLOAD_SESSION_REPORT_PATH,JSON.stringify(report,null,2)+"\n");expect(report.outcome).toBe("PASS");
 }
},120_000);
