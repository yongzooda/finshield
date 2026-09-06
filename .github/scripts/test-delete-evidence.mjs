// B-DELETE-01 계약 시험. 가짜 fetch 와 메모리 DB 로 harness 조립과 정책을 확인한다.
//
// 가짜 Storage 는 객체가 실제로 사라져야만 부재를 돌려준다. 그래서 삭제를
// 건너뛰는 변형을 넣으면 정책이 아니라 harness 자체가 먼저 어긋난다.
import assert from "node:assert/strict";
import { createStorageClient } from "./storage-spike.mjs";
import {
  DELETED_CASES, DUE_TTL_SECONDS, FAMILIES, FORMULA_VERSION, MAX_DELETE_SECONDS,
  SIGNED_URL_TTL_SECONDS, TOTAL_CASES, createAdminStorageClient, runDeleteSpike, servedContent,
} from "./delete-spike.mjs";
import { validateDeleteEvidenceResult } from "./delete-evidence-policy.mjs";

let passed = 0;
let rejected = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };

// ---------- 1. family 구성 ----------
ok(TOTAL_CASES === 40, "Case 는 40건이어야 한다");
ok(DELETED_CASES === 35, "삭제 대상은 35건이어야 한다");
ok(FAMILIES.filter((f) => f.expect === "retained").length === 1, "보존 대상 family 가 하나 있어야 한다");
ok(FAMILIES.some((f) => f.reason === "CLAIM_CONFIRMED"), "Claim 확인 family 가 있어야 한다");
ok(FAMILIES.some((f) => f.reason === "USER_STOPPED"), "사용자 중단 family 가 있어야 한다");
ok(FAMILIES.some((f) => f.reason === "CASE_DELETED"), "Case 삭제 family 가 있어야 한다");
ok(FAMILIES.filter((f) => f.reason === "TTL_EXPIRED").length === 2, "만료 경계는 이전·이후 둘 다 있어야 한다");
ok(MAX_DELETE_SECONDS === 86400, "상한은 24시간이어야 한다");
ok(SIGNED_URL_TTL_SECONDS > 60, "발급 URL 은 제품보다 길게 잡아 더 엄격히 봐야 한다");
ok(servedContent(200, 12) && !servedContent(200, 0) && !servedContent(400, 12), "본문 판정이 상태와 길이를 함께 봐야 한다");

// ---------- 2. 메모리 Storage 와 DB ----------
const objects = new Set();
const units = new Map();
const jobs = [];
let unitNo = 0;
let requestNo = 0;
let claimNo = 0;
const requests = new Map();
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const fakeFetch = async (url, init) => {
  const text = String(url);
  const method = init?.method ?? "GET";
  if (text.includes("/auth/v1/token")) {
    return new Response(JSON.stringify({ access_token: "tok", user: { id: uuid("11111111", 1) } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (text.includes("/rest/v1/financial_profiles")) return new Response("[]", { status: 201 });
  if (text.includes("/storage/v1/object/sign/") && method === "POST") {
    const path = decodeURIComponent(text.split("/object/sign/finshield-quarantine/")[1]);
    return new Response(JSON.stringify({ signedURL: `/object/sign/finshield-quarantine/${path}?token=t` }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (text.includes("/storage/v1/object/sign/") && method === "GET") {
    const path = decodeURIComponent(text.split("/object/sign/finshield-quarantine/")[1].split("?")[0]);
    return objects.has(path) ? new Response(Buffer.alloc(12, 1), { status: 200 }) : new Response(null, { status: 400 });
  }
  if (text.includes("/storage/v1/object/finshield-quarantine/")) {
    const path = decodeURIComponent(text.split("/object/finshield-quarantine/")[1]);
    if (method === "POST") { objects.add(path); return new Response(null, { status: 200 }); }
    if (method === "DELETE") { objects.delete(path); return new Response(null, { status: 200 }); }
    // 회원 JWT 직접 읽기는 격리 Bucket 에서 항상 막힌다.
    return new Response(null, { status: 400 });
  }
  return new Response(null, { status: 404 });
};

const enqueue = (type, id) => {
  if (!jobs.some((j) => j.target_type === type && j.target_id === id && j.status === "QUEUED")) {
    jobs.push({ id: uuid("55555555", jobs.length + 1), target_type: type, target_id: id, status: "QUEUED", lease_token: null });
  }
};
const unitByAny = (id) => [...units.values()].find((u) => u.objectId === id || u.ocrId === id || u.embeddingId === id);

const fakeSql = (strings, ...values) => {
  const text = strings.join("?");
  const arg = (i) => values[i];
  if (text.includes("create_case")) return Promise.resolve([{ case_id: uuid("22222222", ++unitNo) }]);
  if (text.includes("open_upload_slot")) {
    const caseId = arg(1);
    const unit = {
      caseId, caseInputId: uuid("33333333", unitNo), objectId: uuid("44444444", unitNo),
      pageId: uuid("88888888", unitNo), ocrId: uuid("66666666", unitNo), embeddingId: uuid("77777777", unitNo),
      objectPath: `owner/${caseId}/input/${unitNo}.png`, ocrPath: null,
      inputDeleted: false, ocrDeleted: false, embeddingPresent: true, caseDeleted: false,
      rawDeleteStatus: "PENDING", rawDeletedAt: null,
      // 만든 수명이 곧 경계다. 시각을 나중에 고치지 않는다.
      expired: arg(3) === DUE_TTL_SECONDS,
    };
    units.set(unit.objectId, unit);
    // 이미 지난 시각을 돌려줘 계약 시험이 실제로 기다리지 않게 한다.
    return Promise.resolve([{
      case_input_id: unit.caseInputId, object_id: unit.objectId, object_path: unit.objectPath,
      expires_at: new Date(Date.now() - 5_000).toISOString(),
    }]);
  }
  if (text.includes("confirm_upload_slot")) return Promise.resolve([{ slot_state: "UPLOADED" }]);
  if (text.includes("register_input_pages")) {
    return Promise.resolve([{ pgid: [...units.values()].find((u) => u.caseInputId === arg(2)).pageId }]);
  }
  if (text.includes("register_ocr_artifact")) {
    const unit = [...units.values()].find((u) => u.caseInputId === arg(2));
    unit.ocrPath = arg(5);
    return Promise.resolve([{ id: unit.ocrId }]);
  }
  if (text.includes("register_case_embedding")) {
    return Promise.resolve([{ id: [...units.values()].find((u) => u.caseInputId === arg(2)).embeddingId }]);
  }
  if (text.includes("record_extracted_claim")) return Promise.resolve([{ id: uuid("bbbbbbbb", ++claimNo) }]);
  if (text.includes("confirm_claim")) return Promise.resolve([{ n: 2 }]);
  if (text.includes("advance_input_stage")) {
    // CLAIM_CONFIRMED 전진만 청소를 만든다. 나머지 단계는 상태만 옮긴다.
    if (text.includes("CLAIM_CONFIRMED")) {
      const unit = [...units.values()].find((u) => u.caseInputId === arg(2));
      enqueue("INPUT_OBJECT", unit.objectId); enqueue("OCR_ARTIFACT", unit.ocrId);
      enqueue("CASE_EMBEDDING", unit.embeddingId);
    }
    return Promise.resolve([{ id: arg(2) }]);
  }
  if (text.includes("stop_case_input")) {
    const unit = [...units.values()].find((u) => u.caseInputId === arg(2));
    enqueue("INPUT_OBJECT", unit.objectId); enqueue("OCR_ARTIFACT", unit.ocrId);
    enqueue("CASE_EMBEDDING", unit.embeddingId);
    return Promise.resolve([{ n: 3 }]);
  }
  if (text.includes("request_case_deletion")) {
    const caseId = arg(1);
    const requestId = uuid("99999999", ++requestNo);
    requests.set(requestId, caseId);
    for (const unit of units.values()) {
      if (unit.caseId !== caseId) continue;
      enqueue("INPUT_OBJECT", unit.objectId); enqueue("OCR_ARTIFACT", unit.ocrId); enqueue("CASE_EMBEDDING", unit.embeddingId);
    }
    return Promise.resolve([{ request_id: requestId }]);
  }
  if (text.includes("enqueue_file_cleanup")) { enqueue(arg(0), arg(1)); return Promise.resolve([]); }
  if (text.includes("sweep_expired_raw_objects")) {
    let affected = 0;
    for (const unit of units.values()) {
      if (!unit.expired || unit.inputDeleted) continue;
      enqueue("INPUT_OBJECT", unit.objectId); enqueue("OCR_ARTIFACT", unit.ocrId); enqueue("CASE_EMBEDDING", unit.embeddingId);
      affected += 1;
    }
    return Promise.resolve([{ kind: "INPUT_OBJECT_TTL", affected }, { kind: "ORPHAN_OBJECT", affected: 0 }]);
  }
  if (text.includes("from private.file_cleanup_jobs where status in")) {
    return Promise.resolve(jobs.filter((j) => j.status === "QUEUED").map((j) => ({ target_id: j.target_id })));
  }
  if (text.includes("claim_file_cleanup_jobs")) {
    const picked = jobs.filter((j) => j.status === "QUEUED");
    for (const job of picked) { job.status = "RUNNING"; job.lease_token = uuid("aaaaaaaa", 1); }
    return Promise.resolve(picked.map((j) => ({ ...j })));
  }
  if (text.includes("select object_path from private.input_objects")) {
    return Promise.resolve([{ object_path: unitByAny(arg(0)).objectPath }]);
  }
  if (text.includes("select storage_object_path from private.ocr_artifacts")) {
    return Promise.resolve([{ storage_object_path: unitByAny(arg(0)).ocrPath }]);
  }
  if (text.includes("finish_file_cleanup_job")) {
    const job = jobs.find((j) => j.id === arg(0));
    const unit = unitByAny(job.target_id);
    // 운영 함수와 같은 규칙이다. 객체가 남아 있으면 성공을 기록하지 않는다.
    if (job.target_type === "INPUT_OBJECT") {
      if (objects.has(unit.objectPath)) throw new Error("object still present");
      unit.inputDeleted = true;
    } else if (job.target_type === "OCR_ARTIFACT") {
      if (objects.has(unit.ocrPath)) throw new Error("ocr object still present");
      unit.ocrDeleted = true;
    } else { unit.embeddingPresent = false; }
    job.status = "SUCCEEDED";
    if (unit.inputDeleted && unit.ocrDeleted && !unit.embeddingPresent && unit.rawDeleteStatus !== "SUCCEEDED") {
      unit.rawDeleteStatus = "SUCCEEDED"; unit.rawDeletedAt = new Date().toISOString();
    }
    return Promise.resolve([{ id: job.id }]);
  }
  if (text.includes("purge_case")) {
    const caseId = requests.get(arg(0));
    const members = [...units.values()].filter((u) => u.caseId === caseId);
    const ready = members.every((u) => u.inputDeleted && u.ocrDeleted && !u.embeddingPresent);
    if (ready) for (const unit of members) unit.caseDeleted = true;
    return Promise.resolve([{ done: ready }]);
  }
  if (text.includes("as object_rows")) {
    const unit = [...units.values()].find((u) => u.objectPath === arg(1));
    return Promise.resolve([{
      object_rows: objects.has(unit.objectPath) ? 1 : 0,
      ocr_object_rows: objects.has(unit.ocrPath) ? 1 : 0,
      live_embeddings: unit.embeddingPresent ? 1 : 0,
      input_job_done: unit.inputDeleted ? 1 : 0,
      ocr_job_done: unit.ocrDeleted ? 1 : 0,
      embedding_job_done: unit.embeddingPresent ? 0 : 1,
      finished_at: unit.rawDeletedAt,
      purged_requests: unit.caseDeleted ? 1 : 0,
    }]);
  }
  if (text.includes("from storage.objects")) {
    return Promise.resolve([{ n: [...units.values()].filter((u) => objects.has(u.objectPath) || objects.has(u.ocrPath)).length }]);
  }
  return Promise.resolve([]);
};

// ---------- 3. harness 조립 ----------
const client = createStorageClient({ baseUrl: "https://demo.supabase.co/", anonKey: "anon", fetchImpl: fakeFetch });
const admin = createAdminStorageClient({ baseUrl: "https://demo.supabase.co/", secretKey: "sb_secret_x", fetchImpl: fakeFetch });
const observations = await runDeleteSpike({
  client, admin, sql: fakeSql, credentials: { email: "a@b.c", password: "x" }, progress: () => {},
});

ok(observations.cases.length === TOTAL_CASES, "Case 기록이 40건이어야 한다");
ok(observations.contract.formula_version === FORMULA_VERSION, "산식 버전이 계약에 남아야 한다");
ok(observations.contract.uses_secret_key_for === "delete-and-ocr-write", "서버 키 사용 범위가 남아야 한다");
ok(observations.totals.residual_objects === 0, "삭제 대상 객체가 남지 않아야 한다");
ok(observations.totals.issued_url_served_after_delete === 0, "기발급 URL 이 삭제 뒤 통하면 안 된다");
ok(observations.totals.issued_url_served_before_delete === DELETED_CASES, "삭제 전에는 발급 URL 이 통해야 한다");
ok(observations.totals.boundary_early_enqueued === 0, "만료 이전 대상이 대기열에 들어가면 안 된다");
ok(observations.totals.boundary_early_objects_present === 5, "만료 이전 대상은 남아 있어야 한다");
ok(observations.totals.boundary_due_deleted === 5, "만료를 지난 대상은 지워져야 한다");
ok(observations.totals.purged_cases === 10, "Case 삭제 요청이 모두 Purge 돼야 한다");
ok(observations.totals.leftover_objects_after_teardown === 0, "시험이 객체를 남기지 않아야 한다");
ok(!JSON.stringify(observations).includes("sb_secret_"), "결과에 서버 키가 남지 않아야 한다");
ok(!JSON.stringify(observations.cases).includes("owner/"), "결과에 객체 경로가 남지 않아야 한다");
ok(observations.contract.boundary_made_by === "ttl-at-creation", "경계를 만든 방식이 계약에 남아야 한다");
ok(observations.contract.due_ttl_seconds === DUE_TTL_SECONDS, "만료 수명이 계약에 남아야 한다");

// ---------- 4. 정책 ----------
const good = () => ({
  schema_version: 3, blocker_id: "B-DELETE-01", requirements_blob_sha: "a".repeat(40), adr_decision_sha256: "b".repeat(64),
  code_under_test_sha: "c".repeat(40), workflow_head_sha: "c".repeat(40), scope_sha256: "d".repeat(64),
  run: { id: 1, attempt: 1 }, environment: {}, redactions_applied: true,
  observations: JSON.parse(JSON.stringify(observations)),
});
const check = (result) => { const errors = []; validateDeleteEvidenceResult(result, (m) => errors.push(m)); return errors; };
assert.deepEqual(check(good()), [], "기준 결과는 정책을 통과해야 한다");
passed += 1;

const rejects = (name, mutate) => {
  const result = good();
  mutate(result.observations);
  assert.ok(check(result).length > 0, `정책이 '${name}' 를 거부해야 한다`);
  rejected += 1;
};
const deletedRow = (o) => o.cases.find((row) => row.family === "claim_confirmed");
rejects("산식 변경", (o) => { o.contract.formula_version = "other"; });
rejects("Bucket 변경", (o) => { o.contract.bucket = "public"; });
rejects("family 축소", (o) => { o.contract.families = o.contract.families.slice(0, 2); });
rejects("24시간 상한 완화", (o) => { o.contract.max_delete_seconds = 999999; });
rejects("특권 키로 부재 판정", (o) => { o.contract.absence_verified_by = ["service-role-list"]; });
rejects("서버 키 사용 범위 변경", (o) => { o.contract.uses_secret_key_for = "everything"; });
rejects("Case 수 부족", (o) => { o.cases.pop(); });
rejects("원본 객체 잔존", (o) => { deletedRow(o).object_rows = 1; o.totals.residual_objects = 1; });
rejects("청소 미종결", (o) => { deletedRow(o).input_job_done = 0; o.totals.unfinished_input_jobs = 1; });
rejects("상태 판정 표 변경", (o) => { o.contract.state_source = ["public.case_inputs"]; });
rejects("경로 출처 변경", (o) => { o.contract.cleanup_path_source = "database"; });
rejects("OCR 임시 객체 잔존", (o) => { deletedRow(o).ocr_object_rows = 1; o.totals.residual_ocr_objects = 1; });
rejects("Case vector 잔존", (o) => { deletedRow(o).live_embeddings = 1; o.totals.residual_case_embeddings = 1; });
rejects("기발급 URL 이 삭제 뒤 통함", (o) => {
  const row = deletedRow(o); row.issued_url_after_status = 200; row.issued_url_after_bytes = 12;
  row.issued_url_served_after = true; o.totals.issued_url_served_after_delete = 1;
});
rejects("회원 JWT 로 삭제 뒤 읽힘", (o) => {
  const row = deletedRow(o); row.authenticated_read_after_status = 200; row.authenticated_read_served_after = true;
  o.totals.authenticated_reads_after_delete = 1;
});
rejects("삭제 전 URL 이 통하지 않음", (o) => {
  const row = deletedRow(o); row.issued_url_before_status = 400; row.issued_url_before_bytes = 0;
  o.totals.issued_url_served_before_delete = DELETED_CASES - 1;
});
rejects("만료로 설명되는 관측", (o) => {
  deletedRow(o).issued_url_elapsed_seconds = SIGNED_URL_TTL_SECONDS; o.totals.issued_url_expired_before_check = 1;
});
rejects("24시간 초과", (o) => { deletedRow(o).delete_seconds = MAX_DELETE_SECONDS + 1; o.totals.max_delete_seconds = MAX_DELETE_SECONDS + 1; });
rejects("경계 이전 대상 선삭제", (o) => { o.totals.boundary_early_enqueued = 1; });
rejects("경계 이전 대상 소멸", (o) => { o.totals.boundary_early_objects_present = 0; });
rejects("경계 이후 대상 잔존", (o) => { o.totals.boundary_due_deleted = 4; });
rejects("Purge 미완료", (o) => { o.totals.purged_cases = 9; });
rejects("시험 흔적 잔존", (o) => { o.totals.leftover_objects_after_teardown = 1; });
rejects("만료 경계를 시각 조작으로 만듦", (o) => { o.contract.boundary_made_by = "expires-at-update"; });
rejects("만료 수명 변경", (o) => { o.contract.due_ttl_seconds = 1; });
rejects("보존 수명 변경", (o) => { o.contract.live_ttl_seconds = 10; });
rejects("만료 청소 기록 없음", (o) => { o.sweep = []; });
rejects("observations 키 추가", (o) => { o.extra = 1; });

console.log(`B-DELETE-01 계약 시험 통과: 합격 ${passed}건, 정책 거부 ${rejected}건.`);
