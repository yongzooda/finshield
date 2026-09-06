// ============================================================
// B-STORAGE-01 관측 생성기.
//
// 시험 계정으로 실제 로그인해 사용자 JWT 를 받고 그 JWT 로만 Storage 를 부른다.
// service_role 같은 RLS 우회 키를 쓰지 않는다. 우회 키로 재면 제품이 실제로 쓰는
// 경로가 아니라 우회 경로를 재는 셈이 된다.
//
// slot 은 서버 함수가 만든다. 경로를 호출자가 고르지 못한다는 사실이 이 시험의 전제다.
// ============================================================
export const FORMULA_VERSION = "storage-authenticated-slot-v1";
export const BUCKET = "finshield-quarantine";
export const SIZE_LIMIT_BYTES = 10 * 1024 * 1024;
export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

// 기대 판정: allow 는 2xx, deny 는 2xx 가 아니어야 한다.
export const SCENARIOS = Object.freeze([
  { key: "open_slot_upload", expect: "allow", kind: "write" },
  { key: "same_path_upsert", expect: "deny", kind: "write" },
  { key: "foreign_path_upload", expect: "deny", kind: "write" },
  { key: "anonymous_upload", expect: "deny", kind: "write" },
  { key: "owner_read", expect: "deny", kind: "read" },
  { key: "owner_list", expect: "deny", kind: "read" },
  { key: "oversize_upload", expect: "deny", kind: "write" },
  { key: "closed_slot_upload", expect: "deny", kind: "write" },
  { key: "resumable_token_after_close", expect: "deny", kind: "write" },
]);

const b64 = (text) => Buffer.from(String(text), "utf8").toString("base64");

export const createStorageClient = ({ baseUrl, anonKey, fetchImpl = globalThis.fetch }) => {
  const url = String(baseUrl).replace(/\/+$/, "");
  const call = async (path, init = {}) => {
    const response = await fetchImpl(`${url}${path}`, {
      ...init,
      headers: { apikey: anonKey, ...(init.headers ?? {}) },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    return response;
  };
  return {
    url,
    async signIn({ email, password }) {
      const response = await call("/auth/v1/token?grant_type=password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(`sign-in failed with status ${response.status}`);
      const body = await response.json();
      if (!body?.access_token || !body?.user?.id) throw new Error("sign-in response missing token or user id");
      return { token: body.access_token, userId: body.user.id };
    },
    async upsertProfile({ token, ownerId }) {
      const response = await call("/rest/v1/financial_profiles", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          owner_id: ownerId, schema_version: "v1", income_band: "BAND_2", debt_burden_band: "LOW",
          emergency_fund_band: "BAND_1", purpose_code: "LOAN_REFINANCE", horizon_code: "SHORT",
          liquidity_need: "MEDIUM", loss_tolerance: "LOW", completeness: "COMPLETE",
        }),
      });
      return response;
    },
    async putObject({ token, path, bytes, contentType = "image/png", upsert = false }) {
      const headers = { "Content-Type": contentType, "x-upsert": upsert ? "true" : "false" };
      if (token) headers.Authorization = `Bearer ${token}`;
      return call(`/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers, body: bytes });
    },
    async getObject({ token, path }) {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      return call(`/storage/v1/object/${BUCKET}/${path}`, { method: "GET", headers });
    },
    async listObjects({ token, prefix }) {
      return call(`/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: 10 }),
      });
    },
    // TUS 는 업로드 URL 을 먼저 받고 나중에 본문을 보낸다. 그 URL 이 slot 폐쇄 뒤에도
    // 통하는지가 ADR 6.1 이 Live Gate 에서 보라고 한 지점이다.
    async createResumable({ token, path, length, contentType = "image/png" }) {
      const response = await call("/storage/v1/upload/resumable", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`, "Tus-Resumable": "1.0.0", "Upload-Length": String(length),
          "Upload-Metadata": `bucketName ${b64(BUCKET)},objectName ${b64(path)},contentType ${b64(contentType)}`,
        },
      });
      return { status: response.status, location: response.headers.get("location") };
    },
    async patchResumable({ token, location, bytes }) {
      const response = await fetchImpl(location, {
        method: "PATCH",
        headers: {
          apikey: anonKey, Authorization: `Bearer ${token}`, "Tus-Resumable": "1.0.0",
          "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream",
        },
        body: bytes, redirect: "error", signal: AbortSignal.timeout(20_000),
      });
      return response;
    },
  };
};

const record = (results, key, status) => {
  const scenario = SCENARIOS.find((s) => s.key === key);
  const allowed = status >= 200 && status < 300;
  results.push({ scenario: key, expect: scenario.expect, kind: scenario.kind, status, allowed });
};

export const runStorageSpike = async ({ client, sql, credentials, progress = () => {} }) => {
  const { token, userId } = await client.signIn(credentials);
  progress("signin");

  const profile = await client.upsertProfile({ token, ownerId: userId });
  if (!profile.ok && profile.status !== 409) throw new Error(`profile upsert failed with status ${profile.status}`);
  progress("profile");

  // Case 와 slot 은 서버 역할이 만든다. 회원이 경로를 고르지 못한다.
  const caseRows = await sql`
    select private.create_case(${userId}::uuid, 'LOAN'::public.case_scenario, 'storage 시험 Case',
      ${`storage-${Date.now()}`}::text, ${"a".repeat(64)}::text) as case_id`;
  const caseId = caseRows[0].case_id;
  const slot = async (size = 1024) => {
    const rows = await sql`
      select * from private.open_upload_slot(${userId}::uuid, ${caseId}::uuid, 'IMAGE'::public.case_input_type,
        'image/png', ${size}::bigint, 1, 3600)`;
    return rows[0];
  };
  progress("case");

  const results = [];

  // 1. 서버가 준 경로에 회원이 올린다.
  const first = await slot();
  record(results, "open_slot_upload", (await client.putObject({ token, path: first.object_path, bytes: PNG_BYTES })).status);

  // 2. 같은 경로에 다시 올린다. upsert 는 허용되지 않는다.
  record(results, "same_path_upsert", (await client.putObject({ token, path: first.object_path, bytes: PNG_BYTES })).status);

  // 3. 다른 소유자 경로에 올린다.
  const foreign = `00000000-0000-4000-8000-000000000999/${caseId}/${first.case_input_id}/${first.object_id}.png`;
  record(results, "foreign_path_upload", (await client.putObject({ token, path: foreign, bytes: PNG_BYTES })).status);

  // 4. 로그인 없이 올린다.
  const second = await slot();
  record(results, "anonymous_upload", (await client.putObject({ token: null, path: second.object_path, bytes: PNG_BYTES })).status);

  // 5. 본인 객체를 읽는다. 열람은 서버가 발급하는 짧은 URL 로만 한다.
  record(results, "owner_read", (await client.getObject({ token, path: first.object_path })).status);

  // 6. 본인 폴더를 나열한다.
  record(results, "owner_list", (await client.listObjects({ token, prefix: `${userId}/` })).status);

  // 7. 상한을 넘는 본문을 올린다. slot 은 정상 크기로 열어 Storage 쪽 상한을 본다.
  const third = await slot();
  record(results, "oversize_upload", (await client.putObject({
    token, path: third.object_path, bytes: Buffer.alloc(SIZE_LIMIT_BYTES + 1024, 0x41),
  })).status);
  progress("upload");

  // 8. slot 을 닫은 뒤 그 경로에 올린다.
  const fourth = await slot();
  await sql`select slot_state from private.close_upload_slot(${fourth.object_id}::uuid, 'TEST')`;
  record(results, "closed_slot_upload", (await client.putObject({ token, path: fourth.object_path, bytes: PNG_BYTES })).status);

  // 9. slot 이 열려 있을 때 재개 업로드 URL 을 받아 두고, 닫은 뒤 본문을 보낸다.
  const fifth = await slot();
  const resumable = await client.createResumable({ token, path: fifth.object_path, length: PNG_BYTES.length });
  await sql`select slot_state from private.close_upload_slot(${fifth.object_id}::uuid, 'TEST')`;
  let reuseStatus = resumable.status;
  if (resumable.location) {
    reuseStatus = (await client.patchResumable({ token, location: resumable.location, bytes: PNG_BYTES })).status;
  }
  record(results, "resumable_token_after_close", reuseStatus);
  progress("reuse");

  const denies = results.filter((r) => r.expect === "deny");
  const allows = results.filter((r) => r.expect === "allow");
  return {
    contract: {
      formula_version: FORMULA_VERSION,
      bucket: BUCKET,
      size_limit_bytes: SIZE_LIMIT_BYTES,
      scenarios: SCENARIOS.map((s) => s.key),
      uses_service_role: false,
      slot_path_chosen_by: "server",
    },
    scenarios: results,
    totals: {
      allow_scenarios: allows.length,
      allow_passed: allows.filter((r) => r.allowed).length,
      deny_scenarios: denies.length,
      unauthorized_allows: denies.filter((r) => r.allowed).length,
      unauthorized_writes: denies.filter((r) => r.allowed && r.kind === "write").length,
      unauthorized_reads: denies.filter((r) => r.allowed && r.kind === "read").length,
      upsert_allows: results.filter((r) => r.scenario === "same_path_upsert" && r.allowed).length,
      resumable_reuse_allows: results.filter((r) => r.scenario === "resumable_token_after_close" && r.allowed).length,
    },
  };
};
