import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { withoutVerifiedConflictFooter, SQUASH_WRAP_COLUMNS, isBranchUpdateMergeCommit, validateKoreanRecord, validateCommitMessage, validatePullRequest, wrapSquashBody } from "./validate-korean-records.mjs";

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
// main 을 따라잡는 GitHub 병합 커밋(부모 2개)은 검사에서 제외하고, 부모 1개인 영어 커밋은 여전히 거부한다.
const mergeMessage = "Merge branch 'main' into feat/runs-and-manifests";
assert.ok(isBranchUpdateMergeCommit({ parents: [{}, {}], commit: { message: mergeMessage } }));
assert.ok(!isBranchUpdateMergeCommit({ parents: [{}], commit: { message: mergeMessage } }));
assert.ok(!isBranchUpdateMergeCommit({ parents: [{}, {}], commit: { message: "Merge pull request #1 from x/y" } }));
const merged = { ...pr, commits: 2 };
assert.deepEqual(await validatePullRequest(merged, async (path) => path.includes("/commits?")
  ? [{ commit: { message: "fix: 한국어 기록 검사" } }, { parents: [{}, {}], commit: { message: mergeMessage } }] : api(path)), []);
assert.ok((await validatePullRequest(merged, async (path) => path.includes("/commits?")
  ? [{ commit: { message: "fix: 한국어 기록 검사" } }, { parents: [{}], commit: { message: mergeMessage } }] : api(path))).length);
await assert.rejects(validatePullRequest(pr, async () => []), /전체 커밋/);
await assert.rejects(validatePullRequest(pr, async () => { throw new Error("읽기 권한 없음"); }), /권한/);
const many = { ...pr, commits: 101, body: "커밋 전체를 검사합니다." };
assert.deepEqual(await validatePullRequest(many, async (path) => Array.from({ length: path.endsWith("page=1") ? 100 : 1 },
  () => ({ commit: { message: "fix: 한국어 커밋 검사" } }))), []);
await assert.rejects(validatePullRequest(many, async (path) => path.endsWith("page=1")
  ? Array.from({ length: 100 }, () => ({ commit: { message: "fix: 한국어 커밋 검사" } })) : []), /전체 커밋/);

// squash 72열 줄바꿈: 병합 뒤에야 드러나던 실패를 PR 단계에서 잡는다.
assert.equal(SQUASH_WRAP_COLUMNS, 72);
assert.equal(wrapSquashBody("짧은 줄은 그대로 둔다."), "짧은 줄은 그대로 둔다.");
assert.equal(wrapSquashBody("## 제목\n\n- 목록"), "## 제목\n\n- 목록");
assert.equal(wrapSquashBody("가".repeat(80)), "가".repeat(80), "공백 없는 긴 낱말은 쪼개지 않는다");
assert.deepEqual(wrapSquashBody(`${"가".repeat(70)} 나다`).split("\n"), ["가".repeat(70), "나다"]);
assert.ok(wrapSquashBody("한국어 설명 ".repeat(20)).split("\n").every((line) => line.length <= SQUASH_WRAP_COLUMNS));
assert.equal(wrapSquashBody("줄바꿈\r\n확인"), "줄바꿈\n확인", "CRLF는 LF로 정규화한다");

// 실제 실패 사례: 원문은 통과하지만 줄바꿈된 조각에 한국어가 없다.
const wrapHazard = "run `33877345188`, job `101037375335`, 결론 success, artifact `9938417625`, digest `sha256:cf23a25e054dbd623d49f37270b599c18aa1e7351b7aab626c7e5ff54c7fc1e0`이다.";
assert.deepEqual(validateKoreanRecord({ body: wrapHazard, requireBody: true }), []);
assert.ok(validateKoreanRecord({ body: wrapSquashBody(wrapHazard) }).length, "줄바꿈 조각의 영어 설명을 잡아야 한다");
const wrapPr = { number: 43, commits: 1, title: "fix: 한국어 기록 검사", body: `${wrapHazard}\n\nCloses #36` };
const wrapApi = async (path) => path.includes("/commits?")
  ? [{ commit: { message: "fix: 한국어 기록 검사" } }]
  : { number: 36, title: "[FIX] 한국어 정정", body: "한국어 기록으로 정정합니다." };
const wrapErrors = await validatePullRequest(wrapPr, wrapApi);
assert.ok(wrapErrors.some((e) => e.startsWith(`squash ${SQUASH_WRAP_COLUMNS}열 줄바꿈 뒤`)), "PR 검사가 병합 전에 실패해야 한다");
// 같은 내용을 짧은 줄로 나누면 통과한다.
const wrapSafe = { ...wrapPr, body: "실행 기록은 run `33877345188`이다.\n산출물은 `9938417625`이며 digest를 함께 남겼다.\n\nCloses #36" };
assert.deepEqual(await validatePullRequest(wrapSafe, wrapApi), []);

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
console.log("한국어 기록 검사: 제목·본문·커밋·연결 이슈·squash 줄바꿈·페이지 누락·권한·CI 연결 회귀 테스트 통과.");

const footer = "merge: 가입 후 DB 계약 병합\n\n# Conflicts:\n#\tHANDOFF.md\n";
const verified = { parentCount: 2, files: ["HANDOFF.md"] };
assert.deepEqual(validateCommitMessage(withoutVerifiedConflictFooter(footer, verified)), []);
for (const context of [{}, { parentCount: 1, files: ["HANDOFF.md"] }, { parentCount: 2, files: [] }]) {
  assert.ok(validateCommitMessage(withoutVerifiedConflictFooter(footer, context)).length);
}
for (const bad of [footer + "English description", footer.replace("HANDOFF.md", "other.md"),
  footer.replace("#\tHANDOFF.md", "# English description"), footer.replace("# Conflicts:", "# Notes:")]) {
  assert.ok(validateCommitMessage(withoutVerifiedConflictFooter(bad, verified)).length);
}
const sha = "a".repeat(40);
const merge = { sha, parents: [{}, {}], commit: { message: footer } };
const mergeApi = async path => path.includes("/commits?") ? [merge]
  : path.includes(`/commits/${sha}?`) ? { ...merge, files: [{ filename: "HANDOFF.md" }] } : api(path);
assert.deepEqual(await validatePullRequest(pr, mergeApi), []);
assert.ok((await validatePullRequest(pr, async path => path.includes(`/commits/${sha}?`)
  ? { ...merge, files: [{ filename: "not-changed.md" }] } : mergeApi(path))).length);
await assert.rejects(validatePullRequest(pr, async path => path.includes(`/commits/${sha}?`)
  ? { ...merge, files: Array(100).fill({ filename: "HANDOFF.md" }) } : mergeApi(path)), /변경 파일 전체/);
console.log("병합 충돌 메타데이터: 부모·파일 대조 및 영어 주석 거부 검증 통과.");
