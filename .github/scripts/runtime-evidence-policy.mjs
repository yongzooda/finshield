// ============================================================
// B-RUNTIME-01 사전 고정 합격선.
//
// ADR 14.2 해제 조건: Preview/Production 실제 Node minor/patch·deployment·region.
// ADR 15.1 Health·Runtime 행: Preview/Production 각 3 deploy 에서
// 실제 Node/region/deploy ID 기록 100%.
//
// 배포 밖에서 추정한 값은 증거가 아니다. 각 기록은 그 배포가 스스로 보고한
// deployment ID 가 Vercel API 의 ID 와 같을 때만 완전한 기록으로 센다.
// ============================================================
import {
  EXPECTED_NODE_MAJOR, FORMULA_VERSION, MANIFEST_FIELDS, PROBE_PATH,
  REQUIRED_PER_TARGET, TARGETS,
} from "./runtime-spike.mjs";

export { FORMULA_VERSION };

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

const RECORD_KEYS = [
  "target", "probe_status", "manifest_well_formed", "node_version", "node_major",
  "node_minor", "node_patch", "region", "environment", "deployment_id_matches_api",
  "commit_sha_present",
];

const TOTAL_KEYS = [
  "probed", "production_probed", "preview_probed", "complete_records",
  "malformed_manifests", "deployment_id_mismatches", "missing_region",
  "unexpected_node_major", "distinct_node_versions", "distinct_regions",
  "node_versions", "regions",
];

export const validateRuntimeEvidenceResult = (result, fail) => {
  const o = result?.observations;
  if (!exactKeys(o, ["contract", "deployments", "totals"])) {
    fail("observations 는 contract·deployments·totals 만 가져야 합니다.");
    return;
  }

  const c = o.contract;
  if (!exactKeys(c, ["formula_version", "targets", "required_per_target", "expected_node_major",
    "probe_path", "manifest_fields", "measured_inside_deployment", "protection_bypass"])
    || c.formula_version !== FORMULA_VERSION
    || JSON.stringify(c.targets) !== JSON.stringify([...TARGETS])
    || c.required_per_target !== REQUIRED_PER_TARGET
    || c.expected_node_major !== EXPECTED_NODE_MAJOR
    || c.probe_path !== PROBE_PATH
    || JSON.stringify(c.manifest_fields) !== JSON.stringify([...MANIFEST_FIELDS])) {
    fail("contract 의 산식·대상·표본 수·Probe 경로가 현재 코드와 다릅니다.");
  }
  // 배포 밖에서 추정한 값은 이 blocker 의 증거가 아니다.
  if (c.measured_inside_deployment !== true) fail("배포 안에서 읽지 않은 값은 채택할 수 없습니다.");
  if (c.protection_bypass !== "automation-secret") fail("배포 보호를 연 방법 선언이 계약과 다릅니다.");

  const rows = Array.isArray(o.deployments) ? o.deployments : [];
  for (const row of rows) {
    if (!exactKeys(row, RECORD_KEYS)) { fail("배포 기록이 계약과 다릅니다."); continue; }
    if (!TARGETS.includes(row.target)) fail(`배포 기록의 대상 '${row.target}' 이 계약에 없습니다.`);
    if (!Number.isInteger(row.probe_status)) fail("Probe 상태 코드가 유효하지 않습니다.");
    if (!row.manifest_well_formed) fail("형식이 어긋난 manifest 가 있습니다.");
    if (row.node_version === null) fail("Node 판 기록이 빠진 배포가 있습니다.");
    if (row.region === null) fail("region 기록이 빠진 배포가 있습니다.");
    if (!row.deployment_id_matches_api) fail("배포가 보고한 deployment ID 가 Vercel API 의 값과 다릅니다.");
    if (row.node_major !== EXPECTED_NODE_MAJOR) fail(`Node major 가 ${EXPECTED_NODE_MAJOR} 가 아닙니다.`);
  }

  const t = o.totals;
  if (!exactKeys(t, TOTAL_KEYS)) { fail("totals 필드가 계약과 다릅니다."); return; }
  if (t.production_probed !== REQUIRED_PER_TARGET) fail("Production 표본이 세 배포가 아닙니다.");
  if (t.preview_probed !== REQUIRED_PER_TARGET) fail("Preview 표본이 세 배포가 아닙니다.");
  if (t.probed !== REQUIRED_PER_TARGET * TARGETS.length) fail("표본 총수가 계약과 다릅니다.");
  // 기록 100% 가 합격선이다. 하나라도 빠지면 통과가 아니다.
  if (t.complete_records !== t.probed) fail("모든 배포에서 Node·region·deployment ID 를 받지는 못했습니다.");
  if (t.malformed_manifests !== 0) fail("형식이 어긋난 manifest 가 있습니다.");
  if (t.deployment_id_mismatches !== 0) fail("deployment ID 가 어긋난 기록이 있습니다.");
  if (t.missing_region !== 0) fail("region 이 빠진 기록이 있습니다.");
  if (t.unexpected_node_major !== 0) fail("Node major 가 계약과 다른 배포가 있습니다.");
  if (!Array.isArray(t.node_versions) || t.node_versions.length !== t.distinct_node_versions) {
    fail("Node 판 목록과 가짓수가 어긋납니다.");
  }
  if (!Array.isArray(t.regions) || t.regions.length !== t.distinct_regions) {
    fail("region 목록과 가짓수가 어긋납니다.");
  }
  if (t.distinct_node_versions < 1) fail("Node 판을 하나도 받지 못했습니다.");
  if (t.distinct_regions < 1) fail("region 을 하나도 받지 못했습니다.");
};
