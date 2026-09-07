import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { DELETE } from "@/app/api/finshield/session/route";
import { resolveOwner, UnauthenticatedError } from "../auth";
import { GET as cases } from "@/app/api/finshield/cases/route";
import { GET as detail } from "@/app/api/finshield/cases/[id]/route";
import { GET as profile } from "@/app/api/finshield/profile/route";
import { GET as notifications } from "@/app/api/finshield/notifications/route";

/** AUTH-001: 명시적으로 켠 FinShield 합성 계정에서 이번 시험의 세션만 폐기한다. */
it.skipIf(process.env.FINSHIELD_AUTH_LIVE !== "1")("실제 세션 폐기·반복 요청·다른 세션 보존", async () => {
  const base = process.env.SUPABASE_URL;
  if (base !== "https://exarejrwvjochjdminzo.supabase.co") throw new Error("격리 시험의 FinShield 대상 불일치");
  const credentials = JSON.parse(readFileSync(process.env.FINSHIELD_AUTH_FIXTURE_PATH!, "utf8"));
  const headers = { apikey: process.env.SUPABASE_ANON_KEY!, "Content-Type": "application/json" };
  const sessions: { access_token: string; refresh_token: string }[] = [];
  const request = (token: string, origin = "https://probe.example.invalid") => new Request("https://probe.example.invalid/api/finshield/session", {
    method: "DELETE", headers: { Authorization: `Bearer ${token}`, origin },
  });
  const userStatus = async (token: string) => (await fetch(`${base}/auth/v1/user`, {
    headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
  })).status;
  const report: Record<string, unknown> = { schema_version: "auth-signout-development-v2", observed_at: new Date().toISOString(),
    scope: "실제 Supabase Auth와 앱 DELETE·resolveOwner, HTTP 배포·RLS 직접 접근·전체 인증 수명 Gate 제외", checks: {} };
  const checks = report.checks as Record<string, unknown>;
  try {
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers,
        body: JSON.stringify({ email: credentials.email, password: credentials.password }), signal: AbortSignal.timeout(15_000) });
      expect(response.status).toBe(200);
      const body = await response.json();
      // assertion 실패에도 토큰을 출력하지 않는다. 생성 직후 정리 목록에 넣는다.
      sessions.push({ access_token: body.access_token, refresh_token: body.refresh_token });
      expect(body.user?.id === credentials.ownerId).toBe(true);
      expect(typeof body.access_token === "string" && typeof body.refresh_token === "string").toBe(true);
    }
    const [first, other] = sessions;
    checks.before_statuses = await Promise.all(sessions.map(s => userStatus(s.access_token)));
    expect(checks.before_statuses).toEqual([200, 200]);
    expect(await resolveOwner(request(first.access_token)) === credentials.ownerId).toBe(true);
    expect((await cases(request(first.access_token))).status).toBe(200);
    checks.origin_rejected = (await DELETE(request(other.access_token, "https://foreign.example.invalid"))).status;
    expect(checks.origin_rejected).toBe(403);
    expect(await userStatus(other.access_token)).toBe(200);
    const result = await DELETE(request(first.access_token));
    checks.signout_status = result.status;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: "SIGNED_OUT" });
    checks.after_statuses = await Promise.all(sessions.map(s => userStatus(s.access_token)));
    expect(checks.after_statuses).toEqual([403, 200]);
    await expect(resolveOwner(request(first.access_token))).rejects.toBeInstanceOf(UnauthenticatedError);
    checks.app_owner_rejected = true;
    checks.revoked_read_route_statuses = await Promise.all([cases, detail, profile, notifications].map(handler =>
      handler(request(first.access_token), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) }).then(r => r.status)));
    expect(checks.revoked_read_route_statuses).toEqual([401, 401, 401, 401]);
    const refresh = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers,
      body: JSON.stringify({ refresh_token: first.refresh_token }), signal: AbortSignal.timeout(10_000) });
    checks.revoked_refresh_status = refresh.status;
    expect(refresh.status).toBe(400);
    checks.repeat_status = (await DELETE(request(first.access_token))).status;
    expect(checks.repeat_status).toBe(200);
    expect(await resolveOwner(request(other.access_token)) === credentials.ownerId).toBe(true);
    checks.other_session_preserved = true;
    report.outcome = "PASS";
  } catch {
    report.outcome = "FAIL";
    throw new Error("실제 세션 폐기 시험 실패: 비밀 없는 개발 결과의 마지막 검사 참조");
  } finally {
    const cleanup = await Promise.all(sessions.map(s => DELETE(request(s.access_token)).then(r => r.status).catch(() => 0)));
    report.created_session_cleanup_statuses = cleanup;
    if (cleanup.some(s => s !== 200)) report.outcome = "FAIL";
    if (process.env.FINSHIELD_AUTH_REPORT_PATH) writeFileSync(process.env.FINSHIELD_AUTH_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    expect(cleanup.every(s => s === 200)).toBe(true);
  }
}, 90_000);
