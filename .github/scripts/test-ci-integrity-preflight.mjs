import assert from "node:assert/strict";
import { evaluateCiIntegrityPreflight } from "./ci-integrity-preflight.mjs";

const orgRequiredWorkflow = {
  id: 20,
  enforcement: "active",
  source_type: "Organization",
  bypass_actors: [],
  rules: [{
    type: "workflows",
    parameters: {
      workflows: [{
        repository_id: 999,
        path: ".github/workflows/finshield-integrity.yml",
        sha: "a".repeat(40),
      }],
    },
  }],
};

const repositoryRuleset = {
  id: 10,
  enforcement: "active",
  source_type: "Repository",
  bypass_actors: [],
  rules: [{
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "check", integration_id: 15368 }],
    },
  }],
};

const validFixture = () => ({
  repository: { id: 123, full_name: "finshield-team/finshield", owner: { type: "Organization" } },
  rulesets: structuredClone([repositoryRuleset, orgRequiredWorkflow]),
  actionsPermissions: { enabled: true },
  workflowPermissions: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
  artifactRetention: { days: 30 },
  observedAt: "2026-09-04T00:00:00.000Z",
});

const expectBlocked = (mutate, expectedId) => {
  const fixture = validFixture();
  mutate(fixture);
  const result = evaluateCiIntegrityPreflight(fixture);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.missing_requirements.includes(expectedId), `${expectedId}가 차단 사유에 없습니다.`);
};

const ready = evaluateCiIntegrityPreflight(validFixture());
assert.equal(ready.status, "READY_FOR_EXTERNAL_ATTESTATION");
assert.deepEqual(ready.missing_requirements, []);
assert.match(ready.limitations.join(" "), /PASS 증거가 아니다/);

expectBlocked((fixture) => { fixture.repository.owner.type = "User"; }, "OWNER_IS_ORGANIZATION");
expectBlocked((fixture) => { fixture.rulesets = [repositoryRuleset]; }, "ACTIVE_ORG_REQUIRED_WORKFLOW");
expectBlocked((fixture) => {
  fixture.rulesets[1].rules[0].parameters.workflows[0].sha = "main";
}, "EXTERNAL_WORKFLOW_SHA_PIN");
expectBlocked((fixture) => {
  fixture.rulesets[1].rules[0].parameters.workflows[0].repository_id = fixture.repository.id;
}, "EXTERNAL_WORKFLOW_SHA_PIN");
expectBlocked((fixture) => { delete fixture.rulesets[1].bypass_actors; }, "REQUIRED_WORKFLOW_BYPASS_ACTORS_VISIBLE");
expectBlocked((fixture) => { fixture.rulesets[1].bypass_actors.push({ actor_id: 1 }); }, "REQUIRED_WORKFLOW_BYPASS_ACTORS_ZERO");
expectBlocked((fixture) => {
  fixture.rulesets[0].rules[0].parameters.strict_required_status_checks_policy = false;
}, "STRICT_REQUIRED_CHECK");
expectBlocked((fixture) => { fixture.workflowPermissions.default_workflow_permissions = "write"; }, "GITHUB_TOKEN_READ_ONLY");
expectBlocked((fixture) => { fixture.artifactRetention.days = 29; }, "ARTIFACT_RETENTION_30_DAYS");

process.stdout.write("CI integrity preflight contract test passed\n");
