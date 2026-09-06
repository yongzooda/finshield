/**
 * 실행 Manifest 를 DB 에 고정한다.
 *
 * Manifest 는 Run 이 시작될 때 어떤 Agent 와 Tool 이 허용되는지를 못 박는 값이다.
 * 같은 버전은 같은 행을 가리키고 새 행을 만들지 않는다. 그래야 Run 기록을 나중에
 * 다시 읽었을 때 그때 무엇이 허용됐는지 되짚을 수 있다.
 *
 * `finshield_worker` 는 이 표들에 직접 쓸 수 있다. 소유자 자료가 아니라 배포
 * 구성이기 때문이다. 소유자 표는 함수로만 쓴다.
 */

import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { AGENTS, MANIFEST_VERSION, POLICY_VERSIONS, SCENARIO, SCENARIO_VERSION, TOOLS } from "./manifest";

type Sql = ReturnType<typeof postgres>;

export type ResolvedManifest = {
  manifestId: string;
  kbReleaseId: string;
  agentIds: Record<string, string>;
  toolIds: Record<string, string>;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

const KB_RELEASE_VERSION = "p0-loan-corpus-v1";
const CORPUS_SCOPE = {
  schema_version: "1",
  scenario: SCENARIO,
  scenario_version: SCENARIO_VERSION,
  // 이 Release 가 덮는 범위. 여기 없는 자료는 근거로 쓰지 않는다.
  document_types: ["STATUTE", "PRODUCT_TERMS", "OFFICIAL_GUIDE", "CONSUMER_WARNING"],
};

const MODEL_BUNDLE = {
  schema_version: "1",
  judgment_model: "claude-opus-5",
  domain_model: "claude-opus-5",
};

let cached: ResolvedManifest | null = null;

/** 여러 요청이 동시에 들어와도 Release 가 두 개 생기지 않게 버전으로 고정한다. */
const ensureKbRelease = async (sql: Sql): Promise<string> => {
  const existing = await sql`select id from kb.kb_releases where version = ${KB_RELEASE_VERSION}`;
  if (existing.length > 0) return existing[0].id as string;
  const inserted = await sql`
    insert into kb.kb_releases (version, corpus_scope, document_count, chunk_count, manifest_hash)
    values (${KB_RELEASE_VERSION}, ${sql.json(CORPUS_SCOPE)}, 0, 0, ${hash(CORPUS_SCOPE)})
    on conflict (version) do nothing
    returning id`;
  if (inserted.length > 0) return inserted[0].id as string;
  const raced = await sql`select id from kb.kb_releases where version = ${KB_RELEASE_VERSION}`;
  return raced[0].id as string;
};

export const ensureManifest = async (sql: Sql): Promise<ResolvedManifest> => {
  if (cached) return cached;

  const kbReleaseId = await ensureKbRelease(sql);

  const agentIds: Record<string, string> = {};
  for (const agent of AGENTS) {
    const definitionHash = hash({ ...agent, tools: agent.tools });
    const rows = await sql`
      insert into private.agent_definitions
        (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
      values (${agent.agentCode}, ${agent.version}, ${agent.inputSchemaVersion}, ${agent.outputSchemaVersion},
              ${agent.promptVersion}, ${agent.role}, ${definitionHash})
      on conflict (agent_code, version) do update set agent_code = excluded.agent_code
      returning id`;
    agentIds[agent.agentCode] = rows[0].id as string;
  }

  const toolIds: Record<string, string> = {};
  for (const tool of TOOLS) {
    const definitionHash = hash(tool);
    const rows = await sql`
      insert into private.tool_definitions
        (tool_code, version, transport, input_schema_version, output_schema_version,
         max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
      values (${tool.toolCode}, ${tool.version}, ${tool.transport}::public.tool_transport,
              ${tool.inputSchemaVersion}, ${tool.outputSchemaVersion}, ${tool.maxPayloadBytes},
              ${tool.maxBatchSize}, ${tool.timeoutMs}, ${tool.retryLimit}, ${definitionHash})
      on conflict (tool_code, version) do update set tool_code = excluded.tool_code
      returning id`;
    toolIds[tool.toolCode] = rows[0].id as string;
  }

  // Allowlist. 여기 없는 조합으로 Tool 을 부르면 DB trigger 가 기록을 거부한다.
  for (const agent of AGENTS) {
    for (const tool of agent.tools) {
      await sql`
        insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
        values (${agentIds[agent.agentCode]}::uuid, ${toolIds[tool.toolCode]}::uuid, ${tool.purposeCode})
        on conflict do nothing`;
    }
  }

  const configHash = hash({ MANIFEST_VERSION, SCENARIO_VERSION, POLICY_VERSIONS, MODEL_BUNDLE, AGENTS, TOOLS });
  const manifestRows = await sql`
    insert into private.execution_manifests
      (manifest_version, scenario, scenario_version, model_bundle, prompt_bundle_version, schema_bundle_version,
       evidence_policy_version, result_matrix_version, coverage_contract_version, profile_policy_version,
       pii_policy_version, kb_release_id, config_hash)
    values (${MANIFEST_VERSION}, ${SCENARIO}::public.case_scenario, ${SCENARIO_VERSION}, ${sql.json(MODEL_BUNDLE)},
            ${POLICY_VERSIONS.promptBundleVersion}, ${POLICY_VERSIONS.schemaBundleVersion},
            ${POLICY_VERSIONS.evidencePolicyVersion}, ${POLICY_VERSIONS.resultMatrixVersion},
            ${POLICY_VERSIONS.coverageContractVersion}, ${POLICY_VERSIONS.profilePolicyVersion},
            ${POLICY_VERSIONS.piiPolicyVersion}, ${kbReleaseId}::uuid, ${configHash})
    on conflict (manifest_version) do update set manifest_version = excluded.manifest_version
    returning id`;
  const manifestId = manifestRows[0].id as string;

  for (const agent of AGENTS) {
    await sql`
      insert into private.execution_manifest_agents
        (execution_manifest_id, agent_definition_id, logical_agent_key, required)
      values (${manifestId}::uuid, ${agentIds[agent.agentCode]}::uuid, ${agent.logicalKey}, ${agent.required})
      on conflict do nothing`;
    for (const tool of agent.tools) {
      await sql`
        insert into private.execution_manifest_tools
          (execution_manifest_id, tool_definition_id, purpose_code, required)
        values (${manifestId}::uuid, ${toolIds[tool.toolCode]}::uuid, ${tool.purposeCode}, false)
        on conflict do nothing`;
    }
  }

  cached = { manifestId, kbReleaseId, agentIds, toolIds };
  return cached;
};

/** 시험이 캐시를 비울 수 있게 둔다. 제품 경로에서는 부르지 않는다. */
export const resetManifestCache = () => { cached = null; };
