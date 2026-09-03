import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  classifyModelAttempt,
  loadModelFixtures,
  percentile95,
  runDeterministicFaultFixtures,
  runModelSpike,
  usageCostUsd,
} from "./provider-model-spike.mjs";
import { validateModelEvidenceResult } from "./provider-model-policy.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const quotaHeaders = {
  "anthropic-ratelimit-requests-limit": "1000",
  "anthropic-ratelimit-requests-remaining": "999",
  "anthropic-ratelimit-requests-reset": "2026-09-04T00:00:01Z",
  "anthropic-ratelimit-input-tokens-limit": "100000",
  "anthropic-ratelimit-input-tokens-remaining": "99900",
  "anthropic-ratelimit-input-tokens-reset": "2026-09-04T00:00:01Z",
  "anthropic-ratelimit-output-tokens-limit": "100000",
  "anthropic-ratelimit-output-tokens-remaining": "99900",
  "anthropic-ratelimit-output-tokens-reset": "2026-09-04T00:00:01Z",
};

const createFakeClient = ({ breakStrictTool = false, omitQuotaHeaders = false } = {}) => {
  let requestNumber = 0;
  return {
    messages: {
      create(params) {
        requestNumber += 1;
        const currentRequest = requestNumber;
        return {
          async withResponse() {
            const headers = new Headers(omitQuotaHeaders ? {} : quotaHeaders);
            headers.set("request-id", `req_fixture_${currentRequest}`);
            if (params.tool_choice?.type === "tool") {
              const fixtureId = params.messages[0].content.match(/^Fixture (M\d{3})/)[1];
              const lookupKey = fixtures.cases.find((item) => item.id === fixtureId).lookup_key;
              assert.match(params.messages[0].content, new RegExp(`^Fixture ${fixtureId}\\nAuthorized lookup_key: ${lookupKey}\\n`));
              return {
                data: {
                  model: "claude-sonnet-5",
                  stop_reason: "tool_use",
                  content: [{
                    type: "tool_use",
                    id: `tool_${currentRequest}`,
                    name: "get_synthetic_snapshot",
                    input: { fixture_id: fixtureId, lookup_key: breakStrictTool ? "wrong" : lookupKey },
                  }],
                  usage: { input_tokens: 100, output_tokens: 10 },
                },
                response: { status: 200, headers },
                request_id: `req_fixture_${currentRequest}`,
              };
            }
            const toolResult = JSON.parse(params.messages[2].content[0].content);
            const fixtureId = params.messages[0].content.match(/^Fixture (M\d{3})/)[1];
            return {
              data: {
                model: "claude-sonnet-5",
                stop_reason: "end_turn",
                content: [{ type: "text", text: JSON.stringify({
                  fixture_id: fixtureId,
                  state: toolResult.expected_state,
                  risk_signal: toolResult.risk_signal,
                  cited_snapshot_id: "synthetic-h15-v1",
                  summary: "합성 근거 범위에서 안전 상태로 보류합니다.",
                }) }],
                usage: { input_tokens: 120, output_tokens: 20 },
              },
              response: { status: 200, headers },
              request_id: `req_fixture_${currentRequest}`,
            };
          },
        };
      },
    },
  };
};

const noWaitPacer = { wait: async () => {}, observe: () => {} };
const fixtures = loadModelFixtures(root);
assert.equal(fixtures.cases.length, 50);
assert.equal(fixtures.cases.filter((item) => item.input_kind === "text").length, 25);
assert.equal(fixtures.cases.filter((item) => item.input_kind === "file").length, 25);
assert.match(fixtures.fixtureSetHash, /^[0-9a-f]{64}$/);

assert.equal(percentile95([1, 2, 3, 4, 5]), 5);
assert.throws(() => percentile95([]), /one or more/);
assert.equal(usageCostUsd({ input_tokens: 100, output_tokens: 10 }), 0.0003);
assert.throws(() => usageCostUsd({ input_tokens: -1, output_tokens: 1 }), /token counts/);

assert.deepEqual(await classifyModelAttempt(async () => ({ stop_reason: "refusal", parsed_output: null })), { ok: false, category: "refusal" });
assert.deepEqual(await classifyModelAttempt(async () => { throw Object.assign(new Error("x"), { status: 429 }); }), { ok: false, category: "429" });
assert.deepEqual(await classifyModelAttempt(async () => { throw Object.assign(new Error("x"), { name: "APIConnectionTimeoutError" }); }), { ok: false, category: "timeout" });
const faults = await runDeterministicFaultFixtures();
assert.deepEqual(faults, {
  total: 20,
  categories: ["429", "refusal", "schema_error", "timeout"],
  false_successes: 0,
  fixture_mode: "deterministic_adapter_boundary",
});

const spike = await runModelSpike({
  root,
  apiKey: "sk-test-not-a-real-key",
  client: createFakeClient(),
  pacer: noWaitPacer,
});
assert.equal(spike.observations.normal.total, 50);
assert.equal(spike.observations.normal.live_provider_requests, 100);
assert.equal(spike.observations.latency.samples, 100);
assert.equal(spike.observations.text_runs.samples, 20);
assert.equal(spike.observations.file_runs.samples, 20);
assert.equal(spike.observations.auth.rate_limit_headers_present, true);
assert.match(spike.providerRequestIdsHash, /^[0-9a-f]{64}$/);

await assert.rejects(
  runModelSpike({ root, apiKey: "sk-test-not-a-real-key", client: createFakeClient({ breakStrictTool: true }), pacer: noWaitPacer }),
  /strict tool validation \(lookup-key\)/,
);
await assert.rejects(
  runModelSpike({ root, apiKey: "sk-test-not-a-real-key", client: createFakeClient({ omitQuotaHeaders: true }), pacer: noWaitPacer }),
  /metadata or sample counts/,
);

const result = {
  observations: spike.observations,
  environment: {
    node_version: "v24.4.1",
    region: "github-hosted",
    fixture_set_hash: spike.fixtureSetHash,
    pricing_snapshot_date: "2026-09-04",
    pricing_input_per_million_usd: 2,
    pricing_output_per_million_usd: 10,
    sdk_version: "0.117.1",
    provider_request_ids_hash: spike.providerRequestIdsHash,
    fault_fixture_mode: "deterministic_adapter_boundary",
  },
};
const policyErrors = [];
validateModelEvidenceResult(result, (message) => policyErrors.push(message));
assert.deepEqual(policyErrors, []);

const dishonestFaultResult = structuredClone(result);
dishonestFaultResult.observations.faults.fixture_mode = "live_provider";
validateModelEvidenceResult(dishonestFaultResult, (message) => policyErrors.push(message));
assert.match(policyErrors.at(-1), /오류 adapter fixture/);

console.log("Provider model spike contract tests passed: 50 synthetic cases, 20 deterministic fault cases.");
