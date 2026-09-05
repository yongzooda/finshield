// B-SOURCE-02·B-SOURCE-03 증거 harness.
//
// --run : 공공데이터 API 두 개와 공식 페이지 두 개를 실제로 호출해 Snapshot 관측을 만든다.
// --validate : 결과 파일의 metadata 와 raw-metric 정책을 다시 검사한다.
//
// serviceKey·응답 원문·Stack 은 결과와 로그에 남기지 않는다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { validateSourceEvidenceResult } from "./source-evidence-policy.mjs";
import { redactUrl, runSourceSpike } from "./source-snapshot-spike.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-source-evidence.mjs --run|--validate");
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
  const output = spawnSync("git", ["-C", repository ?? "", "show", `${codeSha}:${path}`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
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
if (!["B-SOURCE-02", "B-SOURCE-03"].includes(blockerId)) fail("BLOCKER_ID 는 B-SOURCE-02 또는 B-SOURCE-03 이어야 합니다.");
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");
export const SOURCE_SCOPE_PATHS = Object.freeze([
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/source-snapshot-spike.mjs",
  ".github/scripts/source-evidence-policy.mjs",
  ".github/scripts/run-source-evidence.mjs",
  ".github/scripts/test-source-evidence.mjs",
  ".github/workflows/source-evidence.yml",
  "docs/ops/source-snapshot-spike.md",
]);
const scopeInventory = [...SOURCE_SCOPE_PATHS].sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

const sanitizedFailure = (error) => {
  if (Number.isInteger(error?.status)) return `source-http-${error.status}`;
  if (typeof error?.resultCode === "string") return `source-result-code-${error.resultCode.replace(/[^0-9A-Za-z]/g, "")}`;
  if (["TimeoutError", "AbortError"].includes(error?.name)) return "source-timeout";
  if (error instanceof Error && /^(Source API|DATA_GO_KR_SERVICE_KEY|Source evidence)/.test(error.message)) return redactUrl(error.message);
  return "source-or-harness-error";
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  try {
    const observations = await runSourceSpike({
      apiKey: process.env.DATA_GO_KR_SERVICE_KEY,
      progress: (api, count, total) => console.log(`${blockerId} ${api} records: ${count}/${total ?? "?"}`),
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
      environment: { node_version: process.version, region: process.env.EVIDENCE_REGION, transport: "native-fetch" },
      redactions_applied: true,
    };
    const { fsc, kinfa, cross_check: cross, official_pages: pages } = observations;
    console.log(`${blockerId} fsc: code ${fsc.result_code}, total ${fsc.total_count}, matches ${fsc.product_matches}, fields ${JSON.stringify(fsc.field_names)}`);
    console.log(`${blockerId} kinfa: code ${kinfa.result_code}, total ${kinfa.total_count}, institutions ${kinfa.institution_matches}`);
    console.log(`${blockerId} cross-check: ${JSON.stringify(cross)}`);
    console.log(`${blockerId} official pages: ${JSON.stringify(pages.map((p) => ({ url: p.url, status: p.status, title: p.title, markers: p.markers })))}`);
    const resultErrors = [];
    validateSourceEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`${blockerId} policy failure: ${message}`);
      throw new Error("Source evidence policy failed.");
    }
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (/serviceKey=(?!REDACTED)/.test(serialized) || (process.env.DATA_GO_KR_SERVICE_KEY && serialized.includes(process.env.DATA_GO_KR_SERVICE_KEY))) {
      throw new Error("Source evidence result would contain the service key.");
    }
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, serialized, { flag: "wx", mode: 0o600 });
    console.log(`${blockerId} raw evidence written with service key redacted and response bodies reduced to public record fields.`);
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
validateSourceEvidenceResult(result, fail);
const serialized = resultBytes.toString("utf8");
for (const pattern of [
  /serviceKey=(?!REDACTED)[A-Za-z0-9%+/=_-]{12,}/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?<![A-Za-z0-9])(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}(?![A-Za-z0-9])/,
  /\b\d{6}[- ]?[1-4]\d{6}\b/,
]) {
  if (pattern.test(serialized)) fail("Evidence result에서 service key 또는 직접식별자처럼 보이는 값이 발견됐습니다.");
}
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log(`${blockerId} raw evidence satisfies the preregistered policy.`);
