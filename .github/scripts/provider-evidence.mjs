import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { unzipSync } from "fflate";
import { adrDecisionDigest, maskNonRenderedMarkdown } from "./provider-adr-digest.mjs";
import { validateEmbedEvidenceResult } from "./provider-embed-policy.mjs";
import { validateModelEvidenceResult } from "./provider-model-policy.mjs";
import { expectedInventory as supabaseExpectedInventory, validateSupabaseEvidenceResult } from "./supabase-evidence-policy.mjs";
import { validateSourceEvidenceResult } from "./source-evidence-policy.mjs";
import { validateFileSafetyEvidenceResult } from "./file-safety-policy.mjs";
import { validateRetrievalEvidenceResult } from "./retrieval-evidence-policy.mjs";
import { validateRateEvidenceResult } from "./rate-evidence-policy.mjs";
import { validateConsentEvidenceResult } from "./consent-evidence-policy.mjs";
import { validateStorageEvidenceResult } from "./storage-evidence-policy.mjs";
import { validateDeleteEvidenceResult } from "./delete-evidence-policy.mjs";
import { validateRuntimeEvidenceResult } from "./runtime-evidence-policy.mjs";

export { adrDecisionDigest } from "./provider-adr-digest.mjs";
export { validateEmbedEvidenceResult } from "./provider-embed-policy.mjs";
export { validateModelEvidenceResult } from "./provider-model-policy.mjs";
export { validateSupabaseEvidenceResult } from "./supabase-evidence-policy.mjs";
export { validateSourceEvidenceResult } from "./source-evidence-policy.mjs";

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
const EMBED_FIXTURE_PATH = ".github/fixtures/provider-embed-v5.json";
const EMBED_CANDIDATE_EVALUATION_PATH = ".github/scripts/provider-embed-candidate-evaluation.mjs";
const EMBED_CANDIDATE_SPIKE_PATH = ".github/scripts/provider-embed-candidate-spike.mjs";
const EMBED_EVALUATION_PATH = ".github/scripts/provider-embed-evaluation.mjs";
const TRUSTED_EMBED_EVALUATION_BLOB = "abe7d8151282cf5161884643d15c14adb06c5bc5";
const EMBED_HARNESS_PATH = ".github/scripts/run-provider-embed-evidence.mjs";
const EMBED_POLICY_PATH = ".github/scripts/provider-embed-policy.mjs";
const EMBED_SPIKE_PATH = ".github/scripts/provider-embed-spike.mjs";
const EMBED_OPS_PATH = "docs/ops/provider-embed-spike.md";
const TRUSTED_EMBED_WORKFLOW_BLOB = "e8916c44d5cbca33b0a630d588a57e6cc79c0910";
const TRUSTED_EMBED_FIXTURE_BLOB = "de27c5ab017d07be0525aec4ed254c9dfdc3ba71";
const TRUSTED_EMBED_CANDIDATE_EVALUATION_BLOB = "54ab4c019330b909ef6068415cda5494e936b93d";
const TRUSTED_EMBED_CANDIDATE_SPIKE_BLOB = "0c8c901886c1fdee6861f8bf3ffe82d6aee871ec";
const TRUSTED_EMBED_HARNESS_BLOB = "a76381d0792d1f456fa96a9289451c0235396ca2";
const TRUSTED_EMBED_POLICY_BLOB = "27e399a7b75b042c5fdba691d88722cabe378743";
const TRUSTED_EMBED_SPIKE_BLOB = "73e0a270b8e04ddd70a1317459e578a7247f8110";
const SUPABASE_WORKFLOW_PATH = ".github/workflows/supabase-evidence.yml";
const SUPABASE_HARNESS_PATH = ".github/scripts/run-supabase-evidence.mjs";
const SUPABASE_POLICY_PATH = ".github/scripts/supabase-evidence-policy.mjs";
const SUPABASE_VERIFY_REMOTE_PATH = "supabase/tests/verify-remote.mjs";
const SUPABASE_OPS_PATH = "docs/ops/supabase-evidence.md";
const TRUSTED_SUPABASE_WORKFLOW_BLOB = "7a4e3bebe8fcacaf4e25d2d2de45c066ff6a7e9f";
const TRUSTED_SUPABASE_HARNESS_BLOB = "6b9c70c4277279262ce86af99936f86aa6fd8432";
const TRUSTED_SUPABASE_POLICY_BLOB = "3499fdb7eb8737d7a208b2ac580ee2df62ab57c9";
const TRUSTED_SUPABASE_VERIFY_REMOTE_BLOB = "7232ba0783d22a821b055e915d0075aac3d7a3eb";
const SOURCE_WORKFLOW_PATH = ".github/workflows/source-evidence.yml";
const SOURCE_HARNESS_PATH = ".github/scripts/run-source-evidence.mjs";
const SOURCE_POLICY_PATH = ".github/scripts/source-evidence-policy.mjs";
const SOURCE_SPIKE_PATH = ".github/scripts/source-snapshot-spike.mjs";
const TRUSTED_SOURCE_WORKFLOW_BLOB = "2c7c7300fb2a8305e72230b9e60d6f790df6fb4f";
const TRUSTED_SOURCE_HARNESS_BLOB = "f23b5cfab2beffcf7aad50aa21512bdb89c22a76";
const TRUSTED_SOURCE_POLICY_BLOB = "d547746a60c0c385cac22d862c2e738fde1ea169";
const TRUSTED_SOURCE_SPIKE_BLOB = "2739c9157ea141c0525ecccebf1e6f815c824f9c";
const FILE_SAFETY_WORKFLOW_PATH = ".github/workflows/file-safety-evidence.yml";
const FILE_SAFETY_HARNESS_PATH = ".github/scripts/run-file-safety-evidence.mjs";
const FILE_SAFETY_POLICY_PATH = ".github/scripts/file-safety-policy.mjs";
const FILE_SAFETY_SPIKE_PATH = ".github/scripts/file-safety-spike.mjs";
const FILE_SAFETY_INSPECTOR_PATH = ".github/scripts/file-safety-inspector.mjs";
const FILE_SAFETY_FIXTURES_PATH = ".github/scripts/file-safety-fixtures.mjs";
const FILE_SAFETY_GUARD_PATH = ".github/scripts/file-safety-guard.mjs";
const FILE_SAFETY_WORKER_PATH = ".github/scripts/file-safety-worker.mjs";
const FILE_SAFETY_PARSER_LOCK_PATH = ".github/fixtures/file-safety-parser/package-lock.json";
const FILE_SAFETY_PARSER_MANIFEST_PATH = ".github/fixtures/file-safety-parser/package.json";
const FILE_SAFETY_OPS_PATH = "docs/ops/file-safety-spike.md";
const TRUSTED_FILE_SAFETY_WORKFLOW_BLOB = "93e19d90423984d1fcdf2830034a50873613b080";
const TRUSTED_FILE_SAFETY_HARNESS_BLOB = "0aaa683b4b8cf798c684f1c88c06e115bd389e1e";
const TRUSTED_FILE_SAFETY_POLICY_BLOB = "7bcad9056ae4dd79c100c85a47b5c5719f108006";
const TRUSTED_FILE_SAFETY_SPIKE_BLOB = "fa585947eed6c1512dbab529a94ef0a0ff080568";
const TRUSTED_FILE_SAFETY_INSPECTOR_BLOB = "120628ce8b79f2a9856f27859b280b84069a30cd";
const TRUSTED_FILE_SAFETY_FIXTURES_BLOB = "52f9dd3d111c765a59945e08cfbaff947a9f11e9";
const TRUSTED_FILE_SAFETY_GUARD_BLOB = "061bc295edd244b1fe4c9e11b1ea85a821e12937";
const TRUSTED_FILE_SAFETY_WORKER_BLOB = "1b871d93d6d12d91e7815143dd18bf01498a47b3";
const TRUSTED_FILE_SAFETY_PARSER_LOCK_BLOB = "05fe45d6507aef416eeacbe678532eb26666da7d";
const RETRIEVAL_WORKFLOW_PATH = ".github/workflows/retrieval-evidence.yml";
const RETRIEVAL_HARNESS_PATH = ".github/scripts/run-retrieval-evidence.mjs";
const RETRIEVAL_POLICY_PATH = ".github/scripts/retrieval-evidence-policy.mjs";
const RETRIEVAL_PIPELINE_PATH = ".github/scripts/retrieval-pipeline.mjs";
const RETRIEVAL_CORPUS_PATH = ".github/scripts/retrieval-corpus.mjs";
const RETRIEVAL_OPS_PATH = "docs/ops/retrieval-spike.md";
const RETRIEVAL_PREREG_PATH = "docs/ops/retrieval-blocker-preregistration.md";
const TRUSTED_RETRIEVAL_WORKFLOW_BLOB = "77aad6a9f1c8d73598b01bd0469565e9bde822c1";
const TRUSTED_RETRIEVAL_HARNESS_BLOB = "91905cfc636dd8c4570277d17093fb644021288b";
const TRUSTED_RETRIEVAL_POLICY_BLOB = "69245a8ba32dbd7611a8de27f77bc865e99ead59";
const TRUSTED_RETRIEVAL_PIPELINE_BLOB = "3b160aa495615a7644914653f7e75c7a59f6eb99";
const TRUSTED_RETRIEVAL_CORPUS_BLOB = "9523430cc41073758d3e37f48c532a1ff9db1f02";
const RATE_WORKFLOW_PATH = ".github/workflows/rate-evidence.yml";
const RATE_HARNESS_PATH = ".github/scripts/run-rate-evidence.mjs";
const RATE_POLICY_PATH = ".github/scripts/rate-evidence-policy.mjs";
const RATE_SPIKE_PATH = ".github/scripts/rate-budget-spike.mjs";
const RATE_OPS_PATH = "docs/ops/rate-budget-spike.md";
const TRUSTED_RATE_WORKFLOW_BLOB = "ffc408ce953baea16837d81134117719989f8c72";
const TRUSTED_RATE_HARNESS_BLOB = "ba2e0d403f4cd337216c33dfa4dd97d783cb1d08";
const TRUSTED_RATE_POLICY_BLOB = "0fc5c68023bccdeae4dac562ed19f992ce0d1405";
const TRUSTED_RATE_SPIKE_BLOB = "17f0b31ad4db5bc52013e4e6201678a3408a9221";
const CONSENT_WORKFLOW_PATH = ".github/workflows/consent-evidence.yml";
const CONSENT_HARNESS_PATH = ".github/scripts/run-consent-evidence.mjs";
const CONSENT_POLICY_PATH = ".github/scripts/consent-evidence-policy.mjs";
const CONSENT_SPIKE_PATH = ".github/scripts/consent-privacy-spike.mjs";
const CONSENT_GATE_PATH = ".github/scripts/consent-gate.mjs";
const CONSENT_PII_PATH = "src/lib/agents/pii.ts";
const CONSENT_FIXTURE_PATH = "src/lib/agents/__tests__/pii-synthetic.ts";
const CONSENT_OPS_PATH = "docs/ops/consent-isolation-spike.md";
const TRUSTED_CONSENT_WORKFLOW_BLOB = "d8f92e1e244949415a602d5da41c51bc48e078ef";
const TRUSTED_CONSENT_HARNESS_BLOB = "e861f36dfd2c3fa679bed04f59fe93731b9b0fc1";
const TRUSTED_CONSENT_POLICY_BLOB = "6d5198dc8963506c80844b5dfc354fa22635f329";
const TRUSTED_CONSENT_SPIKE_BLOB = "ab4ec20e424b4ec50115c9797ba0a4ed0545d496";
const TRUSTED_CONSENT_GATE_BLOB = "eae1b967dd6a4c31071ea09e9432e6ef042925c5";
const TRUSTED_CONSENT_PII_BLOB = "411d6dce5cc0c66b4d18a2a51f4386f52ab07bb0";
const TRUSTED_CONSENT_FIXTURE_BLOB = "4be85c448a9dcfb1311e6739d29f19628b87b939";
const STORAGE_WORKFLOW_PATH = ".github/workflows/storage-evidence.yml";
const STORAGE_HARNESS_PATH = ".github/scripts/run-storage-evidence.mjs";
const STORAGE_POLICY_PATH = ".github/scripts/storage-evidence-policy.mjs";
const STORAGE_SPIKE_PATH = ".github/scripts/storage-spike.mjs";
const STORAGE_OPS_PATH = "docs/ops/storage-spike.md";
const TRUSTED_STORAGE_WORKFLOW_BLOB = "9893957251fd0446eacc9b3dddbe69c902b1c0c8";
const TRUSTED_STORAGE_HARNESS_BLOB = "3d3ec4d6d444d0b9e11bc7897fad7652c02cb070";
const TRUSTED_STORAGE_POLICY_BLOB = "d699b24cadb17ce491e972767035cb3eef94048a";
const TRUSTED_STORAGE_SPIKE_BLOB = "2151fe4a4d707626afad1069eb46dcf1655e7af7";
const DELETE_WORKFLOW_PATH = ".github/workflows/delete-evidence.yml";
const DELETE_HARNESS_PATH = ".github/scripts/run-delete-evidence.mjs";
const DELETE_POLICY_PATH = ".github/scripts/delete-evidence-policy.mjs";
const DELETE_SPIKE_PATH = ".github/scripts/delete-spike.mjs";
const DELETE_OPS_PATH = "docs/ops/delete-spike.md";
const TRUSTED_DELETE_WORKFLOW_BLOB = "e8520c36f49e797082b8b2a601539ac08eef5c13";
const TRUSTED_DELETE_HARNESS_BLOB = "4dab33793a064251ed5e127bd7f7e3b5bfa51286";
const TRUSTED_DELETE_POLICY_BLOB = "f03dbbc60a7d60baab514e01b7389fe0aa22513b";
const TRUSTED_DELETE_SPIKE_BLOB = "38dff0e94144f68837831df227e07dc9150542e7";
const RUNTIME_WORKFLOW_PATH = ".github/workflows/runtime-evidence.yml";
const RUNTIME_HARNESS_PATH = ".github/scripts/run-runtime-evidence.mjs";
const RUNTIME_POLICY_PATH = ".github/scripts/runtime-evidence-policy.mjs";
const RUNTIME_SPIKE_PATH = ".github/scripts/runtime-spike.mjs";
const RUNTIME_ROUTE_PATH = "src/app/api/runtime-manifest/route.ts";
const RUNTIME_OPS_PATH = "docs/ops/runtime-spike.md";
const TRUSTED_RUNTIME_WORKFLOW_BLOB = "0c9568727900234787e76365589f9a4d3fcd8869";
const TRUSTED_RUNTIME_HARNESS_BLOB = "1a084cd5b38dbd24de07436b645be0b666a49420";
const TRUSTED_RUNTIME_POLICY_BLOB = "8b437c07cfa87fa1eb2e8bb0932c3c323e2b63af";
const TRUSTED_RUNTIME_SPIKE_BLOB = "f8a28ecf827152c23049c0db56b2aead1336c187";
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
    Object.freeze({ path: EMBED_EVALUATION_PATH, blobSha: TRUSTED_EMBED_EVALUATION_BLOB }),
    Object.freeze({ path: EMBED_CANDIDATE_EVALUATION_PATH, blobSha: TRUSTED_EMBED_CANDIDATE_EVALUATION_BLOB }),
    Object.freeze({ path: EMBED_CANDIDATE_SPIKE_PATH, blobSha: TRUSTED_EMBED_CANDIDATE_SPIKE_BLOB }),
  ]),
  jobName: "provider-embedding-evidence / B-EMBED-01",
  scopePaths: Object.freeze([
    EMBED_FIXTURE_PATH,
    EMBED_CANDIDATE_EVALUATION_PATH,
    EMBED_CANDIDATE_SPIKE_PATH,
    EMBED_EVALUATION_PATH,
    ADR_DIGEST_PATH,
    EMBED_POLICY_PATH,
    EMBED_SPIKE_PATH,
    EMBED_HARNESS_PATH,
    EMBED_WORKFLOW_PATH,
    EMBED_OPS_PATH,
    "docs/ops/quality-evaluation-plan.md",
    ".github/scripts/test-provider-embed-candidate.mjs",
    ".github/scripts/test-provider-embed-spike.mjs",
  ]),
  validate: validateEmbedEvidenceResult,
};

// Migration·시험 SQL 은 저장소에서 읽는다. 손으로 적은 목록은 Migration 이 늘 때 낡는다.
// scope 는 Migration·Stub·시험·harness·정책·workflow·운영 문서 전부를 결박한다.
const supabaseScopePaths = () => {
  const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const inventory = supabaseExpectedInventory(root);
  return Object.freeze([
    ...inventory.migrations.map((file) => `supabase/migrations/${file}`),
    "supabase/tests/00_supabase_stub.sql",
    ...inventory.tests.map((file) => `supabase/tests/${file}`),
    "supabase/tests/run-local.sh",
    SUPABASE_VERIFY_REMOTE_PATH,
    ADR_DIGEST_PATH,
    SUPABASE_POLICY_PATH,
    SUPABASE_HARNESS_PATH,
    ".github/scripts/test-supabase-evidence.mjs",
    SUPABASE_WORKFLOW_PATH,
    SUPABASE_OPS_PATH,
    "docs/ops/supabase-project.md",
  ]);
};

const supabaseEvidencePolicy = {
  gate: "implementation",
  workflowName: "Supabase Evidence",
  workflowPath: SUPABASE_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_SUPABASE_WORKFLOW_BLOB,
  harnessPath: SUPABASE_HARNESS_PATH,
  harnessBlobSha: TRUSTED_SUPABASE_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: SUPABASE_WORKFLOW_PATH, blobSha: TRUSTED_SUPABASE_WORKFLOW_BLOB }),
    Object.freeze({ path: SUPABASE_HARNESS_PATH, blobSha: TRUSTED_SUPABASE_HARNESS_BLOB }),
    Object.freeze({ path: SUPABASE_POLICY_PATH, blobSha: TRUSTED_SUPABASE_POLICY_BLOB }),
    Object.freeze({ path: SUPABASE_VERIFY_REMOTE_PATH, blobSha: TRUSTED_SUPABASE_VERIFY_REMOTE_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: "supabase-evidence / B-SUPABASE-01",
  scopePaths: supabaseScopePaths(),
  validate: validateSupabaseEvidenceResult,
};

// 두 Source blocker 는 같은 harness·같은 관측값을 쓰고 dispatch 입력이 blocker 를 정한다.
const sourceEvidencePolicy = (blockerId) => ({
  gate: "implementation",
  workflowName: "Source Snapshot Evidence",
  workflowPath: SOURCE_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_SOURCE_WORKFLOW_BLOB,
  harnessPath: SOURCE_HARNESS_PATH,
  harnessBlobSha: TRUSTED_SOURCE_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: SOURCE_WORKFLOW_PATH, blobSha: TRUSTED_SOURCE_WORKFLOW_BLOB }),
    Object.freeze({ path: SOURCE_HARNESS_PATH, blobSha: TRUSTED_SOURCE_HARNESS_BLOB }),
    Object.freeze({ path: SOURCE_POLICY_PATH, blobSha: TRUSTED_SOURCE_POLICY_BLOB }),
    Object.freeze({ path: SOURCE_SPIKE_PATH, blobSha: TRUSTED_SOURCE_SPIKE_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: `source-evidence / ${blockerId}`,
  scopePaths: Object.freeze([
    ADR_DIGEST_PATH,
    SOURCE_SPIKE_PATH,
    SOURCE_POLICY_PATH,
    SOURCE_HARNESS_PATH,
    ".github/scripts/test-source-evidence.mjs",
    SOURCE_WORKFLOW_PATH,
    "docs/ops/source-snapshot-spike.md",
  ]),
  validate: validateSourceEvidenceResult,
});

// PASS is fail-closed: each remaining blocker gets a policy only with its real
// harness. A prose criterion or a hand-authored `result: PASS` is never enough.
const fileSafetyEvidencePolicy = {
  gate: "implementation",
  workflowName: "File Safety Evidence",
  workflowPath: FILE_SAFETY_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_FILE_SAFETY_WORKFLOW_BLOB,
  harnessPath: FILE_SAFETY_HARNESS_PATH,
  harnessBlobSha: TRUSTED_FILE_SAFETY_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: FILE_SAFETY_WORKFLOW_PATH, blobSha: TRUSTED_FILE_SAFETY_WORKFLOW_BLOB }),
    Object.freeze({ path: FILE_SAFETY_HARNESS_PATH, blobSha: TRUSTED_FILE_SAFETY_HARNESS_BLOB }),
    Object.freeze({ path: FILE_SAFETY_POLICY_PATH, blobSha: TRUSTED_FILE_SAFETY_POLICY_BLOB }),
    Object.freeze({ path: FILE_SAFETY_SPIKE_PATH, blobSha: TRUSTED_FILE_SAFETY_SPIKE_BLOB }),
    Object.freeze({ path: FILE_SAFETY_INSPECTOR_PATH, blobSha: TRUSTED_FILE_SAFETY_INSPECTOR_BLOB }),
    Object.freeze({ path: FILE_SAFETY_FIXTURES_PATH, blobSha: TRUSTED_FILE_SAFETY_FIXTURES_BLOB }),
    Object.freeze({ path: FILE_SAFETY_GUARD_PATH, blobSha: TRUSTED_FILE_SAFETY_GUARD_BLOB }),
    Object.freeze({ path: FILE_SAFETY_WORKER_PATH, blobSha: TRUSTED_FILE_SAFETY_WORKER_BLOB }),
    Object.freeze({ path: FILE_SAFETY_PARSER_LOCK_PATH, blobSha: TRUSTED_FILE_SAFETY_PARSER_LOCK_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: "file-safety-evidence / B-FILE-SAFETY",
  scopePaths: Object.freeze([
    FILE_SAFETY_PARSER_LOCK_PATH,
    FILE_SAFETY_PARSER_MANIFEST_PATH,
    FILE_SAFETY_FIXTURES_PATH,
    FILE_SAFETY_GUARD_PATH,
    FILE_SAFETY_INSPECTOR_PATH,
    FILE_SAFETY_POLICY_PATH,
    FILE_SAFETY_SPIKE_PATH,
    FILE_SAFETY_WORKER_PATH,
    ADR_DIGEST_PATH,
    FILE_SAFETY_HARNESS_PATH,
    ".github/scripts/test-file-safety-evidence.mjs",
    FILE_SAFETY_WORKFLOW_PATH,
    FILE_SAFETY_OPS_PATH,
  ]),
  validate: validateFileSafetyEvidenceResult,
};

const retrievalEvidencePolicy = {
  gate: "implementation",
  workflowName: "Retrieval Evidence",
  workflowPath: RETRIEVAL_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_RETRIEVAL_WORKFLOW_BLOB,
  harnessPath: RETRIEVAL_HARNESS_PATH,
  harnessBlobSha: TRUSTED_RETRIEVAL_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: RETRIEVAL_WORKFLOW_PATH, blobSha: TRUSTED_RETRIEVAL_WORKFLOW_BLOB }),
    Object.freeze({ path: RETRIEVAL_HARNESS_PATH, blobSha: TRUSTED_RETRIEVAL_HARNESS_BLOB }),
    Object.freeze({ path: RETRIEVAL_POLICY_PATH, blobSha: TRUSTED_RETRIEVAL_POLICY_BLOB }),
    Object.freeze({ path: RETRIEVAL_PIPELINE_PATH, blobSha: TRUSTED_RETRIEVAL_PIPELINE_BLOB }),
    Object.freeze({ path: RETRIEVAL_CORPUS_PATH, blobSha: TRUSTED_RETRIEVAL_CORPUS_BLOB }),
    Object.freeze({ path: EMBED_FIXTURE_PATH, blobSha: TRUSTED_EMBED_FIXTURE_BLOB }),
    Object.freeze({ path: EMBED_SPIKE_PATH, blobSha: TRUSTED_EMBED_SPIKE_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: "retrieval-evidence / B-RETRIEVAL-01",
  scopePaths: Object.freeze([
    ...supabaseExpectedInventory(resolve(fileURLToPath(new URL("../../", import.meta.url)))).migrations.map((file) => `supabase/migrations/${file}`),
    "supabase/tests/00_supabase_stub.sql",
    EMBED_FIXTURE_PATH,
    EMBED_SPIKE_PATH,
    ADR_DIGEST_PATH,
    RETRIEVAL_CORPUS_PATH,
    RETRIEVAL_POLICY_PATH,
    RETRIEVAL_PIPELINE_PATH,
    RETRIEVAL_HARNESS_PATH,
    ".github/scripts/test-retrieval-evidence.mjs",
    RETRIEVAL_WORKFLOW_PATH,
    RETRIEVAL_PREREG_PATH,
    RETRIEVAL_OPS_PATH,
  ]),
  validate: validateRetrievalEvidenceResult,
};

const rateEvidencePolicy = {
  gate: "implementation",
  workflowName: "Rate Budget Evidence",
  workflowPath: RATE_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_RATE_WORKFLOW_BLOB,
  harnessPath: RATE_HARNESS_PATH,
  harnessBlobSha: TRUSTED_RATE_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: RATE_WORKFLOW_PATH, blobSha: TRUSTED_RATE_WORKFLOW_BLOB }),
    Object.freeze({ path: RATE_HARNESS_PATH, blobSha: TRUSTED_RATE_HARNESS_BLOB }),
    Object.freeze({ path: RATE_POLICY_PATH, blobSha: TRUSTED_RATE_POLICY_BLOB }),
    Object.freeze({ path: RATE_SPIKE_PATH, blobSha: TRUSTED_RATE_SPIKE_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: "rate-evidence / B-RATE-01",
  scopePaths: Object.freeze([
    ...supabaseExpectedInventory(resolve(fileURLToPath(new URL("../../", import.meta.url)))).migrations.map((file) => `supabase/migrations/${file}`),
    "supabase/tests/00_supabase_stub.sql",
    ADR_DIGEST_PATH,
    RATE_SPIKE_PATH,
    RATE_POLICY_PATH,
    RATE_HARNESS_PATH,
    ".github/scripts/test-rate-evidence.mjs",
    RATE_WORKFLOW_PATH,
    RATE_OPS_PATH,
  ]),
  validate: validateRateEvidenceResult,
};

const consentEvidencePolicy = {
  gate: "implementation",
  workflowName: "Consent Isolation Evidence",
  workflowPath: CONSENT_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_CONSENT_WORKFLOW_BLOB,
  harnessPath: CONSENT_HARNESS_PATH,
  harnessBlobSha: TRUSTED_CONSENT_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: CONSENT_WORKFLOW_PATH, blobSha: TRUSTED_CONSENT_WORKFLOW_BLOB }),
    Object.freeze({ path: CONSENT_HARNESS_PATH, blobSha: TRUSTED_CONSENT_HARNESS_BLOB }),
    Object.freeze({ path: CONSENT_POLICY_PATH, blobSha: TRUSTED_CONSENT_POLICY_BLOB }),
    Object.freeze({ path: CONSENT_SPIKE_PATH, blobSha: TRUSTED_CONSENT_SPIKE_BLOB }),
    Object.freeze({ path: CONSENT_GATE_PATH, blobSha: TRUSTED_CONSENT_GATE_BLOB }),
    Object.freeze({ path: CONSENT_PII_PATH, blobSha: TRUSTED_CONSENT_PII_BLOB }),
    Object.freeze({ path: CONSENT_FIXTURE_PATH, blobSha: TRUSTED_CONSENT_FIXTURE_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: "consent-evidence / B-CONSENT-01",
  scopePaths: Object.freeze([
    ...supabaseExpectedInventory(resolve(fileURLToPath(new URL("../../", import.meta.url)))).migrations.map((file) => `supabase/migrations/${file}`),
    "supabase/tests/00_supabase_stub.sql",
    CONSENT_GATE_PATH,
    ADR_DIGEST_PATH,
    CONSENT_PII_PATH,
    CONSENT_FIXTURE_PATH,
    CONSENT_SPIKE_PATH,
    CONSENT_POLICY_PATH,
    CONSENT_HARNESS_PATH,
    ".github/scripts/test-consent-evidence.mjs",
    CONSENT_WORKFLOW_PATH,
    CONSENT_OPS_PATH,
  ]),
  validate: validateConsentEvidenceResult,
};

const storageEvidencePolicy = {
  gate: "implementation",
  workflowName: "Storage Evidence",
  workflowPath: STORAGE_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_STORAGE_WORKFLOW_BLOB,
  harnessPath: STORAGE_HARNESS_PATH,
  harnessBlobSha: TRUSTED_STORAGE_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: STORAGE_WORKFLOW_PATH, blobSha: TRUSTED_STORAGE_WORKFLOW_BLOB }),
    Object.freeze({ path: STORAGE_HARNESS_PATH, blobSha: TRUSTED_STORAGE_HARNESS_BLOB }),
    Object.freeze({ path: STORAGE_POLICY_PATH, blobSha: TRUSTED_STORAGE_POLICY_BLOB }),
    Object.freeze({ path: STORAGE_SPIKE_PATH, blobSha: TRUSTED_STORAGE_SPIKE_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: "storage-evidence / B-STORAGE-01",
  scopePaths: Object.freeze([
    ...supabaseExpectedInventory(resolve(fileURLToPath(new URL("../../", import.meta.url)))).migrations.map((file) => `supabase/migrations/${file}`),
    "supabase/tests/00_supabase_stub.sql",
    ADR_DIGEST_PATH,
    STORAGE_SPIKE_PATH,
    STORAGE_POLICY_PATH,
    STORAGE_HARNESS_PATH,
    ".github/scripts/test-storage-evidence.mjs",
    STORAGE_WORKFLOW_PATH,
    STORAGE_OPS_PATH,
  ]),
  validate: validateStorageEvidenceResult,
};

// B-DELETE-01 은 삭제에 서버 키를 쓴다. 부재 판정은 발급 URL 과 회원 JWT 로만 한다.
// 그 사실은 결과 contract 에 남고 delete-evidence-policy 가 확인한다.
const deleteEvidencePolicy = {
  gate: "implementation",
  workflowName: "Delete Evidence",
  workflowPath: DELETE_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_DELETE_WORKFLOW_BLOB,
  harnessPath: DELETE_HARNESS_PATH,
  harnessBlobSha: TRUSTED_DELETE_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: DELETE_WORKFLOW_PATH, blobSha: TRUSTED_DELETE_WORKFLOW_BLOB }),
    Object.freeze({ path: DELETE_HARNESS_PATH, blobSha: TRUSTED_DELETE_HARNESS_BLOB }),
    Object.freeze({ path: DELETE_POLICY_PATH, blobSha: TRUSTED_DELETE_POLICY_BLOB }),
    Object.freeze({ path: DELETE_SPIKE_PATH, blobSha: TRUSTED_DELETE_SPIKE_BLOB }),
    Object.freeze({ path: STORAGE_SPIKE_PATH, blobSha: TRUSTED_STORAGE_SPIKE_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: "delete-evidence / B-DELETE-01",
  scopePaths: Object.freeze([
    ...supabaseExpectedInventory(resolve(fileURLToPath(new URL("../../", import.meta.url)))).migrations.map((file) => `supabase/migrations/${file}`),
    "supabase/tests/00_supabase_stub.sql",
    ADR_DIGEST_PATH,
    STORAGE_SPIKE_PATH,
    DELETE_SPIKE_PATH,
    DELETE_POLICY_PATH,
    DELETE_HARNESS_PATH,
    ".github/scripts/test-delete-evidence.mjs",
    DELETE_WORKFLOW_PATH,
    DELETE_OPS_PATH,
  ]),
  validate: validateDeleteEvidenceResult,
};

// B-RUNTIME-01 은 배포 안의 관측 endpoint 응답만 증거로 쓴다.
// 그 endpoint 자체가 scope 에 들어가야 응답의 출처가 고정된다.
const runtimeEvidencePolicy = {
  gate: "implementation",
  workflowName: "Runtime Evidence",
  workflowPath: RUNTIME_WORKFLOW_PATH,
  workflowBlobSha: TRUSTED_RUNTIME_WORKFLOW_BLOB,
  harnessPath: RUNTIME_HARNESS_PATH,
  harnessBlobSha: TRUSTED_RUNTIME_HARNESS_BLOB,
  trustedExecutionFiles: Object.freeze([
    Object.freeze({ path: RUNTIME_WORKFLOW_PATH, blobSha: TRUSTED_RUNTIME_WORKFLOW_BLOB }),
    Object.freeze({ path: RUNTIME_HARNESS_PATH, blobSha: TRUSTED_RUNTIME_HARNESS_BLOB }),
    Object.freeze({ path: RUNTIME_POLICY_PATH, blobSha: TRUSTED_RUNTIME_POLICY_BLOB }),
    Object.freeze({ path: RUNTIME_SPIKE_PATH, blobSha: TRUSTED_RUNTIME_SPIKE_BLOB }),
    Object.freeze({ path: ADR_DIGEST_PATH, blobSha: TRUSTED_ADR_DIGEST_BLOB }),
  ]),
  jobName: "runtime-evidence / B-RUNTIME-01",
  scopePaths: Object.freeze([
    ADR_DIGEST_PATH,
    RUNTIME_SPIKE_PATH,
    RUNTIME_POLICY_PATH,
    RUNTIME_HARNESS_PATH,
    ".github/scripts/test-runtime-evidence.mjs",
    RUNTIME_WORKFLOW_PATH,
    RUNTIME_OPS_PATH,
    RUNTIME_ROUTE_PATH,
    "src/lib/ops/http.ts",
  ]),
  validate: validateRuntimeEvidenceResult,
};

export const evidencePolicies = Object.freeze({
  "B-MODEL-01": modelEvidencePolicy,
  "B-EMBED-01": embedEvidencePolicy,
  "B-SUPABASE-01": supabaseEvidencePolicy,
  "B-SOURCE-02": sourceEvidencePolicy("B-SOURCE-02"),
  "B-SOURCE-03": sourceEvidencePolicy("B-SOURCE-03"),
  "B-FILE-SAFETY": fileSafetyEvidencePolicy,
  "B-RETRIEVAL-01": retrievalEvidencePolicy,
  "B-RATE-01": rateEvidencePolicy,
  "B-CONSENT-01": consentEvidencePolicy,
  "B-STORAGE-01": storageEvidencePolicy,
  "B-DELETE-01": deleteEvidencePolicy,
  "B-RUNTIME-01": runtimeEvidencePolicy,
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
