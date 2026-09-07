import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const fixtureRoot = fileURLToPath(new URL("../fixtures/ocr-development/", import.meta.url));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const compact = value => value.normalize("NFC").replace(/\s+/gu, "");
const error = code => { throw new Error(code); };

export function loadFixtures() {
  const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8"));
  if (manifest.version !== "ocr-development-v1" || manifest.synthetic_only !== true || manifest.gate_evidence !== false || manifest.fixtures.length !== 3) error("FIXTURE_INVALID");
  return manifest.fixtures.map(fixture => {
    if (!["digital.pdf", "image.png", "scanned-10.pdf"].includes(fixture.path)) error("FIXTURE_PATH_INVALID");
    const bytes = readFileSync(resolve(fixtureRoot, fixture.path));
    if (bytes.length !== fixture.bytes || sha256(bytes) !== fixture.sha256 || bytes.length > 10485760) error("FIXTURE_HASH_INVALID");
    return { ...fixture, bytes };
  });
}

// 원문·좌표·응답 ID를 기록하지 않고 사전 고정한 합성 앵커와 페이지 계약만 진단한다.
export function summarizeResponse(raw, requestId, fixture) {
  if (raw?.version !== "V2" || raw?.requestId !== requestId || !Array.isArray(raw.images) || raw.images.length !== fixture.pages.length) error("OCR_RESPONSE_INVALID");
  const pages = raw.images.map(image => {
    const pageIndex = fixture.format === "pdf" ? image.convertedImageInfo?.pageIndex : 0;
    if (image.inferResult !== "SUCCESS" || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= fixture.pages.length) error("OCR_PAGE_INVALID");
    if (!Array.isArray(image.fields) || !image.fields.length || image.fields.length > 15000) error("OCR_FIELDS_INVALID");
    for (const field of image.fields) {
      if (typeof field.inferText !== "string" || !field.inferText || field.inferText.length > 12000 || field.boundingPoly?.vertices?.length !== 4 || field.boundingPoly.vertices.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y))) error("OCR_FIELD_INVALID");
    }
    const text = compact(image.fields.map(field => field.inferText).join(" "));
    const anchors = fixture.pages[pageIndex].map((anchor, index) => ({ index, exact: text.includes(compact(anchor)) }));
    return { page_index: pageIndex, field_count: image.fields.length, anchors, exact: anchors.every(anchor => anchor.exact) };
  }).sort((a, b) => a.page_index - b.page_index);
  if (pages.some((page, index) => page.page_index !== index)) error("OCR_PAGE_ORDER_INVALID");
  return { pages, all_anchors_exact: pages.every(page => page.exact) };
}

export async function callOcr(fixture, { endpoint, secret, fetchImpl = fetch, requestId = randomUUID() }) {
  let url;
  try { url = new URL(endpoint); } catch { error("OCR_CONFIG_INVALID"); }
  if (!secret || url.protocol !== "https:" || !url.hostname.endsWith(".apigw.ntruss.com") || !url.pathname.endsWith("/general") || url.username || url.password || url.search || url.hash) error("OCR_CONFIG_INVALID");
  const response = await fetchImpl(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(25000),
    headers: { "Content-Type": "application/json", "X-OCR-SECRET": secret },
    body: JSON.stringify({ version: "V2", requestId, timestamp: Date.now(), lang: "ko", enableTableDetection: false,
      images: [{ format: fixture.format, name: fixture.id, data: fixture.bytes.toString("base64") }] }),
  });
  if (!response.ok || !response.body) error(response.status === 429 ? "OCR_RATE_LIMITED" : response.status === 401 || response.status === 403 ? "OCR_AUTH_FAILED" : "OCR_HTTP_FAILED");
  const chunks = []; let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 4 * 1024 * 1024) error("OCR_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  let raw;
  try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { error("OCR_JSON_INVALID"); }
  return summarizeResponse(raw, requestId, fixture);
}

const safeCodes = new Set(["OCR_CONFIG_INVALID", "OCR_AUTH_FAILED", "OCR_RATE_LIMITED", "OCR_HTTP_FAILED", "OCR_RESPONSE_TOO_LARGE", "OCR_RESPONSE_INVALID", "OCR_PAGE_INVALID", "OCR_FIELDS_INVALID", "OCR_FIELD_INVALID", "OCR_PAGE_ORDER_INVALID", "OCR_JSON_INVALID"]);
export function safeFailure(cause) {
  return cause?.name === "TimeoutError" || cause?.name === "AbortError" ? "OCR_TIMEOUT" : safeCodes.has(cause?.message) ? cause.message : "OCR_TRANSPORT_UNKNOWN";
}

async function main() {
  if (process.env.GITHUB_REF !== "refs/heads/main" || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")) error("MAIN_ONLY");
  const fixtures = loadFixtures();
  const output = { mode: "DEVELOPMENT_DIAGNOSTIC", gate_evidence: false, synthetic_only: true,
    revision: process.env.GITHUB_SHA, measured_at: new Date().toISOString(), fixture_version: "ocr-development-v1", table_detection: false, cases: [] };
  for (const fixture of fixtures) {
    const started = Date.now();
    const record = { id: fixture.id, fixture_sha256: fixture.sha256, requested_pages: fixture.pages.length };
    try {
      Object.assign(record, { status: "RESPONSE_VALID" }, await callOcr(fixture, { endpoint: process.env.CLOVA_OCR_INVOKE_URL, secret: process.env.CLOVA_OCR_SECRET }));
    } catch (cause) { Object.assign(record, { status: "FAILED", error_code: safeFailure(cause) }); }
    record.elapsed_ms = Date.now() - started;
    output.cases.push(record);
    // 이전 요청 완료 뒤 1초를 추가로 기다린다. retry나 병렬 호출은 없다.
    await delay(1100);
  }
  const path = resolve(process.env.PROBE_OUTPUT_PATH ?? "probe-output/ocr-development.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify({ mode: output.mode, cases: output.cases.map(({ id, status, elapsed_ms, all_anchors_exact, error_code }) => ({ id, status, elapsed_ms, all_anchors_exact, error_code })) }));
  if (output.cases.some(item => item.status !== "RESPONSE_VALID" || !item.all_anchors_exact)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("OCR_DEVELOPMENT_PROBE_ABORTED"); process.exitCode = 1; });
}
