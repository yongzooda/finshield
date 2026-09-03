import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";

const mode = process.argv[2];
const resultPath = resolve(process.cwd(), "evidence-output/result.json");

if (mode === "--run") {
  console.error([
    "B-MODEL-01 live harness is intentionally fail-closed in this architecture baseline.",
    "Implement the 50 normal, 20 fault, latency and cost measurements in a reviewed PR,",
    "then add a main-only protected environment secret and update its trusted blob pin",
    "only after B-CI-INTEGRITY is independently enforced.",
  ].join(" "));
  process.exit(1);
}

if (mode !== "--validate") {
  console.error("Usage: run-provider-model-evidence.mjs --run|--validate");
  process.exit(2);
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
const repository = process.env.TRUSTED_REPOSITORY;
const codeSha = process.env.CODE_UNDER_TEST_SHA;
const workflowSha = process.env.WORKFLOW_HEAD_SHA;
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
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");
const scopePaths = [
  ".env.example",
  ".github/scripts/provider-adr-digest.mjs",
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
const expectedResultKeys = [
  "schema_version", "blocker_id", "requirements_blob_sha", "adr_decision_sha256", "code_under_test_sha",
  "workflow_head_sha", "scope_sha256", "run", "observations", "environment", "redactions_applied",
];
if (!exactKeys(result, expectedResultKeys)
  || result.schema_version !== 3
  || result.blocker_id !== "B-MODEL-01" || result.blocker_id !== process.env.BLOCKER_ID
  || result.code_under_test_sha !== codeSha || !/^[0-9a-f]{40}$/.test(codeSha ?? "")
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
if (!exactKeys(result.environment, ["node_version", "region", "fixture_set_hash", "pricing_snapshot_date", "provider_request_ids_hash"])
  || result.environment.node_version !== process.version
  || !/^[a-z0-9-]{2,32}$/.test(result.environment.region ?? "")
  || !/^[0-9a-f]{64}$/.test(result.environment.fixture_set_hash ?? "")
  || !/^20\d{2}-\d{2}-\d{2}$/.test(result.environment.pricing_snapshot_date ?? "")
  || !/^[0-9a-f]{64}$/.test(result.environment.provider_request_ids_hash ?? "")) {
  fail("Evidence environment는 허용된 비식별 inventory 필드만 포함해야 합니다.");
}
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
const observations = result?.observations;
if (!exactKeys(observations, ["auth", "normal", "faults", "latency", "text_runs", "file_runs"])) {
  fail("B-MODEL-01 observations 필드가 고정 schema와 다릅니다.");
} else {
  const { auth, normal, faults, latency, text_runs: textRuns, file_runs: fileRuns } = observations;
  if (!exactKeys(auth, ["http_status", "model_id"]) || auth.http_status !== 200 || auth.model_id !== "claude-sonnet-5") {
    fail("auth/model 관측값이 합격 기준과 다릅니다.");
  }
  if (!exactKeys(normal, ["total", "schema_passed", "strict_tool_passed", "post_validation_passed"])
    || !Number.isInteger(normal.total) || normal.total < 50
    || normal.schema_passed !== normal.total || normal.strict_tool_passed !== normal.total
    || normal.post_validation_passed !== normal.total) {
    fail("정상 schema/tool/post-validation 50건 이상 전량 합격이 아닙니다.");
  }
  if (!exactKeys(faults, ["total", "categories", "false_successes"])
    || !Number.isInteger(faults.total) || faults.total < 20
    || !Array.isArray(faults.categories)
    || JSON.stringify([...faults.categories].sort()) !== JSON.stringify(["429", "refusal", "schema_error", "timeout"])
    || faults.false_successes !== 0) {
    fail("오류 fixture 20건·4개 유형·false success 0건 기준을 충족하지 못했습니다.");
  }
  if (!exactKeys(latency, ["samples", "p95_ms"])
    || !Number.isInteger(latency.samples) || latency.samples < 50
    || !Number.isFinite(latency.p95_ms) || latency.p95_ms < 0 || latency.p95_ms > 10_000) {
    fail("단일 호출 P95 10초 기준을 충족하지 못했습니다.");
  }
  if (!exactKeys(textRuns, ["samples", "p95_ms", "p95_cost_usd"])
    || !Number.isInteger(textRuns.samples) || textRuns.samples < 20
    || !Number.isFinite(textRuns.p95_ms) || textRuns.p95_ms < 0 || textRuns.p95_ms > 105_000
    || !Number.isFinite(textRuns.p95_cost_usd) || textRuns.p95_cost_usd < 0 || textRuns.p95_cost_usd > 0.5) {
    fail("Text 20건 P95 시간·비용 기준을 충족하지 못했습니다.");
  }
  if (!exactKeys(fileRuns, ["samples", "p95_ms", "p95_cost_usd"])
    || !Number.isInteger(fileRuns.samples) || fileRuns.samples < 20
    || !Number.isFinite(fileRuns.p95_ms) || fileRuns.p95_ms < 0 || fileRuns.p95_ms > 155_000
    || !Number.isFinite(fileRuns.p95_cost_usd) || fileRuns.p95_cost_usd < 0 || fileRuns.p95_cost_usd > 0.8) {
    fail("Image/PDF 20건 P95 시간·비용 기준을 충족하지 못했습니다.");
  }
}
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("B-MODEL-01 raw evidence satisfies the preregistered numeric policy.");
