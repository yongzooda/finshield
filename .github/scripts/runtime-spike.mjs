// ============================================================
// B-RUNTIME-01 관측 생성기.
//
// ADR 8.2 는 Vercel 의 Node 를 24.x major 로만 고정하고 minor·patch 는 플랫폼
// 갱신에 따라 달라진다고 적었다. 그래서 실제 값을 배포 안에서 읽어야 한다.
// GitHub Actions 에서 process.version 을 읽으면 runner 의 Node 를 재게 된다.
//
// Vercel API 로 Preview·Production 배포를 각각 3개 고르고, 그 배포의
// /api/runtime-manifest 를 불러 Node·region·deployment ID 를 받는다.
// API 가 말한 deployment ID 와 배포가 스스로 말한 ID 가 같아야 한다.
// 그래야 그 응답이 정말 그 배포에서 나왔다고 할 수 있다.
// ============================================================
export const FORMULA_VERSION = "runtime-deployment-manifest-v1";
export const TARGETS = Object.freeze(["production", "preview"]);
export const REQUIRED_PER_TARGET = 3;
export const EXPECTED_NODE_MAJOR = 24;
export const PROBE_PATH = "/api/runtime-manifest";
// 배포 고유 주소는 Deployment Protection 때문에 401 을 준다. 운영 별칭만 공개다.
// Vercel 이 자동화용으로 두는 우회 비밀을 project 설정에서 읽어 header 로 보낸다.
// 사람이 값을 복사해 넣을 필요가 없고, 설정이 없으면 그 사실이 그대로 드러난다.
export const BYPASS_HEADER = "x-vercel-protection-bypass";
export const MANIFEST_FIELDS = Object.freeze([
  "schema_version", "node_version", "node_major", "node_minor", "node_patch",
  "vercel_env", "vercel_region", "vercel_deployment_id", "vercel_commit_sha", "observed_at",
]);

const API = "https://api.vercel.com";

export const createVercelClient = ({ token, fetchImpl = globalThis.fetch }) => {
  const call = async (path) => {
    const response = await fetchImpl(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok: false, status: response.status, body: null };
    return { ok: true, status: response.status, body: await response.json().catch(() => null) };
  };
  return {
    listTeams: () => call("/v2/teams?limit=20"),
    // 개인 계정 token 은 scope 인자가 없어도 되고, 팀 token 은 teamId 가 필요하다.
    // 어느 쪽인지 미리 알 수 없으므로 후보를 차례로 시도한다.
    getProject: (name, teamId) => call(`/v9/projects/${encodeURIComponent(name)}${teamId ? `?teamId=${teamId}` : ""}`),
    getProjectRaw: (name, teamId) => call(`/v9/projects/${encodeURIComponent(name)}${teamId ? `?teamId=${teamId}` : ""}`),
    listDeployments: (projectId, target, teamId) => call(
      `/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=${target}`
      + `&state=READY&limit=40${teamId ? `&teamId=${teamId}` : ""}`),
  };
};

export const resolveProject = async ({ vercel, projectName }) => {
  const teams = await vercel.listTeams();
  const teamIds = Array.isArray(teams.body?.teams) ? teams.body.teams.map((team) => team.id) : [];
  for (const teamId of [null, ...teamIds]) {
    const project = await vercel.getProject(projectName, teamId);
    if (project.ok && project.body?.id) {
      // 우회 비밀은 project 응답의 key 로 온다. 값이 아니라 key 가 비밀이다.
      const bypass = Object.keys(project.body?.protectionBypass ?? {})[0] ?? null;
      return { projectId: project.body.id, teamId, bypass };
    }
  }
  throw new Error("vercel project could not be resolved with the provided token");
};

// 배포가 스스로 보고한 manifest. 형식이 어긋나면 그대로 기록하고 통과시키지 않는다.
export const probeDeployment = async ({ url, bypass = null, fetchImpl = globalThis.fetch }) => {
  const response = await fetchImpl(`https://${url}${PROBE_PATH}`, {
    headers: { Accept: "application/json", ...(bypass ? { [BYPASS_HEADER]: bypass } : {}) },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return { status: response.status, manifest: null };
  const body = await response.json().catch(() => null);
  return { status: response.status, manifest: body };
};

const wellFormed = (manifest) => manifest !== null && typeof manifest === "object"
  && MANIFEST_FIELDS.every((field) => field in manifest)
  && typeof manifest.node_version === "string"
  && Number.isInteger(manifest.node_major) && Number.isInteger(manifest.node_minor)
  && Number.isInteger(manifest.node_patch);

export const runRuntimeSpike = async ({ vercel, projectName, fetchImpl = globalThis.fetch, progress = () => {} }) => {
  const { projectId, teamId, bypass } = await resolveProject({ vercel, projectName });
  if (!bypass) {
    throw new Error("vercel protection bypass for automation is not configured on the project");
  }
  progress("project");

  const deployments = [];
  for (const target of TARGETS) {
    const listed = await vercel.listDeployments(projectId, target, teamId);
    const rows = Array.isArray(listed.body?.deployments) ? listed.body.deployments : [];
    let taken = 0;
    for (const row of rows) {
      if (taken >= REQUIRED_PER_TARGET) break;
      const probe = await probeDeployment({ url: row.url, bypass, fetchImpl });
      // endpoint 가 없던 시절의 배포는 404 다. 증거 표본이 아니라 건너뛴다.
      if (probe.status === 404) continue;
      const manifest = wellFormed(probe.manifest) ? probe.manifest : null;
      deployments.push({
        target,
        probe_status: probe.status,
        manifest_well_formed: manifest !== null,
        node_version: manifest?.node_version ?? null,
        node_major: manifest?.node_major ?? null,
        node_minor: manifest?.node_minor ?? null,
        node_patch: manifest?.node_patch ?? null,
        region: manifest?.vercel_region ?? null,
        environment: manifest?.vercel_env ?? null,
        // 응답이 정말 그 배포에서 나왔는지 본다. API 가 말한 ID 와 같아야 한다.
        deployment_id_matches_api: typeof manifest?.vercel_deployment_id === "string"
          && manifest.vercel_deployment_id === row.uid,
        commit_sha_present: typeof manifest?.vercel_commit_sha === "string" && manifest.vercel_commit_sha.length === 40,
      });
      taken += 1;
    }
    progress(`probed:${target}`);
  }

  const complete = deployments.filter((d) => d.manifest_well_formed
    && d.node_version !== null && d.region !== null && d.deployment_id_matches_api);
  const versions = [...new Set(complete.map((d) => d.node_version))].sort();
  const regions = [...new Set(complete.map((d) => d.region))].sort();

  return {
    contract: {
      formula_version: FORMULA_VERSION,
      targets: [...TARGETS],
      required_per_target: REQUIRED_PER_TARGET,
      expected_node_major: EXPECTED_NODE_MAJOR,
      probe_path: PROBE_PATH,
      manifest_fields: [...MANIFEST_FIELDS],
      // 밖에서 추정하지 않고 배포 안에서 읽은 값만 쓴다.
      measured_inside_deployment: true,
      // 배포 고유 주소는 보호돼 있어 자동화 우회 비밀로 연다. 비밀은 결과에 남기지 않는다.
      protection_bypass: "automation-secret",
    },
    deployments,
    totals: {
      probed: deployments.length,
      production_probed: deployments.filter((d) => d.target === "production").length,
      preview_probed: deployments.filter((d) => d.target === "preview").length,
      complete_records: complete.length,
      malformed_manifests: deployments.filter((d) => !d.manifest_well_formed).length,
      deployment_id_mismatches: deployments.filter((d) => !d.deployment_id_matches_api).length,
      missing_region: deployments.filter((d) => d.region === null).length,
      unexpected_node_major: complete.filter((d) => d.node_major !== EXPECTED_NODE_MAJOR).length,
      // ADR 8.2 가 minor·patch 를 고정 Snapshot 으로 쓰지 말라고 한 근거를 남긴다.
      distinct_node_versions: versions.length,
      distinct_regions: regions.length,
      node_versions: versions,
      regions,
    },
  };
};
