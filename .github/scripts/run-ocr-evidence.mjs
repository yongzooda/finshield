// B-OCR-01: 사전 고정 합성 32문서·112쪽을 실제 Parser·CLOVA에서 측정한다.
// 실행과 별도 검증은 Credential·원문 없이 원장과 합격식을 다시 대조한다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { runOcrQualitySpike, loadQualityFixtures } from "./ocr-quality-spike.mjs";
import { validateOcrEvidenceResult } from "./ocr-evidence-policy.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-ocr-evidence.mjs --run|--validate");
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
  const output = spawnSync("git", ["-C", repository ?? "", "show", `${codeSha}:${path}`], { maxBuffer: 16 * 1024 * 1024 });
  if (output.status !== 0) { fail(`시험 commit에서 '${path}'를 읽을 수 없습니다.`); return ""; }
  commitFiles.set(path, output.stdout);
  return output.stdout;
};

if (!/^[0-9a-f]{40}$/.test(codeSha ?? "") || codeSha !== workflowSha || !repository) {
  fail("Evidence run은 동일한 immutable main SHA와 trusted repository가 필요합니다.");
}
if (blockerId !== "B-OCR-01") fail("BLOCKER_ID 는 B-OCR-01 이어야 합니다.");
const requirements = readAtCommit("docs/02-integrated-requirements.md").toString("utf8");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md").toString("utf8");
const manifest = loadQualityFixtures(repository);

export const OCR_SCOPE_PATHS = Object.freeze([
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/ocr-quality-spike.mjs",
  ".github/scripts/ocr-quality-text.mjs",
  ".github/scripts/ocr-quality-worker.mjs",
  ".github/scripts/ocr-evidence-policy.mjs",
  ".github/scripts/run-ocr-evidence.mjs",
  ".github/scripts/test-ocr-quality.mjs",
  ".github/workflows/ocr-evidence.yml",
  ".github/scripts/file-safety-spike.mjs",
  ".github/scripts/file-safety-fixtures.mjs",
  ".github/scripts/file-safety-inspector.mjs",
  ".github/scripts/file-safety-guard.mjs",
  ".github/scripts/file-safety-policy.mjs",
  ".github/fixtures/file-safety-parser/package.json",
  ".github/fixtures/file-safety-parser/package-lock.json",
  ".github/fixtures/ocr-quality-v1/manifest.json",
  ".github/fixtures/ocr-quality-v2/manifest.json",
  ".github/fixtures/ocr-quality-v2/generate.py",
  "docs/ops/ocr-quality-spike.md",
  ".github/fixtures/ocr-quality-v2/collateral-text.txt",
  ".github/fixtures/ocr-quality-v2/collateral-image.png",
  ".github/fixtures/ocr-quality-v2/collateral-digital.pdf",
  ".github/fixtures/ocr-quality-v2/collateral-scanned.pdf",
  ".github/fixtures/ocr-quality-v2/refund-text.txt",
  ".github/fixtures/ocr-quality-v2/refund-image.png",
  ".github/fixtures/ocr-quality-v2/refund-digital.pdf",
  ".github/fixtures/ocr-quality-v2/refund-scanned.pdf",
  ".github/fixtures/ocr-quality-v2/credit-text.txt",
  ".github/fixtures/ocr-quality-v2/credit-image.png",
  ".github/fixtures/ocr-quality-v2/credit-digital.pdf",
  ".github/fixtures/ocr-quality-v2/credit-scanned.pdf",
  ".github/fixtures/ocr-quality-v2/bridge-text.txt",
  ".github/fixtures/ocr-quality-v2/bridge-image.png",
  ".github/fixtures/ocr-quality-v2/bridge-digital.pdf",
  ".github/fixtures/ocr-quality-v2/bridge-scanned.pdf",
  ".github/fixtures/ocr-quality-v2/insurance-text.txt",
  ".github/fixtures/ocr-quality-v2/insurance-image.png",
  ".github/fixtures/ocr-quality-v2/insurance-digital.pdf",
  ".github/fixtures/ocr-quality-v2/insurance-scanned.pdf",
  ".github/fixtures/ocr-quality-v2/remote-text.txt",
  ".github/fixtures/ocr-quality-v2/remote-image.png",
  ".github/fixtures/ocr-quality-v2/remote-digital.pdf",
  ".github/fixtures/ocr-quality-v2/remote-scanned.pdf",
  ".github/fixtures/ocr-quality-v2/paperwork-text.txt",
  ".github/fixtures/ocr-quality-v2/paperwork-image.png",
  ".github/fixtures/ocr-quality-v2/paperwork-digital.pdf",
  ".github/fixtures/ocr-quality-v2/paperwork-scanned.pdf",
  ".github/fixtures/ocr-quality-v2/earlyrepay-text.txt",
  ".github/fixtures/ocr-quality-v2/earlyrepay-image.png",
  ".github/fixtures/ocr-quality-v2/earlyrepay-digital.pdf",
  ".github/fixtures/ocr-quality-v2/earlyrepay-scanned.pdf"
]);
const scopeInventory = [...OCR_SCOPE_PATHS].sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

const sanitizedFailure = (error) => /^[A-Z_]+$/.test(error?.message ?? "") ? error.message : "OCR_HARNESS_FAILED";

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  for (const name of ["CLOVA_OCR_INVOKE_URL", "CLOVA_OCR_SECRET"]) {
    if (!process.env[name]) fail(`${name} 이 필요합니다.`);
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  try {
    const observations = await runOcrQualitySpike({repository,endpoint:process.env.CLOVA_OCR_INVOKE_URL,secret:process.env.CLOVA_OCR_SECRET});
    console.log(`${blockerId} 고정 문서 ${observations.cases.length}건 측정 완료`);
    const result = {
      schema_version: 3, blocker_id: blockerId,
      requirements_blob_sha: gitBlobSha(Buffer.from(requirements)),
      adr_decision_sha256: adrDecisionDigest(adr),
      code_under_test_sha: codeSha, workflow_head_sha: workflowSha, scope_sha256: scopeSha,
      run: { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
      observations,
      environment: { node_version: process.version, region: process.env.EVIDENCE_REGION, transport: "isolated-pdfjs-and-clova-https" },
      redactions_applied: true,
    };
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
const metrics = validateOcrEvidenceResult(result, fail, {manifest});
console.log(JSON.stringify({metrics}));
const serializedText = resultBytes.toString("utf8");
for (const [name, pattern] of [["dsn", /postgres(?:ql)?:\/\//], ["uuid", /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/], ["token", /eyJ[A-Za-z0-9_-]{10,}/], ["url", /supabase\.co/], ["vercel-token", /\b[A-Za-z0-9]{24}\b/]]) {
  if (pattern.test(serializedText)) fail(`Evidence result에 남으면 안 되는 값이 있습니다: ${name}`);
}
if (errors.length > 0) {
  console.error("Ocr evidence validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-OCR-01 raw evidence satisfies the preregistered policy.");
await exitWithFlushedLogs(0);
