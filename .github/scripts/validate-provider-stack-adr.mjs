import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { maskNonRenderedMarkdown } from "./provider-adr-digest.mjs";
import {
  createGitHubClient,
  secretPatterns,
  validateEvidenceIndex,
  validateEvidencePolicyFiles,
} from "./provider-evidence.mjs";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
if (realpathSync(process.cwd()) !== root) {
  console.error("Provider ADR validator는 저장소 root에서만 실행할 수 있습니다.");
  process.exit(1);
}
const paths = {
  adr: resolve(root, "docs/adr/001-p0-provider-stack.md"),
  requirements: resolve(root, "docs/02-integrated-requirements.md"),
  databaseSpec: resolve(root, "docs/03-database-spec.md"),
  readme: resolve(root, "README.md"),
  docsReadme: resolve(root, "docs/README.md"),
  handoff: resolve(root, "HANDOFF.md"),
  agents: resolve(root, "AGENTS.md"),
  claude: resolve(root, "CLAUDE.md"),
  packageJson: resolve(root, "package.json"),
  packageLock: resolve(root, "package-lock.json"),
  envExample: resolve(root, ".env.example"),
  workflow: resolve(root, ".github/workflows/pr-check.yml"),
  runtimeEnv: resolve(root, "src/lib/env.ts"),
  mcpRoute: resolve(root, "src/app/api/mcp/route.ts"),
};

const read = (path) => readFileSync(path, "utf8");
const adr = read(paths.adr);
const requirements = read(paths.requirements);
const databaseSpec = read(paths.databaseSpec);
const readme = read(paths.readme);
const docsReadme = read(paths.docsReadme);
const handoff = read(paths.handoff);
const agents = read(paths.agents);
const claude = read(paths.claude);
const packageJsonText = read(paths.packageJson);
const packageLockText = read(paths.packageLock);
const envExample = read(paths.envExample);
const workflow = read(paths.workflow);
const runtimeEnv = read(paths.runtimeEnv);
const mcpRoute = read(paths.mcpRoute);
const errors = [];

const fail = (message) => errors.push(message);
validateEvidencePolicyFiles({ root, errors });
const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) fail(message);
};
const countExactLine = (source, expected) => source.split("\n").filter((line) => line === expected).length;
const exactKeysForWorkflow = (value, expected) => (
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
);

if (adr.startsWith("---\n")) fail("Provider ADR은 숨겨진 front matter를 사용할 수 없습니다.");
const structuralAdr = maskNonRenderedMarkdown(adr);

for (const placeholder of ["TODO", "TBD", "FIXME", "작성 예정", "추후 작성"]) {
  if (adr.includes(placeholder)) fail(`Provider ADR에 미해결 표기 '${placeholder}'가 남아 있습니다.`);
}

if (countExactLine(structuralAdr, "# ADR-001: P0 Provider·외부 연동·실행 인프라") !== 1) {
  fail("ADR 제목은 code fence 밖에 정확히 한 번 있어야 합니다.");
}

const singleGate = (pattern, label) => {
  const matches = [...structuralAdr.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`${label} metadata는 정확히 한 번 있어야 합니다.`);
    return null;
  }
  return matches[0][1];
};

const architecture = singleGate(/^- Architecture Decision: `(ACCEPTED|SUPERSEDED)`$/gm, "Architecture Decision");
const implementationGate = singleGate(/^- Implementation Gate \(`N-QLT-010`\): `(NO-GO|GO)`$/gm, "Implementation Gate");
const releaseGate = singleGate(/^- Release Gate \(`N-QLT-009`\): `(NOT-EVALUATED|NO-GO|GO)`$/gm, "Release Gate");

if (architecture !== "ACCEPTED") fail("현재 ADR의 Architecture Decision은 ACCEPTED여야 합니다.");
requireMatch(adr, /문서 선택을 Live 연동 성공으로 계산하지 않는다/, "Architecture 승인과 Live 성공의 구분이 없습니다.");
requireMatch(adr, /N-QLT-010[\s\S]{0,240}Implementation Gate[\s\S]{0,360}N-QLT-009[\s\S]{0,240}Release Gate/, "사전 Implementation Gate와 출시 Release Gate의 구분이 없습니다.");

const expectedRequirementsBlob = "27ce706010344fbcedebe3abd707febff0f1dc26";
const actualRequirementsBlob = createHash("sha1")
  .update(`blob ${Buffer.byteLength(requirements)}\0`)
  .update(requirements)
  .digest("hex");

if (!structuralAdr.includes(`- 요구사항 문서 Git Blob SHA: \`${expectedRequirementsBlob}\``)) {
  fail("ADR의 요구사항 Blob SHA가 기준선과 다릅니다.");
}
if (actualRequirementsBlob !== expectedRequirementsBlob) {
  fail(`요구사항 정본이 ADR 기준선 이후 변경됐습니다: expected ${expectedRequirementsBlob}, actual ${actualRequirementsBlob}. ADR 추적을 재검토하세요.`);
}
if (countExactLine(requirements, "4. 상위 문서와 충돌하지 않고 Architecture Decision이 `ACCEPTED`인 `docs/adr/*.md`") !== 1) {
  fail("요구사항 정본에 승인 ADR의 비덮어쓰기 우선순위가 정확히 정의되지 않았습니다.");
}
if (countExactLine(requirements, "| Profile Policy Validator (비모델) | 프로필 Snapshot과 부담·유동성·위험을 결정적 규칙으로 비교하고, 미입력 시 적합성 축만 보류 | Profile Policy |") !== 1
  || /^\| Suitability Agent \|/m.test(requirements)) {
  fail("요구사항 정본의 P0 적합성 책임이 고정 4개 Domain Agent와 비모델 Profile Policy 경계에 맞지 않습니다.");
}

const requirementContracts = [
  ["N-QLT-009", ["P0", "Production Build", "Live Vertical Slice", "Skip"]],
  ["N-QLT-010", ["P0", "Provider", "Model", "Embedding", "OCR", "Rate Store", "Job"]],
  ["N-PERF-005", ["P0", "10초", "Heartbeat"]],
  ["N-PERF-009", ["P0", "120초", "180초", "WITHHELD"]],
  ["N-AVL-001", ["P0", "/api/health", "외부 Provider", "Cache"]],
  ["N-AVL-006", ["P0", "Migration", "환경변수", "외부 Key", "Preflight"]],
  ["N-AVL-008", ["P0", "2초", "Abort", "Revalidation Job"]],
  ["N-OPS-003", ["P0", "호출 전 원자 예약", "정산"]],
  ["N-OPS-004", ["P0", "Serverless", "공유"]],
  ["AI-021", ["P0", "3~4개", "Product/Institution", "Fraud/Channel", "Sales/Regulation"]],
  ["PC-005", ["P0", "Sales Conduct Agent", "Regulation & Dispute Agent", "기존 PreCase Tool", "실제 실행"]],
  ["INP-004", ["P0", "10MB", "10쪽"]],
  ["INP-006", ["P0", "OCR", "Locator"]],
  ["INP-009", ["P0", "PII Gate", "Embedding"]],
  ["INP-011", ["P0", "24시간", "삭제"]],
  ["INP-013", ["P0", "Private Quarantine", "Masked Intake"]],
  ["E-008", ["P0", "Timeout", "Retry", "Circuit Breaker"]],
  ["E-012", ["P0", "Batch", "413", "429"]],
  ["E-017", ["P0", "Demo 응답", "성공 배지"]],
  ["E-019", ["P0", "MCP", "공식 문서"]],
  ["E-020", ["P0", "사용자 UI에는 `내부 도구`", "MCP conformance", "MCP-compatible Tool"]],
  ["E-021", ["P0", "/api/mcp", "64KiB", "Batch 20", "동시 5"]],
  ["E-022", ["P0", "외부 접속 없이", "Punycode"]],
  ["SEC-FILE-005", ["P0", "Signed URL", "24시간"]],
  ["SEC-PRI-010", ["P0", "동의 거절 시 외부 전송이 0회"]],
  ["SEC-OPS-004", ["P0", "RLS", "배포"]],
  ["REV-001", ["P0", "Lease", "Heartbeat", "Retry"]],
  ["ROLE-001", ["P0", "Live Seed", "실제 Agent"]],
  ["ROLE-003", ["P0", "정적 Fallback"]],
  ["OPS-004", ["P0", "Live Seed", "정적 Fallback", "Snapshot", "Cache"]],
  ["EC-025", ["P0", "사전 계산 Fallback", "실제 실행 성공"]],
];

const requirementRows = new Map();
for (const line of requirements.split("\n")) {
  const match = line.match(/^\| ([A-Z][A-Z0-9-]+) \| (P[0-2]) \|/);
  if (!match) continue;
  const rows = requirementRows.get(match[1]) ?? [];
  rows.push(line);
  requirementRows.set(match[1], rows);
}

for (const [id, tokens] of requirementContracts) {
  const rows = requirementRows.get(id) ?? [];
  if (rows.length !== 1) {
    fail(`요구사항 정본의 '${id}' 정의 행은 정확히 한 번이어야 합니다.`);
  }
  const row = rows[0];
  if (!row) {
    fail(`요구사항 정본에서 '${id}' 행을 찾지 못했습니다.`);
    continue;
  }
  for (const token of tokens) {
    if (!row.includes(token)) fail(`요구사항 '${id}' 계약에서 '${token}'을 확인하지 못했습니다.`);
  }
  if (!structuralAdr.includes(`\`${id}\``)) fail(`Provider ADR에서 '${id}' 추적이 없습니다.`);
}

const dRequirementIds = ["D-008", "D-010", "D-012", "D-014", "D-016", "D-021", "D-025", "D-029", "D-030"];
const dTraceSection = databaseSpec.match(/## 17\.1 D-001~D-032([\s\S]*?)\n## 17\.2/)?.[1] ?? "";
for (const id of dRequirementIds) {
  if (!new RegExp(`^\\| ${id} \\|`, "m").test(dTraceSection)) fail(`DB 명세의 '${id}' 추적 행이 없습니다.`);
  if (!structuralAdr.includes(`\`${id}\``)) fail(`Provider ADR에서 '${id}' 추적이 없습니다.`);
}

const requiredSections = [
  "## 1. 결정 요약",
  "## 2. 문제와 범위",
  "## 3. 목표 구조",
  "## 4. 생성 모델",
  "## 5. Embedding·Hybrid Retrieval",
  "## 6. 파일·Storage·OCR",
  "## 7. Supabase 경계",
  "## 8. 공식 출처와 Snapshot",
  "## 9. Vercel 실행 인프라",
  "## 10. Rate Limit·Budget·관측성",
  "## 11. MCP·Tool 경계",
  "## 12. 환경변수와 Preflight",
  "## 13. 실패·Fallback 계약",
  "## 14. Live Spike 증거 원장",
  "## 15. Live 시험 계획",
  "## 16. 현재 코드와의 차이",
  "## 17. 결과와 트레이드오프",
  "## 18. 공식 참고자료",
  "## 19. 변경 통제",
];

let previousSectionIndex = -1;
for (const heading of requiredSections) {
  if (countExactLine(structuralAdr, heading) !== 1) fail(`Provider ADR 절 '${heading}'은 정확히 한 번 있어야 합니다.`);
  const index = structuralAdr.indexOf(`\n${heading}\n`);
  if (index <= previousSectionIndex) fail(`Provider ADR 절 '${heading}'의 순서가 잘못됐습니다.`);
  previousSectionIndex = index;
}

for (const heading of [
  "### 14.1 현재 확보한 증거",
  "### 14.2 Implementation Gate 차단 항목",
  "### 14.3 Implementation Gate 전환 규칙",
  "### 14.4 Release Gate 차단 항목",
  "### 14.5 제출 후 CI 무결성 강화",
  "### 15.1 사전 고정 합격선",
  "### 15.2 시험 묶음",
]) {
  if (countExactLine(structuralAdr, heading) !== 1) fail(`Provider ADR 하위 절 '${heading}'은 정확히 한 번 있어야 합니다.`);
}

const ledgerStart = structuralAdr.indexOf("### 14.1 현재 확보한 증거");
const ledgerEnd = structuralAdr.indexOf("### 14.2 Implementation Gate 차단 항목", ledgerStart + 1);
const ledgerLines = structuralAdr.slice(ledgerStart, ledgerEnd).trimEnd().split("\n");
const expectedLedgerPrefix = [
  "### 14.1 현재 확보한 증거",
  "",
  "| ID | 항목 | 상태 | 확인 내용 |",
  "|---|---|---|---|",
];
if (JSON.stringify(ledgerLines.slice(0, 4)) !== JSON.stringify(expectedLedgerPrefix)) {
  fail("14.1 증거 원장의 heading·table header가 exact schema와 다릅니다.");
}
const ledgerRows = [];
let ledgerCursor = 4;
for (; ledgerCursor < ledgerLines.length && ledgerLines[ledgerCursor] !== ""; ledgerCursor += 1) {
  const match = ledgerLines[ledgerCursor].match(/^\| `(EVID-[A-Z0-9-]+)` \| ([^|\n]+) \| (OBSERVED|DOCUMENTED|PASS|FAIL|STALE) \| ([^|\n]+) \|$/);
  if (!match || ledgerLines[ledgerCursor].length > 2_000) {
    fail("14.1 증거 원장은 EVID ID·허용 상태·단일 행 4열만 사용할 수 있습니다.");
    continue;
  }
  ledgerRows.push({ id: match[1], status: match[3] });
}
const ledgerTail = ledgerLines.slice(ledgerCursor);
const expectedLedgerTail = [
  "",
  "위 PASS는 제품 Live Vertical Slice PASS가 아니다. GitHub의 Vercel status는 build/deploy 성공을 뜻하며 Provider key·OCR·RLS·Workflow 기능 성공을 증명하지 않는다.",
];
if (JSON.stringify(ledgerTail) !== JSON.stringify(expectedLedgerTail)) {
  fail("14.1 증거 원장에는 table 외 임의 prose나 override를 넣을 수 없습니다.");
}
const ledgerCounts = new Map();
for (const row of ledgerRows) ledgerCounts.set(row.id, (ledgerCounts.get(row.id) ?? 0) + 1);
for (const [id, status] of [["EVID-DEPLOY-01", "OBSERVED"], ["EVID-CI-01", "OBSERVED"], ["EVID-DOC-01", "DOCUMENTED"], ["EVID-LAW-01", "DOCUMENTED"]]) {
  if (ledgerCounts.get(id) !== 1 || !ledgerRows.some((row) => row.id === id && row.status === status)) {
    fail(`14.1 기준 증거 '${id}'의 유일성·상태가 다릅니다.`);
  }
}
if ([...ledgerCounts.values()].some((count) => count !== 1)) fail("14.1 증거 원장 ID는 중복될 수 없습니다.");

const section = (number) => {
  const start = structuralAdr.indexOf(`\n## ${number}.`);
  const next = structuralAdr.indexOf(`\n## ${number + 1}.`, start + 1);
  return structuralAdr.slice(start, next === -1 ? undefined : next);
};

const decisionChecks = [
  [section(1), /\| 생성 모델 \| 사용 \|[^\n]*claude-sonnet-5/, "Anthropic 기본 모델"],
  [section(1), /\| 임베딩 \| 사용 \|[^\n]*embed-v4\.0[^\n]*1024차원/, "Cohere 모델·차원"],
  [section(4), /고정 4개: 상품·기관\(Product\/Institution\), 사기·채널\(Fraud\/Channel\), 판매행위\(Sales Conduct\), 규제·분쟁\(Regulation & Dispute\); 각자 Schema·Tool allowlist·run row/, "P0 고정 Agent 4개"],
  [section(4), /개인 적합성은 별도 다섯 번째 Agent를 가장하지 않는다[\s\S]{0,600}NEED_MORE_INFORMATION/, "개인 적합성 책임 경계"],
  [section(4), /고정 Domain Agent 4개 순차 실행 \| 32초 \| 32초 \| Agent당 최대 8초[\s\S]{0,1000}계획 합계 \| 102초 \| 137초/, "4-Agent deadline 예산"],
  [section(4), /Run 전체에서 최대 1회[\s\S]{0,200}10초 contingency/, "Run-level Model retry 예산"],
  [section(5), /cosine[\s\S]{0,500}Exact KNN/, "Vector 거리·검색"],
  [section(6), /one-use upload slot[\s\S]{0,500}JWT[\s\S]{0,500}x-upsert:false/, "TUS one-use upload"],
  [section(6), /encrypted PDF[\s\S]{0,400}polyglot[\s\S]{0,400}pixel\/zip bomb/, "악성 파일 경계"],
  [section(7), /NOBYPASSRLS[\s\S]{0,600}SECURITY DEFINER[\s\S]{0,400}search_path/, "Runtime 최소권한 Role"],
  [section(8), /서민금융상품기본정보[\s\S]{0,1000}서민대출상품 취급기관[\s\S]{0,2000}햇살론15/, "P0 상품·기관 공식 Source"],
  [section(9), /Node\.js 24\.x Fluid Functions[\s\S]{0,700}process\.version/, "Vercel Runtime 기록"],
  [section(9), /Text Run: 120초[\s\S]{0,300}Image·PDF Run: 180초/, "제품 Hard Deadline"],
  [section(9), /GET \/api\/runs\/\{run_id\}\/status[\s\S]{0,600}background\/cross-device resume은 P1/, "동기 Run 상태 조회 복원"],
  [section(9), /연결 독립 수동 Revalidation Job[\s\S]{0,400}명시적 Job 취소 API/, "Revalidation 연결 단절 예외"],
  [section(9), /invocation_intent[\s\S]{0,500}AMBIGUOUS/, "Provider ambiguous outcome"],
  [section(10), /원자 비용 예약[\s\S]{0,700}reserve 성공[\s\S]{0,700}실제 usage로 settle/, "원자 비용 예약·정산"],
  [section(11), /PUBLIC_MCP_ENABLED=false[\s\S]{0,700}사용자 UI에는 `내부 도구`/, "공개 MCP와 UI 경계"],
  [section(14), /Implementation Gate 차단 항목[\s\S]{0,8000}Release Gate 차단 항목/, "분리된 Gate 표"],
  [section(15), /Recall@5 ≥0\.90[\s\S]{0,1500}숫자·금리·부정어 exact 100%/, "사전 고정 품질 합격선"],
];

for (const [source, pattern, label] of decisionChecks) requireMatch(source, pattern, `${label} 결정이 해당 절에 없습니다.`);

for (const classification of ["사용", "제한 사용", "공식 Snapshot", "P1 이관"]) {
  if (!section(1).split("\n").some((line) => line.includes(`| ${classification} |`))) {
    fail(`분류 '${classification}' 결정 행이 1절에 없습니다.`);
  }
}

const parseGateRows = (startHeading, endHeading) => {
  const start = structuralAdr.indexOf(startHeading);
  const end = structuralAdr.indexOf(endHeading, start + startHeading.length);
  const source = structuralAdr.slice(start, end === -1 ? undefined : end);
  const rows = [];
  for (const line of source.split("\n")) {
    const match = line.match(/^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);
    if (match) rows.push({ id: match[1], evidence: match[2].trim(), status: match[3].trim(), exit: match[4].trim() });
  }
  return rows;
};

const implementationBlockers = [
  "B-MODEL-01",
  "B-EMBED-01",
  "B-RETRIEVAL-01",
  "B-OCR-01",
  "B-FILE-SAFETY",
  "B-CONSENT-01",
  "B-STORAGE-01",
  "B-DELETE-01",
  "B-SUPABASE-01",
  "B-PROCESSOR-PRIVACY",
  "B-PRIVACY-VERCEL",
  "B-LAW-01",
  "B-SOURCE-02",
  "B-SOURCE-03",
  "B-JOB-01",
  "B-RATE-01",
  "B-DEADLINE-01",
  "B-HEALTH-01",
  "B-RUNTIME-01",
  "B-SPIKE-01",
];
const implementationRows = parseGateRows("### 14.2 Implementation Gate 차단 항목", "### 14.3 Implementation Gate 전환 규칙");
const releaseBlockers = ["B-DEMO-01", "B-E2E-01", "B-BUILD-01", "B-CLAIM-01"];
const releaseRows = parseGateRows("### 14.4 Release Gate 차단 항목", "### 14.5 제출 후 CI 무결성 강화");

const blockerStatuses = new Set(["NOT-EVALUATED", "PASS", "FAIL", "BLOCKED"]);
const validateGateRows = (label, rows, expectedIds) => {
  const counts = new Map();
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  for (const id of expectedIds) {
    if (counts.get(id) !== 1) fail(`${label} blocker '${id}'는 정확히 한 행이어야 합니다.`);
  }
  for (const row of rows) {
    if (!expectedIds.includes(row.id)) fail(`알 수 없는 ${label} blocker '${row.id}'가 있습니다.`);
    if (!blockerStatuses.has(row.status)) fail(`${label} blocker '${row.id}'의 상태 '${row.status}'는 허용되지 않습니다.`);
  }
  if (rows.length !== expectedIds.length) fail(`${label} blocker 행 수가 기준과 다릅니다.`);
};

validateGateRows("Implementation", implementationRows, implementationBlockers);
validateGateRows("Release", releaseRows, releaseBlockers);

const deferredCiSection = structuralAdr.slice(
  structuralAdr.indexOf("### 14.5 제출 후 CI 무결성 강화"),
  structuralAdr.indexOf("---\n\n## 15."),
);
if (countExactLine(deferredCiSection, "| `B-CI-INTEGRITY` | DEFERRED | GitHub Team 이상 Organization Required Workflow 또는 동등한 외부 App attestation | Implementation·Release Gate 비차단; 제출 후 별도 검증·채택 |") !== 1) {
  fail("B-CI-INTEGRITY는 제출 후 강화 상태 DEFERRED로 보존해야 합니다.");
}
requireMatch(
  deferredCiSection,
  /N-QLT-010[\s\S]*특정 유료 GitHub 조직 기능을 요구하지 않는[\s\S]*제출 일정의 선행조건에서는 제외/,
  "B-CI-INTEGRITY의 상위 요구 경계와 P0 비차단 결정 근거가 없습니다.",
);
requireMatch(
  structuralAdr.slice(structuralAdr.indexOf("### 14.3 Implementation Gate 전환 규칙"), structuralAdr.indexOf("### 14.4 Release Gate 차단 항목")),
  /repository-controlled evidence[\s\S]*독립 감사 증거로 표현하지 않는다/,
  "P0 Evidence의 저장소 통제 한계가 명시되지 않았습니다.",
);
if (implementationRows.some((row) => row.id === "B-CI-INTEGRITY")) {
  fail("B-CI-INTEGRITY는 P0 Implementation blocker 표에 들어갈 수 없습니다.");
}

const implementationAllPass = implementationRows.length === implementationBlockers.length && implementationRows.every((row) => row.status === "PASS");
if (implementationGate === "GO" && !implementationAllPass) fail("Implementation GO는 모든 blocker가 PASS여야 합니다.");
if (implementationGate === "NO-GO" && implementationAllPass) fail("모든 Implementation blocker가 PASS인데 Gate가 NO-GO입니다.");

const releaseAllPass = releaseRows.length === releaseBlockers.length && releaseRows.every((row) => row.status === "PASS");
const releaseAllNotEvaluated = releaseRows.length === releaseBlockers.length && releaseRows.every((row) => row.status === "NOT-EVALUATED");
if (releaseGate === "NOT-EVALUATED" && !releaseAllNotEvaluated) fail("Release NOT-EVALUATED는 모든 blocker가 NOT-EVALUATED여야 합니다.");
if (releaseGate === "NO-GO" && (releaseAllPass || releaseAllNotEvaluated)) fail("Release NO-GO는 평가가 시작됐고 하나 이상의 blocker가 PASS가 아닌 상태여야 합니다.");
if (releaseGate === "GO" && !releaseAllPass) fail("Release GO는 모든 blocker가 PASS여야 합니다.");
if (releaseGate === "GO" && implementationGate !== "GO") fail("Implementation GO 없이 Release GO가 될 수 없습니다.");
if (!releaseAllNotEvaluated && implementationGate !== "GO") fail("Release blocker 평가는 Implementation Gate가 GO인 뒤에만 시작할 수 있습니다.");

const github = process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_TOKEN
  ? createGitHubClient(process.env.GITHUB_TOKEN)
  : null;

await validateEvidenceIndex({
  root,
  gate: "implementation",
  rows: implementationRows,
  requirementsBlob: actualRequirementsBlob,
  indexRelativePath: "evidence/provider-stack-gate.json",
  errors,
  github,
});
await validateEvidenceIndex({
  root,
  gate: "release",
  rows: releaseRows,
  requirementsBlob: actualRequirementsBlob,
  indexRelativePath: "evidence/release-gate.json",
  errors,
  github,
});

const markdownUrls = [...structuralAdr.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
const parsedUrls = markdownUrls.flatMap((value) => {
  try {
    return [new URL(value)];
  } catch {
    fail(`올바르지 않은 공식 참고 URL입니다: ${value}`);
    return [];
  }
});
const requireOfficialUrl = (host, pathPrefix) => {
  if (!parsedUrls.some((url) => url.hostname === host && url.pathname.startsWith(pathPrefix))) {
    fail(`공식 참고 URL이 없습니다: https://${host}${pathPrefix}`);
  }
};

for (const [host, pathPrefix] of [
  ["platform.claude.com", "/docs/"],
  ["docs.cohere.com", "/docs/"],
  ["mozilla.github.io", "/pdf.js/"],
  ["guide.ncloud-docs.com", "/docs/clovaocr"],
  ["supabase.com", "/docs/"],
  ["vercel.com", "/docs/"],
  ["vercel.com", "/legal/terms"],
  ["open.law.go.kr", "/LSO/"],
  ["www.data.go.kr", "/data/"],
  ["www.fss.or.kr", "/fss/"],
  ["www.kinfa.or.kr", "/cyber/"],
]) requireOfficialUrl(host, pathPrefix);

for (const secretPattern of secretPatterns) {
  if (secretPattern.test(adr)) fail("Provider ADR 보조 secret lint가 자격증명처럼 보이는 값을 찾았습니다.");
}

let packageJson;
let packageLock;
try {
  packageJson = JSON.parse(packageJsonText);
} catch {
  fail("package.json을 JSON으로 읽을 수 없습니다.");
}
try {
  packageLock = JSON.parse(packageLockText);
} catch {
  fail("package-lock.json을 JSON으로 읽을 수 없습니다.");
}
if (packageJson?.engines?.node !== "24.x") fail("package.json engines.node가 ADR의 24.x 결정과 다릅니다.");
if (packageLock?.packages?.[""]?.engines?.node !== "24.x") fail("package-lock.json root engines.node가 ADR의 24.x 결정과 다릅니다.");
if (packageJson?.devDependencies?.["@types/node"] !== "^24") fail("@types/node가 Node 24 타입 계약과 다릅니다.");
if (!/^24\./.test(packageLock?.packages?.["node_modules/@types/node"]?.version ?? "")) fail("package-lock의 @types/node가 24 계열이 아닙니다.");
if (packageJson?.devDependencies?.["remark-parse"] !== "^11.0.0"
  || packageJson?.devDependencies?.unified !== "^11.0.5"
  || packageJson?.devDependencies?.yaml !== "^2.8.1"
  || packageJson?.devDependencies?.fflate !== "^0.8.2") {
  fail("Provider validator 의존성이 package.json과 다릅니다.");
}
if (!/^2\./.test(packageLock?.packages?.["node_modules/yaml"]?.version ?? "")
  || !/^0\.8\./.test(packageLock?.packages?.["node_modules/fflate"]?.version ?? "")) {
  fail("package-lock의 YAML/ZIP validator 의존성이 다릅니다.");
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
let workflowConfig = {};
try {
  const parsed = parseYaml(workflow);
  if (!isRecord(parsed)) throw new Error("root mapping이 아닙니다");
  workflowConfig = parsed;
} catch (error) {
  fail(`PR workflow를 YAML로 읽을 수 없습니다: ${error instanceof Error ? error.message : "unknown error"}`);
}
if (!exactKeysForWorkflow(workflowConfig, ["name", "on", "permissions", "jobs"]) || workflowConfig.name !== "PR 체크") {
  fail("PR workflow top-level 실행 구조가 기준과 다릅니다.");
}
const triggers = isRecord(workflowConfig.on) ? workflowConfig.on : {};
const pullRequestTrigger = isRecord(triggers.pull_request) ? triggers.pull_request : {};
const pushTrigger = isRecord(triggers.push) ? triggers.push : {};
const scheduleTrigger = Array.isArray(triggers.schedule) ? triggers.schedule : [];
if (!exactKeysForWorkflow(triggers, ["pull_request", "push", "schedule"])
  || !exactKeysForWorkflow(pullRequestTrigger, ["branches", "types"])
  || !exactKeysForWorkflow(pushTrigger, ["branches"])
  || JSON.stringify(pullRequestTrigger.branches) !== JSON.stringify(["main"])
  || JSON.stringify(pullRequestTrigger.types) !== JSON.stringify(["opened", "synchronize", "reopened", "edited"])
  || JSON.stringify(pushTrigger.branches) !== JSON.stringify(["main"])
  || !exactKeysForWorkflow(scheduleTrigger[0], ["cron"])
  || scheduleTrigger.length !== 1 || scheduleTrigger[0].cron !== "17 2 * * *") {
  fail("PR workflow의 pull_request/push main과 일일 evidence TTL trigger가 exact 기준과 다릅니다.");
}
const permissions = isRecord(workflowConfig.permissions) ? workflowConfig.permissions : {};
const jobs = isRecord(workflowConfig.jobs) ? workflowConfig.jobs : {};
const checkJob = isRecord(jobs.check) ? jobs.check : {};
const jobEnv = isRecord(checkJob.env) ? checkJob.env : {};
const steps = Array.isArray(checkJob.steps) ? checkJob.steps.filter(isRecord) : [];
if (!exactKeysForWorkflow(jobs, ["check"])
  || !exactKeysForWorkflow(checkJob, ["runs-on", "env", "steps"])
  || checkJob["runs-on"] !== "ubuntu-latest") {
  fail("PR workflow check job의 실행·skip 경계가 exact 기준과 다릅니다.");
}
const expectedJobEnvKeys = [
  "PRECASE_CI", "DATABASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "PUBLIC_MCP_ENABLED",
  "LAW_API_OC", "LAW_API_BASE", "MAX_TOOL_CALLS_PER_CYCLE", "MAX_TOOL_CALLS_PER_SESSION",
  "MAX_FOLLOWUP_QUESTIONS", "MAX_FOLLOWUP_TOTAL", "MAX_STATEMENT_CHARS", "SESSION_IDLE_MINUTES",
  "CONFIDENCE_THRESHOLD", "DAILY_BUDGET_USD", "RATE_LIMIT_PER_MINUTE",
  "RATE_LIMIT_SESSIONS_PER_HOUR", "RATE_LIMIT_JUDGMENTS_PER_DAY",
];
if (!exactKeysForWorkflow(jobEnv, expectedJobEnvKeys)) {
  fail("PR workflow job env에 미승인 실행 환경변수가 있거나 필수값이 없습니다.");
}
const expectedPermissions = { actions: "read", contents: "read", issues: "read", "pull-requests": "read", statuses: "read" };
if (JSON.stringify(Object.keys(permissions).sort()) !== JSON.stringify(Object.keys(expectedPermissions).sort())
  || Object.entries(expectedPermissions).some(([key, value]) => permissions[key] !== value)
  || Object.hasOwn(checkJob, "permissions")) {
  fail("PR CI evidence/run 검증용 exact 최소 읽기 권한이 없습니다.");
}

const requireSingleAction = (prefix, expected, message) => {
  const matches = steps.filter((step) => typeof step.uses === "string" && step.uses.startsWith(prefix));
  if (matches.length !== 1 || matches[0].uses !== expected) fail(message);
  return matches[0];
};
const checkoutStep = requireSingleAction(
  "actions/checkout@",
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  "actions/checkout이 검토한 commit SHA에 고정되지 않았습니다.",
);
if (steps[0] !== checkoutStep || !exactKeysForWorkflow(checkoutStep, ["uses"])) {
  fail("actions/checkout은 외부 repository/ref/path 없이 첫 step에서 현재 PR을 checkout해야 합니다.");
}
const setupNodeStep = requireSingleAction(
  "actions/setup-node@",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/setup-node pin이 검토한 commit SHA와 다릅니다.",
);
if (steps[1] !== setupNodeStep || !exactKeysForWorkflow(setupNodeStep, ["uses", "with"])
  || !exactKeysForWorkflow(setupNodeStep?.with, ["node-version", "cache"])
  || String(isRecord(setupNodeStep?.with) ? setupNodeStep.with["node-version"] : "") !== "24"
  || (isRecord(setupNodeStep?.with) ? setupNodeStep.with.cache : null) !== "npm") {
  fail("actions/setup-node의 Node 24/npm cache 설정이 ADR과 다릅니다.");
}

const unsafeStepKeys = ["if", "continue-on-error", "shell", "working-directory"];
const requireExactRunStep = (name, command, message) => {
  const matches = steps.filter((step) => step.name === name);
  const step = matches[0];
  if (matches.length !== 1 || typeof step?.run !== "string" || step.run.trim() !== command
    || unsafeStepKeys.some((key) => Object.hasOwn(step ?? {}, key))) {
    fail(message);
  }
  return step;
};
const installStepIndex = steps.findIndex((step) => typeof step.run === "string" && step.run.trim() === "npm ci --ignore-scripts");
if (installStepIndex !== 2 || !exactKeysForWorkflow(steps[installStepIndex], ["run"])) {
  fail("npm 의존성 설치는 lifecycle script 없이 세 번째 exact step이어야 합니다.");
}
const databaseStep = requireExactRunStep(
  "DB 명세 검증",
  "node .github/scripts/validate-database-spec.mjs",
  "PR CI가 DB 명세 validator를 exact safe step으로 실행하지 않습니다.",
);
const providerStep = requireExactRunStep(
  "Provider Stack ADR 검증",
  "node .github/scripts/validate-provider-stack-adr.mjs",
  "PR CI가 Provider ADR validator를 exact safe step으로 실행하지 않습니다.",
);
const providerStepIndex = steps.indexOf(providerStep);
const mutationStep = requireExactRunStep(
  "Provider ADR Validator Mutation Test",
  "node .github/scripts/test-provider-stack-adr-validator.mjs",
  "PR CI가 Provider ADR validator mutation test를 exact safe step으로 실행하지 않습니다.",
);
const modelSpikeContractStep = requireExactRunStep(
  "Provider Model Spike Contract Test",
  "node .github/scripts/test-provider-model-spike.mjs",
  "PR CI가 Provider Model Spike contract test를 exact safe step으로 실행하지 않습니다.",
);
const embedSpikeContractStep = requireExactRunStep(
  "Provider Embedding Spike Contract Test",
  "node .github/scripts/test-provider-embed-spike.mjs",
  "PR CI가 Provider Embedding Spike contract test를 exact safe step으로 실행하지 않습니다.",
);
if (steps.indexOf(databaseStep) !== 3 || providerStepIndex !== 4 || steps.indexOf(mutationStep) !== 5
  || !exactKeysForWorkflow(databaseStep, ["name", "run"])
  || !exactKeysForWorkflow(providerStep, ["name", "env", "run"])
  || !exactKeysForWorkflow(mutationStep, ["name", "run"])
  || steps.indexOf(modelSpikeContractStep) <= steps.indexOf(mutationStep)
  || !exactKeysForWorkflow(modelSpikeContractStep, ["name", "run"])
  || steps.indexOf(embedSpikeContractStep) !== steps.indexOf(modelSpikeContractStep) + 1
  || !exactKeysForWorkflow(embedSpikeContractStep, ["name", "run"])) {
  fail("DB/Provider/mutation 검증은 설치 직후의 exact 순서와 필드로 실행해야 합니다.");
}
const providerEnv = isRecord(providerStep?.env) ? providerStep.env : {};
if (!exactKeysForWorkflow(providerEnv, ["GITHUB_TOKEN", "VALIDATION_HEAD_SHA", "VALIDATION_PR_NUMBER"])
  || providerEnv.GITHUB_TOKEN !== "${{ github.token }}"
  || providerEnv.VALIDATION_HEAD_SHA !== "${{ github.sha }}"
  || providerEnv.VALIDATION_PR_NUMBER !== "${{ github.event.pull_request.number }}") {
  fail("Provider evidence 검증 token과 실제 checkout merge candidate SHA·PR 번호가 exact step에 연결되지 않았습니다.");
}
if (jobEnv.PUBLIC_MCP_ENABLED !== "false") fail("PR CI에서 공개 MCP가 비활성화되지 않았습니다.");
requireMatch(envExample, /^PUBLIC_MCP_ENABLED="false"$/m, ".env.example에서 공개 MCP가 비활성화되지 않았습니다.");
if (countExactLine(runtimeEnv, '  PUBLIC_MCP_ENABLED: z.literal("false"),') !== 1) {
  fail("Runtime env schema가 P0 PUBLIC_MCP_ENABLED=false만 허용하지 않습니다.");
}
if (/@\/lib\/mcp\/server|@\/lib\/ops\/rate-limit/.test(mcpRoute)
  || countExactLine(mcpRoute, "  return jsonNoStore({ ok: false, error: \"MCP_DISABLED\" }, 404);") !== 1
  || !/export function OPTIONS\(\): Response \{\n  return mcpUnavailable\(\);\n\}/.test(mcpRoute)
  || !/export function GET\(\): Response \{\n  return mcpUnavailable\(\);\n\}/.test(mcpRoute)
  || !/export function POST\(request: Request\): Response \{\n  void request;\n  return mcpUnavailable\(\);\n\}/.test(mcpRoute)) {
  fail("P0 /api/mcp route가 body·rate limit·MCP handler 실행 전에 모든 method를 404로 차단하지 않습니다.");
}
if (implementationGate === "GO") {
  if (jobEnv.ANTHROPIC_MODEL !== "claude-sonnet-5") fail("Implementation GO에서 CI 기본 모델이 Sonnet 5가 아닙니다.");
  requireMatch(envExample, /^ANTHROPIC_MODEL="claude-sonnet-5"$/m, "Implementation GO에서 .env.example 기본 모델이 Sonnet 5가 아닙니다.");
}

const readmeStatus = `| \`docs/adr/001-p0-provider-stack.md\` | Architecture 승인·Implementation Gate \`${implementationGate}\` |`;
const docsReadmeStatus = `| \`adr/001-p0-provider-stack.md\` | P0 Provider·공식 출처·Storage·Job·실패 계약 | Architecture 승인·Implementation Gate \`${implementationGate}\` |`;
if (!readme.includes(readmeStatus)) fail("README의 Provider Implementation 상태가 동기화되지 않았습니다.");
if (!docsReadme.includes(docsReadmeStatus)) fail("docs/README의 Provider Implementation 상태가 동기화되지 않았습니다.");
requireMatch(docsReadme, /현재 값은 ADR metadata와 위 표를 따른다/, "docs/README가 ADR metadata를 현재 Gate 기준으로 지정하지 않습니다.");
requireMatch(handoff, /Provider Stack ADR: `docs\/adr\/001-p0-provider-stack\.md`/, "HANDOFF에 Provider ADR 기준이 없습니다.");
if (!handoff.includes(`Provider Implementation Gate (\`N-QLT-010\`): \`${implementationGate}\``)) fail("HANDOFF의 Implementation Gate가 ADR과 다릅니다.");
if (!handoff.includes(`Product Release Gate (\`N-QLT-009\`): \`${releaseGate}\``)) fail("HANDOFF의 Release Gate가 ADR과 다릅니다.");
if (implementationGate === "NO-GO") {
  requireMatch(readme, /현재 Commit은[^\n]*`N-QLT-010` Implementation Gate는 `NO-GO`/, "README 현재 설명이 Implementation NO-GO와 다릅니다.");
  requireMatch(handoff, /^1\. `N-QLT-010` Live Spike 증거 확보와 Implementation `NO-GO` 차단 해제$/m, "HANDOFF 첫 다음 작업이 Live Spike 증거 확보가 아닙니다.");
} else {
  requireMatch(readme, /현재 Commit은[^\n]*`N-QLT-010` Implementation Gate는 `GO`/, "README 현재 설명이 Implementation GO와 다릅니다.");
  requireMatch(handoff, /^1\. P0 `docs\/04-feature-spec\.md`/m, "Implementation GO 뒤 HANDOFF 첫 작업이 기능명세로 이동하지 않았습니다.");
  if (/^1\. `N-QLT-010` Live Spike 증거 확보와 Implementation `NO-GO`/m.test(handoff)) fail("Implementation GO인데 HANDOFF에 NO-GO 차단 해제가 남아 있습니다.");
}
if (releaseGate === "NOT-EVALUATED") requireMatch(readme, /`N-QLT-009` Release Gate는 기능 구현 뒤 평가한다/, "README 현재 설명이 Release NOT-EVALUATED와 다릅니다.");
if (releaseGate === "NO-GO") requireMatch(readme, /`N-QLT-009` Release Gate는 `NO-GO`/, "README 현재 설명이 Release NO-GO와 다릅니다.");
if (releaseGate === "GO") requireMatch(readme, /`N-QLT-009` Release Gate는 `GO`/, "README 현재 설명이 Release GO와 다릅니다.");
requireMatch(agents, /ADR은 상위 요구·DB·기능명세를 덮지 않는다/, "AGENTS에 ADR의 우선순위 경계가 없습니다.");
requireMatch(agents, /현재 Gate 값의 유일한 기준은 ADR metadata[\s\S]*Implementation Gate가 `NO-GO`[\s\S]*`GO`[\s\S]*Release Gate \(`N-QLT-009`\)/, "AGENTS에 metadata 기반 분리 Gate 규칙이 없습니다.");
requireMatch(claude, /P0 `햇살론15` 흐름[\s\S]*Product\/Institution[\s\S]*Fraud\/Channel[\s\S]*Sales Conduct[\s\S]*Regulation & Dispute[\s\S]*4개 Domain Agent[\s\S]*동적 Agent 선택[\s\S]*P1 Gate/, "CLAUDE의 P0 Agent 실행 규칙이 정본과 다릅니다.");
requireMatch(databaseSpec, /P0 대출 Manifest는 Product\/Institution, Fraud\/Channel, PreCase 기반 Sales Conduct, Regulation & Dispute의 고정된 4개 Domain Agent/, "DB Manifest의 P0 고정 4-Agent 구성이 ADR과 다릅니다.");
requireMatch(claude, /현재 Gate 값의 유일한 기준[\s\S]*Implementation Gate \(`N-QLT-010`\)[\s\S]*Release Gate \(`N-QLT-009`\)/, "CLAUDE에 metadata 기반 분리 Gate 규칙이 없습니다.");

if (errors.length > 0) {
  console.error("Provider stack ADR validation failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Provider stack ADR validation passed: requirements ${actualRequirementsBlob}, ${implementationBlockers.length} implementation blockers, Implementation ${implementationGate}, Release ${releaseGate}.`);
