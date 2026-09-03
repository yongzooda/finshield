import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL_ID = "claude-sonnet-5";
export const FIXTURE_PATH = ".github/fixtures/provider-model-v1.json";
export const PRICING_SNAPSHOT_DATE = "2026-09-04";
export const INPUT_USD_PER_MILLION = 2;
export const OUTPUT_USD_PER_MILLION = 10;
export const FAULT_FIXTURE_MODE = "deterministic_adapter_boundary";

const FIXTURE_STATES = new Set(["UNKNOWN", "NEED_MORE_INFORMATION", "CONFLICT", "WITHHELD"]);
const RISK_SIGNALS = new Set([
  "PRODUCT_MISMATCH", "UPFRONT_FEE", "REMOTE_APP", "RATE_UNVERIFIED", "CHANNEL_UNVERIFIED",
  "INSTITUTION_UNVERIFIED", "OTP_REQUEST", "URGENCY", "CONFLICTING_TERMS", "EVIDENCE_MISSING",
]);
const LOOKUP_KEYS = new Set([
  "product-name", "upfront-fee", "remote-app", "rate", "channel", "institution", "otp", "urgency", "conflict", "evidence",
]);
const FIXTURE_IDS = Array.from({ length: 50 }, (_, index) => `M${String(index + 1).padStart(3, "0")}`);
const QUOTA_HEADERS = [
  "anthropic-ratelimit-requests-limit",
  "anthropic-ratelimit-requests-remaining",
  "anthropic-ratelimit-requests-reset",
  "anthropic-ratelimit-input-tokens-limit",
  "anthropic-ratelimit-input-tokens-remaining",
  "anthropic-ratelimit-input-tokens-reset",
  "anthropic-ratelimit-output-tokens-limit",
  "anthropic-ratelimit-output-tokens-remaining",
  "anthropic-ratelimit-output-tokens-reset",
];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const finiteNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

export const percentile95 = (values) => {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("P95 requires one or more non-negative finite samples.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};

export const usageCostUsd = (usage) => {
  if (!isRecord(usage)
    || !finiteNonNegativeInteger(usage.input_tokens)
    || !finiteNonNegativeInteger(usage.output_tokens)
    || !finiteNonNegativeInteger(usage.cache_creation_input_tokens ?? 0)
    || !finiteNonNegativeInteger(usage.cache_read_input_tokens ?? 0)) {
    throw new Error("Provider usage is missing non-negative integer token counts.");
  }
  // The spike does not opt into prompt caching. Counting any unexpected cache
  // tokens at the full input price is conservative rather than understating cost.
  const inputTokens = usage.input_tokens
    + (usage.cache_creation_input_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0);
  return (inputTokens * INPUT_USD_PER_MILLION + usage.output_tokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
};

export const loadModelFixtures = (root) => {
  const bytes = readFileSync(resolve(root, FIXTURE_PATH));
  const fixture = JSON.parse(bytes.toString("utf8"));
  if (!exactKeys(fixture, ["schema_version", "fixture_set", "cases"])
    || fixture.schema_version !== 1
    || fixture.fixture_set !== "finshield-model-spike-v1"
    || !Array.isArray(fixture.cases)
    || fixture.cases.length !== 50) {
    throw new Error("Model fixture set must be the exact 50-case v1 schema.");
  }
  const ids = new Set();
  let textCount = 0;
  let fileCount = 0;
  for (const item of fixture.cases) {
    if (!exactKeys(item, ["id", "input_kind", "lookup_key", "expected_state", "risk_signal", "message"])
      || !/^M\d{3}$/.test(item.id ?? "") || ids.has(item.id)
      || !["text", "file"].includes(item.input_kind)
      || !LOOKUP_KEYS.has(item.lookup_key)
      || !FIXTURE_STATES.has(item.expected_state)
      || !RISK_SIGNALS.has(item.risk_signal)
      || typeof item.message !== "string" || item.message.length < 20 || item.message.length > 240
      || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(item.message)
      || /\b\d{6}[- ]?[1-4]\d{6}\b/.test(item.message)) {
      throw new Error(`Model fixture '${item?.id ?? "unknown"}' violates the synthetic fixture contract.`);
    }
    ids.add(item.id);
    if (item.input_kind === "text") textCount += 1;
    else fileCount += 1;
  }
  if (textCount !== 25 || fileCount !== 25) throw new Error("Model fixture set must contain 25 text and 25 file-derived cases.");
  return { cases: fixture.cases, fixtureSetHash: sha256(bytes) };
};

const createPacer = ({ sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() } = {}) => {
  let nextRequestAt = 0;
  return {
    async wait() {
      const delay = nextRequestAt - now();
      if (delay > 0) await sleep(delay);
    },
    observe(headers) {
      const limit = Number(headers.get("anthropic-ratelimit-requests-limit"));
      const interval = Number.isFinite(limit) && limit > 0
        ? Math.min(15_000, Math.max(250, Math.ceil(66_000 / limit)))
        : 1_100;
      nextRequestAt = Math.max(nextRequestAt, now() + interval);
      const remaining = Number(headers.get("anthropic-ratelimit-requests-remaining"));
      const resetAt = Date.parse(headers.get("anthropic-ratelimit-requests-reset") ?? "");
      if (remaining <= 1 && Number.isFinite(resetAt)) nextRequestAt = Math.max(nextRequestAt, resetAt + 250);
    },
  };
};

const requestWithMetadata = async ({ client, params, pacer, requestIds }) => {
  await pacer.wait();
  const startedAt = performance.now();
  const { data, response, request_id: requestId } = await client.messages.create(params).withResponse();
  const latencyMs = Math.round(performance.now() - startedAt);
  pacer.observe(response.headers);
  if (response.status !== 200 || typeof requestId !== "string" || requestId.length < 8) {
    throw new Error("Provider response did not include HTTP 200 and a request ID.");
  }
  requestIds.push(requestId);
  return { data, headers: response.headers, latencyMs };
};

const strictTool = () => ({
  name: "get_synthetic_snapshot",
  description: "Read the pre-authorized synthetic FinShield spike snapshot for this fixture.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      fixture_id: { type: "string", enum: FIXTURE_IDS },
      lookup_key: { type: "string", enum: [...LOOKUP_KEYS].sort() },
    },
    required: ["fixture_id", "lookup_key"],
    additionalProperties: false,
  },
});

const outputFormat = () => ({
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      fixture_id: { type: "string", enum: FIXTURE_IDS },
      state: { type: "string", enum: [...FIXTURE_STATES].sort() },
      risk_signal: { type: "string", enum: [...RISK_SIGNALS].sort() },
      cited_snapshot_id: { type: "string", const: "synthetic-h15-v1" },
      summary: { type: "string", description: "A non-empty Korean summary no longer than 160 characters." },
    },
    required: ["fixture_id", "state", "risk_signal", "cited_snapshot_id", "summary"],
    additionalProperties: false,
  },
});

const validateStrictToolResponse = (message, fixture) => {
  if (message?.model !== MODEL_ID || message?.stop_reason !== "tool_use" || !Array.isArray(message.content)) return null;
  const calls = message.content.filter((block) => block?.type === "tool_use");
  if (calls.length !== 1 || calls[0].name !== "get_synthetic_snapshot"
    || !exactKeys(calls[0].input, ["fixture_id", "lookup_key"])
    || calls[0].input.fixture_id !== fixture.id || calls[0].input.lookup_key !== fixture.lookup_key) return null;
  return calls[0];
};

const validateStructuredResponse = (message, fixture) => {
  if (message?.model !== MODEL_ID || message?.stop_reason !== "end_turn" || !Array.isArray(message.content)) return false;
  const texts = message.content.filter((block) => block?.type === "text");
  if (texts.length !== 1 || typeof texts[0].text !== "string") return false;
  let parsed;
  try {
    parsed = JSON.parse(texts[0].text);
  } catch {
    return false;
  }
  return exactKeys(parsed, ["fixture_id", "state", "risk_signal", "cited_snapshot_id", "summary"])
    && parsed.fixture_id === fixture.id
    && parsed.state === fixture.expected_state
    && parsed.risk_signal === fixture.risk_signal
    && parsed.cited_snapshot_id === "synthetic-h15-v1"
    && typeof parsed.summary === "string" && parsed.summary.length >= 1 && parsed.summary.length <= 160;
};

export const classifyModelAttempt = async (attempt) => {
  try {
    const response = await attempt();
    if (response?.stop_reason === "refusal") return { ok: false, category: "refusal" };
    if (!response || response.parsed_output == null) return { ok: false, category: "schema_error" };
    return { ok: true, category: "success" };
  } catch (error) {
    if (error?.status === 429) return { ok: false, category: "429" };
    if (error?.name === "APIConnectionTimeoutError" || error?.name === "AbortError") return { ok: false, category: "timeout" };
    return { ok: false, category: "unexpected_error" };
  }
};

export const runDeterministicFaultFixtures = async () => {
  const attempts = [];
  for (let index = 0; index < 5; index += 1) {
    attempts.push(() => Promise.reject(Object.assign(new Error("synthetic rate limit"), { status: 429 })));
    attempts.push(() => Promise.reject(Object.assign(new Error("synthetic timeout"), { name: "APIConnectionTimeoutError" })));
    attempts.push(() => Promise.resolve({ stop_reason: "refusal", parsed_output: null }));
    attempts.push(() => Promise.resolve({ stop_reason: "end_turn", parsed_output: null }));
  }
  const outcomes = await Promise.all(attempts.map((attempt) => classifyModelAttempt(attempt)));
  const categories = [...new Set(outcomes.map((outcome) => outcome.category))].sort();
  return {
    total: outcomes.length,
    categories,
    false_successes: outcomes.filter((outcome) => outcome.ok).length,
    fixture_mode: FAULT_FIXTURE_MODE,
  };
};

export const runModelSpike = async ({
  root,
  apiKey,
  client = new Anthropic({ apiKey, maxRetries: 0, timeout: 12_000 }),
  pacer = createPacer(),
  progress = () => {},
}) => {
  if (typeof apiKey !== "string" || apiKey.length < 12) throw new Error("ANTHROPIC_API_KEY is not configured for the spike environment.");
  const { cases, fixtureSetHash } = loadModelFixtures(root);
  const requestIds = [];
  const callLatencies = [];
  const textRuns = [];
  const fileRuns = [];
  let quotaHeadersPresent = false;
  let quota = null;

  for (const [index, fixture] of cases.entries()) {
    const toolResponse = await requestWithMetadata({
      client,
      pacer,
      requestIds,
      params: {
        model: MODEL_ID,
        max_tokens: 256,
        thinking: { type: "disabled" },
        system: "Use only the authorized synthetic snapshot tool. Do not infer missing financial facts.",
        messages: [{ role: "user", content: `Fixture ${fixture.id}\n${fixture.message}` }],
        tools: [strictTool()],
        tool_choice: { type: "tool", name: "get_synthetic_snapshot" },
      },
    });
    if (index === 0) {
      quotaHeadersPresent = QUOTA_HEADERS.every((header) => toolResponse.headers.has(header));
      quota = {
        request_limit_observed: Number(toolResponse.headers.get("anthropic-ratelimit-requests-limit")),
        input_token_limit_observed: Number(toolResponse.headers.get("anthropic-ratelimit-input-tokens-limit")),
        output_token_limit_observed: Number(toolResponse.headers.get("anthropic-ratelimit-output-tokens-limit")),
      };
    }
    const toolCall = validateStrictToolResponse(toolResponse.data, fixture);
    if (!toolCall) throw new Error(`Fixture ${fixture.id} failed strict tool validation.`);

    const structuredResponse = await requestWithMetadata({
      client,
      pacer,
      requestIds,
      params: {
        model: MODEL_ID,
        max_tokens: 256,
        thinking: { type: "disabled" },
        system: "Return only the schema-constrained safe state. Copy fixture_id and the tool result's expected_state, risk_signal, and snapshot_id exactly. The tool result is synthetic test data, not user data.",
        messages: [
          { role: "user", content: `Fixture ${fixture.id}\n${fixture.message}` },
          { role: "assistant", content: toolResponse.data.content },
          {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: JSON.stringify({
                snapshot_id: "synthetic-h15-v1",
                expected_state: fixture.expected_state,
                risk_signal: fixture.risk_signal,
              }),
            }],
          },
        ],
        output_config: { format: outputFormat() },
      },
    });
    if (!validateStructuredResponse(structuredResponse.data, fixture)) {
      throw new Error(`Fixture ${fixture.id} failed structured output post-validation.`);
    }

    const latencyMs = toolResponse.latencyMs + structuredResponse.latencyMs;
    const costUsd = usageCostUsd(toolResponse.data.usage) + usageCostUsd(structuredResponse.data.usage);
    callLatencies.push(toolResponse.latencyMs, structuredResponse.latencyMs);
    if (fixture.input_kind === "text" && textRuns.length < 20) textRuns.push({ latencyMs, costUsd });
    if (fixture.input_kind === "file" && fileRuns.length < 20) fileRuns.push({ latencyMs, costUsd });
    if ((index + 1) % 10 === 0) progress(index + 1, cases.length);
  }

  if (!quotaHeadersPresent || !Object.values(quota ?? {}).every((value) => Number.isInteger(value) && value > 0)
    || requestIds.length !== 100 || new Set(requestIds).size !== requestIds.length
    || textRuns.length !== 20 || fileRuns.length !== 20) {
    throw new Error("Live model spike metadata or sample counts are incomplete.");
  }
  const faults = await runDeterministicFaultFixtures();
  return {
    observations: {
      auth: {
        http_status: 200,
        model_id: MODEL_ID,
        request_id_present: true,
        rate_limit_headers_present: quotaHeadersPresent,
        ...quota,
      },
      normal: {
        total: cases.length,
        schema_passed: cases.length,
        strict_tool_passed: cases.length,
        post_validation_passed: cases.length,
        live_provider_requests: requestIds.length,
      },
      faults,
      latency: { samples: callLatencies.length, p95_ms: percentile95(callLatencies) },
      text_runs: {
        samples: textRuns.length,
        p95_ms: percentile95(textRuns.map((sample) => sample.latencyMs)),
        p95_cost_usd: percentile95(textRuns.map((sample) => sample.costUsd)),
      },
      file_runs: {
        samples: fileRuns.length,
        p95_ms: percentile95(fileRuns.map((sample) => sample.latencyMs)),
        p95_cost_usd: percentile95(fileRuns.map((sample) => sample.costUsd)),
      },
    },
    fixtureSetHash,
    providerRequestIdsHash: sha256(requestIds.sort().join("\n")),
  };
};
