// B-SUPABASE-01 증거 harness.
//
// --run : 격리된 기준 Postgres(pgvector)에 Stub·Migration·불변식 시험을 적용하고
//         카탈로그 digest 를 잰 뒤, 운영 프로젝트를 finshield_worker 로 관측해
//         두 digest 를 비교한다. 결과를 evidence-output/result.json 에 쓴다.
// --validate : 결과 파일의 metadata 와 raw-metric 정책을 다시 검사한다.
//
// DSN·비밀번호·서버 오류 원문은 결과와 로그에 남기지 않는다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { expectedInventory, FORMULA_VERSION, validateSupabaseEvidenceResult } from "./supabase-evidence-policy.mjs";
import { collectRemoteObservations, collectSchemaDigests, MEMBER_ONLY_TABLES, TRACKED_SCHEMAS } from "../../supabase/tests/verify-remote.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-supabase-evidence.mjs --run|--validate");
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
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");
const inventory = repository ? expectedInventory(repository) : { migrations: [], tests: [] };
const scopePaths = [
  ...inventory.migrations.map((f) => `supabase/migrations/${f}`),
  "supabase/tests/00_supabase_stub.sql",
  ...inventory.tests.map((f) => `supabase/tests/${f}`),
  "supabase/tests/run-local.sh",
  "supabase/tests/verify-remote.mjs",
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/supabase-evidence-policy.mjs",
  ".github/scripts/run-supabase-evidence.mjs",
  ".github/scripts/test-supabase-evidence.mjs",
  ".github/workflows/supabase-evidence.yml",
  "docs/ops/supabase-evidence.md",
  "docs/ops/supabase-project.md",
];
const scopeInventory = scopePaths.sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

// psql 로 파일 하나를 적용한다. 서버 메시지 원문은 돌려주지 않고 종류만 남긴다.
const psqlFile = (dsn, file, { quietNotices = false } = {}) => {
  const output = spawnSync("psql", [dsn, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PGOPTIONS: quietNotices ? "-c client_min_messages=warning" : "-c client_min_messages=notice" },
  });
  return { status: output.status, stdout: output.stdout ?? "", stderr: output.stderr ?? "" };
};

const sanitizedFailure = (error) => {
  if (error instanceof Error && /^(Supabase evidence|Migration|Invariant|Remote|Local)/.test(error.message)) return error.message;
  if (["TimeoutError", "AbortError"].includes(error?.name)) return "database-timeout";
  if (typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) return `database-error-${error.code}`;
  return "database-or-harness-error";
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  try {
    const localDsn = process.env.LOCAL_DATABASE_URL;
    const remoteDsn = process.env.FINSHIELD_DATABASE_URL;
    if (!localDsn || !remoteDsn) throw new Error("Supabase evidence needs LOCAL_DATABASE_URL and FINSHIELD_DATABASE_URL.");
    if (!/^postgres(ql)?:\/\/[^/]+:6543\//.test(remoteDsn.replace(/:[^:@/]+@/, ":x@"))) {
      throw new Error("Remote DSN must use the Supavisor pooler port 6543.");
    }

    // 1. 기준 DB: Stub → Migration
    const applyOrder = ["supabase/tests/00_supabase_stub.sql", ...inventory.migrations.map((f) => `supabase/migrations/${f}`)];
    for (const relative of applyOrder) {
      const result = psqlFile(localDsn, resolve(repository, relative), { quietNotices: true });
      if (result.status !== 0) throw new Error(`Migration apply failed at ${relative}`);
      console.log(`B-SUPABASE-01 applied ${relative}`);
    }

    // 2. 불변식 시험. NOTICE 의 거부·허용 확인 행을 세고 MATRIX 요약을 모은다.
    const filesPassed = [];
    const filesFailed = [];
    let assertionsPassed = 0;
    let assertionsFailed = 0;
    const matrix = {};
    for (const file of inventory.tests) {
      const result = psqlFile(localDsn, resolve(repository, `supabase/tests/${file}`));
      const lines = `${result.stdout}\n${result.stderr}`.split("\n");
      const passed = lines.filter((l) => /(거부 확인|허용 확인):/.test(l)).length;
      const failed = lines.filter((l) => /거부되어야 할 문장이 통과|허용되어야 할 문장이 실패/.test(l)).length;
      assertionsPassed += passed;
      assertionsFailed += failed;
      for (const line of lines) {
        const match = line.match(/MATRIX (\{.*\})\s*$/);
        if (match) Object.assign(matrix, JSON.parse(match[1]));
      }
      if (result.status === 0 && lines.some((l) => l.includes("통과했습니다"))) filesPassed.push(file);
      else filesFailed.push(file);
      console.log(`B-SUPABASE-01 test ${file}: ${result.status === 0 ? "passed" : "FAILED"} (${passed} assertions)`);
    }
    if (filesFailed.length > 0) throw new Error(`Invariant tests failed: ${filesFailed.join(", ")}`);

    // 3. 기준 DB digest
    const localSql = postgres(localDsn, { prepare: false, max: 1, idle_timeout: 5 });
    let localSchema;
    try {
      localSchema = await collectSchemaDigests(localSql);
    } finally {
      await localSql.end({ timeout: 5 });
    }

    // 4. 운영 관측
    const remote = await collectRemoteObservations(remoteDsn);

    const result = {
      schema_version: 3,
      blocker_id: "B-SUPABASE-01",
      requirements_blob_sha: gitBlobSha(Buffer.from(requirements)),
      adr_decision_sha256: adrDecisionDigest(adr),
      code_under_test_sha: codeSha,
      workflow_head_sha: workflowSha,
      scope_sha256: scopeSha,
      run: { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
      observations: {
        contract: {
          formula_version: FORMULA_VERSION,
          tracked_schemas: [...TRACKED_SCHEMAS],
          migration_files: inventory.migrations,
          test_files: inventory.tests,
          member_only_tables: [...MEMBER_ONLY_TABLES],
        },
        local: {
          files_passed: filesPassed,
          files_failed: filesFailed,
          assertions_passed: assertionsPassed,
          assertions_failed: assertionsFailed,
          matrix,
          schema: localSchema,
        },
        remote,
        schema_match: {
          tables: localSchema.tables_digest === remote.schema.tables_digest,
          constraints: localSchema.constraint_digest === remote.schema.constraint_digest,
          indexes: localSchema.index_digest === remote.schema.index_digest,
        },
      },
      environment: {
        node_version: process.version,
        region: process.env.EVIDENCE_REGION,
        local_image: process.env.LOCAL_DATABASE_IMAGE ?? "pgvector/pgvector:pg17",
        psql_version: (spawnSync("psql", ["--version"], { encoding: "utf8" }).stdout ?? "").trim(),
        remote_host_role: remote.host_role,
      },
      redactions_applied: true,
    };
    console.log(`B-SUPABASE-01 local schema: ${JSON.stringify(localSchema)}`);
    console.log(`B-SUPABASE-01 remote schema: ${JSON.stringify(remote.schema)}`);
    console.log(`B-SUPABASE-01 matrix: ${JSON.stringify(matrix)}`);
    console.log(`B-SUPABASE-01 schema match: ${JSON.stringify(result.observations.schema_match)}`);
    const resultErrors = [];
    validateSupabaseEvidenceResult(result, (message) => resultErrors.push(message), repository);
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`B-SUPABASE-01 policy failure: ${message}`);
      throw new Error("Supabase evidence policy failed.");
    }
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log("B-SUPABASE-01 raw evidence written without DSN, passwords or server error text.");
  } catch (error) {
    rmSync(resultPath, { force: true });
    console.error(`B-SUPABASE-01 harness failed safely: ${sanitizedFailure(error)}`);
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
  || result.schema_version !== 3 || result.blocker_id !== "B-SUPABASE-01" || result.blocker_id !== process.env.BLOCKER_ID
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
validateSupabaseEvidenceResult(result, fail, repository);
const serialized = resultBytes.toString("utf8");
for (const pattern of [
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:password|passwd|pwd)["'=:\s]+[^\s"']{6,}/i,
]) {
  if (pattern.test(serialized)) fail("Evidence result에서 DSN·자격증명·직접식별자처럼 보이는 값이 발견됐습니다.");
}
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-SUPABASE-01 raw evidence satisfies the preregistered policy.");
