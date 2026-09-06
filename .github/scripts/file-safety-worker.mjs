// ============================================================
// 격리 Parser worker. 부모(harness)가 파일마다 새 프로세스로 띄운다.
//   node --permission --allow-fs-read=<허용 경로> --import file-safety-guard.mjs file-safety-worker.mjs \
//        --file <경로> --mime <선언 MIME> --name-b64 <base64 파일명> [--fault <mode>] [--canary <값>] [--expect-text <문구>]
// 결과는 stdout 에 JSON 한 줄. 파일 원문·환경변수 값·Stack 은 출력하지 않는다.
// 이 프로세스에는 Provider secret 이 없어야 하고 network 가 없어야 한다. 그 사실을 스스로 관측해 보고한다.
// ============================================================
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { LIMITS, inspectFile } from "./file-safety-inspector.mjs";

const started = Date.now();
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const filePath = option("--file");
const declaredMime = option("--mime");
// 파일명에는 NUL·개행이 들어갈 수 있고 그런 이름도 시험 대상이다. 프로세스 인자로는
// 그대로 넘길 수 없으므로 base64 로 받는다.
const filename = (() => {
  const encoded = option("--name-b64");
  return typeof encoded === "string" ? Buffer.from(encoded, "base64").toString("utf8") : null;
})();
const fault = option("--fault");
const canary = option("--canary");
const expectText = option("--expect-text");
const parserRoot = option("--parser-root"); // pdfjs-dist 가 설치된 prefix (node_modules 의 부모)

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|DATABASE_URL|DSN|CREDENTIAL)/i;
const ENV_ALLOWLIST = /^(PATH|HOME|USER|LOGNAME|SHELL|TERM|MAIL|LANG|LANGUAGE|LC_[A-Z]+|PWD|OLDPWD|SHLVL|_|SUDO_[A-Z_]+|XDG_[A-Z_]+|DISPLAY|COLORTERM|TMPDIR|TZ|HOSTNAME|DEBIAN_FRONTEND|CI|RUNNER_[A-Z_]+|GITHUB_[A-Z_]+|__CF_USER_TEXT_ENCODING)$/;

const observeIsolation = () => {
  const names = Object.keys(process.env);
  const probes = {};
  const codeOf = (fn) => { try { fn(); return "allowed"; } catch (error) { return String(error?.code ?? error?.name ?? "error"); } };
  probes.fs_write = codeOf(() => writeFileSync("/tmp/finshield-file-safety-probe", "x"));
  probes.fs_read_outside = codeOf(() => readFileSync("/etc/hosts"));
  probes.child_process = "pending";
  probes.worker_threads = "pending";
  return {
    env_names_count: names.length,
    env_secret_like: names.filter((n) => SECRET_NAME.test(n)).length,
    env_unexpected: names.filter((n) => !ENV_ALLOWLIST.test(n)).sort(),
    env_canary_leak: Boolean(canary) && names.some((n) => String(process.env[n]).includes(canary)),
    permission_model: Boolean(process.permission),
    permission_fs_write_root: process.permission ? process.permission.has("fs.write", "/") : null,
    probes,
  };
};
const finishProbes = async (isolation) => {
  try { const cp = await import("node:child_process"); cp.spawnSync("true"); isolation.probes.child_process = "allowed"; } catch (error) { isolation.probes.child_process = String(error?.code ?? "error"); }
  try { const wt = await import("node:worker_threads"); const w = new wt.Worker("process.exit(0)", { eval: true }); await new Promise((r) => w.on("exit", r)); isolation.probes.worker_threads = "allowed"; } catch (error) { isolation.probes.worker_threads = String(error?.code ?? "error"); }
  const guard = globalThis.__finshieldNetworkGuard ?? null;
  isolation.network_guard_loaded = Boolean(guard);
  isolation.network_attempts = guard ? guard.attempts : null;
  isolation.network_attempt_kinds = guard ? [...guard.kinds] : [];
};

const emit = (payload) => { process.stdout.write(`${JSON.stringify(payload)}\n`); };

const classifyParserError = (error) => {
  const name = String(error?.name ?? "");
  if (name === "ParserUnavailable") return { code: "parser-unavailable", detail: String(error.code).replace(/[^A-Za-z0-9_]/g, "") };
  if (name === "PasswordException") return { code: "encrypted", detail: "parser" };
  if (["InvalidPDFException", "FormatError", "MissingPDFException", "UnexpectedResponseException", "UnknownErrorException", "XRefParseException", "XRefEntryException"].includes(name)) return { code: "parser-malformed", detail: name };
  if (name === "RangeError") return { code: "parser-malformed", detail: "RangeError" };
  return { code: "parser-malformed", detail: name.replace(/[^A-Za-z0-9]/g, "") || "unknown" };
};

const loadPdfjs = async () => {
  try {
    if (!parserRoot) throw new Error("parser root missing");
    return await import(pathToFileURL(`${parserRoot}/node_modules/pdfjs-dist/legacy/build/pdf.mjs`).href);
  } catch (error) {
    const unavailable = new Error("parser unavailable");
    unavailable.name = "ParserUnavailable";
    unavailable.code = String(error?.code ?? "import");
    throw unavailable;
  }
};

const parsePdf = async (bytes) => {
  const pdfjs = await loadPdfjs();
  const fontsUrl = pathToFileURL(`${parserRoot}/node_modules/pdfjs-dist/standard_fonts/`).href;
  const cmapUrl = pathToFileURL(`${parserRoot}/node_modules/pdfjs-dist/cmaps/`).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true, verbosity: 0,
    standardFontDataUrl: fontsUrl, cMapUrl: cmapUrl, cMapPacked: true, disableAutoFetch: true, disableStream: true,
  });
  const doc = await task.promise;
  try {
    if (doc.numPages > LIMITS.MAX_PAGES) return { verdict: "REJECT", reasons: [{ code: "page-limit", detail: `parser:${doc.numPages}` }], pages: doc.numPages };
    let text = "";
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += `${content.items.map((item) => item.str ?? "").join(" ")}\n`;
      page.cleanup();
    }
    const printable = [...text].filter((ch) => /[\p{L}\p{N}\p{P}\p{S} ]/u.test(ch)).length;
    const digits = (text.match(/\d+(?:\.\d+)?%?/g) ?? []).length;
    return {
      verdict: "ACCEPT", reasons: [], pages: doc.numPages, characters: text.length, printable_ratio: text.length ? Number((printable / text.length).toFixed(3)) : 0,
      numeric_tokens: digits, negation_preserved: /\bNOT\b/.test(text), marker_found: expectText ? text.includes(expectText) : null, pdfjs_version: pdfjs.version,
    };
  } finally {
    // pdfjs 6 의 문서 객체에는 destroy 가 없다. 정리는 loading task 가 맡는다.
    await task.destroy();
  }
};

const main = async () => {
  const isolation = observeIsolation();
  if (fault === "crash") process.abort();
  if (fault === "hang") for (;;) { /* wall-time 한도로만 끝난다 */ }
  if (fault === "oom") { const hold = []; for (;;) hold.push(Buffer.alloc(8 * 1024 * 1024, 1)); }
  if (fault === "exit-nonzero") process.exit(3);
  if (fault === "garbage") { process.stdout.write("this is not json\n"); process.exit(0); }
  if (fault === "network-canary") {
    // guard 를 우회한 원본 함수로 실제 연결을 시도해 namespace 격리를 관측한다.
    const guard = globalThis.__finshieldNetworkGuard;
    const raw = guard?.raw ?? {};
    const net = await import("node:net");
    const attempt = (fn) => new Promise((resolve) => { try { fn(resolve); } catch (error) { resolve(String(error?.code ?? "throw")); } });
    const loopback = await attempt((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => { socket.destroy(); resolve("TIMEOUT"); }, 3000);
      socket.on("error", (error) => { clearTimeout(timer); resolve(String(error.code ?? "error")); });
      socket.on("connect", () => { clearTimeout(timer); socket.destroy(); resolve("CONNECTED"); });
      raw.netConnect.call(socket, { host: "127.0.0.1", port: 9 });
    });
    const external = await attempt((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => { socket.destroy(); resolve("TIMEOUT"); }, 3000);
      socket.on("error", (error) => { clearTimeout(timer); resolve(String(error.code ?? "error")); });
      socket.on("connect", () => { clearTimeout(timer); socket.destroy(); resolve("CONNECTED"); });
      raw.netConnect.call(socket, { host: "1.1.1.1", port: 80 });
    });
    const lookup = await new Promise((resolve) => { try { raw.lookup("example.com", (error) => resolve(error ? String(error.code) : "RESOLVED")); } catch (error) { resolve(String(error?.code ?? "throw")); } });
    await finishProbes(isolation);
    emit({ ok: true, fault, isolation, network_canary: { loopback, external, lookup }, elapsed_ms: Date.now() - started });
    return;
  }
  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch (error) {
    emit({ ok: false, error: `read:${String(error?.code ?? "error")}`, isolation, elapsed_ms: Date.now() - started });
    return;
  }
  const inspection = inspectFile({ bytes, declaredMime, filename });
  let parse = null;
  let verdict = inspection.verdict;
  let reasons = inspection.reasons;
  let stage = "inspector";
  if (inspection.verdict === "ACCEPT" && inspection.detected_mime === "application/pdf") {
    stage = "parser";
    try {
      parse = await parsePdf(bytes);
      verdict = parse.verdict;
      reasons = parse.reasons;
    } catch (error) {
      verdict = "REJECT";
      reasons = [classifyParserError(error)];
      parse = { verdict: "REJECT", error: reasons[0].detail };
    }
  }
  await finishProbes(isolation);
  emit({ ok: true, verdict, reasons, stage, inspection: { detected_mime: inspection.detected_mime, extension: inspection.extension, metrics: inspection.metrics }, parse, isolation, elapsed_ms: Date.now() - started });
};

main().catch((error) => {
  emit({ ok: false, error: `worker:${String(error?.name ?? "error").replace(/[^A-Za-z0-9]/g, "")}`, elapsed_ms: Date.now() - started });
  process.exit(4);
});
