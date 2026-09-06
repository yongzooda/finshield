// B-RETRIEVAL-01 증거 harness.
//
// --run : 격리 기준 Postgres 에 v5 corpus 를 적재하고 Cohere 로 임베딩한 뒤
//         Filter·Keyword·Vector·Rerank 종단을 Case 단위로 측정한다.
// --validate : 결과 파일의 metadata 와 사전 고정 정책을 다시 검사한다.
//
// API key·DSN·질의 원문은 결과와 로그에 남기지 않는다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { adrDecisionDigest } from "./provider-adr-digest.mjs";
import { createEmbedPacer, requestEmbeddings } from "./provider-embed-spike.mjs";
import { claimRows, corpusStatements, documentRows, KB_RELEASE_VERSION, MANIFEST_VERSION } from "./retrieval-corpus.mjs";
import {
  AUTHORITY_SCORE, CANDIDATE_POOL_K, RELEVANCE_WEIGHTS, RERANK_WEIGHTS, TOP_K,
  caseMetrics, filteredUnits, macroAverage, percentile, rerankCase, searchClaim,
} from "./retrieval-pipeline.mjs";
import {
  DIMENSION, EMBEDDING_MODEL, FIXTURE_SET, FORMULA_VERSION, THRESHOLDS, validateRetrievalEvidenceResult,
} from "./retrieval-evidence-policy.mjs";

const mode = process.argv[2];
const exitWithFlushedLogs = async (code) => {
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
};
if (!["--run", "--validate"].includes(mode)) {
  console.error("Usage: run-retrieval-evidence.mjs --run|--validate");
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
  const output = spawnSync("git", ["-C", repository ?? "", "show", `${codeSha}:${path}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (output.status !== 0) { fail(`시험 commit에서 '${path}'를 읽을 수 없습니다.`); return ""; }
  commitFiles.set(path, output.stdout);
  return output.stdout;
};

if (!/^[0-9a-f]{40}$/.test(codeSha ?? "") || codeSha !== workflowSha || !repository) {
  fail("Evidence run은 동일한 immutable main SHA와 trusted repository가 필요합니다.");
}
if (blockerId !== "B-RETRIEVAL-01") fail("BLOCKER_ID 는 B-RETRIEVAL-01 이어야 합니다.");
const requirements = readAtCommit("docs/02-integrated-requirements.md");
const adr = readAtCommit("docs/adr/001-p0-provider-stack.md");

const migrationFiles = spawnSync("git", ["-C", repository ?? "", "ls-tree", "--name-only", `${codeSha}:supabase/migrations`], { encoding: "utf8" })
  .stdout.split("\n").filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
export const RETRIEVAL_SCOPE_PATHS = Object.freeze([
  ...migrationFiles.map((file) => `supabase/migrations/${file}`),
  "supabase/tests/00_supabase_stub.sql",
  ".github/fixtures/provider-embed-v5.json",
  ".github/scripts/provider-adr-digest.mjs",
  ".github/scripts/provider-embed-spike.mjs",
  ".github/scripts/retrieval-corpus.mjs",
  ".github/scripts/retrieval-evidence-policy.mjs",
  ".github/scripts/retrieval-pipeline.mjs",
  ".github/scripts/run-retrieval-evidence.mjs",
  ".github/scripts/test-retrieval-evidence.mjs",
  ".github/workflows/retrieval-evidence.yml",
  "docs/ops/retrieval-blocker-preregistration.md",
  "docs/ops/retrieval-spike.md",
]);
const scopeInventory = [...RETRIEVAL_SCOPE_PATHS].sort().map((path) => ({ path, blob_sha: gitBlobSha(Buffer.from(readAtCommit(path))) }));
const scopeSha = sha256(Buffer.from(JSON.stringify(scopeInventory)));

const sanitizedFailure = (error) => {
  const message = String(error?.message ?? "");
  if (/COHERE_API_KEY|DATABASE_URL/.test(message)) return "retrieval-missing-credential";
  if (/embedding/i.test(message)) return "retrieval-embedding-error";
  const kind = String(error?.name ?? "unknown").replace(/[^A-Za-z0-9_]/g, "");
  const code = String(error?.code ?? "").replace(/[^A-Za-z0-9_]/g, "");
  return `retrieval-or-harness-error:${kind}${code ? `/${code}` : ""}`;
};

if (mode === "--run") {
  rmSync(resultPath, { force: true });
  if (!process.env.COHERE_API_KEY) fail("COHERE_API_KEY 가 필요합니다.");
  if (!process.env.RETRIEVAL_DATABASE_URL) fail("RETRIEVAL_DATABASE_URL 이 필요합니다.");
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    await exitWithFlushedLogs(1);
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.RETRIEVAL_DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const fixture = JSON.parse(readAtCommit(".github/fixtures/provider-embed-v5.json"));
    if (fixture.fixture_set !== FIXTURE_SET) throw new Error("평가셋이 계약과 다르다");
    const documents = documentRows(fixture);
    const claims = claimRows(fixture);
    const gateClaims = claims.filter((claim) => claim.split === "gate");

    // 1. 문서 임베딩. 계약은 B-EMBED-01 과 같은 Provider 설정을 그대로 쓴다.
    const pacer = createEmbedPacer();
    const documentVectors = new Map();
    const BATCH = 96;
    for (let index = 0; index < documents.length; index += BATCH) {
      const slice = documents.slice(index, index + BATCH);
      const { vectors } = await requestEmbeddings({
        fetchImpl: globalThis.fetch, apiKey: process.env.COHERE_API_KEY,
        texts: slice.map((doc) => doc.text), inputType: "search_document", pacer,
      });
      slice.forEach((doc, offset) => documentVectors.set(doc.evidence_unit, vectors[offset]));
      console.log(`${blockerId} documents embedded: ${documentVectors.size}/${documents.length}`);
    }

    // 2. corpus 적재. Keyword 는 Postgres tsvector 를 쓴다.
    const { releaseId, manifestId, statements } = corpusStatements({
      fixture, documents, embeddings: documentVectors,
      embeddingModel: EMBEDDING_MODEL, embeddingVersion: "1", dimension: DIMENSION,
    });
    // 다중 문장은 확장 프로토콜이 거부한다. Supabase harness 와 같은 psql 경로를 쓴다.
    // 서버 메시지 원문에는 값이 섞일 수 있어 종류만 남긴다.
    const scratch = mkdtempSync(resolve(tmpdir(), "finshield-retrieval-"));
    const corpusFile = resolve(scratch, "corpus.sql");
    writeFileSync(corpusFile, statements.join("\n"), { mode: 0o600 });
    const applied = spawnSync("psql", [process.env.RETRIEVAL_DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", corpusFile], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    rmSync(scratch, { recursive: true, force: true });
    if (applied.status !== 0) {
      const kind = String(applied.stderr ?? "").match(/ERROR:\s+([a-z_]+)/i)?.[1] ?? `exit-${applied.status}`;
      throw new Error(`corpus 적재 실패: ${kind}`);
    }
    const [{ count: loaded }] = await sql`select count(*)::int as count from kb.knowledge_chunks where kb_release_id = ${releaseId}::uuid`;
    console.log(`${blockerId} corpus loaded: ${loaded} chunks, release ${KB_RELEASE_VERSION}, manifest ${MANIFEST_VERSION}`);
    if (loaded !== documents.length) throw new Error("corpus 적재 수가 다르다");

    // 3. 질의 임베딩과 Provenance.
    const claimVectors = new Map();
    for (let index = 0; index < gateClaims.length; index += BATCH) {
      const slice = gateClaims.slice(index, index + BATCH);
      const { vectors } = await requestEmbeddings({
        fetchImpl: globalThis.fetch, apiKey: process.env.COHERE_API_KEY,
        texts: slice.map((claim) => claim.text), inputType: "search_query", pacer,
      });
      slice.forEach((claim, offset) => claimVectors.set(claim.key, vectors[offset]));
    }
    const provenance = new Map();
    for (const doc of documents) {
      provenance.set(doc.snapshot_id, {
        unit: doc.evidence_unit, fingerprint: doc.source_fingerprint,
        authority_level: doc.authority_level, effective_from: doc.effective_from,
      });
    }

    // 4. Claim 마다 종단 단계를 돌리고 Case 로 묶는다.
    const ledger = [];
    const excludedByCase = new Map();
    const latencies = [];
    const claimResultsByCase = new Map();
    let filterExcluded = 0;
    for (const claim of gateClaims) {
      const started = Date.now();
      const rows = await searchClaim({ sql, manifestId, claim, embedding: claimVectors.get(claim.key) });
      const elapsed = Date.now() - started;
      latencies.push(elapsed);
      const survived = await filteredUnits({ sql, releaseId, claim });
      const missing = claim.relevant_units.filter((unit) => !survived.includes(unit));
      filterExcluded += missing.length;
      excludedByCase.set(claim.case_id, (excludedByCase.get(claim.case_id) ?? 0) + missing.length);
      ledger.push({
        claim_key: claim.key, case_id: claim.case_id, filtered: survived.length,
        keyword: rows.filter((r) => r.matched_by !== "VECTOR").length,
        vector: rows.filter((r) => r.matched_by !== "KEYWORD").length,
        merged: rows.length,
        relevant_in_pool: claim.relevant_units.filter((unit) => rows.some((r) => provenance.get(r.source_snapshot_id)?.unit === unit)).length,
        query_ms: elapsed,
      });
      const bucket = claimResultsByCase.get(claim.case_id) ?? [];
      bucket.push({ claim, rows });
      claimResultsByCase.set(claim.case_id, bucket);
      if (ledger.length % 20 === 0) console.log(`${blockerId} claims searched: ${ledger.length}/${gateClaims.length}`);
    }

    // 5. Case 단위 Rerank 와 지표.
    const cases = [];
    let collapsedTotal = 0;
    for (const [caseId, claimResults] of claimResultsByCase) {
      const caseClaims = claimResults.map((entry) => entry.claim);
      const relevantUnits = new Set(caseClaims.flatMap((claim) => claim.relevant_units));
      const criticalUnits = new Set(caseClaims.flatMap((claim) => claim.critical_units));
      const { top, poolSize, deduped, collapsed } = rerankCase({ claimResults, provenance });
      collapsedTotal += collapsed;
      const metrics = caseMetrics({ relevantUnits, criticalUnits, top });
      const excluded = excludedByCase.get(caseId) ?? 0;
      cases.push({
        case_id: caseId, risk_critical: caseClaims[0].risk_critical, coverage: [...caseClaims[0].coverage].sort(),
        claims: caseClaims.length, pool_size: poolSize, deduped_size: deduped, collapsed_fingerprints: collapsed,
        top_units: top.map((c) => c.unit), relevant_units: [...relevantUnits].sort(), critical_units: [...criticalUnits].sort(),
        recall_at_5: metrics.recall_at_5, precision_at_5: metrics.precision_at_5,
        critical_recall_at_5: metrics.critical_recall_at_5, filter_excluded_answers: excluded,
      });
    }
    cases.sort((left, right) => left.case_id.localeCompare(right.case_id));

    const sliceTotals = new Map();
    for (const row of cases) {
      for (const slice of row.coverage) {
        const bucket = sliceTotals.get(slice) ?? { sum: 0, count: 0 };
        bucket.sum += row.recall_at_5;
        bucket.count += 1;
        sliceTotals.set(slice, bucket);
      }
    }

    const observations = {
      contract: {
        formula_version: FORMULA_VERSION, fixture_set: FIXTURE_SET, measurement_unit: "case",
        embedding_model: EMBEDDING_MODEL, dimension: DIMENSION, candidate_pool_k: CANDIDATE_POOL_K, top_k: TOP_K,
        rerank_weights: { ...RERANK_WEIGHTS }, relevance_weights: { ...RELEVANCE_WEIGHTS }, authority_score: { ...AUTHORITY_SCORE },
        kb_release_version: KB_RELEASE_VERSION, manifest_version: MANIFEST_VERSION, thresholds: { ...THRESHOLDS },
      },
      corpus: {
        documents: documents.length, gate_cases: cases.length, gate_claims: gateClaims.length,
        risk_cases: cases.filter((row) => row.risk_critical).length,
        development_cases: fixture.cases.filter((k) => k.split !== "gate").length,
        distinct_fingerprints: new Set(documents.map((doc) => doc.source_fingerprint)).size,
      },
      cases,
      totals: {
        recall_at_5: macroAverage(cases.map((row) => row.recall_at_5)),
        precision_at_5: macroAverage(cases.map((row) => row.precision_at_5)),
        critical_recall_at_5: macroAverage(cases.filter((row) => row.risk_critical).map((row) => row.critical_recall_at_5)),
        slice_recall_at_5: Object.fromEntries([...sliceTotals.entries()].sort().map(([slice, b]) => [slice, b.sum / b.count])),
        query_p95_ms: percentile(latencies, 0.95), query_p50_ms: percentile(latencies, 0.5),
        filter_excluded_answers: filterExcluded,
        duplicate_fingerprint_inflation: 0,
        collapsed_fingerprints: collapsedTotal,
      },
      ledger,
    };

    const result = {
      schema_version: 3, blocker_id: blockerId,
      requirements_blob_sha: gitBlobSha(Buffer.from(requirements)),
      adr_decision_sha256: adrDecisionDigest(adr),
      code_under_test_sha: codeSha, workflow_head_sha: workflowSha, scope_sha256: scopeSha,
      run: { id: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
      observations,
      environment: { node_version: process.version, region: process.env.EVIDENCE_REGION, transport: "native-fetch" },
      redactions_applied: true,
    };
    console.log(`${blockerId} totals: ${JSON.stringify(observations.totals)}`);
    const resultErrors = [];
    validateRetrievalEvidenceResult(result, (message) => resultErrors.push(message));
    if (resultErrors.length > 0) {
      for (const message of resultErrors) console.error(`${blockerId} policy failure: ${message}`);
      throw new Error("Retrieval evidence policy failed.");
    }
    mkdirSync(resolve(process.cwd(), "evidence-output"), { recursive: true });
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(`${blockerId} raw evidence written without credentials or query text.`);
  } catch (error) {
    rmSync(resultPath, { force: true });
    console.error(`${blockerId} live harness failed safely: ${sanitizedFailure(error)}`);
    await sql.end({ timeout: 5 }).catch(() => {});
    await exitWithFlushedLogs(1);
  }
  await sql.end({ timeout: 5 }).catch(() => {});
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
validateRetrievalEvidenceResult(result, fail);
const serializedText = resultBytes.toString("utf8");
for (const [name, pattern] of [["api-key", /"?[A-Za-z0-9_-]{40,}"?\s*:\s*"[A-Za-z0-9_-]{20,}"/], ["dsn", /postgres(?:ql)?:\/\//], ["claim-text", /안내받았다|약정금리/]]) {
  if (pattern.test(serializedText)) fail(`Evidence result에 남으면 안 되는 값이 있습니다: ${name}`);
}
if (errors.length > 0) {
  console.error("Retrieval evidence validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  await exitWithFlushedLogs(1);
}
console.log("B-RETRIEVAL-01 raw evidence satisfies the preregistered policy.");
await exitWithFlushedLogs(0);
