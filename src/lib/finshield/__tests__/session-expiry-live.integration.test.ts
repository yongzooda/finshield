import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { expect, it } from "vitest";
import { PATCH, DELETE } from "@/app/api/finshield/session/route";
import { GET as cases } from "@/app/api/finshield/cases/route";

it.skipIf(process.env.FINSHIELD_AUTH_NATURAL_EXPIRY !== "1")("기본 수명이 실제 만료된 세션을 Cookie로 복구한다",async()=>{
 if(process.env.SUPABASE_URL!=="https://exarejrwvjochjdminzo.supabase.co")throw new Error("FinShield 대상 불일치");
 const path=process.env.FINSHIELD_AUTH_EXPIRY_FIXTURE_PATH!;
 const fixture=JSON.parse(readFileSync(path,"utf8"));
 const c=JSON.parse(readFileSync(process.env.FINSHIELD_AUTH_FIXTURE_PATH!,"utf8"));
 if(Date.now()<fixture.expires_at*1000+2000)throw new Error("실제 만료 시각 전에는 이 시험을 실행하지 않는다");
 const req=(method:string,token:string)=>new Request("http://127.0.0.1:3108/api/finshield/session",{method,headers:{Origin:"http://127.0.0.1:3108",Authorization:`Bearer ${token}`,Cookie:fixture.cookie}});
 const report:Record<string,unknown>={schema_version:"auth-natural-expiry-development-v1",started_at:fixture.started_at,observed_at:new Date().toISOString(),expires_at:new Date(fixture.expires_at*1000).toISOString(),scope:"발급처 설정·시계 변경 없는 실제 Access 만료와 앱 Handler·실제 Auth·RLS 복구",checks:{},outcome:"FAIL"};
 const checks=report.checks as Record<string,unknown>;let token=fixture.token;
 try{
  checks.expired_read_status=(await cases(req("GET",token))).status;expect(checks.expired_read_status).toBe(401);
  const response=await PATCH(req("PATCH",token));checks.refresh_status=response.status;expect(response.status).toBe(200);const body=await response.json();token=body.access_token;
  const claims=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString());expect(claims.sub===c.ownerId).toBe(true);expect(claims.exp*1000>Date.now()).toBe(true);
  checks.restored_read_status=(await cases(req("GET",token))).status;expect(checks.restored_read_status).toBe(200);
  const prior=JSON.parse(Buffer.from(fixture.token.split(".")[1],"base64url").toString());checks.password_auth_time_preserved=JSON.stringify(prior.amr)===JSON.stringify(claims.amr);expect(checks.password_auth_time_preserved).toBe(true);
  report.outcome="PASS";
 }catch{throw new Error("실제 만료 검증 실패: 비밀 없는 마지막 검사 참조");}
 finally{const response=await DELETE(req("DELETE",token));checks.cleanup_status=response.status;if(response.status!==200)report.outcome="FAIL";if(process.env.FINSHIELD_AUTH_EXPIRY_REPORT_PATH)writeFileSync(process.env.FINSHIELD_AUTH_EXPIRY_REPORT_PATH,JSON.stringify(report,null,2)+"\n");if(response.status===200)unlinkSync(path);expect(report.outcome).toBe("PASS");}
},60_000);
