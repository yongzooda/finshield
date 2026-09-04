import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { validateEmbedEvidenceResult } from "./provider-embed-policy.mjs";
import { assertUnmeasuredGate, FIXTURE_PATH } from "./provider-embed-evaluation.mjs";
import {
  OFFICIAL_TEXT_INPUT_LIMIT_PER_MINUTE,
  PRICING_SNAPSHOT_DATE,
  REQUEST_INTERVAL_MS,
  retryAfterSeconds,
  runEmbedSpike,
} from "./provider-embed-spike.mjs";

const mode = process.argv[2];
// stdout/stderr are asynchronous pipes on Actions. Drain them before explicit
// exit so a failed quality gate retains its complete sanitized diagnostics.
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) =>
    new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-provider-embed-evidence.mjs --run|--validate");
  await exitWithFlushedLogs(2);
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
const scopePaths = [
  ".github/fixtures/provider-embed-v2.json",
  ".github/scripts/provider-embed-evaluation.mjs",
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/provider-embed-policy.mjs",
  ".github/scripts/provider-embed-spike.mjs",
  ".github/scripts/run-provider-embed-evidence.mjs",
  ".github/workflows/provider-embed-evidence.yml",
  "docs/ops/provider-embed-spike.md",
  "docs/ops/quality-evaluation-plan.md",
  ".github/scripts/test-provider-embed-spike.mjs",
];
const scopeInventory = scopePaths.sort().map((path) => ({
  path,
  blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))),
}));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

const sanitizedFailure = (error) => {
  if (Number.isInteger(error?.status)) {
    const retryAfter = retryAfterSeconds(String(error?.retryAfterSeconds));
    return `provider-http-${error.status}; retry-after-seconds=${retryAfter ?? "unavailable"}`;
  }
  if (["TimeoutError", "AbortError"].includes(error?.name)) return "provider-timeout";
  if (error instanceof Error && /^(Provider embed|Embedding|Expanded|COHERE_API_KEY)/.test(error.message)) return error.message;
  return "provider-or-harness-error";
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Embedding holdout audit token is required.");
    await assertUnmeasuredGate({
      repository: process.env.GITHUB_REPOSITORY,
      runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      fixtureBlob: gitBlobSha(Buffer.from(readAtCommit(FIXTURE_PATH))),
      readJson: async (path, allowMissing = false) => {
        const response = await fetch(`https://api.github.com${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
          signal: AbortSignal.timeout(10_000), redirect: "error",
        });
        if (response.status === 404 && allowMissing) return null;
        if (response.status !== 200) throw new Error("Embedding holdout history could not be verified.");
        return response.json();
      },
    });
    const spike = await runEmbedSpike({
      root: repository,
      apiKey: process.env.COHERE_API_KEY,
      progress: (complete, total) => console.log(`B-EMBED-01 synthetic queries: ${complete}/${total}`),
    });
    const result = {
      schema_version: 3,
      blocker_id: "B-EMBED-01",
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
        pricing_source: "https://cohere.com/pricing",
        transport: "native-fetch",
        provider_request_ids_hash: spike.providerRequestIdsHash,
        api_version: "v2",
        official_text_input_limit_per_minute: OFFICIAL_TEXT_INPUT_LIMIT_PER_MINUTE,
        request_interval_ms: REQUEST_INTERVAL_MS,
      },
      redactions_applied: true,
    };
    const resultErrors = [];
    // Fixed ID/number-only rows permit failed-run diagnosis without raw text,
    // vectors, response bodies or request IDs. They are NOT adoption artifacts.
    const { retrieval, samples, ...aggregate } = spike.observations;
    for (const row of retrieval.rows) console.log(`B-EMBED-01 ranking: ${JSON.stringify(row)}`);
    console.log(`B-EMBED-01 quality slices: ${JSON.stringify(retrieval.slices)}`);
    console.log(`B-EMBED-01 measured samples: ${JSON.stringify(samples)}`);
    console.log(`B-EMBED-01 aggregate metrics: ${JSON.stringify(aggregate)}`);
    validateEmbedEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`B-EMBED-01 policy failure: ${message}`);
      throw new Error("Embedding numeric policy failed.");
    }
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log("B-EMBED-01 raw evidence written with request IDs hashed and texts/vectors/response bodies discarded.");
  } catch (error) {
    rmSync(resultPath, { force: true });
    console.error(`B-EMBED-01 live harness failed safely: ${sanitizedFailure(error)}`);
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
  || result.schema_version !== 3 || result.blocker_id !== "B-EMBED-01" || result.blocker_id !== process.env.BLOCKER_ID
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
validateEmbedEvidenceResult(result, fail);
const serialized = resultBytes.toString("utf8");
for (const pattern of [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?<![A-Za-z0-9])(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}(?![A-Za-z0-9])/,
  /\b\d{6}[- ]?[1-4]\d{6}\b/,
  /(?:cohere|authorization)[-_ ]?(?:api[-_ ]?)?key["'=:\s]+[A-Za-z0-9_-]{12,}/i,
]) {
  if (pattern.test(serialized)) fail("Evidence result에서 secret 또는 직접식별자처럼 보이는 값이 발견됐습니다.");
}
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-EMBED-01 raw evidence satisfies the preregistered numeric policy.");
