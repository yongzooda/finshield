// B-LAW-01 계약 시험. 가짜 Vercel 과 가짜 배포로 harness 와 정책을 확인한다.
import assert from "node:assert/strict";
import { createVercelClient } from "./runtime-spike.mjs";
import {
  FORMULA_VERSION, OUTCOMES, PROBE_PATH, SCENARIOS, SNAPSHOT_REPEATS, TARGETS,
  probeToken, runLawSpike,
} from "./law-spike.mjs";
import { validateLawEvidenceResult } from "./law-evidence-policy.mjs";

let passed = 0;
let rejected = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };

// ---------- 1. 계약 구성 ----------
ok(FORMULA_VERSION === "law-referer-and-snapshot-v1", "산식 버전이 고정돼 있어야 한다");
ok(TARGETS.length === 2, "Preview 와 Production 을 모두 봐야 한다");
ok(SCENARIOS.includes("registered") && SCENARIOS.includes("unregistered"), "등록·미등록 Referer 를 모두 봐야 한다");
ok(SCENARIOS.includes("absent"), "Referer 없는 요청도 봐야 한다");
ok(SCENARIOS.includes("snapshot"), "고정 질의가 있어야 한다");
ok(SCENARIOS.includes("change_recent"), "변경 조문 조회가 있어야 한다");
ok(SNAPSHOT_REPEATS >= 2, "고정 질의는 두 번 이상 불러야 흔들림을 본다");
ok(OUTCOMES.includes("rate_limited") && OUTCOMES.includes("server_error"), "429·5xx 를 구분해 남겨야 한다");
// 같은 시각이면 같은 표식이고 OC 원문은 표식에 드러나지 않는다.
ok(probeToken("oc-x") === probeToken("oc-x") && probeToken("oc-x") !== probeToken("oc-y"), "표식이 OC 에 따라 달라야 한다");
ok(!probeToken("oc-x").includes("oc-x"), "표식에 OC 원문이 드러나지 않아야 한다");

// ---------- 2. 가짜 Vercel 과 가짜 배포 ----------
const BYPASS = "b".repeat(32);
const SNAPSHOT_HASH = "a".repeat(64);
const makeFetch = ({ unregisteredPasses = false, oldDeployments = 1 } = {}) => async (url, init) => {
  const text = String(url);
  if (text.includes("/v2/teams")) return new Response(JSON.stringify({ teams: [{ id: "team_1" }] }), { status: 200 });
  if (text.includes("/v9/projects/")) {
    return new Response(JSON.stringify({ id: "prj_1", protectionBypass: { [BYPASS]: { scope: "automation-bypass" } } }), { status: 200 });
  }
  if (text.includes("/v6/deployments")) {
    const target = text.includes("target=production") ? "production" : "preview";
    const rows = [
      ...Array.from({ length: oldDeployments }, (_, i) => ({ uid: `dpl_${target}_old_${i}`, url: `${target}-old-${i}.vercel.app` })),
      { uid: `dpl_${target}`, url: `${target}.vercel.app` },
    ];
    return new Response(JSON.stringify({ deployments: rows }), { status: 200 });
  }
  if (text.includes(PROBE_PATH)) {
    const host = new URL(text).host;
    if (host.includes("-old-")) return new Response(null, { status: 404 });
    if (init?.headers?.["x-vercel-protection-bypass"] !== BYPASS) return new Response(null, { status: 401 });
    if (!/^[0-9a-f]{64}$/.test(init?.headers?.["x-probe-auth"] ?? "")) return new Response(null, { status: 401 });
    const scenario = new URL(text).searchParams.get("scenario");
    const target = host.startsWith("production") ? "production" : "preview";
    const passes = scenario === "unregistered" ? unregisteredPasses : scenario !== "absent";
    return new Response(JSON.stringify({
      schema_version: "1", scenario,
      referer_kind: scenario === "absent" ? "none" : scenario === "unregistered" ? "unregistered"
        : scenario === "deployment_url" ? "deployment" : "registered",
      referer_present: scenario !== "absent",
      status: 200, outcome: passes ? "ok" : "auth_rejected",
      result_code: passes ? null : "AUTH", content_type: "application/json",
      bytes: 1234, body_sha256: scenario === "snapshot" ? SNAPSHOT_HASH : "c".repeat(64),
      ms: 210, vercel_env: target, vercel_deployment_id: `dpl_${target}`,
    }), { status: 200 });
  }
  return new Response(null, { status: 404 });
};

const run = async (options) => {
  const fetchImpl = makeFetch(options);
  const vercel = createVercelClient({ token: "tok", fetchImpl });
  return runLawSpike({ vercel, projectName: "finshield", oc: "oc-x", fetchImpl, progress: () => {} });
};

const observations = await run();
ok(observations.totals.records === TARGETS.length * SCENARIOS.length + (SNAPSHOT_REPEATS - 1), "기록 수가 계약과 같아야 한다");
ok(observations.totals.registered_ok === 2, "등록 도메인은 양쪽에서 통해야 한다");
ok(observations.totals.unregistered_ok === 0, "등록하지 않은 도메인은 통하면 안 된다");
ok(observations.totals.snapshot_hash_stable === true, "고정 질의 해시가 같아야 한다");
ok(observations.totals.deployment_id_mismatches === 0, "deployment ID 가 모두 맞아야 한다");
ok(!observations.records.some((r) => r.probe_status === 404), "endpoint 가 없던 배포는 표본에 들어가면 안 된다");
ok(!JSON.stringify(observations).includes("oc-x"), "결과에 OC 가 남지 않아야 한다");

// ---------- 3. 정책 ----------
const good = () => ({
  schema_version: 3, blocker_id: "B-LAW-01", requirements_blob_sha: "a".repeat(40), adr_decision_sha256: "b".repeat(64),
  code_under_test_sha: "c".repeat(40), workflow_head_sha: "c".repeat(40), scope_sha256: "d".repeat(64),
  run: { id: 1, attempt: 1 }, environment: {}, redactions_applied: true,
  observations: JSON.parse(JSON.stringify(observations)),
});
const check = (result) => { const errors = []; validateLawEvidenceResult(result, (m) => errors.push(m)); return errors; };
assert.deepEqual(check(good()), [], "기준 결과는 정책을 통과해야 한다");
passed += 1;

// 등록하지 않은 도메인이 통하면 ADR 5.2 의 전제가 틀린 것이므로 막아야 한다.
const loose = await run({ unregisteredPasses: true });
assert.ok(check({ ...good(), observations: JSON.parse(JSON.stringify(loose)) }).length > 0,
  "정책이 미등록 도메인 통과를 거부해야 한다");
rejected += 1;

const rejects = (name, mutate) => {
  const result = good();
  mutate(result.observations);
  assert.ok(check(result).length > 0, `정책이 '${name}' 를 거부해야 한다`);
  rejected += 1;
};
rejects("산식 변경", (o) => { o.contract.formula_version = "other"; });
rejects("Probe 경로 변경", (o) => { o.contract.probe_path = "/elsewhere"; });
rejects("대상 축소", (o) => { o.contract.targets = ["production"]; });
rejects("시나리오 축소", (o) => { o.contract.scenarios = ["registered"]; });
rejects("배포 밖에서 측정", (o) => { o.contract.measured_inside_deployment = false; });
rejects("Probe 인증 방식 변경", (o) => { o.contract.probe_auth = "open"; });
rejects("기록 부족", (o) => { o.records.pop(); o.totals.records -= 1; });
rejects("형식 어긋난 기록", (o) => { o.records[0].record_well_formed = false; o.totals.malformed_records = 1; });
rejects("deployment ID 불일치", (o) => { o.records[0].deployment_id_matches = false; o.totals.deployment_id_mismatches = 1; });
rejects("등록 도메인이 한쪽만 통함", (o) => { o.totals.registered_ok = 1; });
rejects("고정 질의 실패", (o) => { o.totals.snapshot_ok = 0; });
rejects("고정 질의 해시 흔들림", (o) => { o.totals.snapshot_hash_stable = false; o.totals.distinct_snapshot_hashes = 2; });
rejects("본문 해시 없음", (o) => { const r = o.records.find((x) => x.outcome === "ok"); r.body_sha256 = null; });
rejects("시간 초과", (o) => { o.totals.timeouts = 1; });
rejects("서버 오류", (o) => { o.totals.server_errors = 1; });
rejects("observations 키 추가", (o) => { o.extra = 1; });

console.log(`B-LAW-01 계약 시험 통과: 합격 ${passed}건, 정책 거부 ${rejected}건.`);
