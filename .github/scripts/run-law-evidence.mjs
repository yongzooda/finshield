// B-LAW-01 증거 harness.
//
// --run : Preview·Production 배포의 관측 endpoint 를 불러 법제처 API 를 Referer
//         네 가지로 두드리고 고정 질의의 본문 해시를 남긴다.
// EVIDENCE_MODE=development 이면 관측만 찍고 결과 파일을 만들지 않는다.
//         산식을 고치는 동안 Gate 를 소모하지 않기 위해서다.
// --validate : 결과 파일의 metadata 와 사전 고정 정책을 다시 검사한다.
//
// Vercel token 과 OC 와 오류 원문은 결과와 로그에 남기지 않는다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { createVercelClient } from "./runtime-spike.mjs";
import { runLawSpike } from "./law-spike.mjs";
import { validateLawEvidenceResult } from "./law-evidence-policy.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-law-evidence.mjs --run|--validate");
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
if (blockerId !== "B-LAW-01") fail("BLOCKER_ID 는 B-LAW-01 이어야 합니다.");
const developmentMode = process.env.EVIDENCE_MODE === "development";
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");

export const LAW_SCOPE_PATHS = Object.freeze([
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/runtime-spike.mjs",
  ".github/scripts/law-spike.mjs",
  ".github/scripts/law-evidence-policy.mjs",
  ".github/scripts/run-law-evidence.mjs",
  ".github/scripts/test-law-evidence.mjs",
  ".github/workflows/law-evidence.yml",
  "docs/ops/law-spike.md",
  "src/app/api/law-probe/route.ts",
  "src/lib/ops/http.ts",
  "src/lib/env.ts",
]);
const scopeInventory = [...LAW_SCOPE_PATHS].sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

const sanitizedFailure = (error) => {
  const message = String(error?.message ?? "");
  if (/VERCEL_TOKEN|LAW_API_OC/.test(message)) return "law-missing-credential";
  const code = String(error?.code ?? "").replace(/[^A-Za-z0-9_]/g, "");
  const kind = String(error?.name ?? "unknown").replace(/[^A-Za-z0-9_]/g, "");
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
  return `law-or-harness-error:${kind}${code ? `/${code}` : ""} said="${said}"`;
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  for (const name of ["VERCEL_TOKEN", "VERCEL_PROJECT", "LAW_API_OC"]) {
    if (!process.env[name]) fail(`${name} 이 필요합니다.`);
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  try {
    const vercel = createVercelClient({ token: process.env.VERCEL_TOKEN });
    const observations = await runLawSpike({
      vercel, projectName: process.env.VERCEL_PROJECT, oc: process.env.LAW_API_OC,
      progress: (stage) => console.log(`${blockerId} stage: ${stage}`),
    });
    console.log(`${blockerId} totals: ${JSON.stringify(observations.totals)}`);
    for (const row of observations.records) {
      console.log(`${blockerId} ${row.target}/${row.scenario}#${row.attempt}:`
        + ` referer=${row.referer_kind} status=${row.status} outcome=${row.outcome}`
        + ` code=${row.result_code} type=${row.content_type} bytes=${row.bytes} ms=${row.ms}`
        + ` hash=${String(row.body_sha256).slice(0, 12)}`);
    }
    if (developmentMode) {
      console.log(`${blockerId} development 실행이라 결과 파일을 만들지 않습니다.`);
      await exitWithFlushedLogs(0);
    }
    const result = {
      schema_version: 3, blocker_id: blockerId,
      requirements_blob_sha: gitBlobSha(Buffer.from(requirements)),
      adr_decision_sha256: adrDecisionDigest(adr),
      code_under_test_sha: codeSha, workflow_head_sha: workflowSha, scope_sha256: scopeSha,
      run: { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
      observations,
      environment: { node_version: process.version, region: process.env.EVIDENCE_REGION, transport: "https" },
      redactions_applied: true,
    };
    const resultErrors = [];
    validateLawEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`${blockerId} policy failure: ${message}`);
      throw new Error("Law evidence policy failed.");
    }
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(`${blockerId} raw evidence written without the Vercel token, OC or error text.`);
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
validateLawEvidenceResult(result, fail);
const serializedText = resultBytes.toString("utf8");
for (const [name, pattern] of [["dsn", /postgres(?:ql)?:\/\//], ["uuid", /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/], ["token", /eyJ[A-Za-z0-9_-]{10,}/], ["url", /supabase\.co/], ["vercel-token", /\b[A-Za-z0-9]{24}\b/]]) {
  if (pattern.test(serializedText)) fail(`Evidence result에 남으면 안 되는 값이 있습니다: ${name}`);
}
if (errors.length > 0) {
  console.error("Law evidence validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-LAW-01 raw evidence satisfies the preregistered policy.");
await exitWithFlushedLogs(0);
