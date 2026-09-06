// B-DELETE-01 증거 harness.
//
// --run : 운영 Supabase 에 시험 Case 40건을 만들고 확인·중단·Case 삭제·만료 경계에서
//         원본·OCR 임시물·Case vector·기발급 열람 URL 이 실제로 사라지는지 관측한다.
// --validate : 결과 파일의 metadata 와 사전 고정 정책을 다시 검사한다.
//
// DSN·서버 키·서버 오류 원문은 결과와 로그에 남기지 않는다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { createStorageClient } from "./storage-spike.mjs";
import { createAdminStorageClient, runDeleteSpike } from "./delete-spike.mjs";
import { validateDeleteEvidenceResult } from "./delete-evidence-policy.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-delete-evidence.mjs --run|--validate");
  await exitWithFlushedLogs(2);
}

const resultPath = resolve(process.cwd(), "evidence-output/result.json");
const repository = process.env.TRUSTED_REPOSITORY;
const codeSha = process.env.CODE_UNDER_TEST_SHA;
const workflowSha = process.env.WORKFLOW_HEAD_SHA;
const blockerId = process.env.BLOCKER_ID;
const errors = [];
const fail = (message) => errors.push(message);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBlobSha = (bytes) => createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
const commitFiles = new Map();
const readAtCommit = (path) => {
  if (commitFiles.has(path)) return commitFiles.get(path);
  const output = spawnSync("git", ["-C", repository ?? "", "show", `${codeSha}:${path}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (output.status !== 0) { fail(`시험 commit에서 '${path}'를 읽을 수 없습니다.`); return ""; }
  commitFiles.set(path, output.stdout);
  return output.stdout;
};

if (!/^[0-9a-f]{40}$/.test(codeSha ?? "") || codeSha !== workflowSha || !repository) {
  fail("Evidence run은 동일한 immutable main SHA와 trusted repository가 필요합니다.");
}
if (blockerId !== "B-DELETE-01") fail("BLOCKER_ID 는 B-DELETE-01 이어야 합니다.");
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");

const migrationListing = spawnSync("git", ["-C", repository ?? "", "ls-tree", "--name-only", `${codeSha}:supabase/migrations`], { encoding: "utf8" });
if (migrationListing.status !== 0) fail("시험 commit 의 Migration 목록을 읽을 수 없습니다.");
const migrationFiles = String(migrationListing.stdout ?? "").split("\n")
  .filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
if (migrationFiles.length === 0) fail("시험 commit 에 Migration 이 없습니다.");

export const DELETE_SCOPE_PATHS = Object.freeze([
  ...migrationFiles.map((file) => `supabase/migrations/${file}`),
  "supabase/tests/00_supabase_stub.sql",
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/storage-spike.mjs",
  ".github/scripts/delete-spike.mjs",
  ".github/scripts/delete-evidence-policy.mjs",
  ".github/scripts/run-delete-evidence.mjs",
  ".github/scripts/test-delete-evidence.mjs",
  ".github/workflows/delete-evidence.yml",
  "docs/ops/delete-spike.md",
]);
const scopeInventory = [...DELETE_SCOPE_PATHS].sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

const sanitizedFailure = (error) => {
  const message = String(error?.message ?? "");
  if (/FINSHIELD_DATABASE_URL/.test(message)) return "delete-missing-credential";
  const code = String(error?.code ?? "").replace(/[^A-Za-z0-9_]/g, "");
  const kind = String(error?.name ?? "unknown").replace(/[^A-Za-z0-9_]/g, "");
  // 제약·표 이름은 저장소에 그대로 있는 식별자다. 사용자 자료가 아니다.
  const where = [error?.constraint_name, error?.table_name, error?.routine]
    .filter((part) => typeof part === "string" && part.length > 0)
    .map((part) => part.replace(/[^A-Za-z0-9_.]/g, "")).join("/");
  // 우리가 쓴 오류 문장은 원인을 바로 말해 준다. 다만 식별자·경로·자료는 지운다.
  // Postgres 는 행 내용을 message 가 아니라 DETAIL 에 넣으므로 message 만 쓴다.
  const said = String(message)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/[0-9a-f]{16,}/gi, "<hex>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<mail>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\S*\/\S*\/\S*/g, "<path>")
    .replace(/\d{6,}/g, "<num>")
    .replace(/\s+/g, " ").trim().slice(0, 200);
  return `delete-or-harness-error:${kind}${code ? `/${code}` : ""}${where ? `@${where}` : ""} said="${said}"`;
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  for (const name of ["FINSHIELD_DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY",
    "SUPABASE_TEST_EMAIL", "SUPABASE_TEST_PASSWORD"]) {
    if (!process.env[name]) fail(`${name} 이 필요합니다.`);
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  const { default: postgres } = await import("postgres");
  const dsn = process.env.FINSHIELD_DATABASE_URL;
  const sql = postgres(dsn, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const client = createStorageClient({ baseUrl: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY });
    const admin = createAdminStorageClient({ baseUrl: process.env.SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY });
    const observations = await runDeleteSpike({
      client, admin, sql,
      credentials: { email: process.env.SUPABASE_TEST_EMAIL, password: process.env.SUPABASE_TEST_PASSWORD },
      progress: (stage) => console.log(`${blockerId} stage: ${stage}`),
    });
    console.log(`${blockerId} totals: ${JSON.stringify(observations.totals)}`);
    console.log(`${blockerId} sweep: ${JSON.stringify(observations.sweep)}`);
    // Case 마다 한 줄씩 남긴다. 정책이 막았을 때 어느 Case 가 왜인지 로그로 안다.
    for (const row of observations.cases) {
      console.log(`${blockerId} case ${row.label}: url_before=${row.issued_url_before_status}/${row.issued_url_before_bytes}`
        + ` url_after=${row.issued_url_after_status}/${row.issued_url_after_bytes}`
        + ` jwt_after=${row.authenticated_read_after_status} elapsed=${row.issued_url_elapsed_seconds}`
        + ` jobs=${row.input_job_done}/${row.ocr_job_done}/${row.embedding_job_done}`
        + ` vector=${row.live_embeddings} purge=${row.purge_verified} secs=${row.delete_seconds}`);
    }
    for (const family of new Set(observations.cases.map((row) => row.family))) {
      const rows = observations.cases.filter((row) => row.family === family);
      console.log(`${blockerId} family ${family}: cases=${rows.length}`
        + ` objects_left=${rows.filter((row) => row.object_rows > 0).length}`
        + ` issued_url_after=${rows.filter((row) => row.issued_url_served_after).length}`);
    }
    const result = {
      schema_version: 3, blocker_id: blockerId,
      requirements_blob_sha: gitBlobSha(Buffer.from(requirements)),
      adr_decision_sha256: adrDecisionDigest(adr),
      code_under_test_sha: codeSha, workflow_head_sha: workflowSha, scope_sha256: scopeSha,
      run: { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
      observations,
      environment: { node_version: process.version, region: process.env.EVIDENCE_REGION, transport: "postgres" },
      redactions_applied: true,
    };
    const resultErrors = [];
    validateDeleteEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`${blockerId} policy failure: ${message}`);
      throw new Error("Delete evidence policy failed.");
    }
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(`${blockerId} raw evidence written without DSN, server key or server error text.`);
  } catch (error) {
    rmSync(resultPath, { force: true });
    console.error(`${blockerId} live harness failed safely: ${sanitizedFailure(error)}`);
    await sql.end({ timeout: 5 }).catch(() => {});
    await exitWithFlushedLogs(1);
  }
  await sql.end({ timeout: 5 }).catch(() => {});
  await exitWithFlushedLogs(0);
}

if (!existsSync(resultPath)) {
  console.error("Evidence result does not exist; a failed --run must never create PASS evidence.");
  await exitWithFlushedLogs(1);
}
const resultBytes = readFileSync(resultPath);
if (resultBytes.byteLength === 0 || resultBytes.byteLength > 512 * 1024) {
  console.error("Evidence result size is outside the 1..512 KiB boundary.");
  await exitWithFlushedLogs(1);
}
let result;
try { result = JSON.parse(resultBytes.toString("utf8")); } catch {
  console.error("Evidence result is not valid JSON.");
  await exitWithFlushedLogs(1);
}
if (!exactKeys(result, [
  "schema_version", "blocker_id", "requirements_blob_sha", "adr_decision_sha256", "code_under_test_sha",
  "workflow_head_sha", "scope_sha256", "run", "observations", "environment", "redactions_applied",
])
  || result.schema_version !== 3 || result.blocker_id !== blockerId
  || result.code_under_test_sha !== codeSha || result.workflow_head_sha !== workflowSha || workflowSha !== codeSha
  || result.scope_sha256 !== scopeSha
  || result.requirements_blob_sha !== gitBlobSha(Buffer.from(requirements))
  || result.adr_decision_sha256 !== adrDecisionDigest(adr)
  || !exactKeys(result.run, ["id", "attempt"])
  || result.run.id !== Number(process.env.GITHUB_RUN_ID)
  || result.run.attempt !== Number(process.env.GITHUB_RUN_ATTEMPT)
  || result.redactions_applied !== true) {
  fail("Evidence top-level metadata가 trusted execution context와 다릅니다.");
}
validateDeleteEvidenceResult(result, fail);
const serializedText = resultBytes.toString("utf8");
for (const [name, pattern] of [["dsn", /postgres(?:ql)?:\/\//], ["uuid", /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/], ["token", /eyJ[A-Za-z0-9_-]{10,}/], ["url", /supabase\.co/], ["secret", /sb_secret_[A-Za-z0-9_-]+/], ["path", /[0-9a-f-]{8,}\/[0-9a-f-]{8,}\//]]) {
  if (pattern.test(serializedText)) fail(`Evidence result에 남으면 안 되는 값이 있습니다: ${name}`);
}
if (errors.length > 0) {
  console.error("Delete evidence validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-DELETE-01 raw evidence satisfies the preregistered policy.");
await exitWithFlushedLogs(0);
