import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { unzipSync } from "fflate";
import { adrDecisionDigest, maskNonRenderedMarkdown } from "./provider-adr-digest.mjs";
import { validateEmbedEvidenceResult } from "./provider-embed-policy.mjs";
import { validateModelEvidenceResult } from "./provider-model-policy.mjs";

export { adrDecisionDigest } from "./provider-adr-digest.mjs";
export { validateEmbedEvidenceResult } from "./provider-embed-policy.mjs";
export { validateModelEvidenceResult } from "./provider-model-policy.mjs";

const REPOSITORY = "yongzooda/finshield";
const EVIDENCE_WORKFLOW_NAME = "Provider Spike Evidence";
const EVIDENCE_WORKFLOW_PATH = ".github/workflows/provider-spike-evidence.yml";
const MODEL_FIXTURE_PATH = ".github/fixtures/provider-model-v1.json";
const MODEL_HARNESS_PATH = ".github/scripts/run-provider-model-evidence.mjs";
const ADR_DIGEST_PATH = ".github/scripts/provider-adr-digest.mjs";
const MODEL_POLICY_PATH = ".github/scripts/provider-model-policy.mjs";
const MODEL_SPIKE_PATH = ".github/scripts/provider-model-spike.mjs";
const PACKAGE_JSON_PATH = "package.json";
const PACKAGE_LOCK_PATH = "package-lock.json";
const TRUSTED_EVIDENCE_WORKFLOW_BLOB = "49f21b3aabe11f5c53e39f2a2e30cd857a549ca6";
const TRUSTED_MODEL_FIXTURE_BLOB = "baec2b7b6945e527905bf2b5822fb2912d95659a";
const TRUSTED_MODEL_HARNESS_BLOB = "109c96b06dfc1c3eaa76d16f9c7d76d7b70ca93d";
const TRUSTED_ADR_DIGEST_BLOB = "a0d89bbd01fcdd4cc2659afb29d243ba2bdfc099";
const TRUSTED_MODEL_POLICY_BLOB = "50a19a237b29951021e271173fe1ee692b13ccaf";
const TRUSTED_MODEL_SPIKE_BLOB = "7448338a029999476c4ec0580ca181dbe50e8135";
const TRUSTED_PACKAGE_JSON_BLOB = "ecb26cd086f874ea4f989d50f2719a8390c282de";
const TRUSTED_PACKAGE_LOCK_BLOB = "678296a5f7e2256799413740041886f29f939191";
const EMBED_WORKFLOW_PATH = ".github/workflows/provider-embed-evidence.yml";
const EMBED_FIXTURE_PATH = ".github/fixtures/provider-embed-v1.json";
const EMBED_HARNESS_PATH = ".github/scripts/run-provider-embed-evidence.mjs";
const EMBED_POLICY_PATH = ".github/scripts/provider-embed-policy.mjs";
const EMBED_SPIKE_PATH = ".github/scripts/provider-embed-spike.mjs";
const EMBED_OPS_PATH = "docs/ops/provider-embed-spike.md";
const TRUSTED_EMBED_WORKFLOW_BLOB = "204b15d107adff1ffb59e17b58e8b9393bf4f6f9";
const TRUSTED_EMBED_FIXTURE_BLOB = "a22c0b2f7239a4361b1f8437c61da3998c2dd5c7";
const TRUSTED_EMBED_HARNESS_BLOB = "2088f33d827321c3c10560bc7cbbd1e0001cfdcf";
const TRUSTED_EMBED_POLICY_BLOB = "d55faaa9ffebcc187eead6703d0497e7611892ce";
const TRUSTED_EMBED_SPIKE_BLOB = "8031855d5bf6b08c1ef9bcc7849b7a6dcbca7459";
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_EVIDENCE_AGE_MS = 27 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const secretPatterns = [
  /sk-ant-[A-Za-z0-9_-]{12,}/,
  /sk-[A-Za-z0-9_-]{24,}/,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /serviceKey=[A-Za-z0-9%+/]{12,}/,
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/,
];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBlobSha = (bytes) => createHash("sha1")
  .update(`blob ${bytes.byteLength}\0`)
  .update(bytes)
  .digest("hex");

const exactKeys = (value, expected) => {
  if (!isRecord(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
};

const isInside = (parent, child) => {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`);
};

const isUtcTimestamp = (value) => (
  /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value ?? "")
  && Number.isFinite(Date.parse(value))
);


const decodeGitHubFile = (file) => {
  if (file?.type !== "file" || file?.encoding !== "base64" || typeof file?.content !== "string"
    || !/^[0-9a-f]{40}$/.test(file?.sha ?? "")) return null;
  const bytes = Buffer.from(file.content.replace(/\s/g, ""), "base64");
  return gitBlobSha(bytes) === file.sha ? bytes : null;
};

const adoptedGateRowIsPass = (source, gate, blockerId) => {
  const structuralSource = maskNonRenderedMarkdown(source);
  const startHeading = gate === "implementation"
    ? "### 14.2 Implementation Gate 차단 항목"
    : "### 14.4 Release Gate 차단 항목";
  const endHeading = gate === "implementation"
    ? "### 14.3 Implementation Gate 전환 규칙"
    : "### 14.5 제출 후 CI 무결성 강화";
  const start = structuralSource.indexOf(startHeading);
  const end = start >= 0 ? structuralSource.indexOf(endHeading, start + startHeading.length) : -1;
  if (start < 0 || end < 0) return false;
  const matchingRows = structuralSource.slice(start, end).split("\n").filter((line) => {
    const fields = line.split("|").map((field) => field.trim());
    return fields[1] === `\`${blockerId}\``;
  });
  if (matchingRows.length !== 1) return false;
  return matchingRows[0].split("|").map((field) => field.trim())[3] === "PASS";
};

const modelEvidencePolicy = {
  gate: "implementation",
  workflowName: EVIDENCE_WORKFLOW_NAME,
  workflowPath: EVIDENCE_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_EVIDENCE_WORKFLOW_BLOB,
  harnessPath: MODEL_HARNESS_PATH,
  harnessBlobSha: TRUSTED_MODEL_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: EVIDENCE_WORKFLOW_PATH, blobSha: TRUSTED_EVIDENCE_WORKFLOW_BLOB }),
    Object.freeze({ path: MODEL_FIXTURE_PATH, blobSha: TRUSTED_MODEL_FIXTURE_BLOB }),
    Object.freeze({ path: MODEL_HARNESS_PATH, blobSha: TRUSTED_MODEL_HARNESS_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
    Object.freeze({ path: MODEL_POLICY_PATH, blobSha: TRUSTED_MODEL_POLICY_BLOB }),
    Object.freeze({ path: MODEL_SPIKE_PATH, blobSha: TRUSTED_MODEL_SPIKE_BLOB }),
    Object.freeze({ path: PACKAGE_JSON_PATH, blobSha: TRUSTED_PACKAGE_JSON_BLOB }),
    Object.freeze({ path: PACKAGE_LOCK_PATH, blobSha: TRUSTED_PACKAGE_LOCK_BLOB }),
  ]),
  jobName: "provider-evidence / B-MODEL-01",
  scopePaths: Object.freeze([
    ".env.example",
    ".github/fixtures/provider-model-v1.json",
    ".github/scripts/provider-adr-digest.mjs",
    ".github/scripts/provider-model-policy.mjs",
    ".github/scripts/provider-model-spike.mjs",
    ".github/scripts/run-provider-model-evidence.mjs",
    ".github/workflows/provider-spike-evidence.yml",
    "package-lock.json",
    "package.json",
  ]),
  validate: validateModelEvidenceResult,
};

const embedEvidencePolicy = {
  gate: "implementation",
  workflowName: "Provider Embedding Evidence",
  workflowPath: EMBED_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_EMBED_WORKFLOW_BLOB,
  harnessPath: EMBED_HARNESS_PATH,
  harnessBlobSha: TRUSTED_EMBED_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: EMBED_WORKFLOW_PATH, blobSha: TRUSTED_EMBED_WORKFLOW_BLOB }),
    Object.freeze({ path: EMBED_FIXTURE_PATH, blobSha: TRUSTED_EMBED_FIXTURE_BLOB }),
    Object.freeze({ path: EMBED_HARNESS_PATH, blobSha: TRUSTED_EMBED_HARNESS_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
    Object.freeze({ path: EMBED_POLICY_PATH, blobSha: TRUSTED_EMBED_POLICY_BLOB }),
    Object.freeze({ path: EMBED_SPIKE_PATH, blobSha: TRUSTED_EMBED_SPIKE_BLOB }),
  ]),
  jobName: "provider-embedding-evidence / B-EMBED-01",
  scopePaths: Object.freeze([
    EMBED_FIXTURE_PATH,
    ADR_DIGEST_PATH,
    EMBED_POLICY_PATH,
    EMBED_SPIKE_PATH,
    EMBED_HARNESS_PATH,
    EMBED_WORKFLOW_PATH,
    EMBED_OPS_PATH,
  ]),
  validate: validateEmbedEvidenceResult,
};

// PASS is fail-closed: each remaining blocker gets a policy only with its real
// harness. A prose criterion or a hand-authored `result: PASS` is never enough.
export const evidencePolicies = Object.freeze({
  "B-MODEL-01": modelEvidencePolicy,
  "B-EMBED-01": embedEvidencePolicy,
});

export const computeEvidenceScopeDigest = (root, policy, fail) => {
  const inventory = [];
  for (const relativePath of [...new Set(policy?.scopePaths ?? [])].sort()) {
    const path = resolve(root, relativePath);
    if (!isInside(root, path) || !existsSync(path) || lstatSync(path).isSymbolicLink()
      || !lstatSync(path).isFile() || !isInside(root, realpathSync(path))) {
      fail(`Evidence scope 파일 '${relativePath}'이 저장소 내부 일반 파일이 아닙니다.`);
      return null;
    }
    inventory.push({ path: relativePath, blob_sha: gitBlobSha(readFileSync(path)) });
  }
  if (inventory.length === 0) {
    fail("Evidence policy의 scopePaths가 비어 있습니다.");
    return null;
  }
  return sha256(Buffer.from(JSON.stringify(inventory)));
};

export const validateEvidencePolicyFiles = ({ root, errors }) => {
  const fail = (message) => errors.push(message);
  for (const [blockerId, policy] of Object.entries(evidencePolicies)) {
    const trustedExecutionFiles = Array.isArray(policy.trustedExecutionFiles) ? policy.trustedExecutionFiles : [];
    const trustedPaths = trustedExecutionFiles.map((file) => file?.path);
    if (trustedExecutionFiles.length === 0
      || new Set(trustedPaths).size !== trustedExecutionFiles.length
      || trustedExecutionFiles.some((file) => !file || typeof file.path !== "string"
        || !/^[0-9a-f]{40}$/.test(file.blobSha ?? "") || !policy.scopePaths.includes(file.path))
      || !trustedExecutionFiles.some((file) => file.path === policy.workflowPath && file.blobSha === policy.workflowBlobSha)
      || !trustedExecutionFiles.some((file) => file.path === policy.harnessPath && file.blobSha === policy.harnessBlobSha)) {
      fail(`${blockerId} trusted execution 파일 pin 정책이 유효하지 않습니다.`);
    }
    for (const { path, blobSha: expectedBlob } of trustedExecutionFiles) {
      const absolutePath = resolve(root, path);
      if (!existsSync(absolutePath) || lstatSync(absolutePath).isSymbolicLink() || !lstatSync(absolutePath).isFile()
        || gitBlobSha(readFileSync(absolutePath)) !== expectedBlob) {
        fail(`${blockerId} trusted policy 파일 '${path}'의 현재 Git Blob SHA가 등록 pin과 다릅니다.`);
      }
    }
    computeEvidenceScopeDigest(root, policy, fail);
  }
};

const parseSingleResultZip = (archiveBytes, fail) => {
  if (!(archiveBytes instanceof Uint8Array) || archiveBytes.byteLength === 0 || archiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail("Actions evidence archive 크기가 허용 범위를 벗어났습니다.");
    return null;
  }

  // Reject Zip64/multiple entries/encryption/symlinks and zip bombs before inflate.
  let eocd = -1;
  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
  for (let offset = archiveBytes.byteLength - 22; offset >= Math.max(0, archiveBytes.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || view.getUint16(eocd + 8, true) !== 1 || view.getUint16(eocd + 10, true) !== 1) {
    fail("Actions evidence archive는 Zip64가 아닌 result.json 단일 entry여야 합니다.");
    return null;
  }
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralOffset + 46 > archiveBytes.byteLength || view.getUint32(centralOffset, true) !== 0x02014b50) {
    fail("Actions evidence archive central directory가 유효하지 않습니다.");
    return null;
  }
  const flags = view.getUint16(centralOffset + 8, true);
  const uncompressedSize = view.getUint32(centralOffset + 24, true);
  const nameLength = view.getUint16(centralOffset + 28, true);
  const externalAttributes = view.getUint32(centralOffset + 38, true);
  const nameStart = centralOffset + 46;
  const nameEnd = nameStart + nameLength;
  const entryName = nameEnd <= archiveBytes.byteLength
    ? new TextDecoder().decode(archiveBytes.subarray(nameStart, nameEnd))
    : "";
  const unixMode = externalAttributes >>> 16;
  if ((flags & 0x1) !== 0 || entryName !== "result.json" || uncompressedSize === 0 || uncompressedSize > MAX_RESULT_BYTES
    || (unixMode & 0o170000) === 0o120000) {
    fail("Actions evidence archive entry가 암호화·경로·크기·symlink 규칙을 위반했습니다.");
    return null;
  }

  try {
    const files = unzipSync(archiveBytes);
    if (Object.keys(files).length !== 1 || !files["result.json"] || files["result.json"].byteLength !== uncompressedSize) {
      fail("Actions evidence archive는 정확히 하나의 result.json만 포함해야 합니다.");
      return null;
    }
    return files["result.json"];
  } catch (error) {
    fail(`Actions evidence archive를 해제할 수 없습니다: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  }
};

const allowedAdoptionPath = (filename) => (
  filename.startsWith("evidence/")
  || filename === "docs/adr/001-p0-provider-stack.md"
  || filename === "README.md"
  || filename === "docs/README.md"
  || filename === "HANDOFF.md"
);

export const adoptionFilesAreSafe = (files) => (
  Array.isArray(files)
  && files.length < 300
  && files.every((file) => allowedAdoptionPath(file?.filename ?? "")
    && (typeof file?.previous_filename !== "string" || allowedAdoptionPath(file.previous_filename)))
);

export const createGitHubClient = (token, fetchImpl = globalThis.fetch) => {
  const request = async (path, { binary = false } = {}) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: binary ? "application/vnd.github+json" : "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        // 2026-03-10 removed pull_request.merge_commit_sha. Keep the supported
        // 2022 contract until provenance migrates to its replacement before 2028-03-10.
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return binary ? new Uint8Array(await response.arrayBuffer()) : response.json();
  };

  return {
    getRepository: () => request(`/repos/${REPOSITORY}`),
    getBranch: (branch) => request(`/repos/${REPOSITORY}/branches/${encodeURIComponent(branch)}`),
    getRun: (runId) => request(`/repos/${REPOSITORY}/actions/runs/${runId}`),
    getWorkflow: (workflowId) => request(`/repos/${REPOSITORY}/actions/workflows/${workflowId}`),
    getFileBlob: (path, ref) => request(`/repos/${REPOSITORY}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`),
    getJobs: (runId, attempt) => request(`/repos/${REPOSITORY}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`),
    getArtifacts: (runId) => request(`/repos/${REPOSITORY}/actions/runs/${runId}/artifacts?per_page=100`),
    downloadArtifact: (artifactId) => request(`/repos/${REPOSITORY}/actions/artifacts/${artifactId}/zip`, { binary: true }),
    compare: (base, head) => request(`/repos/${REPOSITORY}/compare/${base}...${head}?per_page=100`),
    getPull: (pullNumber) => request(`/repos/${REPOSITORY}/pulls/${pullNumber}`),
  };
};

export const validateEvidenceIndex = async ({
  root,
  gate,
  rows,
  requirementsBlob,
  indexRelativePath,
  errors,
  github = null,
  currentHeadSha = process.env.VALIDATION_HEAD_SHA,
  currentPrNumber = process.env.VALIDATION_PR_NUMBER,
  nowMs = Date.now(),
}) => {
  const fail = (message) => errors.push(message);
  const passIds = rows
    .filter((row) => row.status === "PASS")
    .map((row) => row.id)
    .sort();

  if (passIds.length === 0) return;
  const indexPath = resolve(root, indexRelativePath);
  if (!existsSync(indexPath)) {
    fail(`${gate} PASS blocker가 있지만 '${indexRelativePath}'가 없습니다.`);
    return;
  }

  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    fail(`${indexRelativePath}를 JSON으로 읽을 수 없습니다.`);
    return;
  }
  if (!exactKeys(index, ["schema_version", "gate", "requirements_blob_sha", "entries"])
    || index.schema_version !== 3 || index.gate !== gate || index.requirements_blob_sha !== requirementsBlob) {
    fail(`${indexRelativePath}의 strict schema/gate/requirements hash가 현재 ADR과 다릅니다.`);
  }
  const entries = isRecord(index.entries) ? index.entries : {};
  if (JSON.stringify(Object.keys(entries).sort()) !== JSON.stringify(passIds)) {
    fail(`${indexRelativePath} entry는 현재 PASS blocker와 정확히 일치해야 합니다.`);
  }
  if (!github || !/^[0-9a-f]{40}$/.test(currentHeadSha ?? "")) {
    fail(`${gate} PASS evidence는 PR head SHA와 GitHub API 권한이 있는 Actions에서 검증해야 합니다.`);
    return;
  }

  const evidenceRoot = resolve(root, "evidence");
  for (const id of passIds) {
    const policy = evidencePolicies[id];
    if (!policy || policy.gate !== gate) {
      fail(`${gate} blocker '${id}'에는 아직 trusted raw-metric proof policy가 없어 PASS로 바꿀 수 없습니다.`);
      continue;
    }
    const currentScopeSha = computeEvidenceScopeDigest(root, policy, (message) => fail(`${gate} evidence '${id}': ${message}`));
    const entry = entries[id];
    const entryKeys = [
      "code_under_test_sha", "workflow_head_sha", "run_id", "run_attempt", "workflow_id", "workflow_path", "workflow_blob_sha", "harness_blob_sha",
      "scope_sha256", "job_name", "artifact_id", "artifact_name", "artifact_digest", "result_path", "result_sha256", "adoption_pr_number", "adopted_at",
    ];
    if (!exactKeys(entry, entryKeys)) {
      fail(`${gate} evidence '${id}' index entry가 strict schema와 다릅니다.`);
      continue;
    }
    if (!/^[0-9a-f]{40}$/.test(entry.code_under_test_sha ?? "")
      || entry.workflow_head_sha !== entry.code_under_test_sha
      || !Number.isInteger(entry.run_id) || entry.run_id <= 0
      || !Number.isInteger(entry.run_attempt) || entry.run_attempt <= 0
      || !Number.isInteger(entry.workflow_id) || entry.workflow_id <= 0
      || entry.workflow_path !== policy.workflowPath
      || entry.workflow_blob_sha !== policy.workflowBlobSha
      || entry.harness_blob_sha !== policy.harnessBlobSha
      || entry.scope_sha256 !== currentScopeSha || !/^[0-9a-f]{64}$/.test(entry.scope_sha256 ?? "")
      || entry.job_name !== policy.jobName
      || !Number.isInteger(entry.artifact_id) || entry.artifact_id <= 0
      || entry.artifact_name !== `provider-evidence-${id}-${entry.code_under_test_sha}`
      || !/^sha256:[0-9a-f]{64}$/.test(entry.artifact_digest ?? "")
      || !/^[0-9a-f]{64}$/.test(entry.result_sha256 ?? "") || /^0{64}$/.test(entry.result_sha256)
      || !Number.isInteger(entry.adoption_pr_number) || entry.adoption_pr_number <= 0
      || !isUtcTimestamp(entry.adopted_at)) {
      fail(`${gate} evidence '${id}' provenance 필드가 유효하지 않습니다.`);
    }

    const resultPath = typeof entry.result_path === "string" ? resolve(root, entry.result_path) : "";
    if (!resultPath || !isInside(evidenceRoot, resultPath) || !existsSync(resultPath)
      || lstatSync(resultPath).isSymbolicLink() || !lstatSync(resultPath).isFile()
      || !isInside(evidenceRoot, realpathSync(resultPath))) {
      fail(`${gate} evidence '${id}' result snapshot이 evidence/ 아래의 일반 파일이 아닙니다.`);
      continue;
    }
    const resultBytes = readFileSync(resultPath);
    if (resultBytes.byteLength > MAX_RESULT_BYTES || sha256(resultBytes) !== entry.result_sha256) {
      fail(`${gate} evidence '${id}' result snapshot SHA-256/크기가 실제 파일과 다릅니다.`);
    }
    let result;
    try {
      result = JSON.parse(resultBytes.toString("utf8"));
    } catch {
      fail(`${gate} evidence '${id}' result snapshot은 JSON이어야 합니다.`);
      continue;
    }
    const currentAdrDigest = adrDecisionDigest(readFileSync(resolve(root, "docs/adr/001-p0-provider-stack.md"), "utf8"));
    if (!exactKeys(result, ["schema_version", "blocker_id", "requirements_blob_sha", "adr_decision_sha256", "code_under_test_sha", "workflow_head_sha", "scope_sha256", "run", "observations", "environment", "redactions_applied"])
      || result.schema_version !== 3 || result.blocker_id !== id
      || result.requirements_blob_sha !== requirementsBlob
      || result.adr_decision_sha256 !== currentAdrDigest
      || result.code_under_test_sha !== entry.code_under_test_sha
      || result.workflow_head_sha !== entry.workflow_head_sha
      || result.scope_sha256 !== entry.scope_sha256
      || !exactKeys(result.run, ["id", "attempt"])
      || result.run.id !== entry.run_id || result.run.attempt !== entry.run_attempt
      || !isRecord(result.environment)
      || result.redactions_applied !== true) {
      fail(`${gate} evidence '${id}' result snapshot의 strict metadata가 index와 다릅니다.`);
    }
    if (secretPatterns.some((pattern) => pattern.test(resultBytes.toString("utf8")))) {
      fail(`${gate} evidence '${id}' result snapshot에서 자격증명처럼 보이는 값이 발견됐습니다.`);
    }
    policy.validate(result, (message) => fail(`${gate} evidence '${id}': ${message}`));

    try {
      const [run, workflowInfo, trustedExecutionBlobs, jobsResponse, artifactsResponse, adoptionPull, mainBranch] = await Promise.all([
        github.getRun(entry.run_id),
        github.getWorkflow(entry.workflow_id),
        Promise.all(policy.trustedExecutionFiles.map((file) => github.getFileBlob(file.path, entry.workflow_head_sha))),
        github.getJobs(entry.run_id, entry.run_attempt),
        github.getArtifacts(entry.run_id),
        github.getPull(entry.adoption_pr_number),
        github.getBranch("main"),
      ]);
      if (run?.repository?.full_name !== REPOSITORY || run?.head_sha !== entry.workflow_head_sha
        || run?.head_branch !== "main"
        || run?.id !== entry.run_id || run?.run_attempt !== entry.run_attempt
        || run?.workflow_id !== entry.workflow_id || run?.name !== policy.workflowName
        || ![policy.workflowPath, `${policy.workflowPath}@main`].includes(run?.path) || run?.event !== "workflow_dispatch"
        || run?.status !== "completed" || run?.conclusion !== "success") {
        fail(`${gate} evidence '${id}' Actions run identity/head/attempt/conclusion이 일치하지 않습니다.`);
      }
      const mainSha = mainBranch?.commit?.sha;
      const trustedMainComparison = /^[0-9a-f]{40}$/.test(mainSha ?? "")
        ? await github.compare(entry.workflow_head_sha, mainSha)
        : null;
      if (!trustedMainComparison || !["ahead", "identical"].includes(trustedMainComparison.status)
        || trustedMainComparison?.merge_base_commit?.sha !== entry.workflow_head_sha) {
        fail(`${gate} evidence '${id}' trusted workflow head가 main 이력에 존재하지 않습니다.`);
      }
      if (adoptionPull?.number !== entry.adoption_pr_number
        || adoptionPull?.base?.repo?.full_name !== REPOSITORY || adoptionPull?.base?.ref !== "main"
        || adoptionPull?.head?.repo?.full_name !== REPOSITORY) {
        fail(`${gate} evidence '${id}' 채택 PR의 번호·base·head 저장소가 일치하지 않습니다.`);
      }
      let adoptionSha;
      if (adoptionPull?.merged === true) {
        adoptionSha = adoptionPull.merge_commit_sha;
        if (adoptionPull.state !== "closed" || !isUtcTimestamp(adoptionPull.merged_at)
          || !/^[0-9a-f]{40}$/.test(adoptionSha ?? "")) {
          fail(`${gate} evidence '${id}' 채택 PR의 실제 merge commit을 확인할 수 없습니다.`);
        }
        const adoptionMainComparison = /^[0-9a-f]{40}$/.test(adoptionSha ?? "") && /^[0-9a-f]{40}$/.test(mainSha ?? "")
          ? await github.compare(adoptionSha, mainSha)
          : null;
        if (!adoptionMainComparison || !["ahead", "identical"].includes(adoptionMainComparison.status)
          || adoptionMainComparison?.merge_base_commit?.sha !== adoptionSha) {
          fail(`${gate} evidence '${id}' 채택 merge commit이 현재 main 이력에 없습니다.`);
        }
      } else {
        adoptionSha = currentHeadSha;
        if (adoptionPull?.state !== "open"
          || Number(currentPrNumber) !== entry.adoption_pr_number
          || adoptionPull?.merge_commit_sha !== currentHeadSha
          || mainSha !== entry.code_under_test_sha) {
          fail(`${gate} evidence '${id}' 미병합 채택 PR은 시험한 main 바로 위의 현재 merge candidate여야 합니다.`);
        }
      }
      const [adoptedResultFile, adoptedIndexFile, adoptedAdrFile] = await Promise.all([
        github.getFileBlob(entry.result_path, adoptionSha),
        github.getFileBlob(indexRelativePath, adoptionSha),
        github.getFileBlob("docs/adr/001-p0-provider-stack.md", adoptionSha),
      ]);
      const adoptedResultBytes = decodeGitHubFile(adoptedResultFile);
      const adoptedIndexBytes = decodeGitHubFile(adoptedIndexFile);
      const adoptedAdrBytes = decodeGitHubFile(adoptedAdrFile);
      let adoptedIndex = null;
      try {
        adoptedIndex = adoptedIndexBytes ? JSON.parse(adoptedIndexBytes.toString("utf8")) : null;
      } catch {
        adoptedIndex = null;
      }
      const adoptedAdr = adoptedAdrBytes?.toString("utf8") ?? "";
      const adoptedBlockerPass = adoptedGateRowIsPass(adoptedAdr, gate, id);
      if (!adoptedResultBytes || sha256(adoptedResultBytes) !== entry.result_sha256
        || !isRecord(adoptedIndex) || adoptedIndex.schema_version !== 3 || adoptedIndex.gate !== gate
        || adoptedIndex.requirements_blob_sha !== requirementsBlob
        || !isDeepStrictEqual(adoptedIndex?.entries?.[id], entry)
        || !adoptedBlockerPass || adrDecisionDigest(adoptedAdr) !== result.adr_decision_sha256) {
        fail(`${gate} evidence '${id}' result·index entry·PASS 상태가 지정한 채택 PR commit에 실제로 존재하지 않습니다.`);
      }
      if (workflowInfo?.id !== entry.workflow_id || workflowInfo?.path !== policy.workflowPath || workflowInfo?.state !== "active") {
        fail(`${gate} evidence '${id}' workflow ID/path/state가 일치하지 않습니다.`);
      }
      const trustedExecutionMismatch = policy.trustedExecutionFiles.some((file, index) => (
        trustedExecutionBlobs[index]?.type !== "file"
        || trustedExecutionBlobs[index]?.path !== file.path
        || trustedExecutionBlobs[index]?.sha !== file.blobSha
      ));
      if (trustedExecutionMismatch) {
        fail(`${gate} evidence '${id}' 시험 commit의 trusted execution 파일 blob pin이 다릅니다.`);
      }
      const jobs = Array.isArray(jobsResponse?.jobs) ? jobsResponse.jobs : [];
      const matchingJobs = jobs.filter((job) => (
        job?.name === policy.jobName
        && job?.run_id === entry.run_id
        && job?.head_sha === entry.workflow_head_sha
      ));
      const requiredSteps = ["Install trusted validator dependencies", "Run blocker evidence harness", "Validate raw evidence", "Upload evidence artifact"];
      if (matchingJobs.length !== 1 || matchingJobs[0]?.conclusion !== "success"
        || requiredSteps.some((name) => !matchingJobs[0]?.steps?.some((step) => step?.name === name && step?.conclusion === "success"))) {
        fail(`${gate} evidence '${id}' exact job/step 성공 기록이 없습니다.`);
      }
      const artifacts = Array.isArray(artifactsResponse?.artifacts) ? artifactsResponse.artifacts : [];
      const artifactMatches = artifacts.filter((artifact) => artifact?.id === entry.artifact_id && artifact?.name === entry.artifact_name);
      if (artifactMatches.length !== 1 || artifactMatches[0]?.expired !== false || artifactMatches[0]?.digest !== entry.artifact_digest
        || artifactMatches[0]?.workflow_run?.id !== entry.run_id || artifactMatches[0]?.workflow_run?.head_sha !== entry.workflow_head_sha) {
        fail(`${gate} evidence '${id}' Actions artifact ID/name/digest/run이 일치하지 않습니다.`);
      }
      const artifactCreatedMs = Date.parse(artifactMatches[0]?.created_at ?? "");
      const adoptedMs = Date.parse(entry.adopted_at ?? "");
      if (!Number.isFinite(artifactCreatedMs) || artifactCreatedMs > nowMs + MAX_CLOCK_SKEW_MS
        || nowMs - artifactCreatedMs > MAX_EVIDENCE_AGE_MS
        || !Number.isFinite(adoptedMs) || adoptedMs < artifactCreatedMs || adoptedMs > nowMs + MAX_CLOCK_SKEW_MS) {
        fail(`${gate} evidence '${id}' artifact가 27일 TTL 또는 생성·채택 시각 규칙을 위반했습니다.`);
      }
      const comparison = /^[0-9a-f]{40}$/.test(adoptionSha ?? "")
        ? await github.compare(entry.code_under_test_sha, adoptionSha)
        : null;
      const changedFiles = Array.isArray(comparison?.files) ? comparison.files : [];
      if (comparison?.status !== "ahead"
        || comparison?.merge_base_commit?.sha !== entry.code_under_test_sha
        || !adoptionFilesAreSafe(changedFiles)) {
        fail(`${gate} evidence '${id}' 시험 commit 뒤 evidence 채택 allowlist 밖의 코드가 변경됐습니다.`);
      }

      const archiveBytes = await github.downloadArtifact(entry.artifact_id);
      if (`sha256:${sha256(archiveBytes)}` !== entry.artifact_digest) {
        fail(`${gate} evidence '${id}' 다운로드 archive digest가 Actions metadata와 다릅니다.`);
      }
      const archivedResult = parseSingleResultZip(archiveBytes, (message) => fail(`${gate} evidence '${id}': ${message}`));
      if (archivedResult && (sha256(archivedResult) !== entry.result_sha256 || !Buffer.from(archivedResult).equals(resultBytes))) {
        fail(`${gate} evidence '${id}' Actions result.json과 commit B snapshot이 다릅니다.`);
      }
    } catch (error) {
      fail(`${gate} evidence '${id}' GitHub provenance를 검증할 수 없습니다: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
};

export { gitBlobSha };
