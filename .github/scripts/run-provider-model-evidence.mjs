import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { validateModelEvidenceResult } from "./provider-model-policy.mjs";
import {
  FAULT_FIXTURE_MODE,
  INPUT_USD_PER_MILLION,
  OUTPUT_USD_PER_MILLION,
  PRICING_SNAPSHOT_DATE,
  runModelSpike,
} from "./provider-model-spike.mjs";

const mode = process.argv[2];
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-provider-model-evidence.mjs --run|--validate");
  process.exit(2);
}

const resultPath = resolve(process.cwd(), "evidence-output/result.json");
const repository = process.env.TRUSTED_REPOSITORY;
const codeSha = process.env.CODE_UNDER_TEST_SHA;
const workflowSha = process.env.WORKFLOW_HEAD_SHA;
const errors = [];
const fail = (message) => errors.push(message);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBlobSha = (bytes) => createHash("sha1")
  .update(`blob ${bytes.byteLength}\0`)
  .update(bytes)
  .digest("hex");
const commitFiles = new Map();
const readAtCommit = (path) => {
  if (commitFiles.has(path)) return commitFiles.get(path);
  const output = spawnSync("git", ["-C", repository ?? "", "show", `${codeSha}:${path}`], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (output.status !== 0) {
    fail(`시험 commit에서 '${path}'를 읽을 수 없습니다.`);
    return "";
  }
  commitFiles.set(path, output.stdout);
  return output.stdout;
};

if (!/^[0-9a-f]{40}$/.test(codeSha ?? "") || codeSha !== workflowSha || !repository) {
  fail("Evidence run은 동일한 immutable main SHA와 trusted repository가 필요합니다.");
}
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");
const packageLockText = readAtCommit("package-lock.json");
const scopePaths = [
  ".env.example",
  ".github/fixtures/provider-model-v1.json",
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/provider-model-policy.mjs",
  ".github/scripts/provider-model-spike.mjs",
  ".github/scripts/run-provider-model-evidence.mjs",
  ".github/workflows/provider-spike-evidence.yml",
  "package-lock.json",
  "package.json",
];
const scopeInventory = scopePaths.sort().map((path) => ({
  path,
  blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))),
}));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

let packageLock = {};
try {
  packageLock = JSON.parse(packageLockText);
} catch {
  fail("시험 commit의 package-lock.json을 읽을 수 없습니다.");
}
const sdkVersion = packageLock?.packages?.["node_modules/@anthropic-ai/sdk"]?.version;
const sanitizedFailure = (error) => {
  if (Number.isInteger(error?.status)) return `provider-http-${error.status}`;
  if (["APIConnectionTimeoutError", "AbortError"].includes(error?.name)) return "provider-timeout";
  if (error instanceof Error && /^(Fixture M\d{3}|Live model spike metadata|ANTHROPIC_API_KEY)/.test(error.message)) return error.message;
  return "provider-or-harness-error";
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  try {
    const spike = await runModelSpike({
      root: repository,
      apiKey: process.env.ANTHROPIC_API_KEY,
      progress: (complete, total) => console.log(`B-MODEL-01 synthetic fixtures: ${complete}/${total}`),
    });
    const result = {
      schema_version: 3,
      blocker_id: "B-MODEL-01",
      requirements_blob_sha: gitBlobSha(Buffer.from(requirements)),
      adr_decision_sha256: adrDecisionDigest(adr),
      code_under_test_sha: codeSha,
      workflow_head_sha: workflowSha,
      scope_sha256: scopeSha,
      run: {
        id: Number(process.env.GITHUB_RUN_ID),
        attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      },
      observations: spike.observations,
      environment: {
        node_version: process.version,
        region: process.env.EVIDENCE_REGION,
        fixture_set_hash: spike.fixtureSetHash,
        pricing_snapshot_date: PRICING_SNAPSHOT_DATE,
        pricing_input_per_million_usd: INPUT_USD_PER_MILLION,
        pricing_output_per_million_usd: OUTPUT_USD_PER_MILLION,
        sdk_version: sdkVersion,
        provider_request_ids_hash: spike.providerRequestIdsHash,
        fault_fixture_mode: FAULT_FIXTURE_MODE,
      },
      redactions_applied: true,
    };
    const resultErrors = [];
    validateModelEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) throw new Error(resultErrors.join("; "));
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log("B-MODEL-01 raw evidence written with request IDs hashed and response bodies discarded.");
  } catch (error) {
    rmSync(resultPath, { force: true });
    console.error(`B-MODEL-01 live harness failed safely: ${sanitizedFailure(error)}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!existsSync(resultPath)) {
  console.error("Evidence result does not exist; a failed --run must never create PASS evidence.");
  process.exit(1);
}
const resultBytes = readFileSync(resultPath);
if (resultBytes.byteLength === 0 || resultBytes.byteLength > 512 * 1024) {
  console.error("Evidence result size is outside the 1..512 KiB boundary.");
  process.exit(1);
}

let result;
try {
  result = JSON.parse(resultBytes.toString("utf8"));
} catch {
  console.error("Evidence result is not valid JSON.");
  process.exit(1);
}
const expectedResultKeys = [
  "schema_version", "blocker_id", "requirements_blob_sha", "adr_decision_sha256", "code_under_test_sha",
  "workflow_head_sha", "scope_sha256", "run", "observations", "environment", "redactions_applied",
];
if (!exactKeys(result, expectedResultKeys)
  || result.schema_version !== 3
  || result.blocker_id !== "B-MODEL-01" || result.blocker_id !== process.env.BLOCKER_ID
  || result.code_under_test_sha !== codeSha
  || result.workflow_head_sha !== workflowSha || workflowSha !== codeSha
  || result.scope_sha256 !== scopeSha
  || result.requirements_blob_sha !== gitBlobSha(Buffer.from(requirements))
  || result.adr_decision_sha256 !== adrDecisionDigest(adr)
  || !exactKeys(result.run, ["id", "attempt"])
  || result.run.id !== Number(process.env.GITHUB_RUN_ID)
  || result.run.attempt !== Number(process.env.GITHUB_RUN_ATTEMPT)
  || result.redactions_applied !== true) {
  fail("Evidence top-level metadata가 trusted execution context와 다릅니다.");
}
validateModelEvidenceResult(result, fail);
const serialized = resultBytes.toString("utf8");
for (const pattern of [
  /sk-ant-[A-Za-z0-9_-]{12,}/,
  /sk-[A-Za-z0-9_-]{24,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?<![A-Za-z0-9])(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}(?![A-Za-z0-9])/,
  /\b\d{6}[- ]?[1-4]\d{6}\b/,
]) {
  if (pattern.test(serialized)) fail("Evidence result에서 secret 또는 직접식별자처럼 보이는 값이 발견됐습니다.");
}
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("B-MODEL-01 raw evidence satisfies the preregistered numeric policy.");
