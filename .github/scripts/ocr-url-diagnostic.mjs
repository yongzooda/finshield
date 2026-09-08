import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fieldValues, linesFromBoxes } from "./ocr-quality-text.mjs";

export const MODE = "DEVELOPMENT_DIAGNOSTIC";
export const FIXTURE_ID = "refinance-scanned";
export const FIXTURE_SHA256 = "718307af79cbf15a6bc49bafcba9790efb05a16ed5e457d392f08fd960f29472";
const FIXTURE_ROOT = ".github/fixtures/ocr-quality-v1";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const error = code => { throw new Error(code); };

export function loadFixture(repository = process.cwd()) {
  const manifest = JSON.parse(readFileSync(resolve(repository, FIXTURE_ROOT, "manifest.json"), "utf8"));
  const fixture = manifest.fixtures?.find(item => item.id === FIXTURE_ID);
  if (manifest.version !== "ocr-quality-v1" || manifest.synthetic_only !== true || !fixture
    || fixture.kind !== "scanned" || fixture.path !== `${FIXTURE_ID}.pdf`
    || fixture.sha256 !== FIXTURE_SHA256 || fixture.pages?.length !== 10) error("FIXTURE_INVALID");
  const bytes = readFileSync(resolve(repository, FIXTURE_ROOT, fixture.path));
  if (bytes.length !== fixture.bytes || sha256(bytes) !== FIXTURE_SHA256 || bytes.length > 10 * 1024 * 1024) error("FIXTURE_HASH_INVALID");
  const expectedUrls = fixture.pages.map(page => page.fields?.url);
  if (expectedUrls.some(value => value !== "https://refinance.example/loan")) error("FIXTURE_TRUTH_INVALID");
  return { ...fixture, bytes, expectedUrls };
}

const safeSyntheticText = value => {
  const text = String(value ?? "").normalize("NFC").trim();
  if (text.length > 160 || /[\r\n@?#%]/u.test(text) || !/^(?:주소\s*[:：]?\s*)?[\x20-\x7e]+$/u.test(text)) return null;
  return text;
};

const rowBoxes = boxes => {
  const rows = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find(item => Math.abs(item.y - box.y) <= Math.max(2, Math.min(item.height, box.height) * 0.55));
    if (!row) { row = { y: box.y, height: box.height, boxes: [] }; rows.push(row); }
    row.boxes.push(box);
  }
  return rows.sort((a, b) => a.y - b.y).map(row => ({ ...row, boxes: row.boxes.sort((a, b) => a.x - b.x) }));
};

const firstMismatch = (expected, actual) => {
  const limit = Math.max(expected.length, actual.length);
  for (let index = 0; index < limit; index++) {
    if (expected[index] !== actual[index]) return {
      index,
      expected_code_point: expected[index]?.codePointAt(0) ?? null,
      actual_code_point: actual[index]?.codePointAt(0) ?? null,
    };
  }
  return null;
};

export function summarizeResponse(raw, requestId, fixture) {
  if (raw?.version !== "V2" || raw.requestId !== requestId || !Array.isArray(raw.images)
    || raw.images.length !== fixture.pages.length) error("OCR_RESPONSE_INVALID");
  const pages = Array(fixture.pages.length).fill(null);
  for (const image of raw.images) {
    const pageIndex = image.convertedImageInfo?.pageIndex;
    if (image.inferResult !== "SUCCESS" || !Number.isInteger(pageIndex) || pageIndex < 0
      || pageIndex >= pages.length || pages[pageIndex] !== null || !Array.isArray(image.fields)
      || image.fields.length === 0 || image.fields.length > 15000) error("OCR_PAGE_INVALID");
    const boxes = image.fields.map(field => {
      const vertices = field.boundingPoly?.vertices;
      if (typeof field.inferText !== "string" || !field.inferText || field.inferText.length > 12000
        || vertices?.length !== 4 || vertices.some(vertex => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y))) error("OCR_FIELD_INVALID");
      const xs = vertices.map(vertex => vertex.x), ys = vertices.map(vertex => vertex.y);
      return {
        text: field.inferText,
        x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
        confidence: Number.isFinite(field.inferConfidence) ? field.inferConfidence : null,
      };
    });
    const lines = linesFromBoxes(boxes);
    const extracted = fieldValues(lines).find(field => field.type === "url")?.value ?? null;
    const addressRow = rowBoxes(boxes).find(row => row.boxes.some(box => /^주소\s*[:：]?\s*$/u.test(box.text.trim()))
      || /^주소\s*[:：]/u.test(row.boxes.map(box => box.text).join(" ").trim()));
    const rawLine = addressRow?.boxes.map(box => box.text).join(" ") ?? "";
    const safeLine = safeSyntheticText(rawLine);
    const candidate = safeLine?.replace(/^주소\s*[:：]?\s*/u, "").replace(/\s+/gu, "") ?? null;
    const expected = fixture.expectedUrls[pageIndex];
    const safeExtracted = extracted === null ? null : safeSyntheticText(extracted)?.replace(/\s+/gu, "") ?? null;
    const confidences = addressRow?.boxes.map(box => box.confidence).filter(Number.isFinite) ?? [];
    pages[pageIndex] = {
      page_index: pageIndex,
      address_row_found: Boolean(addressRow),
      address_line: safeLine,
      recognition_value: candidate,
      extractor_value: safeExtracted,
      expected_value: expected,
      recognition_exact: candidate === expected,
      extractor_exact: safeExtracted === expected,
      first_mismatch: candidate === null ? null : firstMismatch(expected, candidate),
      actual_length: candidate?.length ?? null,
      expected_length: expected.length,
      row_token_count: addressRow?.boxes.length ?? 0,
      minimum_confidence_milli: confidences.length ? Math.round(Math.min(...confidences) * 1000) : null,
    };
  }
  if (pages.some(page => page === null)) error("OCR_PAGE_ORDER_INVALID");
  return {
    pages,
    summary: {
      pages: pages.length,
      address_rows_found: pages.filter(page => page.address_row_found).length,
      recognition_exact: pages.filter(page => page.recognition_exact).length,
      extractor_exact: pages.filter(page => page.extractor_exact).length,
    },
  };
}

export async function callOcr(fixture, { endpoint, secret, requestId = randomUUID(), fetchImpl = fetch }) {
  let url;
  try { url = new URL(endpoint); } catch { error("OCR_CONFIG_INVALID"); }
  if (!secret || url.protocol !== "https:" || !url.hostname.endsWith(".apigw.ntruss.com")
    || !url.pathname.endsWith("/general") || url.username || url.password || url.search || url.hash) error("OCR_CONFIG_INVALID");
  const response = await fetchImpl(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(35_000),
    headers: { "Content-Type": "application/json", "X-OCR-SECRET": secret },
    body: JSON.stringify({
      version: "V2", requestId, timestamp: Date.now(), lang: "ko", enableTableDetection: false,
      images: [{ format: "pdf", name: fixture.id, data: fixture.bytes.toString("base64") }],
    }),
  });
  if (!response.ok || !response.body) error(response.status === 429 ? "OCR_RATE_LIMITED"
    : response.status === 401 || response.status === 403 ? "OCR_AUTH_FAILED" : "OCR_HTTP_FAILED");
  const chunks = []; let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) error("OCR_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  let raw;
  try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { error("OCR_JSON_INVALID"); }
  return summarizeResponse(raw, requestId, fixture);
}

const safeCodes = new Set(["FIXTURE_INVALID", "FIXTURE_HASH_INVALID", "FIXTURE_TRUTH_INVALID", "OCR_CONFIG_INVALID",
  "OCR_AUTH_FAILED", "OCR_RATE_LIMITED", "OCR_HTTP_FAILED", "OCR_RESPONSE_TOO_LARGE", "OCR_RESPONSE_INVALID",
  "OCR_PAGE_INVALID", "OCR_FIELD_INVALID", "OCR_PAGE_ORDER_INVALID", "OCR_JSON_INVALID"]);
export const safeFailure = cause => cause?.name === "TimeoutError" || cause?.name === "AbortError"
  ? "OCR_TIMEOUT" : safeCodes.has(cause?.message) ? cause.message : "OCR_TRANSPORT_UNKNOWN";

async function main() {
  if (process.env.GITHUB_REF !== "refs/heads/main" || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")) error("MAIN_ONLY");
  const fixture = loadFixture(process.env.TRUSTED_REPOSITORY);
  const started = Date.now();
  const output = {
    mode: MODE, gate_evidence: false, synthetic_only: true,
    revision: process.env.GITHUB_SHA, measured_at: new Date().toISOString(),
    fixture_version: "ocr-quality-v1", fixture_id: fixture.id, fixture_sha256: fixture.sha256,
    provider_options: { format: "pdf", lang: "ko", table_detection: false, retry: false },
    request_count: 1, status: "FAILED", error_code: null, elapsed_ms: 0, pages: [], summary: null,
  };
  try {
    Object.assign(output, await callOcr(fixture, {
      endpoint: process.env.CLOVA_OCR_INVOKE_URL,
      secret: process.env.CLOVA_OCR_SECRET,
    }), { status: "RESPONSE_VALID" });
  } catch (cause) { output.error_code = safeFailure(cause); }
  output.elapsed_ms = Date.now() - started;
  const path = resolve(process.env.PROBE_OUTPUT_PATH ?? "probe-output/ocr-url-diagnostic.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ mode: output.mode, status: output.status, error_code: output.error_code,
    elapsed_ms: output.elapsed_ms, summary: output.summary }));
  if (output.status !== "RESPONSE_VALID") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(cause => { console.error(safeFailure(cause)); process.exitCode = 1; });
}
