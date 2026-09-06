// B-FILE-SAFETY 증거 harness.
//
// --run : 합성 Fixture 를 격리 프로세스에서 검사·Parsing 해 관측을 만든다.
// --validate : 결과 파일의 metadata 와 사전 고정 정책을 다시 검사한다.
//
// 파일 원문·환경변수 값·Stack 은 결과와 로그에 남기지 않는다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { validateFileSafetyEvidenceResult } from "./file-safety-policy.mjs";
import { runFileSafetySpike } from "./file-safety-spike.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-file-safety-evidence.mjs --run|--validate");
  await exitWithFlushedLogs(2);
}

const resultPath = resolve(process.cwd(), "evidence-output/result.json");
const repository = process.env.TRUSTED_REPOSITORY;
const codeSha = process.env.CODE_UNDER_TEST_SHA;
const workflowSha = process.env.WORKFLOW_HEAD_SHA;
const blockerId = process.env.BLOCKER_ID;
const parserRoot = process.env.PARSER_ROOT;
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
  const output = spawnSync("git", ["-C", repository ?? "", "show", `${codeSha}:${path}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
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
if (blockerId !== "B-FILE-SAFETY") fail("BLOCKER_ID 는 B-FILE-SAFETY 여야 합니다.");
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");

export const FILE_SAFETY_SCOPE_PATHS = Object.freeze([
  ".github/fixtures/file-safety-parser/package-lock.json",
  ".github/fixtures/file-safety-parser/package.json",
  ".github/scripts/file-safety-fixtures.mjs",
  ".github/scripts/file-safety-guard.mjs",
  ".github/scripts/file-safety-inspector.mjs",
  ".github/scripts/file-safety-policy.mjs",
  ".github/scripts/file-safety-spike.mjs",
  ".github/scripts/file-safety-worker.mjs",
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/run-file-safety-evidence.mjs",
  ".github/scripts/test-file-safety-evidence.mjs",
  ".github/workflows/file-safety-evidence.yml",
  "docs/ops/file-safety-spike.md",
]);
const scopeInventory = [...FILE_SAFETY_SCOPE_PATHS].sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

// 원인 종류만 남긴다. 메시지 원문에는 경로·환경값이 섞일 수 있어 출력하지 않는다.
const sanitizedFailure = (error) => {
  const message = String(error?.message ?? "");
  if (/network namespace/.test(message)) return `file-safety-no-namespace:${message.split(": ").pop().replace(/[^A-Za-z0-9_-]/g, "")}`;
  if (/no result for/.test(message)) return "file-safety-worker-no-result";
  const kind = String(error?.name ?? "unknown").replace(/[^A-Za-z0-9_]/g, "");
  const code = String(error?.code ?? "").replace(/[^A-Za-z0-9_]/g, "");
  return `file-safety-or-harness-error:${kind}${code ? `/${code}` : ""}`;
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  if (!parserRoot || !existsSync(resolve(parserRoot, "node_modules/pdfjs-dist"))) fail("PARSER_ROOT 에 설치된 Parser 가 필요합니다.");
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  try {
    let done = 0;
    const observations = runFileSafetySpike({
      parserRoot,
      progress: (name, category) => { done += 1; if (done % 10 === 0) console.log(`${blockerId} ${done} fixtures done (latest ${category})`); },
    });
    const result = {
      schema_version: 3,
      blocker_id: blockerId,
      requirements_blob_sha: gitBlobSha(Buffer.from(requirements)),
      adr_decision_sha256: adrDecisionDigest(adr),
      code_under_test_sha: codeSha,
      workflow_head_sha: workflowSha,
      scope_sha256: scopeSha,
      run: { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
      observations,
      environment: { node_version: process.version, region: process.env.EVIDENCE_REGION, isolation: "unshare-net+node-permission" },
      redactions_applied: true,
    };
    console.log(`${blockerId} fixtures: ${JSON.stringify(observations.fixtures.by_category)}`);
    console.log(`${blockerId} totals: ${JSON.stringify(observations.totals)}`);
    console.log(`${blockerId} isolation: ${JSON.stringify({ ...observations.isolation, negative_control: observations.isolation.negative_control })}`);
    console.log(`${blockerId} faults: ${JSON.stringify(observations.faults)}`);
    const resultErrors = [];
    validateFileSafetyEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`${blockerId} policy failure: ${message}`);
      throw new Error("File safety evidence policy failed.");
    }
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, serialized, { flag: "wx", mode: 0o600 });
    console.log(`${blockerId} raw evidence written without file bytes or environment values.`);
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
try {
  result = JSON.parse(resultBytes.toString("utf8"));
} catch {
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
validateFileSafetyEvidenceResult(result, fail);
// 결과에 파일 원문·환경변수 값이 섞이지 않았는지 본다. 관측은 이름·개수·판정만 담는다.
const serializedText = resultBytes.toString("utf8");
const LEAK_PATTERNS = [
  ["pdf-bytes", /%PDF-/],
  ["png-signature", /\\u0089PNG/],
  ["executable", /This program cannot be run in DOS mode/],
  ["canary", /finshield-file-safety-canary/],
  ["absolute-path", /"\/(?:home|Users|tmp|var)\//],
];
for (const [name, pattern] of LEAK_PATTERNS) {
  if (pattern.test(serializedText)) fail(`Evidence result에 남으면 안 되는 값이 있습니다: ${name}`);
}
if (errors.length > 0) {
  console.error("File safety evidence validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-FILE-SAFETY raw evidence satisfies the preregistered policy.");
await exitWithFlushedLogs(0);
