import { fileURLToPath } from "node:url";

const API_VERSION = "2026-03-10";
const DEFAULT_REPOSITORY = "yongzooda/finshield";
const REQUIRED_CHECK_CONTEXT = "check";
const MINIMUM_ARTIFACT_RETENTION_DAYS = 30;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isSha = (value) => /^[0-9a-f]{40}$/.test(value ?? "");

const activeRules = (rulesets) => rulesets.filter((ruleset) => ruleset?.enforcement === "active");

const requiredWorkflowRulesets = (rulesets) => activeRules(rulesets).filter((ruleset) => (
  ["Organization", "Enterprise"].includes(ruleset?.source_type)
  && Array.isArray(ruleset?.rules)
  && ruleset.rules.some((rule) => rule?.type === "workflows")
));

const hasPinnedExternalWorkflow = (ruleset, targetRepositoryId) => ruleset.rules.some((rule) => (
  rule?.type === "workflows"
  && Array.isArray(rule?.parameters?.workflows)
  && rule.parameters.workflows.some((workflow) => (
    Number.isInteger(workflow?.repository_id)
    && workflow.repository_id > 0
    && workflow.repository_id !== targetRepositoryId
    && typeof workflow?.path === "string"
    && workflow.path.startsWith(".github/workflows/")
    && isSha(workflow?.sha)
  ))
));

const hasStrictRequiredCheck = (rulesets) => activeRules(rulesets).some((ruleset) => (
  Array.isArray(ruleset?.rules)
  && ruleset.rules.some((rule) => (
    rule?.type === "required_status_checks"
    && rule?.parameters?.strict_required_status_checks_policy === true
    && Array.isArray(rule?.parameters?.required_status_checks)
    && rule.parameters.required_status_checks.some((status) => (
      status?.context === REQUIRED_CHECK_CONTEXT
      && Number.isInteger(status?.integration_id)
      && status.integration_id > 0
    ))
  ))
));

export const evaluateCiIntegrityPreflight = ({
  repository,
  rulesets,
  actionsPermissions,
  workflowPermissions,
  artifactRetention,
  observedAt = new Date().toISOString(),
}) => {
  if (!isRecord(repository) || !Array.isArray(rulesets)) {
    throw new TypeError("repository와 rulesets 관측값이 필요합니다.");
  }

  const checks = [];
  const record = (id, passed, observed) => {
    checks.push({ id, status: passed ? "PASS" : "FAIL", observed });
  };

  const workflowRulesets = requiredWorkflowRulesets(rulesets);
  const workflowBypassActorsAreVisible = workflowRulesets.length > 0
    && workflowRulesets.every((ruleset) => Array.isArray(ruleset.bypass_actors));
  const workflowBypassActorsAreEmpty = workflowBypassActorsAreVisible
    && workflowRulesets.every((ruleset) => ruleset.bypass_actors.length === 0);
  const externalWorkflowPinned = workflowRulesets.some((ruleset) => (
    hasPinnedExternalWorkflow(ruleset, repository.id)
  ));

  record("OWNER_IS_ORGANIZATION", repository?.owner?.type === "Organization", repository?.owner?.type ?? "missing");
  record("ACTIVE_ORG_REQUIRED_WORKFLOW", workflowRulesets.length > 0, workflowRulesets.map((ruleset) => ruleset.id));
  record("EXTERNAL_WORKFLOW_SHA_PIN", externalWorkflowPinned, externalWorkflowPinned ? "present" : "missing");
  record(
    "REQUIRED_WORKFLOW_BYPASS_ACTORS_VISIBLE",
    workflowBypassActorsAreVisible,
    workflowBypassActorsAreVisible ? "visible" : "missing-or-unreadable",
  );
  record(
    "REQUIRED_WORKFLOW_BYPASS_ACTORS_ZERO",
    workflowBypassActorsAreEmpty,
    workflowBypassActorsAreVisible
      ? workflowRulesets.reduce((total, ruleset) => total + ruleset.bypass_actors.length, 0)
      : "unverified",
  );
  record("STRICT_REQUIRED_CHECK", hasStrictRequiredCheck(rulesets), REQUIRED_CHECK_CONTEXT);
  record(
    "ACTIONS_ENABLED",
    actionsPermissions?.enabled === true,
    actionsPermissions?.enabled === true ? "enabled" : "disabled-or-unverified",
  );
  record(
    "GITHUB_TOKEN_READ_ONLY",
    workflowPermissions?.default_workflow_permissions === "read"
      && workflowPermissions?.can_approve_pull_request_reviews === false,
    isRecord(workflowPermissions)
      ? `${workflowPermissions.default_workflow_permissions}/${workflowPermissions.can_approve_pull_request_reviews}`
      : "unverified",
  );
  record(
    "ARTIFACT_RETENTION_30_DAYS",
    Number.isInteger(artifactRetention?.days)
      && artifactRetention.days >= MINIMUM_ARTIFACT_RETENTION_DAYS,
    Number.isInteger(artifactRetention?.days) ? artifactRetention.days : "unverified",
  );

  const missingRequirements = checks.filter((check) => check.status === "FAIL").map((check) => check.id);
  return {
    schema_version: 1,
    repository: repository.full_name,
    observed_at: observedAt,
    status: missingRequirements.length === 0 ? "READY_FOR_EXTERNAL_ATTESTATION" : "BLOCKED",
    checks,
    missing_requirements: missingRequirements,
    limitations: [
      "이 preflight는 B-CI-INTEGRITY 외부 강화 완료 증거가 아니다.",
      "외부 GitHub App attestation의 발행자·현재 merge SHA·policy pin·artifact/run·27일 TTL 검증은 별도 privileged control에서 수행해야 한다.",
    ],
  };
};

const createGitHubClient = ({ token, repository, fetchImpl = globalThis.fetch }) => {
  const request = async (path) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return response.json();
  };

  return {
    getRepository: () => request(`/repos/${repository}`),
    getRulesets: () => request(`/repos/${repository}/rulesets?includes_parents=true&per_page=100`),
    getRuleset: (rulesetId) => request(`/repos/${repository}/rulesets/${rulesetId}?includes_parents=true`),
    getActionsPermissions: () => request(`/repos/${repository}/actions/permissions`),
    getWorkflowPermissions: () => request(`/repos/${repository}/actions/permissions/workflow`),
    getArtifactRetention: () => request(`/repos/${repository}/actions/permissions/artifact-and-log-retention`),
  };
};

export const collectCiIntegrityPreflight = async ({
  token,
  repository = DEFAULT_REPOSITORY,
  fetchImpl = globalThis.fetch,
}) => {
  if (typeof token !== "string" || token.length < 20) {
    throw new Error("repository·organization Ruleset 세부 조회가 가능한 관리 GH_TOKEN이 필요합니다.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("FINSHIELD_REPOSITORY는 owner/repo 형식이어야 합니다.");
  }

  const github = createGitHubClient({ token, repository, fetchImpl });
  const [repo, summaries, actionsPermissions, workflowPermissions, artifactRetention] = await Promise.all([
    github.getRepository(),
    github.getRulesets(),
    github.getActionsPermissions(),
    github.getWorkflowPermissions(),
    github.getArtifactRetention(),
  ]);
  if (!Array.isArray(summaries)) throw new Error("GitHub rulesets 응답이 배열이 아닙니다.");
  const rulesets = await Promise.all(summaries.map((ruleset) => github.getRuleset(ruleset.id)));

  return evaluateCiIntegrityPreflight({
    repository: repo,
    rulesets,
    actionsPermissions,
    workflowPermissions,
    artifactRetention,
  });
};

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  try {
    const result = await collectCiIntegrityPreflight({
      token: process.env.GH_TOKEN,
      repository: process.env.FINSHIELD_REPOSITORY ?? DEFAULT_REPOSITORY,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "READY_FOR_EXTERNAL_ATTESTATION") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`CI integrity preflight 실패: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
