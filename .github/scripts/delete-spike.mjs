// ============================================================
// B-DELETE-01 관측 생성기.
//
// ADR 6.4 삭제 계약과 15.1 물리 삭제 행을 실제 운영 Supabase 에서 잰다.
// 원본은 Claim 확인·사용자 중단·Case 삭제 중 가장 먼저 온 시점에 지우고,
// 어떤 경우에도 만든 지 24시간을 넘기지 않는다.
//
// 부재 판정은 특권 키로 하지 않는다. 지우기 전에 서버가 발급한 열람 URL 과
// 회원 JWT 로 다시 읽어 본다. 특권 키는 제품과 같은 이유로 삭제에만 쓴다.
// 회원 JWT 는 격리 Bucket 객체를 지울 권한이 없고, 24시간 만료 청소는
// 회원이 접속하지 않아도 돌아야 하기 때문이다.
// ============================================================
import { createHash } from "node:crypto";

export const FORMULA_VERSION = "delete-24h-physical-erasure-v1";
export const BUCKET = "finshield-quarantine";
export const MAX_DELETE_SECONDS = 86_400;
// 제품은 열람 URL 을 60초로 만든다. 여기서는 900초로 만든다.
// 오래 사는 URL 일수록 삭제 뒤에도 통할 시간이 길어 시험이 더 엄격해진다.
// 짧게 잡으면 "그냥 만료됐다" 로 설명되는 관측이 섞인다.
export const SIGNED_URL_TTL_SECONDS = 900;

// 각 family 는 삭제를 유발하는 경로 하나를 나타낸다.
// ttl_boundary_early 만 남아 있어야 정상이다. 경계 이전에 지우면 규칙 위반이다.
// 만료 경계는 expires_at 을 나중에 고쳐서 만들지 않는다. 만들 때 정한 수명이
// 실제로 지나가기를 기다린다. 그래야 청소가 시간에 반응한다고 말할 수 있다.
export const DUE_TTL_SECONDS = 60;
export const LIVE_TTL_SECONDS = 3600;
export const FAMILIES = Object.freeze([
  { key: "claim_confirmed", reason: "CLAIM_CONFIRMED", cases: 10, expect: "deleted", ttl: LIVE_TTL_SECONDS },
  { key: "user_stopped", reason: "USER_STOPPED", cases: 10, expect: "deleted", ttl: LIVE_TTL_SECONDS },
  { key: "case_deleted", reason: "CASE_DELETED", cases: 10, expect: "deleted", ttl: LIVE_TTL_SECONDS },
  { key: "ttl_boundary_due", reason: "TTL_EXPIRED", cases: 5, expect: "deleted", ttl: DUE_TTL_SECONDS },
  { key: "ttl_boundary_early", reason: "TTL_EXPIRED", cases: 5, expect: "retained", ttl: LIVE_TTL_SECONDS },
]);
export const TOTAL_CASES = FAMILIES.reduce((sum, f) => sum + f.cases, 0);
export const DELETED_CASES = FAMILIES.filter((f) => f.expect === "deleted")
  .reduce((sum, f) => sum + f.cases, 0);

export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

// 특권 키 client. 삭제·OCR 임시물 쓰기·열람 URL 발급만 한다.
// 이 client 로는 어떤 부재도 판정하지 않는다.
export const createAdminStorageClient = ({ baseUrl, secretKey, fetchImpl = globalThis.fetch }) => {
  const url = String(baseUrl).replace(/\/+$/, "");
  const call = (path, init = {}) => fetchImpl(`${url}${path}`, {
    ...init,
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, ...(init.headers ?? {}) },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  return {
    // 발급 URL 은 자격 없이 부른다. 그 호출에 이 client 의 header 를 붙이지 않는다.
    rawFetch: fetchImpl,
    async putObject({ path, bytes, contentType = "image/png" }) {
      return call(`/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST", headers: { "Content-Type": contentType, "x-upsert": "false" }, body: bytes,
      });
    },
    // 지울 대상을 찾는 용도다. 부재 판정에는 쓰지 않는다.
    async listObjects({ prefix, limit = 100 }) {
      const response = await call(`/storage/v1/object/list/${BUCKET}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit }),
      });
      if (!response.ok) return [];
      const body = await response.json().catch(() => []);
      return Array.isArray(body) ? body.filter((row) => row?.id).map((row) => `${prefix}${row.name}`) : [];
    },
    async deleteObject({ path }) {
      return call(`/storage/v1/object/${BUCKET}/${path}`, { method: "DELETE" });
    },
    // 제품에서 열람 URL 은 private.authorize_input_object_read 가 통과시킨 경로에만 만든다.
    async signUrl({ path, ttlSeconds = SIGNED_URL_TTL_SECONDS }) {
      const response = await call(`/storage/v1/object/sign/${BUCKET}/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: ttlSeconds }),
      });
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      const signed = body?.signedURL ?? body?.signedUrl ?? null;
      return signed ? `${url}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` : null;
    },
  };
};

// 발급된 URL 을 자격 없이 그대로 부른다. 지워진 뒤에는 본문이 오면 안 된다.
export const readIssuedUrl = async (signedUrl, fetchImpl = globalThis.fetch) => {
  if (!signedUrl) return { status: 0, bytes: 0 };
  const response = await fetchImpl(signedUrl, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  const body = response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
  return { status: response.status, bytes: body.length };
};

export const servedContent = (status, bytes) => status >= 200 && status < 300 && bytes > 0;

// 합성 표식만 해싱한다. 개인정보나 원본을 넣지 않는다.
const hex64 = (seed) => createHash("sha256").update(String(seed), "utf8").digest("hex");

// Cleanup Worker. 제품 서버가 하는 일을 그대로 한다.
// DB 에서 대상을 받아 Storage 에서 지우고, 부재를 확인하는 함수로 끝낸다.
export const runCleanupWorker = async ({ sql, admin, maxRounds = 40 }) => {
  let deleted = 0;
  let finished = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const jobs = await sql`select * from private.claim_file_cleanup_jobs(50, 120)`;
    if (jobs.length === 0) return { deleted, finished, rounds: round };
    for (const job of jobs) {
      // worker 역할은 storage schema 를 쓰지 못하고 경로를 돌려주는 함수도 없다.
      // 그래서 job 이 들고 있는 소유자·Case·입력으로 접두사를 만들어 Storage API 로
      // 대상을 찾는다. 지울 것을 찾는 용도이지 부재를 판정하는 경로가 아니다.
      // 이전 실행이 남긴 객체도 같은 방법으로 지워진다.
      if (job.target_type !== "CASE_EMBEDDING" && job.case_input_id) {
        const prefix = `${job.owner_id}/${job.case_id}/${job.case_input_id}/`;
        for (const path of await admin.listObjects({ prefix })) {
          await admin.deleteObject({ path });
          deleted += 1;
        }
      }
      // 객체가 남아 있으면 이 함수가 성공 기록을 거부한다. 그것이 재조회 확인이다.
      await sql`select id from private.finish_file_cleanup_job(${job.id}::uuid, ${job.lease_token}::uuid, null)`;
      finished += 1;
    }
  }
  throw new Error("cleanup worker did not drain within the round limit");
};

const buildCase = async ({ sql, client, admin, token, userId, family, index }) => {
  const label = `${family.key}-${index}`;
  const caseRows = await sql`
    select private.create_case(${userId}::uuid, 'LOAN'::public.case_scenario, '삭제 시험 Case',
      ${`delete-${Date.now()}-${label}`}::text, ${hex64(label)}::text) as case_id`;
  const caseId = caseRows[0].case_id;

  const slotRows = await sql`
    select * from private.open_upload_slot(${userId}::uuid, ${caseId}::uuid, 'IMAGE'::public.case_input_type,
      'image/png', ${PNG_BYTES.length}::bigint, 1, ${family.ttl}::integer)`;
  const slot = slotRows[0];

  const upload = await client.putObject({ token, path: slot.object_path, bytes: PNG_BYTES });
  if (!upload.ok) throw new Error(`slot upload failed with status ${upload.status}`);
  await sql`select slot_state from private.confirm_upload_slot(${slot.object_id}::uuid, '89504e47')`;

  // worker 는 소유자 표에 직접 쓰지 못한다. 산출물은 전부 함수로 만든다.
  const pageRows = await sql`
    select pgid from private.register_input_pages(${userId}::uuid, ${caseId}::uuid,
      ${slot.case_input_id}::uuid, 1) as pgid`;
  const pageId = pageRows[0].pgid;

  // OCR 임시물은 서버가 만든다. 회원 JWT 는 slot 경로 밖에 쓸 수 없다.
  const ocrPath = `${userId}/${caseId}/${slot.case_input_id}/ocr-${slot.object_id}.png`;
  const ocrUpload = await admin.putObject({ path: ocrPath, bytes: PNG_BYTES });
  if (!ocrUpload.ok) throw new Error(`ocr artifact upload failed with status ${ocrUpload.status}`);
  const ocrRows = await sql`
    select private.register_ocr_artifact(${userId}::uuid, ${caseId}::uuid, ${slot.case_input_id}::uuid,
      ${pageId}::uuid, 'SPIKE', ${ocrPath}, ${family.ttl}::integer) as id`;

  const embedRows = await sql`
    select private.register_case_embedding(${userId}::uuid, ${caseId}::uuid, ${slot.case_input_id}::uuid,
      ${pageId}::uuid, 'spike', 'v1', ${`[${Array(1024).fill(0).join(",")}]`}::extensions.vector,
      ${hex64(`embed-${label}`)}, ${family.ttl}::integer) as id`;

  // 지우기 전에 열람 URL 을 받아 두고, 실제로 본문이 오는지 먼저 확인한다.
  // 나중의 부재 판정이 의미를 가지려면 지금은 반드시 와야 한다.
  const issuedUrl = await admin.signUrl({ path: slot.object_path });
  const issuedAt = Date.now();
  const before = await readIssuedUrl(issuedUrl, admin.rawFetch);

  return {
    label,
    family: family.key,
    ownerId: userId,
    caseId,
    caseInputId: slot.case_input_id,
    objectId: slot.object_id,
    objectPath: slot.object_path,
    pageId,
    ocrId: ocrRows[0].id,
    ocrPath,
    embeddingId: embedRows[0].id,
    issuedUrl,
    issuedUrlBefore: { status: before.status, bytes: before.bytes },
    issuedAt,
    expiresAt: new Date(slot.expires_at).getTime(),
    createdAt: Date.now(),
  };
};

// family 별 삭제 유발 경로. 제품이 실제로 부르는 함수만 쓴다.
// 청소 대기열에 넣는 것도 제품 함수가 한다. harness 가 직접 넣지 않는다.
const triggerDeletion = async ({ sql, unit, family, progress = () => {} }) => {
  if (family.key === "claim_confirmed") {
    // 입력 단계를 한 칸씩 실제로 전진시킨다. 건너뛰면 제품 경로가 아니다.
    progress(`trigger:${unit.label}:validated`);
    await sql`select id from private.advance_input_stage(${unit.ownerId}::uuid, ${unit.caseId}::uuid,
      ${unit.caseInputId}::uuid, 'VALIDATED'::public.input_stage,
      ${JSON.stringify({ detected_mime: "image/png", magic_signature: "89504e47" })}::text::jsonb)`;
    progress(`trigger:${unit.label}:extracted`);
    await sql`select id from private.advance_input_stage(${unit.ownerId}::uuid, ${unit.caseId}::uuid,
      ${unit.caseInputId}::uuid, 'EXTRACTED'::public.input_stage, '{}'::jsonb)`;
    progress(`trigger:${unit.label}:masked`);
    await sql`select id from private.advance_input_stage(${unit.ownerId}::uuid, ${unit.caseId}::uuid,
      ${unit.caseInputId}::uuid, 'MASKED'::public.input_stage,
      ${JSON.stringify({ masked_text: "마스킹 본문", masked_text_hash: hex64(`mask-${unit.label}`), pii_policy_version: "v1" })}::text::jsonb)`;
    progress(`trigger:${unit.label}:claim`);
    const claimRows = await sql`
      select private.record_extracted_claim(${unit.ownerId}::uuid, ${unit.caseId}::uuid,
        ${unit.caseInputId}::uuid, ${unit.pageId}::uuid, 'PRODUCT_TERM', '확인할 Claim') as id`;
    await sql`select private.confirm_claim(${unit.ownerId}::uuid, ${unit.caseId}::uuid, ${claimRows[0].id}::uuid) as n`;
    // 이 전진이 원본·임시물·vector 를 청소에 넣는다.
    progress(`trigger:${unit.label}:confirmed`);
    await sql`select id from private.advance_input_stage(${unit.ownerId}::uuid, ${unit.caseId}::uuid,
      ${unit.caseInputId}::uuid, 'CLAIM_CONFIRMED'::public.input_stage, '{}'::jsonb)`;
    return {};
  }
  if (family.key === "user_stopped") {
    progress(`trigger:${unit.label}:stop`);
    await sql`select private.stop_case_input(${unit.ownerId}::uuid, ${unit.caseId}::uuid,
      ${unit.caseInputId}::uuid, 'USER_STOPPED') as n`;
    return {};
  }
  if (family.key === "case_deleted") {
    progress(`trigger:${unit.label}:request`);
    const rows = await sql`
      select private.request_case_deletion(${unit.ownerId}::uuid, ${unit.caseId}::uuid,
        ${`delete-spike:${unit.label}`}::text, ${hex64(`req-${unit.label}`)}::text,
        ${hex64(`hmac-${unit.label}`)}::text, 'spike-k1', 'spike-p1') as request_id`;
    return { deletionRequestId: rows[0].request_id };
  }
  // 만료 경계는 유발할 것이 없다. 만들 때 정한 수명이 지나가기를 기다린다.
  return {};
};

// 부재 판정. 특권 키를 쓰지 않는 두 경로를 먼저 본다.
const verifyUnit = async ({ sql, client, admin, token, unit }) => {
  const issued = await readIssuedUrl(unit.issuedUrl, admin.rawFetch);
  const authenticated = await client.getObject({ token, path: unit.objectPath });

  const rows = await sql`
    select
      (select count(*) from private.case_embeddings where id = ${unit.embeddingId}::uuid)::int as live_embeddings,
      (select count(*) from private.file_cleanup_jobs
        where target_id = ${unit.objectId}::uuid and status = 'SUCCEEDED')::int as input_job_done,
      (select count(*) from private.file_cleanup_jobs
        where target_id = ${unit.ocrId}::uuid and status = 'SUCCEEDED')::int as ocr_job_done,
      (select count(*) from private.file_cleanup_jobs
        where target_id = ${unit.embeddingId}::uuid and status = 'SUCCEEDED')::int as embedding_job_done,
      (select max(finished_at) from private.file_cleanup_jobs
        where target_id in (${unit.objectId}::uuid, ${unit.ocrId}::uuid, ${unit.embeddingId}::uuid)
          and status = 'SUCCEEDED') as finished_at,
      (select count(*) from public.deletion_requests
        where target_id = ${unit.caseId}::uuid and status = 'COMPLETED')::int as purged_requests`;
  const r = rows[0];

  const finishedAt = r.finished_at ? new Date(r.finished_at).getTime() : null;
  return {
    label: unit.label,
    family: unit.family,
    issued_url_elapsed_seconds: Math.round((Date.now() - unit.issuedAt) / 1000),
    issued_url_before_status: unit.issuedUrlBefore.status,
    issued_url_before_bytes: unit.issuedUrlBefore.bytes,
    issued_url_after_status: issued.status,
    issued_url_after_bytes: issued.bytes,
    issued_url_served_after: servedContent(issued.status, issued.bytes),
    authenticated_read_after_status: authenticated.status,
    authenticated_read_served_after: authenticated.status >= 200 && authenticated.status < 300,
    live_embeddings: r.live_embeddings,
    // 청소 작업의 성공은 부재를 다시 조회한 뒤에만 기록된다. 그래서 이 셋이
    // 원본·임시물·vector 의 삭제 축 종결을 대신 말해 준다.
    input_job_done: r.input_job_done,
    ocr_job_done: r.ocr_job_done,
    embedding_job_done: r.embedding_job_done,
    purged_requests: r.purged_requests,
    // 만든 시점부터 삭제가 확인된 시점까지의 실제 경과다.
    delete_seconds: finishedAt === null ? null : Math.round((finishedAt - unit.createdAt) / 1000),
  };
};

export const runDeleteSpike = async ({ client, admin, sql, credentials, progress = () => {} }) => {
  const { token, userId } = await client.signIn(credentials);
  const profile = await client.upsertProfile({ token, ownerId: userId });
  if (!profile.ok && profile.status !== 409) throw new Error(`profile upsert failed with status ${profile.status}`);
  progress("signin");

  const units = [];
  for (const family of FAMILIES) {
    for (let i = 0; i < family.cases; i += 1) {
      units.push(await buildCase({ sql, client, admin, token, userId, family, index: i }));
    }
    progress(`built:${family.key}`);
  }

  const deletionRequests = [];
  for (const family of FAMILIES) {
    for (const unit of units.filter((u) => u.family === family.key)) {
      const extra = await triggerDeletion({ sql, unit, family, progress });
      if (extra.deletionRequestId) deletionRequests.push(extra.deletionRequestId);
    }
  }
  progress("triggered");

  // 만료가 지나가기를 기다린다. 시각을 고쳐서 만들지 않는다.
  const dueUnits = units.filter((u) => u.family === "ttl_boundary_due");
  const waitUntil = Math.max(...dueUnits.map((u) => u.expiresAt)) + 2_000;
  const waitedMs = Math.max(0, waitUntil - Date.now());
  if (waitedMs > 0) await new Promise((done) => { setTimeout(done, waitedMs); });
  progress("waited");

  // 만료 청소는 한 번만 돈다. 경계 이전 대상까지 집어가면 그 자리에서 드러난다.
  const sweep = await sql`select kind, affected from private.sweep_expired_raw_objects()`;

  // Worker 를 돌리기 전에 어느 대상이 대기열에 들어갔는지 먼저 센다.
  const queued = await sql`
    select target_id::text as target_id from private.file_cleanup_jobs where status in ('QUEUED', 'RUNNING', 'FAILED')`;
  const queuedIds = new Set(queued.map((row) => row.target_id));
  for (const unit of units) {
    unit.enqueued = [unit.objectId, unit.ocrId, unit.embeddingId]
      .filter((id) => queuedIds.has(String(id))).length;
  }
  progress("swept");

  const worker = await runCleanupWorker({ sql, admin });
  progress("cleaned");

  // Case 삭제는 객체 부재를 확인한 뒤에만 관계형 자식을 지운다.
  let purged = 0;
  for (const requestId of deletionRequests) {
    const rows = await sql`select private.purge_case(${requestId}::uuid) as done`;
    if (rows[0].done === true) purged += 1;
  }
  progress("purged");

  const observations = [];
  for (const unit of units) observations.push(await verifyUnit({ sql, client, admin, token, unit }));

  const deleted = observations.filter((o) => FAMILIES.find((f) => f.key === o.family).expect === "deleted");
  const retained = observations.filter((o) => FAMILIES.find((f) => f.key === o.family).expect === "retained");

  const totals = {
    cases_total: observations.length,
    deleted_cases: deleted.length,
    retained_cases: retained.length,
    // 지운 뒤 남은 것. 하나라도 0 이 아니면 불합격이다.
    residual_case_embeddings: deleted.filter((o) => o.live_embeddings > 0).length,
    // 삭제 축이 종결되지 않은 것. 청소 성공은 부재를 다시 조회한 뒤에만 남는다.
    unfinished_input_jobs: deleted.filter((o) => o.input_job_done === 0).length,
    unfinished_ocr_jobs: deleted.filter((o) => o.ocr_job_done === 0).length,
    unfinished_embedding_jobs: deleted.filter((o) => o.embedding_job_done === 0).length,
    // 특권 키를 쓰지 않는 두 경로. 지운 뒤 본문이 오면 안 된다.
    issued_url_served_after_delete: deleted.filter((o) => o.issued_url_served_after).length,
    authenticated_reads_after_delete: deleted.filter((o) => o.authenticated_read_served_after).length,
    // 발급 URL 이 그냥 만료돼서 안 온 것으로 설명되면 안 된다.
    issued_url_expired_before_check: deleted.filter((o) => o.issued_url_elapsed_seconds >= SIGNED_URL_TTL_SECONDS).length,
    issued_url_served_before_delete: deleted.filter((o) => servedContent(o.issued_url_before_status, o.issued_url_before_bytes)).length,
    max_delete_seconds: deleted.reduce((max, o) => Math.max(max, o.delete_seconds ?? 0), 0),
    // 경계 이전 대상은 청소가 집어가면 안 된다.
    boundary_early_enqueued: units.filter((u) => u.family === "ttl_boundary_early" && u.enqueued > 0).length,
    // 보존 대상은 발급 URL 이 아직 본문을 준다. 특권 없는 경로로 존재를 확인한다.
    boundary_early_objects_present: retained.filter((o) => o.issued_url_served_after).length,
    boundary_due_deleted: observations.filter((o) => o.family === "ttl_boundary_due" && o.input_job_done > 0).length,
    purged_cases: purged,
    purge_requests_completed: observations.filter((o) => o.purged_requests > 0).length,
    cleanup_jobs_finished: worker.finished,
    storage_deletes: worker.deleted,
  };

  // 남겨 둔 경계 이전 대상까지 지우고 끝낸다. 운영 프로젝트에 시험 흔적을 남기지 않는다.
  for (const unit of units.filter((u) => u.family === "ttl_boundary_early")) {
    for (const [type, id] of [["INPUT_OBJECT", unit.objectId], ["OCR_ARTIFACT", unit.ocrId],
      ["CASE_EMBEDDING", unit.embeddingId]]) {
      await sql`select private.enqueue_file_cleanup(${type}::text, ${id}::uuid, 'TTL_EXPIRED'::text)`;
    }
  }
  const teardown = await runCleanupWorker({ sql, admin });
  // 뒷정리 확인은 Storage API 로 한다. 위생 점검이지 부재 판정 경로가 아니다.
  const leftover = await admin.listObjects({ prefix: `${userId}/`, limit: 100 });
  totals.teardown_jobs_finished = teardown.finished;
  totals.leftover_objects_after_teardown = leftover.length;
  progress("teardown");

  return {
    contract: {
      formula_version: FORMULA_VERSION,
      bucket: BUCKET,
      families: FAMILIES.map((f) => ({ key: f.key, reason: f.reason, cases: f.cases, expect: f.expect })),
      total_cases: TOTAL_CASES,
      max_delete_seconds: MAX_DELETE_SECONDS,
      signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
      due_ttl_seconds: DUE_TTL_SECONDS,
      live_ttl_seconds: LIVE_TTL_SECONDS,
      boundary_made_by: "ttl-at-creation",
      // 삭제에는 서버 키가 필요하다. 회원 JWT 는 격리 Bucket 객체를 지울 수 없고
      // 24시간 만료 청소는 회원 접속과 무관하게 돌아야 한다.
      uses_secret_key_for: "delete-and-ocr-write",
      absence_verified_by: ["issued-signed-url", "member-jwt-read"],
      // worker 역할이 읽을 수 있는 표만 본다. 소유자 표는 직접 읽지 않는다.
      state_source: ["private.case_embeddings", "private.file_cleanup_jobs", "public.deletion_requests"],
      // 객체가 사라졌다는 판정은 이 셋으로만 한다. 특권 키로 목록을 조회해 판정하지 않는다.
      // finish_file_cleanup_job 은 객체가 남아 있으면 성공 기록 자체를 거부한다.
      object_absence_source: ["issued-signed-url", "member-jwt-read", "finish_file_cleanup_job"],
      // 청소 대상의 Storage 경로를 돌려주는 함수가 아직 없다. 그동안은 job 이 들고 있는
      // 소유자·Case·입력으로 접두사를 만들어 Storage API 로 찾는다.
      cleanup_path_source: "storage-api-prefix-listing",
    },
    sweep: sweep.map((row) => ({ kind: row.kind, affected: Number(row.affected) })),
    cases: observations,
    totals,
  };
};
