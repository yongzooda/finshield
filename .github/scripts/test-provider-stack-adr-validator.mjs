import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import {
  adoptionFilesAreSafe,
  adrDecisionDigest,
  computeEvidenceScopeDigest,
  evidencePolicies,
  gitBlobSha,
  validateEvidenceIndex,
  validateModelEvidenceResult,
} from "./provider-evidence.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const validatorPath = ".github/scripts/validate-provider-stack-adr.mjs";
const fixturePaths = [
  validatorPath,
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/provider-evidence.mjs",
  ".github/scripts/run-provider-model-evidence.mjs",
  ".github/workflows/pr-check.yml",
  ".github/workflows/provider-spike-evidence.yml",
  ".env.example",
  "src/lib/env.ts",
  "src/app/api/mcp/route.ts",
  "AGENTS.md",
  "CLAUDE.md",
  "HANDOFF.md",
  "README.md",
  "docs/README.md",
  "docs/02-integrated-requirements.md",
  "docs/03-database-spec.md",
  "docs/adr/001-p0-provider-stack.md",
  "package.json",
  "package-lock.json",
];

const makeFixture = () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "finshield-provider-validator-")));
  for (const relativePath of fixturePaths) {
    const destination = resolve(fixture, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(root, relativePath), destination);
  }
  symlinkSync(resolve(root, "node_modules"), resolve(fixture, "node_modules"), "dir");
  return fixture;
};

const execute = (mutate = () => {}, extraEnv = {}) => {
  const fixture = makeFixture();
  try {
    mutate(fixture);
    return spawnSync(process.execPath, [validatorPath], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "", GITHUB_TOKEN: "", ...extraEnv },
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
};

const update = (fixture, relativePath, transform) => {
  const path = resolve(fixture, relativePath);
  writeFileSync(path, transform(readFileSync(path, "utf8")));
};

const expectPass = (name, mutate, env) => {
  const result = execute(mutate, env);
  if (result.status !== 0) throw new Error(`${name}: expected PASS\n${result.stderr}${result.stdout}`);
};

const expectFail = (name, mutate, expected) => {
  const result = execute(mutate);
  const output = `${result.stderr}${result.stdout}`;
  if (result.status === 0 || !expected.test(output)) {
    throw new Error(`${name}: expected failure matching ${expected}\n${output}`);
  }
};

const expectPartialEvidence = async ({
  artifactAgeMs = 60_000,
  adoptionMerged = false,
  adoptedContentMismatch = false,
  adoptedLedgerDecoy = false,
  trustedAPathMismatch = null,
  expectedError = null,
} = {}) => {
  const fixture = makeFixture();
  try {
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "validator@example.invalid"],
      ["config", "user.name", "Provider Validator Test"],
      ["add", "--", ...fixturePaths],
      ["commit", "-qm", "test: trusted main fixture"],
    ]) {
      const git = spawnSync("git", args, {
        cwd: fixture,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2026-09-03T00:00:00Z",
          GIT_COMMITTER_DATE: "2026-09-03T00:00:00Z",
        },
      });
      if (git.status !== 0) throw new Error(`git ${args[0]} failed: ${git.stderr}${git.stdout}`);
    }
    const codeUnderTestSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8" }).stdout.trim();
    const workflowHeadSha = codeUnderTestSha;
    const currentHeadSha = "b".repeat(40);
    const adoptionPrNumber = 135;
    const nowMs = Date.now();
    const artifactCreatedAt = new Date(nowMs - artifactAgeMs).toISOString();
    const adoptedAt = new Date(nowMs - Math.min(30_000, Math.floor(artifactAgeMs / 2))).toISOString();
    const runId = 12345;
    const workflowId = 67890;
    const artifactId = 24680;
    const workflowBlobSha = "aeb7baa6ac9b7e9e597769b83a1f58db097a7f76";
    const harnessBlobSha = "d296230b83e1bfc2ab5daeb2bd6c2ed1e6d55802";
    const trustedExecutionBlobs = new Map([
      [".github/workflows/provider-spike-evidence.yml", workflowBlobSha],
      [".github/scripts/run-provider-model-evidence.mjs", harnessBlobSha],
      [".github/scripts/provider-adr-digest.mjs", "a0d89bbd01fcdd4cc2659afb29d243ba2bdfc099"],
      ["package.json", "ecb26cd086f874ea4f989d50f2719a8390c282de"],
      ["package-lock.json", "678296a5f7e2256799413740041886f29f939191"],
    ]);
    const requirementsBlob = "5dd728c7d396ebfe283dd05eb79d56a792a03dfd";
    update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
      "| `B-MODEL-01` | Anthropic Sonnet 5 auth·quota·structured output·strict tool·P95·cost | NOT-EVALUATED |",
      "| `B-MODEL-01` | Anthropic Sonnet 5 auth·quota·structured output·strict tool·P95·cost | PASS |",
    ));
    const scopeErrors = [];
    const scopeSha = computeEvidenceScopeDigest(
      fixture,
      evidencePolicies["B-MODEL-01"],
      (message) => scopeErrors.push(message),
    );
    if (!scopeSha || scopeErrors.length > 0) throw new Error(`fixture scope failed: ${scopeErrors.join("\n")}`);
    const result = {
      schema_version: 3,
      blocker_id: "B-MODEL-01",
      requirements_blob_sha: requirementsBlob,
      adr_decision_sha256: adrDecisionDigest(readFileSync(resolve(fixture, "docs/adr/001-p0-provider-stack.md"), "utf8")),
      code_under_test_sha: codeUnderTestSha,
      workflow_head_sha: workflowHeadSha,
      scope_sha256: scopeSha,
      run: { id: runId, attempt: 1 },
      observations: {
        auth: { http_status: 200, model_id: "claude-sonnet-5" },
        normal: { total: 50, schema_passed: 50, strict_tool_passed: 50, post_validation_passed: 50 },
        faults: { total: 20, categories: ["429", "refusal", "schema_error", "timeout"], false_successes: 0 },
        latency: { samples: 50, p95_ms: 9_500 },
        text_runs: { samples: 20, p95_ms: 100_000, p95_cost_usd: 0.49 },
        file_runs: { samples: 20, p95_ms: 150_000, p95_cost_usd: 0.79 },
      },
      environment: {
        node_version: process.version,
        region: "test",
        fixture_set_hash: "d".repeat(64),
        pricing_snapshot_date: "2026-09-03",
        provider_request_ids_hash: "e".repeat(64),
      },
      redactions_applied: true,
    };
    const resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    const harnessResultPath = resolve(fixture, "evidence-output/result.json");
    mkdirSync(dirname(harnessResultPath), { recursive: true });
    writeFileSync(harnessResultPath, resultBytes);
    const harnessValidation = spawnSync(process.execPath, [".github/scripts/run-provider-model-evidence.mjs", "--validate"], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        BLOCKER_ID: "B-MODEL-01",
        CODE_UNDER_TEST_SHA: codeUnderTestSha,
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_RUN_ID: String(runId),
        TRUSTED_REPOSITORY: fixture,
        WORKFLOW_HEAD_SHA: workflowHeadSha,
      },
    });
    if (harnessValidation.status !== 0) {
      throw new Error(`trusted harness digest/scope parity failed\n${harnessValidation.stderr}${harnessValidation.stdout}`);
    }
    const resultSha = createHash("sha256").update(resultBytes).digest("hex");
    const archive = zipSync({ "result.json": new Uint8Array(resultBytes) }, { level: 9 });
    const archiveDigest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    const resultRelativePath = `evidence/results/B-MODEL-01/${runId}.json`;
    const resultPath = resolve(fixture, resultRelativePath);
    mkdirSync(dirname(resultPath), { recursive: true });
    writeFileSync(resultPath, resultBytes);
    const indexPath = resolve(fixture, "evidence/provider-stack-gate.json");
    writeFileSync(indexPath, `${JSON.stringify({
      schema_version: 3,
      gate: "implementation",
      requirements_blob_sha: requirementsBlob,
      entries: {
        "B-MODEL-01": {
          code_under_test_sha: codeUnderTestSha,
          workflow_head_sha: workflowHeadSha,
          run_id: runId,
          run_attempt: 1,
          workflow_id: workflowId,
          workflow_path: ".github/workflows/provider-spike-evidence.yml",
          workflow_blob_sha: workflowBlobSha,
          harness_blob_sha: harnessBlobSha,
          scope_sha256: scopeSha,
          job_name: "provider-evidence / B-MODEL-01",
          artifact_id: artifactId,
          artifact_name: `provider-evidence-B-MODEL-01-${codeUnderTestSha}`,
          artifact_digest: archiveDigest,
          result_path: resultRelativePath,
          result_sha256: resultSha,
          adoption_pr_number: adoptionPrNumber,
          adopted_at: adoptedAt,
        },
      },
    }, null, 2)}\n`);

    const github = {
      getRun: async () => ({
        id: runId,
        run_attempt: 1,
        workflow_id: workflowId,
        name: "Provider Spike Evidence",
        path: ".github/workflows/provider-spike-evidence.yml",
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
        head_sha: workflowHeadSha,
        head_branch: "main",
        repository: { full_name: "yongzooda/finshield" },
      }),
      getBranch: async () => ({ commit: { sha: adoptionMerged ? currentHeadSha : codeUnderTestSha } }),
      getPull: async () => ({
        number: adoptionPrNumber,
        state: adoptionMerged ? "closed" : "open",
        merged: adoptionMerged,
        merged_at: adoptionMerged ? adoptedAt : null,
        merge_commit_sha: currentHeadSha,
        base: { ref: "main", repo: { full_name: "yongzooda/finshield" } },
        head: { repo: { full_name: "yongzooda/finshield" } },
      }),
      getWorkflow: async () => ({ id: workflowId, path: ".github/workflows/provider-spike-evidence.yml", state: "active" }),
      getFileBlob: async (path, ref) => {
        if (ref === workflowHeadSha) {
          const expectedBlob = trustedExecutionBlobs.get(path);
          if (!expectedBlob) throw new Error(`unexpected trusted execution path ${path}`);
          return {
            type: "file",
            path,
            sha: path === trustedAPathMismatch ? "0".repeat(40) : expectedBlob,
          };
        }
        if (ref === currentHeadSha) {
          let bytes = adoptedContentMismatch && path === resultRelativePath
            ? Buffer.from("{}\n")
            : readFileSync(resolve(fixture, path));
          if (adoptedLedgerDecoy && path === "docs/adr/001-p0-provider-stack.md") {
            bytes = Buffer.from(bytes.toString("utf8")
              .replace(
                "| `B-MODEL-01` | Anthropic Sonnet 5 auth·quota·structured output·strict tool·P95·cost | PASS |",
                "| `B-MODEL-01` | Anthropic Sonnet 5 auth·quota·structured output·strict tool·P95·cost | NOT-EVALUATED |",
              )
              .replace(
                "### 14.1 현재 확보한 증거",
                "### 14.1 현재 확보한 증거\n\n<!--\n### 14.2 Implementation Gate 차단 항목\n| `B-MODEL-01` | decoy | PASS | decoy |\n### 14.3 Implementation Gate 전환 규칙\n-->",
              ));
          }
          return { type: "file", encoding: "base64", content: bytes.toString("base64"), sha: gitBlobSha(bytes) };
        }
        throw new Error(`unexpected file ref ${ref}`);
      },
      getJobs: async () => ({ jobs: [{
        name: "provider-evidence / B-MODEL-01",
        run_id: runId,
        head_sha: workflowHeadSha,
        conclusion: "success",
        steps: [
          { name: "Run blocker evidence harness", conclusion: "success" },
          { name: "Install trusted validator dependencies", conclusion: "success" },
          { name: "Validate raw evidence", conclusion: "success" },
          { name: "Upload evidence artifact", conclusion: "success" },
        ],
      }] }),
      getArtifacts: async () => ({ artifacts: [{
        id: artifactId,
        name: `provider-evidence-B-MODEL-01-${codeUnderTestSha}`,
        expired: false,
        digest: archiveDigest,
        created_at: artifactCreatedAt,
        workflow_run: { id: runId, head_sha: workflowHeadSha },
      }] }),
      compare: async (base, head) => {
        if (base === head) return { status: "identical", merge_base_commit: { sha: base }, files: [] };
        return {
          status: "ahead",
          merge_base_commit: { sha: base },
          files: [
            { filename: "docs/adr/001-p0-provider-stack.md", status: "modified" },
            { filename: "evidence/provider-stack-gate.json", status: "added" },
            { filename: resultRelativePath, status: "added" },
          ],
        };
      },
      downloadArtifact: async () => archive,
    };
    const errors = [];
    await validateEvidenceIndex({
      root: fixture,
      gate: "implementation",
      rows: [
        { id: "B-MODEL-01", status: "PASS" },
      ],
      requirementsBlob,
      indexRelativePath: "evidence/provider-stack-gate.json",
      errors,
      github,
      currentHeadSha,
      currentPrNumber: adoptionPrNumber,
      nowMs,
    });
    if (expectedError) {
      if (!errors.some((error) => expectedError.test(error))) {
        throw new Error(`partial evidence expected error ${expectedError}\n${errors.join("\n")}`);
      }
    } else if (errors.length > 0) {
      throw new Error(`partial PASS evidence expected success\n${errors.join("\n")}`);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
};

expectPass("canonical baseline", () => {});

expectPass(
  "path override ignored",
  (fixture) => writeFileSync(resolve(fixture, "fake-adr.md"), "- Implementation Gate (`N-QLT-010`): `GO`\n"),
  { PROVIDER_ADR_PATH: "fake-adr.md", PROVIDER_REQUIREMENTS_PATH: "fake-adr.md", DATABASE_SPEC_PATH: "fake-adr.md" },
);

await expectPartialEvidence();
await expectPartialEvidence({ adoptionMerged: true });
await expectPartialEvidence({ artifactAgeMs: 28 * 24 * 60 * 60 * 1000, expectedError: /27일 TTL/ });
await expectPartialEvidence({ adoptedContentMismatch: true, expectedError: /채택 PR commit에 실제로 존재/ });
await expectPartialEvidence({ adoptedLedgerDecoy: true, expectedError: /채택 PR commit에 실제로 존재/ });
for (const trustedAPathMismatch of [
  ".github/scripts/provider-adr-digest.mjs",
  "package.json",
  "package-lock.json",
]) {
  await expectPartialEvidence({ trustedAPathMismatch, expectedError: /trusted execution 파일 blob pin/ });
}

{
  const metricErrors = [];
  validateModelEvidenceResult({ observations: {
    auth: { http_status: 200, model_id: "claude-sonnet-5" },
    normal: { total: 50, schema_passed: 50, strict_tool_passed: 50, post_validation_passed: 50 },
    faults: { total: 20, categories: ["429", "refusal", "schema_error", "timeout"], false_successes: 0 },
    latency: { samples: 50, p95_ms: -1 },
    text_runs: { samples: 20, p95_ms: 100_000, p95_cost_usd: 0.49 },
    file_runs: { samples: 20, p95_ms: 150_000, p95_cost_usd: 0.79 },
  } }, (message) => metricErrors.push(message));
  if (!metricErrors.some((message) => message.includes("P95 10초"))) {
    throw new Error("negative latency metric must be rejected");
  }
}

if (adoptionFilesAreSafe([{
  status: "renamed",
  previous_filename: "src/app/api/route.ts",
  filename: "evidence/route.ts",
}])) {
  throw new Error("rename from application code into evidence must be rejected");
}

expectFail(
  "HTML comment cannot supply metadata",
  (fixture) => update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
    "- Implementation Gate (`N-QLT-010`): `NO-GO`",
    "<!-- - Implementation Gate (`N-QLT-010`): `NO-GO` -->",
  )),
  /Implementation Gate metadata는 정확히 한 번/,
);

expectFail(
  "astral prefix cannot shift HTML masking",
  (fixture) => update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
    "- Implementation Gate (`N-QLT-010`): `NO-GO`",
    `${"😀".repeat(200)}\n<!--\n- Implementation Gate (\`N-QLT-010\`): \`NO-GO\`\n-->`,
  )),
  /Implementation Gate metadata는 정확히 한 번/,
);

expectFail(
  "tilde fence cannot supply metadata",
  (fixture) => update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
    "- Implementation Gate (`N-QLT-010`): `NO-GO`",
    "~~~text\n- Implementation Gate (`N-QLT-010`): `NO-GO`\n~~~",
  )),
  /Implementation Gate metadata는 정확히 한 번/,
);

expectFail(
  "GO requires every blocker PASS",
  (fixture) => update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
    "- Implementation Gate (`N-QLT-010`): `NO-GO`",
    "- Implementation Gate (`N-QLT-010`): `GO`",
  )),
  /Implementation GO는 모든 blocker가 PASS/,
);

expectFail(
  "deferred CI hardening cannot reenter implementation blockers",
  (fixture) => update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
    "| `B-SPIKE-01` | 실제 Provider·Source·Storage·DB·Workflow component vertical | NOT-EVALUATED | §15.1 합성 Text·Image·PDF spike 합격; 제품 UI 요구 없음 |",
    "| `B-CI-INTEGRITY` | 외부 immutable CI | BLOCKED | Required Workflow |\n| `B-SPIKE-01` | 실제 Provider·Source·Storage·DB·Workflow component vertical | NOT-EVALUATED | §15.1 합성 Text·Image·PDF spike 합격; 제품 UI 요구 없음 |",
  )),
  /알 수 없는 Implementation blocker 'B-CI-INTEGRITY'/,
);

expectFail(
  "deferred CI hardening cannot be presented as complete",
  (fixture) => update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
    "| `B-CI-INTEGRITY` | DEFERRED |",
    "| `B-CI-INTEGRITY` | PASS |",
  )),
  /B-CI-INTEGRITY는 제출 후 강화 상태 DEFERRED로 보존해야 합니다/,
);

expectFail(
  "requirements drift is detected",
  (fixture) => update(fixture, "docs/02-integrated-requirements.md", (source) => `${source}\n`),
  /요구사항 정본이 ADR 기준선 이후 변경/,
);

expectFail(
  "trusted harness changes invalidate its policy pin",
  (fixture) => update(fixture, ".github/scripts/run-provider-model-evidence.mjs", (source) => `${source}\n`),
  /trusted policy 파일.*현재 Git Blob SHA가 등록 pin과 다릅니다/,
);

for (const [name, path] of [
  ["trusted ADR digest helper changes invalidate its policy pin", ".github/scripts/provider-adr-digest.mjs"],
  ["trusted package manifest changes invalidate its policy pin", "package.json"],
  ["trusted package lock changes invalidate its policy pin", "package-lock.json"],
]) {
  expectFail(
    name,
    (fixture) => update(fixture, path, (source) => `${source}\n`),
    /trusted policy 파일.*현재 Git Blob SHA가 등록 pin과 다릅니다/,
  );
}

expectFail(
  "unpinned checkout is rejected",
  (fixture) => update(fixture, ".github/workflows/pr-check.yml", (source) => source.replace(
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
    "actions/checkout@v4",
  )),
  /actions\/checkout이 검토한 commit SHA에 고정되지 않았습니다/,
);

expectFail(
  "YAML comment cannot fake pinned checkout",
  (fixture) => update(fixture, ".github/workflows/pr-check.yml", (source) => source.replace(
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
    "actions/checkout@v4 # actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
  )),
  /actions\/checkout이 검토한 commit SHA에 고정되지 않았습니다/,
);

expectFail(
  "YAML comment cannot fake validator command",
  (fixture) => update(fixture, ".github/workflows/pr-check.yml", (source) => source.replace(
    "run: node .github/scripts/validate-provider-stack-adr.mjs",
    "run: echo validator-skipped # node .github/scripts/validate-provider-stack-adr.mjs",
  )),
  /PR CI가 Provider ADR validator를 exact safe step으로 실행하지 않습니다/,
);

expectFail(
  "checkout cannot redirect to another repository",
  (fixture) => update(fixture, ".github/workflows/pr-check.yml", (source) => source.replace(
    "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
    "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\n        with:\n          repository: attacker/controlled",
  )),
  /actions\/checkout은 외부 repository\/ref\/path 없이/,
);

expectFail(
  "check job cannot be skipped",
  (fixture) => update(fixture, ".github/workflows/pr-check.yml", (source) => source.replace(
    "    runs-on: ubuntu-latest",
    "    runs-on: ubuntu-latest\n    if: false",
  )),
  /check job의 실행·skip 경계/,
);

expectFail(
  "pull request trigger cannot be removed",
  (fixture) => update(fixture, ".github/workflows/pr-check.yml", (source) => source.replace(
    "  pull_request:\n    branches: [main]\n",
    "",
  )),
  /pull_request\/push main과 일일 evidence TTL trigger/,
);

expectFail(
  "provider evidence must bind the actual merge candidate",
  (fixture) => update(fixture, ".github/workflows/pr-check.yml", (source) => source.replace(
    "VALIDATION_HEAD_SHA: ${{ github.sha }}",
    "VALIDATION_HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
  )),
  /merge candidate SHA·PR 번호/,
);

expectFail(
  "runtime MCP flag cannot be enabled during P0",
  (fixture) => update(fixture, "src/lib/env.ts", (source) => source.replace(
    'PUBLIC_MCP_ENABLED: z.literal("false")',
    'PUBLIC_MCP_ENABLED: z.enum(["false", "true"])',
  )),
  /Runtime env schema가 P0 PUBLIC_MCP_ENABLED=false만 허용하지 않습니다/,
);

expectFail(
  "public MCP route cannot call the protocol handler during P0",
  (fixture) => update(fixture, "src/app/api/mcp/route.ts", (source) => source.replace(
    'import { env } from "@/lib/env";',
    'import { env } from "@/lib/env";\nimport { handlePayload } from "@/lib/mcp/server";',
  )),
  /P0 \/api\/mcp route가 body·rate limit·MCP handler 실행 전에/,
);

expectFail(
  "release evaluation cannot start before implementation GO",
  (fixture) => {
    update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source
      .replace("- Release Gate (`N-QLT-009`): `NOT-EVALUATED`", "- Release Gate (`N-QLT-009`): `NO-GO`")
      .replace(
        "| `B-DEMO-01` | 비회원 격리 Live Seed가 한 동작으로 실제 Agent Pipeline 실행 | NOT-EVALUATED |",
        "| `B-DEMO-01` | 비회원 격리 Live Seed가 한 동작으로 실제 Agent Pipeline 실행 | FAIL |",
      ));
  },
  /Release blocker 평가는 Implementation Gate가 GO인 뒤/,
);

expectFail(
  "Sales and regulation agents cannot be merged",
  (fixture) => update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
    "고정 4개: 상품·기관(Product/Institution), 사기·채널(Fraud/Channel), 판매행위(Sales Conduct), 규제·분쟁(Regulation & Dispute)",
    "고정 3개: 상품·기관(Product/Institution), 사기·채널(Fraud/Channel), 판매행위·규제(Sales/Regulation)",
  )),
  /P0 고정 Agent 4개 결정/,
);

expectFail(
  "four agents require separate runtime contracts",
  (fixture) => update(fixture, "docs/adr/001-p0-provider-stack.md", (source) => source.replace(
    "; 각자 Schema·Tool allowlist·run row",
    "; 하나의 공유 Schema·Tool·run row",
  )),
  /P0 고정 Agent 4개 결정/,
);

console.log("Provider ADR validator mutation tests passed: 4 pass cases, 30 rejection cases.");
