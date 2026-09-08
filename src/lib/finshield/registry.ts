/**
 * 실행 Manifest 를 읽고 코드와 DB 가 같은 값을 보는지 확인한다.
 *
 * Manifest 는 Migration 0021 이 심는다. Runtime 은 쓰지 않는다. `finshield_worker`
 * 에게 쓰기 권한이 없는 것이 설계다. Run 이 시작될 때 무엇이 허용됐는지를 나중에
 * 되짚으려면 그 값이 배포와 함께 고정돼 있어야 한다.
 *
 * 코드의 선언과 DB 의 행이 어긋나면 Run 을 시작하지 않는다. 조용히 다른 구성으로
 * 도는 것보다 그 자리에서 멈추는 편이 낫다.
 */

import "server-only";
import type postgres from "postgres";
import {
  AGENTS, DEFINITION_VERSION, TOOL_DEFINITION_VERSION, MANIFEST_VERSION, FINSHIELD_MODEL, MODEL_TIMEOUTS,
  TOOLS, POLICY_VERSIONS,
} from "./manifest";

type Sql = ReturnType<typeof postgres>;

export type ResolvedManifest = {
  manifestId: string;
  kbReleaseId: string;
  agentIds: Record<string, string>;
  toolIds: Record<string, string>;
};

let cached: ResolvedManifest | null = null;

export class ManifestDriftError extends Error {}

export const loadManifest = async (sql: Sql): Promise<ResolvedManifest> => {
  if (cached) return cached;

  const manifests = await sql`
    select id, kb_release_id, model_bundle, profile_policy_version from private.execution_manifests
     where manifest_version = ${MANIFEST_VERSION}`;
  if (manifests.length !== 1) {
    throw new ManifestDriftError(`실행 Manifest ${MANIFEST_VERSION} 이 DB 에 없다. 해당 배포의 Migration과 실행 설정을 적용했는지 확인할 것`);
  }
  if (manifests[0].profile_policy_version !== POLICY_VERSIONS.profilePolicyVersion) {
    throw new ManifestDriftError("Manifest 프로필 정책이 코드와 다르다");
  }
  const bundle = manifests[0].model_bundle;
  if (bundle?.judgment_model !== FINSHIELD_MODEL || bundle?.domain_model !== FINSHIELD_MODEL) {
    throw new ManifestDriftError("Manifest 모델이 FinShield 기본 모델과 다르다");
  }
  const timeoutPolicy = bundle?.timeout_policy;
  if (!timeoutPolicy || Object.entries(MODEL_TIMEOUTS).some(([key, value]) => timeoutPolicy[key] !== value)) {
    throw new ManifestDriftError("Manifest 모델 시간 제한이 코드와 다르다");
  }
  const manifestId = manifests[0].id as string;
  const kbReleaseId = manifests[0].kb_release_id as string;

  const agentRows = await sql`
    select ad.agent_code, ad.id, ma.logical_agent_key
      from private.execution_manifest_agents ma
      join private.agent_definitions ad on ad.id = ma.agent_definition_id
     where ma.execution_manifest_id = ${manifestId}::uuid and ad.version = ${DEFINITION_VERSION}`;
  const agentIds: Record<string, string> = {};
  for (const row of agentRows) agentIds[row.agent_code as string] = row.id as string;

  for (const agent of AGENTS) {
    if (!agentIds[agent.agentCode]) {
      throw new ManifestDriftError(`Manifest 에 ${agent.agentCode} 가 없다`);
    }
    const bound = agentRows.find((row) => row.agent_code === agent.agentCode);
    if (bound?.logical_agent_key !== agent.logicalKey) {
      throw new ManifestDriftError(`${agent.agentCode} 의 논리 key 가 코드와 다르다`);
    }
  }
  if (agentRows.length !== AGENTS.length) {
    throw new ManifestDriftError(`Manifest 의 Agent 수가 코드와 다르다: ${agentRows.length}`);
  }

  const toolRows = await sql`
    select tool_code, id from private.tool_definitions where version = ${TOOL_DEFINITION_VERSION}`;
  const toolIds: Record<string, string> = {};
  for (const row of toolRows) toolIds[row.tool_code as string] = row.id as string;
  for (const tool of TOOLS) {
    if (!toolIds[tool.toolCode]) throw new ManifestDriftError(`Tool ${tool.toolCode} 가 DB 에 없다`);
  }

  // Allowlist 도 대조한다. 코드가 더 넓게 알고 있으면 실행 중에야 막히므로 여기서 멈춘다.
  const allowRows = await sql`
    select ad.agent_code, td.tool_code, al.purpose_code
      from private.agent_tool_allowlists al
      join private.agent_definitions ad on ad.id = al.agent_definition_id
      join private.tool_definitions td on td.id = al.tool_definition_id
     where ad.version = ${DEFINITION_VERSION} and td.version = ${TOOL_DEFINITION_VERSION}`;
  const allowed = new Set(allowRows.map((row) => `${row.agent_code}:${row.tool_code}:${row.purpose_code}`));
  for (const agent of AGENTS) {
    for (const tool of agent.tools) {
      const key = `${agent.agentCode}:${tool.toolCode}:${tool.purposeCode}`;
      if (!allowed.has(key)) throw new ManifestDriftError(`허용 목록에 없다: ${key}`);
    }
  }

  if (allowed.size !== AGENTS.reduce((n, agent) => n + agent.tools.length, 0)) {
    throw new ManifestDriftError("DB에 코드보다 넓은 Tool 권한이 있다");
  }
  cached = { manifestId, kbReleaseId, agentIds, toolIds };
  return cached;
};

/** 시험이 캐시를 비울 수 있게 둔다. 제품 경로에서는 부르지 않는다. */
export const resetManifestCache = () => { cached = null; };
