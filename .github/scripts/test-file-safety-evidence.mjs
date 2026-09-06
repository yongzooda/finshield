// B-FILE-SAFETY 계약 시험. 외부 호출 없이 검사기·Fixture·정책·orchestration 을 확인한다.
// 가짜 spawn 으로 격리 worker 를 흉내내어 spike 의 조립 로직까지 offline 으로 돌린다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORY_RULES, FIXTURE_GENERATOR_VERSION, buildFixtures, fixtureDigests } from "./file-safety-fixtures.mjs";
import { LIMITS, REASON_CODES, inspectFile } from "./file-safety-inspector.mjs";
import { FORMULA_VERSION, MAX_OLD_SPACE_MB, PARSER_INTEGRITY, PARSER_VERSION, validateFileSafetyEvidenceResult } from "./file-safety-policy.mjs";
import { probeNetworkNamespace, runFileSafetySpike } from "./file-safety-spike.mjs";

let passed = 0;
let rejected = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };

// ---------- 1. Fixture 계약 ----------
const fixtures = buildFixtures();
ok(fixtures.length >= 100, "Fixture 는 100건 이상이어야 한다");
const byCategory = {};
for (const f of fixtures) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
for (const [name, rule] of Object.entries(CATEGORY_RULES)) {
  ok(byCategory[name] >= rule.minimum, `분류 ${name} 는 최소 ${rule.minimum}건`);
}
const dangerous = Object.entries(byCategory).filter(([k]) => k !== "benign" && k !== "fault").reduce((s, [, v]) => s + v, 0);
ok(dangerous >= 50, "위험 입력은 ADR 15.1 의 최소 표본 50건 이상이어야 한다");
ok(fixtures.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)), "모든 Fixture 에 SHA-256 이 있어야 한다");
const digests = fixtureDigests();
ok(Object.keys(digests).length === fixtures.length, "digest 목록과 Fixture 수가 같아야 한다");
ok(buildFixtures().every((f) => f.sha256 === digests[f.name]), "Fixture 생성은 결정적이어야 한다");
ok(fixtures.some((f) => f.filename.includes("\0")), "NUL 이 든 파일명 Fixture 가 있어야 한다");
ok(fixtures.some((f) => f.filename.includes("..")), "경로 상위 이동 파일명 Fixture 가 있어야 한다");

// ---------- 2. 검사기 판정 ----------
for (const f of fixtures) {
  if (f.category === "fault") continue;
  const r = inspectFile({ bytes: f.bytes, declaredMime: f.declared_mime, filename: f.filename });
  const rule = CATEGORY_RULES[f.category];
  const expected = f.expected_stage === "parser" ? "ACCEPT" : rule.expected;
  assert.equal(r.verdict, expected, `${f.name}: ${expected} 여야 하는데 ${r.verdict} (${JSON.stringify(r.reasons)})`);
  if (expected === "REJECT") {
    assert.ok(r.reasons.some((x) => rule.reasons.includes(x.code)), `${f.name}: 사유 가족 불일치 ${JSON.stringify(r.reasons)}`);
  }
  assert.ok(r.reasons.every((x) => REASON_CODES.includes(x.code)), `${f.name}: 사유 코드가 목록에 있어야 한다`);
  passed += 1;
}
ok(inspectFile({ bytes: Buffer.alloc(LIMITS.MAX_BYTES + 1), declaredMime: "application/pdf", filename: "a.pdf" }).reasons.some((r) => r.code === "too-large"), "10 MiB 초과는 거부");
ok(inspectFile({ bytes: Buffer.alloc(0), declaredMime: "application/pdf", filename: "a.pdf" }).reasons.some((r) => r.code === "empty"), "빈 파일은 거부");

// ---------- 3. 가짜 격리 worker 로 spike 를 돌린다 ----------
const decodeOption = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const makeFakeSpawn = ({ usernsWorks = true } = {}) => (command, args) => {
  if (args?.[args.length - 1] === "true") {
    const userns = command === "unshare";
    return userns && !usernsWorks ? { status: 1, stdout: "", stderr: "uid_map" } : { status: 0, stdout: "", stderr: "" };
  }
  const real = args.slice(args.indexOf("--") + 1);
  const filePath = decodeOption(real, "--file");
  const fault = decodeOption(real, "--fault");
  const filename = Buffer.from(decodeOption(real, "--name-b64") ?? "", "base64").toString("utf8");
  // worker 환경은 `env -i KEY=VALUE ...` 로 만든다. 그 조각에서 canary 를 읽는다.
  const envAssignments = real.filter((a) => /^[A-Z_]+=/.test(a));
  const leaked = envAssignments.some((a) => /^(?:[A-Z_]*(?:KEY|SECRET|TOKEN))=/.test(a) && a.includes("finshield-file-safety-canary"));
  ok(envAssignments.every((a) => /^(?:PATH|FINSHIELD_TEST_SECRET_KEY)=/.test(a)), "worker 환경은 PATH 와 대조용 canary 만 받는다");
  const isolation = {
    env_names_count: envAssignments.length,
    env_secret_like: leaked ? 1 : 0,
    env_unexpected: [],
    env_canary_leak: leaked,
    permission_model: true,
    probes: { fs_write: "ERR_ACCESS_DENIED", fs_read_outside: "ERR_ACCESS_DENIED", child_process: "ERR_ACCESS_DENIED", worker_threads: "ERR_ACCESS_DENIED" },
    network_guard_loaded: true,
    network_attempts: 0,
    network_attempt_kinds: [],
  };
  if (fault === "crash") return { status: null, signal: "SIGABRT", stdout: "", stderr: "" };
  if (fault === "hang") return { status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" };
  if (fault === "oom") return { status: 134, signal: null, stdout: "", stderr: "heap out of memory" };
  if (fault === "exit-nonzero") return { status: 3, signal: null, stdout: "", stderr: "" };
  if (fault === "garbage") return { status: 0, signal: null, stdout: "not json\n", stderr: "" };
  if (fault === "network-canary") {
    return { status: 0, signal: null, stderr: "", stdout: `${JSON.stringify({ ok: true, fault, isolation, network_canary: { loopback: "ENETUNREACH", external: "ENETUNREACH", lookup: "EAI_AGAIN" }, elapsed_ms: 5 })}\n` };
  }
  const bytes = readFileSync(filePath);
  const inspection = inspectFile({ bytes, declaredMime: decodeOption(real, "--mime"), filename });
  let verdict = inspection.verdict;
  let reasons = inspection.reasons;
  let stage = "inspector";
  if (inspection.verdict === "ACCEPT" && inspection.detected_mime === "application/pdf") {
    stage = "parser";
    const name = filename.replace(/\.[^.]+$/, "");
    if (name.startsWith("malformed-")) { verdict = "REJECT"; reasons = [{ code: "parser-malformed", detail: "UnknownErrorException" }]; }
  }
  return { status: 0, signal: null, stderr: "", stdout: `${JSON.stringify({ ok: true, verdict, reasons, stage, inspection: { detected_mime: inspection.detected_mime, extension: inspection.extension, metrics: inspection.metrics }, parse: null, isolation, elapsed_ms: 3 })}\n` };
};

const fakeSpawn = makeFakeSpawn();
const fakeSpawnNoUserns = makeFakeSpawn({ usernsWorks: false });
ok(probeNetworkNamespace(fakeSpawn, "darwin").available === false, "Linux 가 아니면 namespace 를 쓸 수 없다");
ok(probeNetworkNamespace(fakeSpawn, "linux").mode === "userns", "가능하면 user namespace 를 쓴다");
ok(probeNetworkNamespace(fakeSpawnNoUserns, "linux").mode === "sudo", "user namespace 가 막히면 sudo 로 대체한다");
ok(probeNetworkNamespace(() => ({ status: 1 }), "linux").available === false, "둘 다 막히면 증거를 만들지 않는다");
assert.throws(() => runFileSafetySpike({ parserRoot: "/nonexistent", spawn: fakeSpawn, platform: "darwin" }), /network namespace/);
passed += 1;

const observations = runFileSafetySpike({ parserRoot: "/nonexistent", spawn: fakeSpawn, platform: "linux" });
ok(observations.contract.isolation.network_namespace_mode === "userns", "관측에 namespace mode 가 남는다");
const sudoObservations = runFileSafetySpike({ parserRoot: "/nonexistent", spawn: fakeSpawnNoUserns, platform: "linux" });
ok(sudoObservations.contract.isolation.network_namespace_mode === "sudo", "대체 mode 도 관측에 남는다");
ok(observations.totals.mismatches === 0, "합계에 어긋남이 없어야 한다");
ok(observations.isolation.network_attempts === 0, "network 시도는 0건");
ok(observations.isolation.canary_leaks === 0, "본 실행에서는 canary 가 보이지 않아야 한다");
ok(observations.isolation.negative_control.canary_visible === true, "음성 대조에서는 canary 가 보여야 한다");
ok(observations.isolation.negative_control.detected === true, "음성 대조에서 탐지가 동작해야 한다");
ok(observations.faults.every((f) => f.contained === true), "모든 fault 가 worker 안에서 끝나야 한다");
ok(observations.faults.filter((f) => f.stdout_parsable).length === 1, "stdout 이 JSON 인 fault 는 network canary 하나뿐");
ok(observations.contract.formula_version === FORMULA_VERSION, "산식 버전 고정");
ok(observations.contract.fixture_generator_version === FIXTURE_GENERATOR_VERSION, "생성기 버전 고정");

// Parser 는 lockfile 로 고정한다. 정책 상수와 lockfile 이 어긋나면 설치본이 달라진다.
const lock = JSON.parse(readFileSync(new URL("../fixtures/file-safety-parser/package-lock.json", import.meta.url), "utf8"));
const locked = lock.packages["node_modules/pdfjs-dist"];
ok(locked.version === PARSER_VERSION, "lockfile 의 Parser 버전이 정책 상수와 같아야 한다");
ok(locked.integrity === PARSER_INTEGRITY, "lockfile 의 Parser integrity 가 정책 상수와 같아야 한다");
const manifest = JSON.parse(readFileSync(new URL("../fixtures/file-safety-parser/package.json", import.meta.url), "utf8"));
ok(manifest.dependencies["pdfjs-dist"] === PARSER_VERSION, "manifest 가 정확한 버전을 고정해야 한다");
ok(observations.contract.parser.version === PARSER_VERSION && observations.contract.parser.integrity === PARSER_INTEGRITY, "관측의 Parser 고정값이 정책과 같아야 한다");

const baseline = {
  schema_version: 3, blocker_id: "B-FILE-SAFETY", requirements_blob_sha: "a".repeat(40), adr_decision_sha256: "b".repeat(64),
  code_under_test_sha: "c".repeat(40), workflow_head_sha: "c".repeat(40), scope_sha256: "d".repeat(64),
  run: { id: 1, attempt: 1 }, observations, environment: { node_version: "v24.0.0" }, redactions_applied: true,
};
const check = (result) => { const errors = []; validateFileSafetyEvidenceResult(result, (m) => errors.push(m)); return errors; };
assert.deepEqual(check(baseline), [], "기준 결과는 정책을 통과해야 한다");
passed += 1;

// ---------- 4. 정책이 무엇을 거부하는지 ----------
const clone = () => JSON.parse(JSON.stringify(baseline));
const mustReject = (name, mutate) => {
  const result = clone();
  mutate(result);
  const errors = check(result);
  assert.ok(errors.length > 0, `정책이 '${name}' 를 거부해야 한다`);
  rejected += 1;
};
mustReject("산식 버전 변경", (r) => { r.observations.contract.formula_version = "other"; });
mustReject("생성기 버전 변경", (r) => { r.observations.contract.fixture_generator_version = "other"; });
mustReject("한도 완화", (r) => { r.observations.contract.limits.MAX_PAGES = 1000; });
mustReject("한도 제거", (r) => { delete r.observations.contract.limits.MAX_BYTES; });
mustReject("Parser 버전 변경", (r) => { r.observations.contract.parser.version = "1.0.0"; });
mustReject("Parser integrity 변경", (r) => { r.observations.contract.parser.integrity = "sha512-x"; });
mustReject("heap 상한 변경", (r) => { r.observations.contract.isolation.max_old_space_mb = MAX_OLD_SPACE_MB + 1; });
mustReject("권한 모델 미사용", (r) => { r.observations.contract.isolation.permission_model = false; });
mustReject("환경변수 allowlist 확대", (r) => { r.observations.contract.isolation.env_allowlist = ["PATH", "HOME"]; });
mustReject("분류 최소 건수 완화", (r) => { r.observations.contract.categories.polyglot.minimum = 1; });
mustReject("Fixture digest 변조", (r) => { r.observations.fixtures.sha256["benign-pdf-1page"] = "0".repeat(64); });
mustReject("Fixture 제거", (r) => { delete r.observations.fixtures.sha256["benign-pdf-1page"]; });
mustReject("Fixture 총계 변조", (r) => { r.observations.fixtures.total += 1; });
mustReject("위험 Fixture 축소", (r) => { r.observations.fixtures.by_category.polyglot = 2; });
mustReject("위험 입력 통과", (r) => { const run = r.observations.runs.find((x) => x.category === "polyglot"); run.verdict = "ACCEPT"; run.reason_codes = []; });
mustReject("정상 입력 거부", (r) => { const run = r.observations.runs.find((x) => x.category === "benign"); run.verdict = "REJECT"; run.reason_codes = ["malformed"]; });
mustReject("사유 가족 불일치", (r) => { const run = r.observations.runs.find((x) => x.category === "encrypted"); run.reason_codes = ["page-limit"]; });
mustReject("목록에 없는 사유 코드", (r) => { r.observations.runs.find((x) => x.verdict === "REJECT").reason_codes = ["made-up"]; });
mustReject("worker 비정상 종료", (r) => { r.observations.runs[0].exit_status = 1; });
mustReject("실행 기록 누락", (r) => { r.observations.runs.pop(); });
mustReject("합계 조작", (r) => { r.observations.totals.mismatches = 1; });
mustReject("Parser 단계 0회", (r) => { r.observations.totals.parser_stage_runs = 0; });
mustReject("secret 형태 환경변수 노출", (r) => { r.observations.isolation.env_secret_like_max = 1; });
mustReject("예상 밖 환경변수", (r) => { r.observations.isolation.env_unexpected = ["ANTHROPIC_API_KEY"]; });
mustReject("canary 유출", (r) => { r.observations.isolation.canary_leaks = 1; });
mustReject("network 시도", (r) => { r.observations.isolation.network_attempts = 1; });
mustReject("파일 쓰기 허용", (r) => { r.observations.isolation.probes_denied.fs_write = false; });
mustReject("child process 허용", (r) => { r.observations.isolation.probes_denied.child_process = false; });
mustReject("음성 대조 없음", (r) => { r.observations.isolation.negative_control.detected = false; });
mustReject("namespace 미사용", (r) => { r.observations.contract.isolation.network_namespace = false; });
mustReject("알 수 없는 namespace mode", (r) => { r.observations.contract.isolation.network_namespace_mode = "none"; });
mustReject("바깥 연결 성공", (r) => { r.observations.isolation.negative_control.network.external = "CONNECTED"; });
mustReject("fault 전파", (r) => { r.observations.faults[0].contained = false; });
mustReject("fault 가 정상 종료", (r) => { const f = r.observations.faults.find((x) => x.mode === "crash"); f.exit_status = 0; f.signal = null; });
mustReject("heap 한도 대신 시간 상한으로 끝남", (r) => { r.observations.faults.find((x) => x.mode === "oom").wall_timeout = true; });
mustReject("무한 루프가 시간 상한 없이 끝남", (r) => { r.observations.faults.find((x) => x.mode === "hang").wall_timeout = false; });
mustReject("fault 기록 누락", (r) => { r.observations.faults.pop(); });
mustReject("network canary 결과 없음", (r) => { r.observations.faults = r.observations.faults.filter((f) => f.mode !== "network-canary"); r.observations.fixtures.by_category.fault -= 1; });
mustReject("observations 키 추가", (r) => { r.observations.extra = 1; });

console.log(`B-FILE-SAFETY 계약 시험 통과: 합격 ${passed}건, 정책 거부 ${rejected}건, Fixture ${fixtures.length}건(위험 ${dangerous}건).`);
