import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { validateKoreanRecord, validateCommitMessage, validatePullRequest } from "./validate-korean-records.mjs";

assert.deepEqual(validateCommitMessage("fix: 한국어 기록 검사 추가\n\nCloses #36\n관련 이슈: #29"), []);
for (const message of ["test: add evidence harness", "fix: 한국어 제목\n\nRetain sanitized diagnostics.",
  "fix: 한국어 제목\n\nCo-Authored-By: tool <x@example.com>"]) assert.ok(validateCommitMessage(message).length);
assert.deepEqual(validateKoreanRecord({ title: "[FIX] API 응답 오류", requireBody: true,
  body: "응답 오류를 수정합니다.\n\n```text\nError: request failed\n```\n\n- `npm test`\nCloses #36\nhttps://example.com" }), []);
assert.ok(validateKoreanRecord({ title: "fix: 한국어 제목", body: "English only body", requireBody: true }).length);
assert.ok(validateKoreanRecord({ title: "fix: 한국어 제목", body: "<!-- 한국어 설명 -->\nCloses #36", requireBody: true }).length);
assert.ok(validateKoreanRecord({ title: "fix: 한국어 제목", body: "```\nError", requireBody: true }).length);
assert.deepEqual(validateKoreanRecord({ body: "한국어 설명입니다.\n> Original provider message", requireBody: true }), []);

const pr = { number: 37, commits: 1, title: "fix: 한국어 기록 검사", body: "기록 형식 검사를 추가합니다.\n\nCloses #36" };
const api = async (path) => path.includes("/commits?")
  ? [{ commit: { message: "fix: 한국어 기록 검사" } }]
  : { number: 36, title: "[FIX] 영어 기록 오류", body: "한국어 기록으로 정정합니다." };
assert.deepEqual(await validatePullRequest(pr, api), []);
assert.ok((await validatePullRequest(pr, async (path) => path.includes("/commits?")
  ? [{ commit: { message: "fix: add validation" } }] : api(path))).length);
assert.ok((await validatePullRequest(pr, async (path) => path.includes("/commits?")
  ? api(path) : { number: 36, title: "English issue", body: "English description" })).length);
await assert.rejects(validatePullRequest(pr, async () => []), /전체 커밋/);
await assert.rejects(validatePullRequest(pr, async () => { throw new Error("읽기 권한 없음"); }), /권한/);
const many = { ...pr, commits: 101, body: "커밋 전체를 검사합니다." };
assert.deepEqual(await validatePullRequest(many, async (path) => Array.from({ length: path.endsWith("page=1") ? 100 : 1 },
  () => ({ commit: { message: "fix: 한국어 커밋 검사" } }))), []);
await assert.rejects(validatePullRequest(many, async (path) => path.endsWith("page=1")
  ? Array.from({ length: 100 }, () => ({ commit: { message: "fix: 한국어 커밋 검사" } })) : []), /전체 커밋/);

const dir = mkdtempSync(resolve(tmpdir(), "finshield-korean-record-"));
try {
  const file = resolve(dir, "message");
  writeFileSync(file, "fix: 한국어 커밋 검사\n\n# 편집기 설명");
  const args = [".github/scripts/validate-korean-records.mjs", "--commit-file", file];
  assert.equal(spawnSync(process.execPath, args).status, 0);
  writeFileSync(file, "fix: English commit");
  assert.equal(spawnSync(process.execPath, args).status, 1);
} finally { rmSync(dir, { recursive: true, force: true }); }

const ci = parse(readFileSync(".github/workflows/pr-check.yml", "utf8"));
assert.deepEqual(ci.on.pull_request.types, ["opened", "synchronize", "reopened", "edited"]);
assert.equal(ci.permissions.issues, "read");
for (const command of ["node .github/scripts/test-korean-records.mjs", "node .github/scripts/validate-korean-records.mjs --ci"]) {
  const steps = ci.jobs.check.steps.filter((s) => s.run === command);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].if, undefined);
  assert.equal(steps[0]["continue-on-error"], undefined);
}
const records = parse(readFileSync(".github/workflows/record-language.yml", "utf8"));
assert.deepEqual(records.on.issues.types, ["opened", "edited", "reopened"]);
assert.deepEqual(records.on.issue_comment.types, ["created", "edited"]);
assert.ok(Object.values(records.permissions).every((v) => v === "read"));
assert.ok(!JSON.stringify(records).includes("pull_request_target"));
assert.match(readFileSync(".githooks/commit-msg", "utf8"), /validate-korean-records\.mjs --commit-file "\$1"/);
console.log("한국어 기록 검사: 제목·본문·커밋·연결 이슈·페이지 누락·권한·CI 연결 회귀 테스트 통과.");
