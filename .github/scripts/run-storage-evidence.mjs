// B-STORAGE-01 증거 harness.
//
// --run : 격리 기준 Postgres 에 fixture 를 만들고 동시 예약·Rate·Provider 직렬화를 관측한다.
// --validate : 결과 파일의 metadata 와 사전 고정 정책을 다시 검사한다.
//
// DSN 과 서버 오류 원문은 결과와 로그에 남기지 않는다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { createStorageClient, runStorageSpike } from "./storage-spike.mjs";
import { validateStorageEvidenceResult } from "./storage-evidence-policy.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-storage-evidence.mjs --run|--validate");
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
if (blockerId !== "B-STORAGE-01") fail("BLOCKER_ID 는 B-STORAGE-01 이어야 합니다.");
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");

const migrationListing = spawnSync("git", ["-C", repository ?? "", "ls-tree", "--name-only", `${codeSha}:supabase/migrations`], { encoding: "utf8" });
if (migrationListing.status !== 0) fail("시험 commit 의 Migration 목록을 읽을 수 없습니다.");
const migrationFiles = String(migrationListing.stdout ?? "").split("\n")
  .filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
if (migrationFiles.length === 0) fail("시험 commit 에 Migration 이 없습니다.");

export const STORAGE_SCOPE_PATHS = Object.freeze([
  ...migrationFiles.map((file) => `supabase/migrations/${file}`),
  "supabase/tests/00_supabase_stub.sql",
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/storage-spike.mjs",
  ".github/scripts/storage-evidence-policy.mjs",
  ".github/scripts/run-storage-evidence.mjs",
  ".github/scripts/test-storage-evidence.mjs",
  ".github/workflows/storage-evidence.yml",
  "docs/ops/storage-spike.md",
]);
const scopeInventory = [...STORAGE_SCOPE_PATHS].sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

const sanitizedFailure = (error) => {
  const message = String(error?.message ?? "");
  if (/FINSHIELD_DATABASE_URL/.test(message)) return "storage-missing-credential";
  const code = String(error?.code ?? "").replace(/[^A-Za-z0-9_]/g, "");
  const kind = String(error?.name ?? "unknown").replace(/[^A-Za-z0-9_]/g, "");
  return `storage-or-harness-error:${kind}${code ? `/${code}` : ""}`;
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  for (const name of ["FINSHIELD_DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_TEST_EMAIL", "SUPABASE_TEST_PASSWORD"]) {
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
    const observations = await runStorageSpike({
      client, sql,
      credentials: { email: process.env.SUPABASE_TEST_EMAIL, password: process.env.SUPABASE_TEST_PASSWORD },
      progress: (stage) => console.log(`${blockerId} stage: ${stage}`),
    });
    console.log(`${blockerId} totals: ${JSON.stringify(observations.totals)}`);
    for (const row of observations.scenarios) {
      console.log(`${blockerId} scenario ${row.scenario}: expect=${row.expect} status=${row.status} allowed=${row.allowed}`);
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
    console.log(`${blockerId} transfer: ${JSON.stringify(observations.transfer)}`);
    console.log(`${blockerId} mask: ${JSON.stringify(observations.mask)}`);
    for (const row of observations.scenarios) {
      console.log(`${blockerId} scenario ${row.scenario}: sent=${row.sent} reason=${row.reason ?? "-"} audit=${row.audit_events.join(",")}`);
    }
    const resultErrors = [];
    validateStorageEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`${blockerId} policy failure: ${message}`);
      throw new Error("Storage evidence policy failed.");
    }
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(`${blockerId} raw evidence written without DSN or server error text.`);
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
validateStorageEvidenceResult(result, fail);
const serializedText = resultBytes.toString("utf8");
for (const [name, pattern] of [["dsn", /postgres(?:ql)?:\/\//], ["uuid", /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/], ["token", /eyJ[A-Za-z0-9_-]{10,}/], ["url", /supabase\.co/]]) {
  if (pattern.test(serializedText)) fail(`Evidence result에 남으면 안 되는 값이 있습니다: ${name}`);
}
if (errors.length > 0) {
  console.error("Storage evidence validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-STORAGE-01 raw evidence satisfies the preregistered policy.");
await exitWithFlushedLogs(0);
