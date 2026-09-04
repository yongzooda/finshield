import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hasKorean = (value) => (value.match(/[가-힣]/g) ?? []).length >= 2;
const reference = /^(?:Closes|Fixes|Resolves|Related(?: to)?)\s+#\d+(?:\s*[,·]\s*#\d+)*\.?$/i;

// 언어 이해기가 아닌 최소 형식 검사다. 기술명·원문 로그는 보존하되
// 설명 문장의 한국어 여부는 작성자와 검토자가 최종 확인한다.
export const validateKoreanRecord = ({ title, body = "", requireBody = false }) => {
  const errors = [];
  if (title !== undefined && (!hasKorean(title) || title.includes("\n"))) errors.push("제목을 한국어로 작성해야 합니다.");
  if (/(?:Co-Authored-By|Generated (?:with|by))\s*:/i.test(body)) errors.push("공동저자·생성 도구 트레일러는 허용하지 않습니다.");
  let fence = null, prose = 0;
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const marker = line.match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = null;
      return;
    }
    if (fence || !line || line.startsWith(">") || reference.test(line)) return;
    const text = line.replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/g, "")
      .replace(/^[-*#\d.\s\[\]x]+/, "");
    if (!/[A-Za-z가-힣]/.test(text)) return;
    if (!hasKorean(text)) errors.push(`본문 ${index + 1}행의 설명을 한국어로 작성해야 합니다.`);
    else prose++;
  });
  if (fence) errors.push("원문 코드 블록이 닫히지 않았습니다.");
  if (requireBody && prose === 0) errors.push("본문에 한국어 설명이 필요합니다.");
  return errors;
};

// GitHub은 PR 본문을 squash 커밋 메시지로 옮길 때 72열 기준 단어 단위로
// 다시 줄바꿈한다. 잘린 조각에 한국어가 남지 않으면 병합 뒤에야 main 검사가
// 실패하므로, PR 검사에서 이 형태를 미리 확인한다.
export const SQUASH_WRAP_COLUMNS = 72;

export const wrapSquashBody = (body, width = SQUASH_WRAP_COLUMNS) => body.replace(/\r\n/g, "\n").split("\n")
  .flatMap((line) => {
    if (line.length <= width) return [line];
    const wrapped = [];
    let current = "";
    for (const token of line.split(" ")) {
      if (!current) { current = token; continue; }
      if (current.length + 1 + token.length <= width) current += ` ${token}`;
      else { wrapped.push(current); current = token; }
    }
    wrapped.push(current);
    return wrapped;
  }).join("\n");

export const validateCommitMessage = (message) => {
  const [title, ...body] = message.trim().split("\n");
  return validateKoreanRecord({ title, body: body.join("\n") });
};

const assertContext = (condition, message) => { if (!condition) throw new Error(message); };
const prefix = "/repos/yongzooda/finshield";
export const validatePullRequest = async (pr, readJson) => {
  assertContext(Number.isSafeInteger(pr.number) && pr.number > 0, "PR 번호가 올바르지 않습니다.");
  const body = pr.body ?? "";
  const errors = validateKoreanRecord({ title: pr.title, body, requireBody: true });
  const wrapped = wrapSquashBody(body);
  if (wrapped !== body) {
    errors.push(...validateKoreanRecord({ body: wrapped }).map((e) => `squash ${SQUASH_WRAP_COLUMNS}열 줄바꿈 뒤: ${e}`));
  }
  let total = 0;
  for (let page = 1; page <= 30; page++) {
    const commits = await readJson(`${prefix}/pulls/${pr.number}/commits?per_page=100&page=${page}`);
    assertContext(Array.isArray(commits), "PR 커밋 목록을 검증할 수 없습니다.");
    for (const commit of commits) {
      assertContext(typeof commit?.commit?.message === "string", "PR 커밋 메시지를 검증할 수 없습니다.");
      total++;
      errors.push(...validateCommitMessage(commit.commit.message).map((e) => `커밋 ${total}: ${e}`));
    }
    if (commits.length < 100) break;
    assertContext(page < 30, "PR 커밋 수가 검증 한도를 초과했습니다.");
  }
  assertContext(total > 0 && total === pr.commits, "PR 전체 커밋 목록이 일치하지 않습니다.");
  const linked = [...new Set([...(pr.body ?? "").matchAll(/(?:Closes|Fixes|Resolves)\s+#(\d+)/gi)].map((m) => Number(m[1])))];
  for (const number of linked) {
    const issue = await readJson(`${prefix}/issues/${number}`);
    assertContext(issue.number === number && !issue.pull_request, "연결 이슈를 검증할 수 없습니다.");
    errors.push(...validateKoreanRecord({ title: issue.title, body: issue.body ?? "", requireBody: true }).map((e) => `연결 이슈 #${number}: ${e}`));
  }
  return errors;
};

const run = async () => {
  if (process.argv[2] === "--commit-file") {
    const message = readFileSync(process.argv[3], "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n");
    return validateCommitMessage(message);
  }
  assertContext(process.argv[2] === "--ci", "사용법: --commit-file 파일 또는 --ci");
  assertContext(process.env.GITHUB_REPOSITORY === "yongzooda/finshield" && process.env.GITHUB_TOKEN, "저장소·읽기 토큰이 필요합니다.");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const readJson = async (path) => {
    assertContext(path.startsWith(prefix + "/"), "다른 저장소에 접근할 수 없습니다.");
    const response = await fetch("https://api.github.com" + path, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    assertContext(response.status === 200, `GitHub 기록 조회 실패: HTTP ${response.status}`);
    return response.json();
  };
  if (event.pull_request) {
    const pr = await readJson(`${prefix}/pulls/${event.pull_request.number}`);
    assertContext(pr.head.sha === event.pull_request.head.sha, "PR HEAD가 바뀌어 새 검사가 필요합니다.");
    return validatePullRequest(pr, readJson);
  }
  if (event.comment) {
    if (event.comment.user?.type === "Bot") return [];
    return validateKoreanRecord({ body: event.comment.body ?? "", requireBody: true });
  }
  if (event.issue) {
    if (event.issue.user?.type === "Bot") return [];
    return validateKoreanRecord({ title: event.issue.title, body: event.issue.body ?? "", requireBody: true });
  }
  if (process.env.GITHUB_EVENT_NAME === "push") {
    assertContext(/^[a-f0-9]{40}$/.test(event.before) && /^[a-f0-9]{40}$/.test(event.after), "push SHA가 올바르지 않습니다.");
    const compare = await readJson(`${prefix}/compare/${event.before}...${event.after}`);
    assertContext(Array.isArray(compare.commits) && compare.commits.length === compare.total_commits
      && compare.total_commits > 0 && compare.total_commits <= 250, "전체 push 커밋을 검증할 수 없습니다.");
    return compare.commits.flatMap((c) => validateCommitMessage(c.commit.message));
  }
  assertContext(process.env.GITHUB_EVENT_NAME === "schedule", "지원하지 않는 기록 이벤트입니다.");
  // 일일 검사는 현재 main의 squash 커밋을 확인한다. 기존 SHA는 소급 변경하지 않는다.
  assertContext(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""), "main SHA가 올바르지 않습니다.");
  const commit = await readJson(`${prefix}/commits/${process.env.GITHUB_SHA}`);
  return validateCommitMessage(commit.commit.message);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const errors = await run();
    for (const error of errors) console.error(error);
    if (errors.length) process.exitCode = 1;
    else console.log("한국어 작업 기록 형식 검사를 통과했습니다.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "기록 검사에 실패했습니다.");
    process.exitCode = 1;
  }
}
