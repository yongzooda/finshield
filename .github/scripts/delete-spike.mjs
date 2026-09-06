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
export const FAMILIES = Object.freeze([
  { key: "claim_confirmed", reason: "CLAIM_CONFIRMED", cases: 10, expect: "deleted" },
  { key: "user_stopped", reason: "USER_STOPPED", cases: 10, expect: "deleted" },
  { key: "case_deleted", reason: "CASE_DELETED", cases: 10, expect: "deleted" },
  { key: "ttl_boundary_due", reason: "TTL_EXPIRED", cases: 5, expect: "deleted" },
  { key: "ttl_boundary_early", reason: "TTL_EXPIRED", cases: 5, expect: "retained" },
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
      let path = null;
      if (job.target_type === "INPUT_OBJECT") {
        const rows = await sql`select object_path from private.input_objects where id = ${job.target_id}::uuid`;
        path = rows[0]?.object_path ?? null;
      } else if (job.target_type === "OCR_ARTIFACT") {
        const rows = await sql`select storage_object_path from private.ocr_artifacts where id = ${job.target_id}::uuid`;
        path = rows[0]?.storage_object_path ?? null;
      }
      if (path) {
        await admin.deleteObject({ path });
        deleted += 1;
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
      'image/png', ${PNG_BYTES.length}::bigint, 1, 3600)`;
  const slot = slotRows[0];

  const upload = await client.putObject({ token, path: slot.object_path, bytes: PNG_BYTES });
  if (!upload.ok) throw new Error(`slot upload failed with status ${upload.status}`);
  await sql`select slot_state from private.confirm_upload_slot(${slot.object_id}::uuid, '89504e47')`;

  const pageRows = await sql`
    insert into public.case_input_pages (owner_id, case_id, case_input_id, page_no, parse_status, locator_schema_version)
    values (${userId}::uuid, ${caseId}::uuid, ${slot.case_input_id}::uuid, 1, 'PARSED', 'v1')
    returning id`;
  const pageId = pageRows[0].id;

  // OCR 임시물은 서버가 만든다. 회원 JWT 는 slot 경로 밖에 쓸 수 없다.
  const ocrPath = `${userId}/${caseId}/${slot.case_input_id}/ocr-${slot.object_id}.png`;
  const ocrUpload = await admin.putObject({ path: ocrPath, bytes: PNG_BYTES });
  if (!ocrUpload.ok) throw new Error(`ocr artifact upload failed with status ${ocrUpload.status}`);
  const ocrRows = await sql`
    insert into private.ocr_artifacts (owner_id, case_id, case_input_id, page_id, provider_code,
      storage_object_path, status, expires_at)
    values (${userId}::uuid, ${caseId}::uuid, ${slot.case_input_id}::uuid, ${pageId}::uuid, 'SPIKE',
      ${ocrPath}, 'AVAILABLE', now() + interval '1 hour')
    returning id`;

  const embedRows = await sql`
    insert into private.case_embeddings (owner_id, case_id, case_input_id, page_id, model_id, model_version,
      dimensions, embedding, masked_content_hash, expires_at)
    values (${userId}::uuid, ${caseId}::uuid, ${slot.case_input_id}::uuid, ${pageId}::uuid,
      'spike', 'v1', 1024, ${`[${Array(1024).fill(0).join(",")}]`}::extensions.vector,
      ${hex64(`embed-${label}`)}, now() + interval '1 hour')
    returning id`;

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
    ocrId: ocrRows[0].id,
    ocrPath,
    embeddingId: embedRows[0].id,
    issuedUrl,
    issuedUrlBefore: { status: before.status, bytes: before.bytes },
    issuedAt,
    createdAt: Date.now(),
  };
};

// family 별 삭제 유발 경로. 제품이 실제로 부르는 함수만 쓴다.
const triggerDeletion = async ({ sql, unit, family }) => {
  if (family.key === "claim_confirmed") {
    await sql`update public.case_inputs set claim_confirmed_at = now(), input_stage = 'CLAIM_CONFIRMED'
               where id = ${unit.caseInputId}::uuid`;
  } else if (family.key === "user_stopped") {
    await sql`update public.case_inputs set input_outcome = 'CANCELLED'
               where id = ${unit.caseInputId}::uuid`;
  } else if (family.key === "case_deleted") {
    const rows = await sql`
      select private.request_case_deletion(${unit.ownerId}::uuid, ${unit.caseId}::uuid,
        ${`delete-spike:${unit.label}`}::text, ${hex64(`req-${unit.label}`)}::text,
        ${hex64(`hmac-${unit.label}`)}::text, 'spike-k1', 'spike-p1') as request_id`;
    return { deletionRequestId: rows[0].request_id };
  } else {
    // 24시간 경계. due 는 만료를 지난 상태로, early 는 아직 남은 상태로 둔다.
    const shift = family.expect === "deleted" ? "-1 minute" : "+5 minutes";
    await sql`update private.input_objects set expires_at = now() + ${shift}::interval where id = ${unit.objectId}::uuid`;
    await sql`update private.ocr_artifacts set expires_at = now() + ${shift}::interval where id = ${unit.ocrId}::uuid`;
    await sql`update private.case_embeddings set expires_at = now() + ${shift}::interval where id = ${unit.embeddingId}::uuid`;
    return {};
  }

  if (family.key === "claim_confirmed" || family.key === "user_stopped") {
    for (const [type, id] of [["INPUT_OBJECT", unit.objectId], ["OCR_ARTIFACT", unit.ocrId],
      ["CASE_EMBEDDING", unit.embeddingId]]) {
      await sql`select private.enqueue_file_cleanup(${type}::text, ${id}::uuid, ${family.reason}::text)`;
    }
  }
  return {};
};

// 부재 판정. 특권 키를 쓰지 않는 두 경로를 먼저 본다.
const verifyUnit = async ({ sql, client, admin, token, unit }) => {
  const issued = await readIssuedUrl(unit.issuedUrl, admin.rawFetch);
  const authenticated = await client.getObject({ token, path: unit.objectPath });

  const rows = await sql`
    select
      (select count(*) from storage.objects o
        where o.bucket_id = ${BUCKET} and o.name = ${unit.objectPath})::int as object_rows,
      (select count(*) from storage.objects o
        where o.bucket_id = ${BUCKET} and o.name = ${unit.ocrPath})::int as ocr_object_rows,
      (select count(*) from private.input_objects
        where id = ${unit.objectId}::uuid and deleted_at is null)::int as live_input_objects,
      (select count(*) from private.ocr_artifacts
        where id = ${unit.ocrId}::uuid and deleted_at is null)::int as live_ocr_artifacts,
      (select count(*) from private.case_embeddings where id = ${unit.embeddingId}::uuid)::int as live_embeddings,
      (select raw_delete_status::text from public.case_inputs where id = ${unit.caseInputId}::uuid) as raw_delete_status,
      (select raw_deleted_at from public.case_inputs where id = ${unit.caseInputId}::uuid) as raw_deleted_at,
      (select count(*) from public.financial_cases where id = ${unit.caseId}::uuid)::int as live_cases`;
  const r = rows[0];

  const rawDeletedAt = r.raw_deleted_at ? new Date(r.raw_deleted_at).getTime() : null;
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
    object_rows: r.object_rows,
    ocr_object_rows: r.ocr_object_rows,
    live_input_objects: r.live_input_objects,
    live_ocr_artifacts: r.live_ocr_artifacts,
    live_embeddings: r.live_embeddings,
    live_cases: r.live_cases,
    raw_delete_status: r.raw_delete_status,
    // Case 를 통째로 지운 family 에서는 행 자체가 사라진다. 그때는 경과를 재지 않는다.
    delete_seconds: rawDeletedAt === null ? null : Math.round((rawDeletedAt - unit.createdAt) / 1000),
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
      const extra = await triggerDeletion({ sql, unit, family });
      if (extra.deletionRequestId) deletionRequests.push(extra.deletionRequestId);
    }
  }
  progress("triggered");

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
    residual_objects: deleted.filter((o) => o.object_rows > 0).length,
    residual_ocr_objects: deleted.filter((o) => o.ocr_object_rows > 0).length,
    residual_input_metadata: deleted.filter((o) => o.live_input_objects > 0).length,
    residual_ocr_metadata: deleted.filter((o) => o.live_ocr_artifacts > 0).length,
    residual_case_embeddings: deleted.filter((o) => o.live_embeddings > 0).length,
    // 특권 키를 쓰지 않는 두 경로. 지운 뒤 본문이 오면 안 된다.
    issued_url_served_after_delete: deleted.filter((o) => o.issued_url_served_after).length,
    authenticated_reads_after_delete: deleted.filter((o) => o.authenticated_read_served_after).length,
    // 발급 URL 이 그냥 만료돼서 안 온 것으로 설명되면 안 된다.
    issued_url_expired_before_check: deleted.filter((o) => o.issued_url_elapsed_seconds >= SIGNED_URL_TTL_SECONDS).length,
    issued_url_served_before_delete: deleted.filter((o) => servedContent(o.issued_url_before_status, o.issued_url_before_bytes)).length,
    max_delete_seconds: deleted.reduce((max, o) => Math.max(max, o.delete_seconds ?? 0), 0),
    // 경계 이전 대상은 청소가 집어가면 안 된다.
    boundary_early_enqueued: units.filter((u) => u.family === "ttl_boundary_early" && u.enqueued > 0).length,
    boundary_early_objects_present: retained.filter((o) => o.object_rows === 1).length,
    boundary_due_deleted: observations.filter((o) => o.family === "ttl_boundary_due" && o.object_rows === 0).length,
    purged_cases: purged,
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
  const leftover = await sql`
    select count(*)::int as n from storage.objects
     where bucket_id = ${BUCKET} and name like ${`${userId}/%`}`;
  totals.teardown_jobs_finished = teardown.finished;
  totals.leftover_objects_after_teardown = leftover[0].n;
  progress("teardown");

  return {
    contract: {
      formula_version: FORMULA_VERSION,
      bucket: BUCKET,
      families: FAMILIES.map((f) => ({ key: f.key, reason: f.reason, cases: f.cases, expect: f.expect })),
      total_cases: TOTAL_CASES,
      max_delete_seconds: MAX_DELETE_SECONDS,
      signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
      // 삭제에는 서버 키가 필요하다. 회원 JWT 는 격리 Bucket 객체를 지울 수 없고
      // 24시간 만료 청소는 회원 접속과 무관하게 돌아야 한다.
      uses_secret_key_for: "delete-and-ocr-write",
      absence_verified_by: ["issued-signed-url", "member-jwt-read"],
    },
    sweep: sweep.map((row) => ({ kind: row.kind, affected: Number(row.affected) })),
    cases: observations,
    totals,
  };
};
