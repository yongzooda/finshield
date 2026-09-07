// B-HEALTH-01: 실제 Next Route 100회·DB 장애·외부 HTTP 전송 계측을 같은 main SHA로 고정한다.
// 실행과 별도 검증은 Credential·원문 없이 원장과 합격식을 다시 대조한다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { runHealthSpike } from "./health-spike.mjs";
import { validateHealthEvidenceResult } from "./health-evidence-policy.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-health-evidence.mjs --run|--validate");
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
if (blockerId !== "B-HEALTH-01") fail("BLOCKER_ID 는 B-HEALTH-01 이어야 합니다.");
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");

export const HEALTH_SCOPE_PATHS = Object.freeze([
  ".github/scripts/provider-adr-digest.mjs", ".github/scripts/health-spike.mjs",
  ".github/scripts/health-evidence-policy.mjs", ".github/scripts/run-health-evidence.mjs",
  ".github/scripts/health-network-audit.mjs", ".github/scripts/test-health-status.mjs",
  ".github/scripts/test-health-evidence.mjs", ".github/workflows/health-evidence.yml",
  "docs/ops/health-status-spike.md", "src/app/api/health/route.ts",
  "src/app/api/health/__tests__/strict.test.ts", "src/lib/finshield/health-status.mjs",
  "src/lib/finshield/health-status.d.mts", "src/lib/finshield/db.ts", "src/lib/finshield/env.ts",
  "src/lib/ops/http.ts", "src/app/api/runtime-manifest/route.ts", "next.config.ts",
  "package.json", "package-lock.json",
]);
const scopeInventory = [...HEALTH_SCOPE_PATHS].sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

const sanitizedFailure = (error) => /^[A-Z_]+$/.test(error?.message ?? "") ? error.message : "HEALTH_HARNESS_FAILED";

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  for (const name of ["FINSHIELD_DATABASE_URL"]) {
    if (!process.env[name]) fail(`${name} 이 필요합니다.`);
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  try {
    const observations = await runHealthSpike({repository,dsn:process.env.FINSHIELD_DATABASE_URL});
    console.log(`${blockerId} 요청 수: ${observations.requests.length}, 외부 전송 계측: ${JSON.stringify(observations.network)}`);
    const result = {
      schema_version: 3, blocker_id: blockerId,
      requirements_blob_sha: gitBlobSha(Buffer.from(requirements)),
      adr_decision_sha256: adrDecisionDigest(adr),
      code_under_test_sha: codeSha, workflow_head_sha: workflowSha, scope_sha256: scopeSha,
      run: { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
      observations,
      environment: { node_version: process.version, region: process.env.EVIDENCE_REGION, transport: "loopback-http-and-supabase-tls" },
      redactions_applied: true,
    };
    const resultErrors = [];
    validateHealthEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`${blockerId} policy failure: ${message}`);
      throw new Error("Health evidence policy failed.");
    }
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(`${blockerId} raw evidence written without credentials or error text.`);
  } catch (error) {
    rmSync(resultPath, { force: true });
    console.error(`${blockerId} live harness failed safely: ${sanitizedFailure(error)}`);
    await exitWithFlushedLogs(1);
  }
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
validateHealthEvidenceResult(result, fail);
const serializedText = resultBytes.toString("utf8");
for (const [name, pattern] of [["dsn", /postgres(?:ql)?:\/\//], ["uuid", /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/], ["token", /eyJ[A-Za-z0-9_-]{10,}/], ["url", /supabase\.co/], ["vercel-token", /\b[A-Za-z0-9]{24}\b/]]) {
  if (pattern.test(serializedText)) fail(`Evidence result에 남으면 안 되는 값이 있습니다: ${name}`);
}
if (errors.length > 0) {
  console.error("Health evidence validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-HEALTH-01 raw evidence satisfies the preregistered policy.");
await exitWithFlushedLogs(0);
