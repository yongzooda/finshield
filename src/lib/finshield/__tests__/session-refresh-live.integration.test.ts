import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { POST, PATCH, DELETE } from "@/app/api/finshield/session/route";
import { resolveOwner } from "../auth";

it.skipIf(process.env.FINSHIELD_AUTH_LIVE !== "1")("실제 Cookie 갱신·동시 요청·응답 유실·다른 세션 보존",async()=>{
 if(process.env.SUPABASE_URL!=="https://exarejrwvjochjdminzo.supabase.co")throw new Error("FinShield 대상 불일치");
 const c=JSON.parse(readFileSync(process.env.FINSHIELD_AUTH_FIXTURE_PATH!,"utf8"));
 const sessions:{token:string;cookie:string}[]=[];
 const report:Record<string,unknown>={schema_version:"auth-refresh-development-v1",observed_at:new Date().toISOString(),scope:"실제 Supabase·서버 Cookie 회전·합성 새 세션, 브라우저와 자연 만료는 별도",checks:{},outcome:"FAIL"};
 const checks=report.checks as Record<string,unknown>;
 const claims=(t:string)=>JSON.parse(Buffer.from(t.split(".")[1],"base64url").toString());
 const request=(method:string,s?:{token:string;cookie:string},origin="https://probe.example.invalid")=>new Request("https://probe.example.invalid/api/finshield/session",{method,headers:{Origin:origin,"Content-Type":"application/json",...(s?{Authorization:`Bearer ${s.token}`,Cookie:s.cookie}:{})},...(method==="POST"?{body:JSON.stringify({email:c.email,password:c.password})}:{})});
 const pair=async(r:Response)=>{const b=await r.json();const cookie=r.headers.get("set-cookie")?.split(";")[0]??"";expect(typeof b.access_token==="string"&&cookie.length>0).toBe(true);return{token:b.access_token as string,cookie};};
 try{
  for(let i=0;i<2;i++){const r=await POST(request("POST"));expect(r.status).toBe(200);const s=await pair(r);sessions.push(s);expect(claims(s.token).sub===c.ownerId).toBe(true);expect(r.headers.get("set-cookie")?.includes("HttpOnly; SameSite=Strict; Secure")).toBe(true);}
  const[first,other]=sessions;const original={...first};const oldAmr=claims(first.token).amr;
  checks.login_sessions_isolated=claims(first.token).session_id!==claims(other.token).session_id;expect(checks.login_sessions_isolated).toBe(true);
  checks.other_cookie_rejected=(await PATCH(request("PATCH",{token:first.token,cookie:other.cookie}))).status;expect(checks.other_cookie_rejected).toBe(401);
  checks.foreign_origin_rejected=(await PATCH(request("PATCH",first,"https://foreign.example.invalid"))).status;expect(checks.foreign_origin_rejected).toBe(403);
  const responses=await Promise.all([PATCH(request("PATCH",original)),PATCH(request("PATCH",original))]);checks.concurrent_statuses=responses.map(r=>r.status);expect(checks.concurrent_statuses).toEqual([200,200]);
  const pairs=await Promise.all(responses.map(pair));Object.assign(first,pairs[0]);
  checks.rotation_cookie_changed=first.cookie!==original.cookie;expect(checks.rotation_cookie_changed).toBe(true);
  checks.refresh_did_not_reauthenticate=JSON.stringify(claims(first.token).amr)===JSON.stringify(oldAmr);expect(checks.refresh_did_not_reauthenticate).toBe(true);
  expect(await resolveOwner(request("GET",first))===c.ownerId).toBe(true);
  // 응답의 Cookie를 받지 못한 클라이언트가 기본 reuse interval 밖에서 부모로 복원한다.
  await new Promise(resolve=>setTimeout(resolve,11_000));
  const recovery=await PATCH(request("PATCH",original));checks.lost_response_recovery_status=recovery.status;expect(recovery.status).toBe(200);Object.assign(first,await pair(recovery));
  const out=await DELETE(request("DELETE",first));checks.signout_status=out.status;expect(out.status).toBe(200);expect(out.headers.get("set-cookie")?.includes("Max-Age=0")).toBe(true);
  const revoked=await PATCH(request("PATCH",first));checks.revoked_refresh_status=revoked.status;expect(revoked.status).toBe(401);
  expect(await resolveOwner(request("GET",other))===c.ownerId).toBe(true);checks.other_session_preserved=true;
  report.outcome="PASS";
 }catch{throw new Error("실제 갱신 검증 실패: 비밀 없는 마지막 검사 참조");}
 finally{report.cleanup_statuses=await Promise.all(sessions.map(s=>DELETE(request("DELETE",s)).then(r=>r.status).catch(()=>0)));if(!(report.cleanup_statuses as number[]).every(s=>s===200))report.outcome="FAIL";if(process.env.FINSHIELD_AUTH_REFRESH_REPORT_PATH)writeFileSync(process.env.FINSHIELD_AUTH_REFRESH_REPORT_PATH,JSON.stringify(report,null,2)+"\n");expect(report.outcome).toBe("PASS");}
},90_000);
