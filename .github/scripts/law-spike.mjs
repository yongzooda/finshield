// ============================================================
// B-LAW-01 관측 생성기.
//
// ADR 5.2 는 법제처가 요청의 Referer 를 등록 도메인과 대조한다고 적었고,
// Preview 와 Production 각각에서 probe 해 어느 범위까지 통과하는지 확인하라고
// 요구한다. 그래서 배포 안의 관측 endpoint 를 부른다. Actions 에서 직접 부르면
// 우리 배포가 아니라 runner 의 환경을 재게 된다.
//
// endpoint 는 OC 에서 유도한 시각 한정 표식을 요구한다. OC 자체는 오가지 않고
// 시험 쪽과 배포 쪽이 이미 같은 값을 들고 있어 새 secret 이 필요 없다.
// ============================================================
import { createHash } from "node:crypto";
import { resolveProject } from "./runtime-spike.mjs";

export const FORMULA_VERSION = "law-referer-and-snapshot-v1";
export const PROBE_PATH = "/api/law-probe";
export const TARGETS = Object.freeze(["production", "preview"]);
export const SCENARIOS = Object.freeze([
  "registered", "absent", "deployment_url", "unregistered", "snapshot", "change_recent",
]);
// 운영에서 고정 질의를 한 번 더 불러 본문 해시가 흔들리지 않는지 본다.
export const SNAPSHOT_REPEATS = 2;
export const RECORD_FIELDS = Object.freeze([
  "schema_version", "scenario", "referer_kind", "referer_present", "status", "outcome",
  "result_code", "content_type", "bytes", "body_sha256", "ms", "vercel_env", "vercel_deployment_id",
]);
export const OUTCOMES = Object.freeze([
  "ok", "auth_rejected", "http_error", "rate_limited", "server_error", "timeout", "network_error",
]);

// 시각 한정 표식. 배포 쪽과 같은 식으로 만든다.
export const probeToken = (oc, at = Date.now()) => createHash("sha256")
  .update(`${oc}:${new Date(at).toISOString().slice(0, 13)}`, "utf8").digest("hex");

const wellFormed = (record) => record !== null && typeof record === "object"
  && RECORD_FIELDS.every((field) => field in record)
  && OUTCOMES.includes(record.outcome)
  && Number.isInteger(record.status);

export const callProbe = async ({ url, scenario, token, bypass, fetchImpl = globalThis.fetch }) => {
  const response = await fetchImpl(`https://${url}${PROBE_PATH}?scenario=${encodeURIComponent(scenario)}`, {
    headers: {
      Accept: "application/json",
      "x-probe-auth": token,
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { probe_status: response.status, record: null };
  return { probe_status: response.status, record: await response.json().catch(() => null) };
};

export const runLawSpike = async ({ vercel, projectName, oc, fetchImpl = globalThis.fetch, progress = () => {} }) => {
  const { projectId, teamId, bypass } = await resolveProject({ vercel, projectName });
  if (!bypass) throw new Error("vercel protection bypass for automation is not configured on the project");
  const token = probeToken(oc);
  progress("project");

  const deployments = {};
  for (const target of TARGETS) {
    const listed = await vercel.listDeployments(projectId, target, teamId);
    const rows = Array.isArray(listed.body?.deployments) ? listed.body.deployments : [];
    for (const row of rows) {
      const probe = await callProbe({ url: row.url, scenario: "registered", token, bypass, fetchImpl });
      // endpoint 가 없던 배포는 404 다. 표본이 아니라 건너뛴다.
      if (probe.probe_status === 404) continue;
      deployments[target] = { url: row.url, uid: row.uid };
      break;
    }
    if (!deployments[target]) throw new Error(`no ${target} deployment carries the law probe endpoint`);
    progress(`resolved:${target}`);
  }

  const records = [];
  for (const target of TARGETS) {
    for (const scenario of SCENARIOS) {
      const repeats = target === "production" && scenario === "snapshot" ? SNAPSHOT_REPEATS : 1;
      for (let attempt = 1; attempt <= repeats; attempt += 1) {
        const probe = await callProbe({ url: deployments[target].url, scenario, token, bypass, fetchImpl });
        const record = wellFormed(probe.record) ? probe.record : null;
        records.push({
          target,
          scenario,
          attempt,
          probe_status: probe.probe_status,
          record_well_formed: record !== null,
          referer_kind: record?.referer_kind ?? null,
          referer_present: record?.referer_present ?? null,
          status: record?.status ?? null,
          outcome: record?.outcome ?? null,
          result_code: record?.result_code ?? null,
          content_type: record?.content_type ?? null,
          bytes: record?.bytes ?? null,
          body_sha256: record?.body_sha256 ?? null,
          ms: record?.ms ?? null,
          // 배포가 스스로 어느 환경인지 말한 값이다. 밖에서 붙이지 않는다.
          reported_env: record?.vercel_env ?? null,
          deployment_id_matches: typeof record?.vercel_deployment_id === "string"
            && record.vercel_deployment_id === deployments[target].uid,
        });
      }
    }
    progress(`probed:${target}`);
  }

  const okOf = (scenario) => records.filter((r) => r.scenario === scenario && r.outcome === "ok").length;
  const snapshots = records.filter((r) => r.scenario === "snapshot" && r.target === "production");
  const snapshotHashes = [...new Set(snapshots.map((r) => r.body_sha256).filter(Boolean))];

  return {
    contract: {
      formula_version: FORMULA_VERSION,
      probe_path: PROBE_PATH,
      targets: [...TARGETS],
      scenarios: [...SCENARIOS],
      snapshot_repeats: SNAPSHOT_REPEATS,
      record_fields: [...RECORD_FIELDS],
      outcomes: [...OUTCOMES],
      // 배포 안에서 부른 결과만 쓴다. OC 와 요청 주소는 결과에 담지 않는다.
      measured_inside_deployment: true,
      probe_auth: "oc-derived-hourly-token",
    },
    records,
    totals: {
      records: records.length,
      malformed_records: records.filter((r) => !r.record_well_formed).length,
      deployment_id_mismatches: records.filter((r) => !r.deployment_id_matches).length,
      registered_ok: okOf("registered"),
      absent_ok: okOf("absent"),
      deployment_url_ok: okOf("deployment_url"),
      unregistered_ok: okOf("unregistered"),
      snapshot_ok: okOf("snapshot"),
      change_recent_ok: okOf("change_recent"),
      auth_rejected: records.filter((r) => r.outcome === "auth_rejected").length,
      rate_limited: records.filter((r) => r.outcome === "rate_limited").length,
      server_errors: records.filter((r) => r.outcome === "server_error").length,
      http_errors: records.filter((r) => r.outcome === "http_error").length,
      timeouts: records.filter((r) => r.outcome === "timeout").length,
      distinct_snapshot_hashes: snapshotHashes.length,
      snapshot_hash_stable: snapshotHashes.length === 1,
      max_ms: records.reduce((max, r) => Math.max(max, r.ms ?? 0), 0),
    },
  };
};
