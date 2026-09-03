const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

export const validateModelEvidenceResult = (result, fail) => {
  if (!exactKeys(result?.observations, ["auth", "normal", "faults", "latency", "text_runs", "file_runs"])) {
    fail("B-MODEL-01 observations 필드가 고정 schema와 다릅니다.");
    return;
  }
  const { auth, normal, faults, latency, text_runs: textRuns, file_runs: fileRuns } = result.observations;
  if (!exactKeys(auth, [
    "http_status", "model_id", "request_id_present", "rate_limit_headers_present",
    "request_limit_observed", "input_token_limit_observed", "output_token_limit_observed",
  ])
    || auth.http_status !== 200 || auth.model_id !== "claude-sonnet-5"
    || auth.request_id_present !== true || auth.rate_limit_headers_present !== true
    || !Number.isInteger(auth.request_limit_observed) || auth.request_limit_observed <= 0
    || !Number.isInteger(auth.input_token_limit_observed) || auth.input_token_limit_observed <= 0
    || !Number.isInteger(auth.output_token_limit_observed) || auth.output_token_limit_observed <= 0) {
    fail("B-MODEL-01 auth/model/request/quota header 관측값이 합격 기준과 다릅니다.");
  }
  if (!exactKeys(normal, ["total", "schema_passed", "strict_tool_passed", "post_validation_passed", "live_provider_requests"])
    || !Number.isInteger(normal.total) || normal.total < 50
    || normal.schema_passed !== normal.total
    || normal.strict_tool_passed !== normal.total
    || normal.post_validation_passed !== normal.total
    || normal.live_provider_requests < normal.total * 2) {
    fail("B-MODEL-01 정상 schema/tool/post-validation 50건 이상 전량 합격과 live request 증거가 없습니다.");
  }
  if (!exactKeys(faults, ["total", "categories", "false_successes", "fixture_mode"])
    || !Number.isInteger(faults.total) || faults.total < 20
    || !Array.isArray(faults.categories)
    || JSON.stringify([...faults.categories].sort()) !== JSON.stringify(["429", "refusal", "schema_error", "timeout"])
    || faults.false_successes !== 0
    || faults.fixture_mode !== "deterministic_adapter_boundary") {
    fail("B-MODEL-01 오류 adapter fixture 20건·4개 유형·false success 0건 기준을 충족하지 못했습니다.");
  }
  if (!exactKeys(latency, ["samples", "p95_ms"])
    || !Number.isInteger(latency.samples) || latency.samples < 100
    || !Number.isFinite(latency.p95_ms) || latency.p95_ms < 0 || latency.p95_ms > 10_000) {
    fail("B-MODEL-01 단일 호출 P95 10초 기준을 충족하지 못했습니다.");
  }
  if (!exactKeys(textRuns, ["samples", "p95_ms", "p95_cost_usd"])
    || !Number.isInteger(textRuns.samples) || textRuns.samples < 20
    || !Number.isFinite(textRuns.p95_ms) || textRuns.p95_ms < 0 || textRuns.p95_ms > 105_000
    || !Number.isFinite(textRuns.p95_cost_usd) || textRuns.p95_cost_usd < 0 || textRuns.p95_cost_usd > 0.5) {
    fail("B-MODEL-01 Text 20건 P95 시간·비용 기준을 충족하지 못했습니다.");
  }
  if (!exactKeys(fileRuns, ["samples", "p95_ms", "p95_cost_usd"])
    || !Number.isInteger(fileRuns.samples) || fileRuns.samples < 20
    || !Number.isFinite(fileRuns.p95_ms) || fileRuns.p95_ms < 0 || fileRuns.p95_ms > 155_000
    || !Number.isFinite(fileRuns.p95_cost_usd) || fileRuns.p95_cost_usd < 0 || fileRuns.p95_cost_usd > 0.8) {
    fail("B-MODEL-01 Image/PDF 20건 P95 시간·비용 기준을 충족하지 못했습니다.");
  }
  if (!exactKeys(result?.environment, [
    "node_version", "region", "fixture_set_hash", "pricing_snapshot_date", "pricing_input_per_million_usd",
    "pricing_output_per_million_usd", "sdk_version", "provider_request_ids_hash", "fault_fixture_mode",
  ])
    || !/^v24\./.test(result.environment.node_version ?? "")
    || !/^[a-z0-9-]{2,32}$/.test(result.environment.region ?? "")
    || !/^[0-9a-f]{64}$/.test(result.environment.fixture_set_hash ?? "")
    || result.environment.pricing_snapshot_date !== "2026-09-04"
    || result.environment.pricing_input_per_million_usd !== 2
    || result.environment.pricing_output_per_million_usd !== 10
    || result.environment.sdk_version !== "0.117.1"
    || !/^[0-9a-f]{64}$/.test(result.environment.provider_request_ids_hash ?? "")
    || result.environment.fault_fixture_mode !== "deterministic_adapter_boundary") {
    fail("B-MODEL-01 environment·fixture·가격·SDK inventory가 승인된 기준과 다릅니다.");
  }
};
