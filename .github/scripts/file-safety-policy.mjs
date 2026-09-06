// ============================================================
// B-FILE-SAFETY 사전 고정 합격선. 결과 파일을 다시 검사한다.
//
// ADR 15.1 File safety 행: 위험 입력 ≥50건에서 거부 100%, secret·network 접근 0건,
// process crash 가 Agent Runtime 에 전파 0건.
// 이 정책은 그 세 값을 결과의 관측값으로 재계산하고, Fixture 가 생성기와 같은지도 확인한다.
// 합격선을 바꾸면 기존 결과를 무효화하고 ADR 변경 PR 로 승인받는다.
// ============================================================
import { CATEGORY_RULES, FAULT_EXPECTATIONS, FIXTURE_GENERATOR_VERSION, fixtureDigests } from "./file-safety-fixtures.mjs";
import { LIMITS, REASON_CODES } from "./file-safety-inspector.mjs";

export const FORMULA_VERSION = "file-safety-isolated-parser-fixture-matrix-v1";
export const PARSER_PACKAGE = "pdfjs-dist";
export const PARSER_VERSION = "6.3.289";
export const PARSER_INTEGRITY = "sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==";
export const MAX_OLD_SPACE_MB = 512;
export const MIN_DANGEROUS_FIXTURES = 50; // ADR 15.1 최소 표본
export const WORKER_ENV_ALLOWLIST = Object.freeze(["PATH"]);
// userns: 권한 없는 user namespace. sudo: Ubuntu 24.04 처럼 AppArmor 가 그것을 막을 때
// network namespace 만 sudo 로 만들고 setpriv 로 곧바로 원래 사용자로 내려간다.
export const NAMESPACE_MODES = Object.freeze(["userns", "sudo"]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const DANGEROUS = Object.keys(CATEGORY_RULES).filter((c) => c !== "benign" && c !== "fault");

export const validateFileSafetyEvidenceResult = (result, fail) => {
  const o = result?.observations;
  if (!exactKeys(o, ["contract", "fixtures", "runs", "faults", "isolation", "totals"])) {
    fail("observations 는 contract·fixtures·runs·faults·isolation·totals 만 가져야 합니다.");
    return;
  }

  // 1. 계약: 산식·한도·Parser 를 코드 상수와 대조한다.
  const c = o.contract;
  if (!exactKeys(c, ["formula_version", "fixture_generator_version", "limits", "categories", "parser", "isolation"])
    || c.formula_version !== FORMULA_VERSION || c.fixture_generator_version !== FIXTURE_GENERATOR_VERSION) {
    fail("contract 의 산식·Fixture 생성기 버전이 현재 코드와 다릅니다.");
  }
  for (const [key, value] of Object.entries(LIMITS)) {
    if (c.limits?.[key] !== value) fail(`한도 ${key} 가 코드 상수와 다릅니다.`);
  }
  if (!exactKeys(c.limits ?? {}, Object.keys(LIMITS))) fail("한도 목록이 코드 상수와 다릅니다.");
  for (const [name, rule] of Object.entries(CATEGORY_RULES)) {
    const declared = c.categories?.[name];
    if (declared?.expected !== rule.expected || declared?.minimum !== rule.minimum) fail(`분류 ${name} 의 기대 판정·최소 건수가 다릅니다.`);
  }
  if (c.parser?.package !== PARSER_PACKAGE || c.parser?.version !== PARSER_VERSION || c.parser?.integrity !== PARSER_INTEGRITY) {
    fail("Parser 의 package·version·integrity 가 고정값과 다릅니다.");
  }
  if (c.isolation?.permission_model !== true || c.isolation?.max_old_space_mb !== MAX_OLD_SPACE_MB
    || c.isolation?.network_namespace !== true || !NAMESPACE_MODES.includes(c.isolation?.network_namespace_mode)
    || JSON.stringify(c.isolation?.env_allowlist) !== JSON.stringify([...WORKER_ENV_ALLOWLIST])) {
    fail("격리 계약(권한 모델·namespace·heap 상한·환경변수 allowlist)이 고정값과 다릅니다.");
  }

  // 2. Fixture: 생성기를 다시 돌려 SHA-256 이 같은지 본다. 다르면 시험 대상이 바뀐 것이다.
  const expected = fixtureDigests();
  const actual = o.fixtures?.sha256;
  if (!isRecord(actual) || JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
    fail("Fixture 목록이 생성기와 다릅니다.");
  } else {
    const differing = Object.keys(expected).filter((name) => actual[name] !== expected[name]);
    if (differing.length > 0) fail(`Fixture ${differing.length}건의 SHA-256 이 생성기와 다릅니다: ${differing.slice(0, 5).join(", ")}`);
  }
  const byCategory = o.fixtures?.by_category ?? {};
  for (const [name, rule] of Object.entries(CATEGORY_RULES)) {
    if (!Number.isInteger(byCategory[name]) || byCategory[name] < rule.minimum) fail(`분류 ${name} 의 Fixture 가 최소 ${rule.minimum}건에 못 미칩니다.`);
  }
  const dangerousCount = DANGEROUS.reduce((sum, name) => sum + (byCategory[name] ?? 0), 0);
  if (dangerousCount < MIN_DANGEROUS_FIXTURES) fail(`위험 입력 Fixture 가 ${MIN_DANGEROUS_FIXTURES}건에 못 미칩니다.`);
  if (o.fixtures?.total !== Object.keys(expected).length) fail("Fixture 총계가 생성기와 다릅니다.");

  // 3. 판정: 분류마다 기대 판정과 사유 가족이 맞아야 하고 어긋남은 0건이어야 한다.
  const runs = Array.isArray(o.runs) ? o.runs : [];
  const nonFault = Object.keys(expected).length - (byCategory.fault ?? 0);
  if (runs.length !== nonFault) fail("실행 기록 수가 fault 를 뺀 Fixture 수와 다릅니다.");
  let benignAccepted = 0;
  let dangerousRejected = 0;
  for (const run of runs) {
    if (!exactKeys(run, ["name", "category", "verdict", "stage", "reason_codes", "ms", "exit_status", "signal"])) {
      fail(`실행 기록 '${run?.name ?? "이름 없음"}' 의 필드가 계약과 다릅니다.`);
      continue;
    }
    const rule = CATEGORY_RULES[run.category];
    if (!rule || run.category === "fault") { fail(`실행 기록 '${run.name}' 의 분류가 올바르지 않습니다.`); continue; }
    if (run.exit_status !== 0 || run.signal !== null) fail(`'${run.name}' 은 worker 가 정상 종료하지 않았습니다.`);
    if (!Array.isArray(run.reason_codes) || run.reason_codes.some((code) => !REASON_CODES.includes(code))) {
      fail(`'${run.name}' 의 사유 코드가 목록에 없습니다.`);
    }
    if (run.verdict !== rule.expected) {
      fail(`'${run.name}' 은 ${rule.expected} 여야 하는데 ${run.verdict} 입니다.`);
      continue;
    }
    if (run.verdict === "ACCEPT") {
      if (run.reason_codes.length > 0) fail(`'${run.name}' 은 ACCEPT 인데 사유가 남아 있습니다.`);
      benignAccepted += 1;
    } else {
      if (!run.reason_codes.some((code) => rule.reasons.includes(code))) fail(`'${run.name}' 의 거부 사유가 분류 ${run.category} 의 가족에 없습니다.`);
      dangerousRejected += 1;
    }
  }
  if (benignAccepted !== (byCategory.benign ?? 0)) fail("정상 입력이 모두 통과하지는 않았습니다.");
  if (dangerousRejected !== dangerousCount) fail("위험 입력이 모두 거부되지는 않았습니다.");
  const t = o.totals;
  if (!exactKeys(t, ["mismatches", "benign_accepted", "dangerous_rejected", "parser_stage_runs", "max_ms"])
    || t.mismatches !== 0 || t.benign_accepted !== benignAccepted || t.dangerous_rejected !== dangerousRejected
    || !Number.isInteger(t.parser_stage_runs) || t.parser_stage_runs < 1 || !Number.isFinite(t.max_ms)) {
    fail("합계가 실행 기록과 맞지 않거나 Parser 단계를 한 번도 거치지 않았습니다.");
  }

  // 4. 격리: secret·network 접근 0건. 탐지기가 살아 있다는 음성 대조도 요구한다.
  const iso = o.isolation;
  if (!exactKeys(iso, ["env_secret_like_max", "env_unexpected", "canary_leaks", "network_attempts", "probes_denied", "negative_control"])
    || iso.env_secret_like_max !== 0 || iso.canary_leaks !== 0 || iso.network_attempts !== 0
    || !Array.isArray(iso.env_unexpected) || iso.env_unexpected.length !== 0) {
    fail("worker 가 secret 형태 환경변수·canary·network 접근에서 깨끗하지 않습니다.");
  }
  if (!exactKeys(iso.probes_denied ?? {}, ["fs_write", "fs_read_outside", "child_process", "worker_threads"])
    || Object.values(iso.probes_denied ?? {}).some((value) => value !== true)) {
    fail("worker 의 파일 쓰기·바깥 읽기·child process·worker thread 가 모두 거부되지는 않았습니다.");
  }
  if (iso.negative_control?.canary_visible !== true || iso.negative_control?.detected !== true) {
    fail("음성 대조가 없어 canary 탐지가 동작한다는 사실을 확인할 수 없습니다.");
  }

  // 5. Fault: 모든 주입이 worker 안에서 끝나고 부모가 살아남아 기록해야 한다.
  const faults = Array.isArray(o.faults) ? o.faults : [];
  if (faults.length !== (byCategory.fault ?? 0)) fail("fault 기록 수가 fault Fixture 수와 다릅니다.");
  for (const f of faults) {
    if (!exactKeys(f, ["name", "mode", "contained", "exit_status", "signal", "wall_timeout", "stdout_parsable"])) {
      fail(`fault 기록 '${f?.name ?? "이름 없음"}' 의 필드가 계약과 다릅니다.`);
      continue;
    }
    if (f.contained !== true) fail(`fault '${f.name}' 이 파일 판정값을 만들었습니다.`);
    const expectation = FAULT_EXPECTATIONS[f.mode];
    if (!expectation) { fail(`fault '${f.name}' 의 주입 방식이 목록에 없습니다.`); continue; }
    const terminated = f.exit_status !== 0 || f.signal !== null;
    if (terminated !== expectation.terminated) fail(`fault '${f.name}' 의 종료 형태가 계약과 다릅니다.`);
    if (f.wall_timeout !== expectation.wall_timeout) fail(`fault '${f.name}' 이 기대한 방식으로 끝나지 않았습니다.`);
    if (f.stdout_parsable !== expectation.parsable) fail(`fault '${f.name}' 의 stdout 형태가 계약과 다릅니다.`);
  }
  if (new Set(faults.map((f) => f.mode)).size !== Object.keys(FAULT_EXPECTATIONS).length) {
    fail("주입한 fault 종류가 계약과 다릅니다.");
  }
  const canary = faults.find((f) => f.mode === "network-canary");
  if (!canary || canary.stdout_parsable !== true) fail("network canary 결과가 없습니다.");
  const canaryObservation = o.isolation?.negative_control?.network ?? null;
  if (!canaryObservation || canaryObservation.external === "CONNECTED") {
    fail("격리 밖으로 나가는 연결이 성공했습니다.");
  }
};
