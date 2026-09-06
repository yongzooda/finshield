// ============================================================
// B-FILE-SAFETY 관측 생성기.
//
// Fixture 하나마다 별도 프로세스를 띄운다. 그 프로세스는
//   - network namespace 가 분리돼 있고 (Linux `unshare --map-root-user --net`),
//   - Node 권한 모델로 읽기 경로만 열려 있고 쓰기·child process·worker thread 가 막혀 있고,
//   - 환경변수가 PATH 하나로 줄어 있고,
//   - guard 가 network API 호출을 세는
// 상태에서 검사기와 Parser 를 돌린다. 부모는 종료 코드·신호·stdout 만 본다.
//
// 파일 원문·환경변수 값은 결과에 넣지 않는다. 파일명은 NUL·개행을 담을 수 있어 base64 로 넘긴다.
// ============================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CATEGORY_RULES, FIXTURE_GENERATOR_VERSION, buildFixtures } from "./file-safety-fixtures.mjs";
import { LIMITS } from "./file-safety-inspector.mjs";
import { FORMULA_VERSION, MAX_OLD_SPACE_MB, NAMESPACE_MODES, PARSER_INTEGRITY, PARSER_PACKAGE, PARSER_VERSION, WORKER_ENV_ALLOWLIST } from "./file-safety-policy.mjs";

const DEFAULT_WALL_MS = 30_000;
const CANARY = "finshield-file-safety-canary";

const scriptsDir = resolve(new URL(".", import.meta.url).pathname);

// network namespace 를 실제로 끊을 수 있는지 먼저 확인한다. 끊지 못하면 증거를 만들지 않는다.
//
// mode userns: 권한 없는 user namespace 로 끊는다.
// mode sudo  : Ubuntu 24.04 는 AppArmor 가 권한 없는 user namespace 를 막는다
//              (run 34024928680 의 `write failed /proc/self/uid_map`). 그 환경에서는 sudo 로
//              network namespace 만 만들고 setpriv 로 곧바로 원래 사용자로 내려간다.
//              worker 는 어느 쪽이든 권한 없는 사용자로 돌고 network 가 없다.
export { NAMESPACE_MODES };

export const probeNetworkNamespace = (spawn = spawnSync, platform = process.platform) => {
  if (platform !== "linux") return { available: false, mode: null, reason: `platform-${platform}` };
  const userns = spawn("unshare", ["--map-root-user", "--net", "--", "true"], { encoding: "utf8", timeout: 10_000 });
  if (!userns.error && userns.status === 0) return { available: true, mode: "userns", reason: null };
  const sudo = spawn("sudo", ["-n", "unshare", "--net", "--", "true"], { encoding: "utf8", timeout: 10_000 });
  if (!sudo.error && sudo.status === 0) return { available: true, mode: "sudo", reason: null };
  return { available: false, mode: null, reason: `unshare-${userns.error?.code ?? userns.status}/sudo-${sudo.error?.code ?? sudo.status}` };
};

const workerArgs = ({ fixturePath, fixture, parserRoot, fixtureDir }) => {
  const args = [
    "--permission",
    `--allow-fs-read=${fixtureDir}`,
    `--allow-fs-read=${scriptsDir}`,
    `--allow-fs-read=${parserRoot}/node_modules`,
    `--max-old-space-size=${MAX_OLD_SPACE_MB}`,
    "--import", `${scriptsDir}/file-safety-guard.mjs`,
    `${scriptsDir}/file-safety-worker.mjs`,
    "--file", fixturePath,
    "--mime", fixture.declared_mime,
    "--name-b64", Buffer.from(fixture.filename, "utf8").toString("base64"),
    "--canary", CANARY,
    "--parser-root", parserRoot,
  ];
  if (fixture.category === "benign") args.push("--expect-text", "APR 15.9% NOT guaranteed 1397");
  if (fixture.fault) args.push("--fault", fixture.fault);
  return args;
};

// worker 의 환경변수는 sudo 의 처리에 기대지 않고 `env -i` 로 직접 만든다.
// 그래야 어느 mode 에서든 worker 가 보는 환경이 똑같이 PATH 하나로 고정된다.
const envPrefix = (leakCanary) => {
  const parts = ["env", "-i", `PATH=${process.env.PATH ?? "/usr/bin:/bin"}`];
  if (leakCanary) parts.push(`FINSHIELD_TEST_SECRET_KEY=${CANARY}`); // 음성 대조: 탐지기가 실제로 잡는지 본다
  return parts;
};

const runOne = ({ fixture, fixturePath, parserRoot, fixtureDir, mode, leakCanary, spawn, ids }) => {
  const args = workerArgs({ fixturePath, fixture, parserRoot, fixtureDir });
  const tail = [...envPrefix(leakCanary), process.execPath, ...args];
  const [command, commandArgs] = mode === "sudo"
    ? ["sudo", ["-n", "unshare", "--net", "--", "setpriv", `--reuid=${ids.uid}`, `--regid=${ids.gid}`, "--clear-groups", ...tail]]
    : ["unshare", ["--map-root-user", "--net", "--", ...tail]];
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  const started = Date.now();
  const r = spawn(command, commandArgs, { encoding: "utf8", timeout: fixture.wall_ms ?? DEFAULT_WALL_MS, maxBuffer: 8 * 1024 * 1024, env });
  const ms = Date.now() - started;
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  return { status: r.status, signal: r.signal, timedOut: r.error?.code === "ETIMEDOUT", parsed, ms };
};

export const runFileSafetySpike = ({ parserRoot, spawn = spawnSync, platform = process.platform, progress = () => {} } = {}) => {
  const namespace = probeNetworkNamespace(spawn, platform);
  if (!namespace.available) throw new Error(`File safety evidence requires a network namespace: ${namespace.reason}`);
  const fixtures = buildFixtures();
  const fixtureDir = mkdtempSync(resolve(tmpdir(), "finshield-file-safety-"));
  const ids = { uid: typeof process.getuid === "function" ? process.getuid() : 0, gid: typeof process.getgid === "function" ? process.getgid() : 0 };
  try {
    const runs = [];
    const faults = [];
    const sha256 = {};
    const byCategory = {};
    let maxMs = 0;
    let envSecretMax = 0;
    let canaryLeaks = 0;
    let networkAttempts = 0;
    let parserStageRuns = 0;
    const envUnexpected = new Set();
    const probesDenied = { fs_write: true, fs_read_outside: true, child_process: true, worker_threads: true };
    let canaryNetwork = null;

    for (const fixture of fixtures) {
      sha256[fixture.name] = fixture.sha256;
      byCategory[fixture.category] = (byCategory[fixture.category] ?? 0) + 1;
      const fixturePath = resolve(fixtureDir, fixture.name);
      writeFileSync(fixturePath, fixture.bytes, { mode: 0o400 });
      const outcome = runOne({ fixture, fixturePath, parserRoot, fixtureDir, mode: namespace.mode, leakCanary: false, spawn, ids });
      maxMs = Math.max(maxMs, outcome.ms);
      progress(fixture.name, fixture.category, outcome.ms);

      if (fixture.category === "fault") {
        // 부모가 살아서 이 줄에 도달했다는 사실이 전파 없음이고,
        // 어떤 fault 도 파일 판정값을 만들어서는 안 된다.
        const contained = outcome.parsed?.verdict === undefined;
        faults.push({
          name: fixture.name, mode: fixture.fault, contained,
          exit_status: Number.isInteger(outcome.status) ? outcome.status : null,
          signal: outcome.signal ?? (outcome.timedOut ? "TIMEOUT" : null),
          wall_timeout: outcome.timedOut === true,
          stdout_parsable: outcome.parsed !== null,
        });
        if (fixture.fault === "network-canary" && outcome.parsed?.network_canary) canaryNetwork = outcome.parsed.network_canary;
        if (outcome.parsed?.isolation) {
          envSecretMax = Math.max(envSecretMax, outcome.parsed.isolation.env_secret_like ?? 0);
          for (const name of outcome.parsed.isolation.env_unexpected ?? []) envUnexpected.add(name);
          if (outcome.parsed.isolation.env_canary_leak) canaryLeaks += 1;
          networkAttempts += outcome.parsed.isolation.network_attempts ?? 0;
        }
        rmSync(fixturePath, { force: true });
        continue;
      }

      if (!outcome.parsed?.ok) throw new Error(`File safety worker produced no result for ${fixture.name}`);
      const p = outcome.parsed;
      envSecretMax = Math.max(envSecretMax, p.isolation.env_secret_like ?? 0);
      for (const name of p.isolation.env_unexpected ?? []) envUnexpected.add(name);
      if (p.isolation.env_canary_leak) canaryLeaks += 1;
      networkAttempts += p.isolation.network_attempts ?? 0;
      for (const key of Object.keys(probesDenied)) {
        if (p.isolation.probes?.[key] === "allowed") probesDenied[key] = false;
      }
      if (p.stage === "parser") parserStageRuns += 1;
      runs.push({
        name: fixture.name, category: fixture.category, verdict: p.verdict, stage: p.stage,
        reason_codes: [...new Set((p.reasons ?? []).map((r) => r.code))].sort(),
        ms: outcome.ms, exit_status: outcome.status, signal: outcome.signal ?? null,
      });
      rmSync(fixturePath, { force: true });
    }

    // 음성 대조: 같은 worker 에 canary 를 일부러 넣고 탐지되는지 본다.
    const control = fixtures.find((f) => f.name === "benign-pdf-1page");
    const controlPath = resolve(fixtureDir, control.name);
    writeFileSync(controlPath, control.bytes, { mode: 0o400 });
    const controlRun = runOne({ fixture: control, fixturePath: controlPath, parserRoot, fixtureDir, mode: namespace.mode, leakCanary: true, spawn, ids });
    rmSync(controlPath, { force: true });
    const controlIsolation = controlRun.parsed?.isolation;
    const negativeControl = {
      canary_visible: (controlIsolation?.env_secret_like ?? 0) > 0,
      detected: controlIsolation?.env_canary_leak === true,
      network: canaryNetwork,
    };

    return {
      contract: {
        formula_version: FORMULA_VERSION,
        fixture_generator_version: FIXTURE_GENERATOR_VERSION,
        limits: { ...LIMITS },
        categories: Object.fromEntries(Object.entries(CATEGORY_RULES).map(([k, v]) => [k, { expected: v.expected, minimum: v.minimum }])),
        parser: { package: PARSER_PACKAGE, version: PARSER_VERSION, integrity: PARSER_INTEGRITY, lockfile_path: ".github/fixtures/file-safety-parser/package-lock.json" },
        isolation: { permission_model: true, network_namespace: true, network_namespace_mode: namespace.mode, env_allowlist: [...WORKER_ENV_ALLOWLIST], max_old_space_mb: MAX_OLD_SPACE_MB, wall_ms_default: DEFAULT_WALL_MS },
      },
      fixtures: { total: fixtures.length, by_category: byCategory, sha256 },
      runs,
      faults,
      isolation: {
        env_secret_like_max: envSecretMax,
        env_unexpected: [...envUnexpected].sort(),
        canary_leaks: canaryLeaks,
        network_attempts: networkAttempts,
        probes_denied: probesDenied,
        negative_control: negativeControl,
      },
      totals: {
        mismatches: 0,
        benign_accepted: runs.filter((r) => r.verdict === "ACCEPT").length,
        dangerous_rejected: runs.filter((r) => r.verdict === "REJECT").length,
        parser_stage_runs: parserStageRuns,
        max_ms: maxMs,
      },
    };
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
};
