// B-RUNTIME-01 계약 시험. 가짜 Vercel API 와 가짜 배포로 harness 와 정책을 확인한다.
import assert from "node:assert/strict";
import {
  EXPECTED_NODE_MAJOR, FORMULA_VERSION, MANIFEST_FIELDS, PROBE_PATH, REQUIRED_PER_TARGET,
  TARGETS, createVercelClient, runRuntimeSpike,
} from "./runtime-spike.mjs";
import { validateRuntimeEvidenceResult } from "./runtime-evidence-policy.mjs";

let passed = 0;
let rejected = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };

// ---------- 1. 계약 구성 ----------
ok(TARGETS.length === 2 && TARGETS.includes("production") && TARGETS.includes("preview"), "두 배포 대상을 봐야 한다");
ok(REQUIRED_PER_TARGET === 3, "대상마다 세 배포를 봐야 한다");
ok(EXPECTED_NODE_MAJOR === 24, "ADR 이 고정한 major 는 24 다");
ok(PROBE_PATH.startsWith("/api/"), "Probe 는 배포 안의 경로여야 한다");
ok(MANIFEST_FIELDS.includes("vercel_deployment_id"), "manifest 에 deployment ID 가 있어야 한다");
ok(MANIFEST_FIELDS.includes("vercel_region"), "manifest 에 region 이 있어야 한다");
ok(FORMULA_VERSION === "runtime-deployment-manifest-v1", "산식 버전이 고정돼 있어야 한다");

// ---------- 2. 가짜 Vercel 과 가짜 배포 ----------
const makeFetch = ({ oldDeployments = 2, nodeVersions = ["v24.5.0", "v24.5.1"], mismatch = false } = {}) => {
  const deployment = (target, i) => ({ uid: `dpl_${target}_${i}`, url: `${target}-${i}.vercel.app` });
  const listFor = (target) => [
    ...Array.from({ length: oldDeployments }, (_, i) => deployment(`${target}-old`, i)),
    ...Array.from({ length: 4 }, (_, i) => deployment(target, i)),
  ];
  return async (url) => {
    const text = String(url);
    if (text.includes("/v2/teams")) return new Response(JSON.stringify({ teams: [{ id: "team_1" }] }), { status: 200 });
    if (text.includes("/v9/projects/")) {
      // 개인 scope 로는 404, 팀 scope 로만 통과한다. 후보 시도 경로를 확인한다.
      return text.includes("teamId=team_1")
        ? new Response(JSON.stringify({ id: "prj_1" }), { status: 200 })
        : new Response(null, { status: 404 });
    }
    if (text.includes("/v6/deployments")) {
      const target = text.includes("target=production") ? "production" : "preview";
      return new Response(JSON.stringify({ deployments: listFor(target) }), { status: 200 });
    }
    if (text.endsWith(PROBE_PATH)) {
      const host = new URL(text).host;
      // endpoint 가 없던 시절의 배포는 404 다.
      if (host.includes("-old-")) return new Response(null, { status: 404 });
      const index = Number(host.split("-").pop().split(".")[0]);
      const version = nodeVersions[index % nodeVersions.length];
      const [, major, minor, patch] = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version);
      const target = host.startsWith("production") ? "production" : "preview";
      return new Response(JSON.stringify({
        schema_version: "1", node_version: version,
        node_major: Number(major), node_minor: Number(minor), node_patch: Number(patch),
        vercel_env: target, vercel_region: "icn1",
        vercel_deployment_id: mismatch ? "dpl_wrong" : `dpl_${target}_${index}`,
        vercel_commit_sha: "a".repeat(40), observed_at: new Date().toISOString(),
      }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
};

const run = async (options) => {
  const fetchImpl = makeFetch(options);
  const vercel = createVercelClient({ token: "tok", fetchImpl });
  return runRuntimeSpike({ vercel, projectName: "finshield", fetchImpl, progress: () => {} });
};

const observations = await run();
ok(observations.totals.probed === 6, "표본이 여섯 배포여야 한다");
ok(observations.totals.production_probed === 3 && observations.totals.preview_probed === 3, "대상마다 세 배포여야 한다");
ok(observations.totals.complete_records === 6, "여섯 기록이 모두 완전해야 한다");
ok(observations.totals.deployment_id_mismatches === 0, "deployment ID 가 모두 맞아야 한다");
ok(observations.totals.unexpected_node_major === 0, "Node major 가 모두 24 여야 한다");
ok(observations.totals.distinct_node_versions >= 1, "Node 판을 받아야 한다");
ok(observations.contract.measured_inside_deployment === true, "배포 안에서 읽었다는 사실이 남아야 한다");
// endpoint 가 없던 배포를 건너뛰지 않으면 표본이 오래된 배포로 채워진다.
ok(!observations.deployments.some((d) => d.probe_status === 404), "404 배포는 표본에 들어가면 안 된다");

// 배포가 남의 ID 를 말하면 그 응답이 그 배포에서 나왔다고 할 수 없다.
const mismatched = await run({ mismatch: true });
ok(mismatched.totals.deployment_id_mismatches === 6, "ID 불일치를 모두 세야 한다");
ok(mismatched.totals.complete_records === 0, "ID 가 어긋나면 완전한 기록이 아니다");

// ---------- 3. 정책 ----------
const good = () => ({
  schema_version: 3, blocker_id: "B-RUNTIME-01", requirements_blob_sha: "a".repeat(40), adr_decision_sha256: "b".repeat(64),
  code_under_test_sha: "c".repeat(40), workflow_head_sha: "c".repeat(40), scope_sha256: "d".repeat(64),
  run: { id: 1, attempt: 1 }, environment: {}, redactions_applied: true,
  observations: JSON.parse(JSON.stringify(observations)),
});
const check = (result) => { const errors = []; validateRuntimeEvidenceResult(result, (m) => errors.push(m)); return errors; };
assert.deepEqual(check(good()), [], "기준 결과는 정책을 통과해야 한다");
passed += 1;

assert.ok(check({ ...good(), observations: JSON.parse(JSON.stringify(mismatched)) }).length > 0,
  "정책이 ID 불일치 결과를 거부해야 한다");
rejected += 1;

const rejects = (name, mutate) => {
  const result = good();
  mutate(result.observations);
  assert.ok(check(result).length > 0, `정책이 '${name}' 를 거부해야 한다`);
  rejected += 1;
};
rejects("산식 변경", (o) => { o.contract.formula_version = "other"; });
rejects("대상 축소", (o) => { o.contract.targets = ["production"]; });
rejects("표본 수 완화", (o) => { o.contract.required_per_target = 1; });
rejects("Probe 경로 변경", (o) => { o.contract.probe_path = "/elsewhere"; });
rejects("배포 밖에서 측정", (o) => { o.contract.measured_inside_deployment = false; });
rejects("Production 표본 부족", (o) => {
  const i = o.deployments.findIndex((d) => d.target === "production");
  o.deployments.splice(i, 1); o.totals.production_probed = 2; o.totals.probed = 5; o.totals.complete_records = 5;
});
rejects("Node 판 누락", (o) => { o.deployments[0].node_version = null; o.totals.complete_records = 5; });
rejects("region 누락", (o) => { o.deployments[0].region = null; o.totals.missing_region = 1; o.totals.complete_records = 5; });
rejects("형식 어긋난 manifest", (o) => { o.deployments[0].manifest_well_formed = false; o.totals.malformed_manifests = 1; });
rejects("Node major 불일치", (o) => { o.deployments[0].node_major = 22; o.totals.unexpected_node_major = 1; });
rejects("기록률 100% 미만", (o) => { o.totals.complete_records = 5; });
rejects("판 목록과 가짓수 불일치", (o) => { o.totals.distinct_node_versions = 9; });
rejects("region 을 하나도 못 받음", (o) => { o.totals.regions = []; o.totals.distinct_regions = 0; });
rejects("observations 키 추가", (o) => { o.extra = 1; });

console.log(`B-RUNTIME-01 계약 시험 통과: 합격 ${passed}건, 정책 거부 ${rejected}건.`);
