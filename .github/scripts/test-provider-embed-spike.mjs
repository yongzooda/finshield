import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adrDecisionDigest,
  computeEvidenceScopeDigest,
  evidencePolicies,
  gitBlobSha,
} from "./provider-evidence.mjs";
import { validateEmbedEvidenceResult } from "./provider-embed-policy.mjs";
import {
  buildEmbedRequest,
  cosineSimilarity,
  embeddingCostUsd,
  exactKnn,
  loadEmbedFixtures,
  percentile,
  runEmbedSpike,
} from "./provider-embed-spike.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const fixtures = loadEmbedFixtures(root);
assert.equal(fixtures.documents.length, 140);
assert.equal(fixtures.queries.length, 100);
assert.equal(fixtures.documents.filter((item) => !item.relevant).length, 40);
assert.equal(fixtures.queries.filter((item) => item.hard_negative_probe).length, 40);
assert.equal(fixtures.queries.filter((item) => item.risk_critical).length, 30);
assert.match(fixtures.fixtureSetHash, /^[0-9a-f]{64}$/);

assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
assert.throws(() => percentile([], 0.95), /finite non-negative/);
assert.equal(embeddingCostUsd(1000), 0.00012);
assert.throws(() => embeddingCostUsd(-1), /non-negative integer/);
assert.equal(cosineSimilarity([1, 0], [4, 0]), 1);
assert.throws(() => cosineSimilarity([0, 0], [1, 0]), /non-zero/);
assert.deepEqual(exactKnn([1, 0], [{ id: "B", vector: [1, 0] }, { id: "A", vector: [2, 0] }]), [
  { id: "A", score: 1 },
  { id: "B", score: 1 },
]);
assert.deepEqual(buildEmbedRequest(["합성 질의"], "search_query"), {
  model: "embed-v4.0",
  texts: ["합성 질의"],
  input_type: "search_query",
  embedding_types: ["float"],
  output_dimension: 1024,
  truncate: "NONE",
});

const topicIndex = new Map([...new Set(fixtures.documents.map((item) => item.topic_id))].map((id, index) => [id, index]));
const textTopic = new Map([
  ...fixtures.documents.map((item) => [item.text, item.topic_id]),
  ...fixtures.queries.map((item) => [item.text, item.topic_id]),
]);
let requestNumber = 0;
const fakeFetch = async (_url, options) => {
  requestNumber += 1;
  assert.equal(options.method, "POST");
  assert.match(options.headers.Authorization, /^Bearer sk-test-not-real/);
  const request = JSON.parse(options.body);
  assert.equal(request.model, "embed-v4.0");
  const vectors = request.texts.map((text) => {
    const vector = Array(1024).fill(0);
    vector[topicIndex.get(textTopic.get(text))] = 1;
    return vector;
  });
  return new Response(JSON.stringify({
    id: `embed-response-${requestNumber}`,
    embeddings: { float: vectors },
    meta: { billed_units: { input_tokens: request.texts.length * 10 } },
  }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "2000",
    },
  });
};

const spike = await runEmbedSpike({ root, apiKey: "sk-test-not-real-key", fetchImpl: fakeFetch });
assert.equal(requestNumber, 102);
assert.equal(spike.observations.quality.recall_at_5, 1);
assert.equal(spike.observations.quality.risk_core_recall_at_5, 1);
assert.equal(spike.observations.quality.precision_at_5, 1);
assert.equal(spike.observations.usage.provider_requests, 102);
assert.equal(spike.observations.provider.unique_request_ids, 102);

const result = {
  observations: spike.observations,
  environment: {
    node_version: "v24.4.1",
    region: "github-hosted",
    fixture_set_hash: spike.fixtureSetHash,
    pricing_snapshot_date: "2026-09-04",
    pricing_source: "https://cohere.com/pricing",
    transport: "native-fetch",
    provider_request_ids_hash: spike.providerRequestIdsHash,
    api_version: "v2",
    official_text_input_limit_per_minute: 2000,
  },
};
const policyErrors = [];
validateEmbedEvidenceResult(result, (message) => policyErrors.push(message));
assert.deepEqual(policyErrors, []);

for (const [field, value] of [["recall_at_5", 0.89], ["risk_core_recall_at_5", 0.99], ["precision_at_5", 0.79]]) {
  const invalid = structuredClone(result);
  invalid.observations.quality[field] = value;
  const errors = [];
  validateEmbedEvidenceResult(invalid, (message) => errors.push(message));
  assert.match(errors.join("\n"), /Recall@5/);
}
const slow = structuredClone(result);
slow.observations.latency.query_p95_ms = 1501;
validateEmbedEvidenceResult(slow, (message) => policyErrors.push(message));
assert.match(policyErrors.at(-1), /P95 1.5초/);
const wrongDimension = structuredClone(result);
wrongDimension.observations.contract.dimension = 768;
validateEmbedEvidenceResult(wrongDimension, (message) => policyErrors.push(message));
assert.match(policyErrors.at(-1), /dimension/);
const wrongCost = structuredClone(result);
wrongCost.observations.usage.calculated_cost_usd += 0.01;
validateEmbedEvidenceResult(wrongCost, (message) => policyErrors.push(message));
assert.match(policyErrors.at(-1), /비용 계산/);

const invalidVectorFetch = async () => new Response(JSON.stringify({
  embeddings: { float: [[1, 0]] },
  meta: { billed_units: { input_tokens: 1 } },
}), { status: 200, headers: { "content-type": "application/json", "x-request-id": "invalid-request-id" } });
await assert.rejects(
  runEmbedSpike({ root, apiKey: "sk-test-not-real-key", fetchImpl: invalidVectorFetch }),
  /dimension/,
);
await assert.rejects(runEmbedSpike({ root, apiKey: "", fetchImpl: fakeFetch }), /COHERE_API_KEY/);

const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
assert.match(revision, /^[0-9a-f]{40}$/);
const scopeErrors = [];
const scopeSha = computeEvidenceScopeDigest(root, evidencePolicies["B-EMBED-01"], (message) => scopeErrors.push(message));
assert.deepEqual(scopeErrors, []);
const runnerResult = {
  schema_version: 3,
  blocker_id: "B-EMBED-01",
  requirements_blob_sha: gitBlobSha(readFileSync(resolve(root, "docs/02-integrated-requirements.md"))),
  adr_decision_sha256: adrDecisionDigest(readFileSync(resolve(root, "docs/adr/001-p0-provider-stack.md"), "utf8")),
  code_under_test_sha: revision,
  workflow_head_sha: revision,
  scope_sha256: scopeSha,
  run: { id: 777, attempt: 1 },
  observations: spike.observations,
  environment: result.environment,
  redactions_applied: true,
};
const outputDirectory = resolve(root, "evidence-output");
const outputPath = resolve(outputDirectory, "result.json");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(runnerResult, null, 2)}\n`);
try {
  const validation = spawnSync(process.execPath, [".github/scripts/run-provider-embed-evidence.mjs", "--validate"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      BLOCKER_ID: "B-EMBED-01",
      CODE_UNDER_TEST_SHA: revision,
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_RUN_ID: "777",
      TRUSTED_REPOSITORY: root,
      WORKFLOW_HEAD_SHA: revision,
    },
  });
  assert.equal(validation.status, 0, `${validation.stderr}${validation.stdout}`);
} finally {
  rmSync(outputPath, { force: true });
}

console.log("Provider embedding spike contract tests passed: 100 Korean queries, 40 hard-negative probes, 140 documents.");
