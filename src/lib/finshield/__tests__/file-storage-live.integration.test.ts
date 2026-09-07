import { expect, it } from "vitest";
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { processFileInput } from "../files/process";
import { createClaimExtractor } from "../agents/model-adapter";
import { cleanupCaseFiles } from "../files/cleanup";

// N-QLT-010 개발 진단: 고정 합성 PDF만 허용한다. 기본 시험에서는 외부 연결하지 않는다.
it.skipIf(process.env.FINSHIELD_LIVE_STORAGE_PROBE !== "1")(
  "합성 회원 TUS → 실제 Storage·Parser·모델·DB → 중단·물리 삭제", async () => {
    const base = process.env.SUPABASE_URL!;
    if (base !== "https://exarejrwvjochjdminzo.supabase.co") throw new Error("FINSHIELD_PROJECT_ONLY");
    const owner = process.env.FINSHIELD_PROBE_OWNER!;
    const token = process.env.FINSHIELD_PROBE_TOKEN!;
    const publicHeaders = { apikey: process.env.SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` };
    const account = await fetch(`${base}/auth/v1/user`, { headers: publicHeaders, signal: AbortSignal.timeout(10000) });
    const user = await account.json();
    if (!account.ok || user.id !== owner || !/^finshield-file-probe-\d+@example\.com$/.test(user.email ?? "")) {
      throw new Error("SYNTHETIC_PROBE_ACCOUNT_ONLY");
    }
    const sql = postgres(process.env.FINSHIELD_DATABASE_URL!, { prepare: false, max: 1 });
    let caseId: string | undefined, inputId: string | undefined;
    try {
      const [role] = await sql`select current_user as name`;
      expect(role.name).toBe("finshield_worker");
      const bytes = readFileSync(".github/fixtures/finshield/synthetic-loan.pdf");
      const [kase] = await sql`select private.create_case(${owner}::uuid,'LOAN','합성 실제 파일 연결 시험',
        ${randomUUID()},${createHash("sha256").update(bytes).digest("hex")}) as id`;
      caseId = kase.id;
      const [slot] = await sql`select * from private.open_upload_slot(${owner}::uuid,${caseId!}::uuid,
        'PDF','application/pdf',${bytes.length},1,3600)`;
      inputId = slot.case_input_id;
      const b64 = (value: string) => Buffer.from(value).toString("base64");
      const tus = await fetch(`${base}/storage/v1/upload/resumable`, {
        method: "POST", headers: { ...publicHeaders, "Tus-Resumable": "1.0.0", "Upload-Length": String(bytes.length),
          "Upload-Metadata": `bucketName ${b64("finshield-quarantine")},objectName ${b64(slot.object_path)},contentType ${b64("application/pdf")}` },
        redirect: "error", signal: AbortSignal.timeout(15000),
      });
      expect(tus.status).toBe(201);
      const location = new URL(tus.headers.get("location")!, base);
      if (location.origin !== base) throw new Error("TUS_ORIGIN_REJECTED");
      const uploaded = await fetch(location, { method: "PATCH", headers: { ...publicHeaders,
        "Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
        body: bytes, redirect: "error", signal: AbortSignal.timeout(15000) });
      expect(uploaded.status).toBe(204);
      const started = Date.now();
      const result = await processFileInput({ sql, ownerId: owner, caseId: caseId!, inputId: inputId!,
        ocrConsent: false, extractClaims: createClaimExtractor(), signal: AbortSignal.timeout(40000) });
      expect(result.masked_pages).toHaveLength(1);
      expect(result.claims.length).toBeGreaterThanOrEqual(4);
      expect(result.claims.every(claim => claim.source_page_no === 1)).toBe(true);
      const [usage] = await sql`select count(*)::int as calls,coalesce(sum(actual_microunits),0)::int as cost
        from private.usage_reservations where case_input_id=${inputId!}::uuid and status='SETTLED'`;
      expect(usage.calls).toBe(1);
      expect(usage.cost).toBeGreaterThan(0);
      await sql`select private.stop_case_input(${owner}::uuid,${caseId!}::uuid,${inputId!}::uuid,'USER_CANCELLED')`;
      const cleanup = await cleanupCaseFiles(sql, owner, caseId!);
      expect(cleanup.pending).toBe(false);
      expect(cleanup.finished).toBeGreaterThan(0);
      const missing = await fetch(`${base}/storage/v1/object/finshield-quarantine/${slot.object_path}`,
        { headers: { apikey: process.env.SUPABASE_SECRET_KEY! }, signal: AbortSignal.timeout(10000) });
      expect(missing.ok).toBe(false);
      writeFileSync("/tmp/finshield-file-storage-live-result.json", JSON.stringify({
        kind: "development-live-tus-storage-parser-model-worker-cleanup-not-release",
        fixture_sha256: createHash("sha256").update(bytes).digest("hex"),
        elapsed_ms: Date.now() - started, claims: result.claims.length, pages: result.masked_pages.length,
        model_calls: usage.calls, model_cost_microunits: usage.cost, cleanup, absent_status: missing.status,
        ocr_used: false,
      }, null, 2), { mode: 0o600 });
    } finally {
      try {
        if (caseId && inputId) {
          await sql`select private.stop_case_input(${owner}::uuid,${caseId}::uuid,${inputId}::uuid,'USER_CANCELLED')`;
          await cleanupCaseFiles(sql, owner, caseId);
        }
      } finally { await sql.end({ timeout: 2 }); }
    }
  }, 90000,
);
