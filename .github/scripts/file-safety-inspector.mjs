// ============================================================
// B-FILE-SAFETY: Parser 이전 파일 검사 (ADR 6.1·6.2, INP-003·INP-004·INP-005, SEC-FILE-002~004).
//
// 확장자·선언 MIME·검출 Magic Byte 를 대조하고 PDF 의 encrypted·active content·
// embedded file·polyglot·bomb·손상 구조를 Parser 를 부르기 전에 거부한다.
// 이 모듈은 파일 바이트만 읽고 network·환경변수·파일 시스템에 접근하지 않는다.
// 판정은 REJECT 이면 사유 코드를 모두 남기고, ACCEPT 이어도 계측값을 남긴다.
// 열거값(사유 코드·한도)을 바꾸면 file-safety-policy.mjs 와 docs/ops/file-safety-spike.md 를 같이 바꾼다.
// ============================================================
import { inflateSync } from "node:zlib";

export const LIMITS = Object.freeze({
  MAX_BYTES: 10 * 1024 * 1024, // INP-004·ADR 6.1: 10 MiB
  MAX_PAGES: 10, // INP-004·ADR 6.3: PDF 10쪽
  MAX_IMAGE_PIXELS: 25_000_000, // 이미지 한 장의 decode pixel 상한 (5,000×5,000)
  MAX_TOTAL_IMAGE_PIXELS: 100_000_000, // 문서 안 이미지 pixel 합계 상한
  MAX_DECODED_BYTES: 32 * 1024 * 1024, // FlateDecode 해제 합계 상한
  MAX_OBJECTS: 50_000, // 간접 객체 수 상한
  MAX_NESTING: 128, // 배열·사전 중첩 깊이 상한 (stream 밖)
  MAX_TRAILING_BYTES: 1024, // 마지막 %%EOF 뒤 허용 바이트
  EOCD_SEARCH_BYTES: 65_557, // ZIP end-of-central-directory 탐색 범위(주석 최대 64 KiB + 22)
});

export const REASON_CODES = Object.freeze([
  "empty", "too-large", "unknown-type", "foreign-signature", "type-mismatch", "extension-mismatch", "double-extension",
  "unsafe-filename", "zip-appended", "trailing-data", "polyglot-html", "encrypted", "active-content", "open-action",
  "embedded-file", "executable-payload", "page-limit", "pixel-limit", "decompression-bomb", "object-limit", "nesting-limit",
  "malformed", "malformed-xref", "no-pages", "malformed-png", "malformed-jpeg",
  // Parser 단계에서만 나오는 코드. 검사기는 만들지 않지만 같은 목록으로 관리한다.
  "parser-malformed", "parser-unavailable",
]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const startsWith = (bytes, text) => bytes.length >= text.length && bytes.toString("latin1", 0, text.length) === text;

export const ALLOWED_TYPES = Object.freeze({
  "application/pdf": Object.freeze({ extensions: Object.freeze(["pdf"]), detect: (b) => startsWith(b, "%PDF-") }),
  "image/png": Object.freeze({ extensions: Object.freeze(["png"]), detect: (b) => b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE) }),
  "image/jpeg": Object.freeze({ extensions: Object.freeze(["jpg", "jpeg"]), detect: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }),
});

const FOREIGN_SIGNATURES = [
  ["zip", (b) => startsWith(b, "PK\x03\x04") || startsWith(b, "PK\x05\x06") || startsWith(b, "PK\x07\x08")],
  ["gif", (b) => startsWith(b, "GIF8")],
  ["pe", (b) => startsWith(b, "MZ")],
  ["elf", (b) => startsWith(b, "\x7fELF")],
  ["macho", (b) => b.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe].includes(b.readUInt32BE(0))],
  ["ole", (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))],
  ["gzip", (b) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b],
  ["rar", (b) => startsWith(b, "Rar!")],
  ["7z", (b) => b.length >= 6 && b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))],
  ["script", (b) => startsWith(b, "#!")],
  ["bmp", (b) => startsWith(b, "BM")],
  ["tiff", (b) => startsWith(b, "II*\0") || startsWith(b, "MM\0*")],
  ["webp", (b) => startsWith(b, "RIFF") && b.length >= 12 && b.toString("latin1", 8, 12) === "WEBP"],
  ["utf16-bom", (b) => b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))],
  ["markup", (b) => /^\s*<(?:\?xml|!doctype|html|svg|script|body|head)/i.test(b.toString("latin1", 0, Math.min(b.length, 1024)))],
];

// 실행·스크립트·웹·압축 확장자는 어느 위치에 있어도 이름을 신뢰하지 않는다 (SEC-FILE-002).
const DANGEROUS_EXTENSIONS = new Set([
  "exe", "dll", "com", "scr", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "jar", "sh", "bash", "zsh",
  "py", "rb", "pl", "php", "phtml", "asp", "aspx", "jsp", "html", "htm", "xhtml", "svg", "xml", "zip", "rar", "7z", "gz", "tar", "iso",
  "img", "lnk", "hta", "app", "dmg", "pkg", "deb", "rpm", "apk", "chm", "reg", "inf", "cpl", "docm", "xlsm", "pptm",
]);
const DELIM = "(?=[\\s/\\[\\]<>(){}%]|$)";
const ACTIVE_TOKEN = new RegExp(`/(JavaScript|JS|Launch|SubmitForm|ImportData|RichMedia|XFA|AA|GoToR|GoToE|Movie|Sound|Rendition)${DELIM}`, "g");
const EMBEDDED_TOKEN = new RegExp(`/(EmbeddedFile|EmbeddedFiles|FileAttachment|EF)${DELIM}`, "g");
const ENCRYPT_TOKEN = new RegExp(`/Encrypt${DELIM}`);
const MAX_SCAN_TEXT = 8 * 1024 * 1024; // 정규식 탐색 상한 (해제 데이터는 앞부분만 훑는다; 합계 상한은 별도)

const pngCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = pngCrcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const decodeNameEscapes = (text) => text.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

// idx 를 감싸는 가장 안쪽 << >> 사전의 [start, end) 를 돌려준다. 없으면 null.
const enclosingDict = (text, idx) => {
  let depth = 0;
  let start = -1;
  for (let i = idx; i >= 1; i -= 1) {
    if (text[i] === ">" && text[i - 1] === ">") { depth += 1; i -= 1; continue; }
    if (text[i] === "<" && text[i - 1] === "<") {
      if (depth === 0) { start = i - 1; break; }
      depth -= 1; i -= 1;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    if (text[i] === "<" && text[i + 1] === "<") { depth += 1; i += 1; continue; }
    if (text[i] === ">" && text[i + 1] === ">") {
      depth -= 1; i += 1;
      if (depth === 0) return [start, i + 1];
    }
  }
  return null;
};

const findObjectBody = (text, number) => {
  const pattern = new RegExp(`(?:^|[^0-9])${number}\\s+0\\s+obj\\b`, "g");
  const match = pattern.exec(text);
  if (!match) return null;
  const start = match.index + match[0].length;
  const end = text.indexOf("endobj", start);
  return end < 0 ? text.slice(start) : text.slice(start, end);
};

// /OpenAction 은 문서 안 이동(GoTo·목적지 배열)만 허용한다. 간접 참조는 그 객체까지 본다.
const openActionAllowed = (text, afterIdx, depth = 0) => {
  const rest = text.slice(afterIdx, afterIdx + 400).replace(/^\s+/, "");
  if (rest.startsWith("[")) return true;
  if (rest.startsWith("<<")) {
    const dict = enclosingDict(text, afterIdx + (text.slice(afterIdx).search(/\S/)) + 1);
    const body = dict ? text.slice(dict[0], dict[1]) : rest;
    const kinds = [...body.matchAll(/\/S\s*\/([A-Za-z]+)/g)].map((m) => m[1]);
    return kinds.length > 0 && kinds.every((kind) => kind === "GoTo");
  }
  const ref = /^(\d+)\s+0\s+R/.exec(rest);
  if (ref && depth < 4) {
    const body = findObjectBody(text, Number(ref[1]));
    if (body === null) return false;
    const trimmed = body.replace(/^\s+/, "");
    if (trimmed.startsWith("[")) return true;
    const kinds = [...body.matchAll(/\/S\s*\/([A-Za-z]+)/g)].map((m) => m[1]);
    return kinds.length > 0 && kinds.every((kind) => kind === "GoTo");
  }
  return false;
};

const scanNesting = (text, regions) => {
  let depth = 0;
  let max = 0;
  let regionIdx = 0;
  for (let i = 0; i < text.length - 1; i += 1) {
    while (regionIdx < regions.length && regions[regionIdx][1] <= i) regionIdx += 1;
    if (regionIdx < regions.length && i >= regions[regionIdx][0]) { i = regions[regionIdx][1] - 1; continue; }
    const c = text[i];
    if (c === "<" && text[i + 1] === "<") { depth += 1; i += 1; } else if (c === ">" && text[i + 1] === ">") { depth -= 1; i += 1; } else if (c === "[") depth += 1; else if (c === "]") depth -= 1;
    if (depth > max) max = depth;
    if (max > LIMITS.MAX_NESTING) return max;
  }
  return max;
};

const analyzePdf = (bytes, reasons, metrics) => {
  const text = bytes.toString("latin1");
  const header = /^%PDF-(\d)\.(\d)/.exec(text);
  if (!header || !((header[1] === "1" && Number(header[2]) <= 7) || (header[1] === "2" && header[2] === "0"))) {
    reasons.push({ code: "malformed", detail: "pdf-version" });
  }
  if (/<(?:script|html|!doctype|svg|iframe|body)/i.test(text.slice(0, 1024))) reasons.push({ code: "polyglot-html" });
  const lastEof = text.lastIndexOf("%%EOF");
  if (lastEof < 0) {
    reasons.push({ code: "malformed", detail: "missing-eof" });
  } else {
    const tail = text.slice(lastEof + 5).replace(/[\r\n\t ]+$/, "");
    metrics.trailing_bytes = tail.length;
    if (tail.length > LIMITS.MAX_TRAILING_BYTES) reasons.push({ code: "trailing-data", detail: "after-eof" });
    if (/PK\x03\x04|PK\x05\x06/.test(tail)) reasons.push({ code: "zip-appended" });
  }
  const startxref = text.lastIndexOf("startxref");
  const offsetMatch = startxref >= 0 ? /^startxref\s+(\d+)/.exec(text.slice(startxref, startxref + 40)) : null;
  if (!offsetMatch) {
    reasons.push({ code: "malformed-xref", detail: "missing-startxref" });
  } else {
    const offset = Number(offsetMatch[1]);
    const at = offset < bytes.length ? text.slice(offset, offset + 40).replace(/^\s+/, "") : "";
    if (!/^xref/.test(at) && !/^\d+\s+\d+\s+obj\b/.test(at)) reasons.push({ code: "malformed-xref", detail: "startxref-target" });
  }
  const normalized = decodeNameEscapes(text);
  const objectCount = (normalized.match(/(?:^|[^0-9])\d+\s+\d+\s+obj\b/g) ?? []).length;
  metrics.object_count = objectCount;
  if (objectCount > LIMITS.MAX_OBJECTS) reasons.push({ code: "object-limit" });

  // stream 구간을 먼저 찾는다. 사전 텍스트는 직전 obj 부터 stream 키워드까지다.
  const regions = [];
  const streams = [];
  const streamPattern = /stream\r?\n/g;
  let m;
  while ((m = streamPattern.exec(normalized)) !== null) {
    if (m.index >= 3 && normalized.slice(m.index - 3, m.index) === "end") continue;
    const dataStart = m.index + m[0].length;
    const end = normalized.indexOf("endstream", dataStart);
    if (end < 0) { reasons.push({ code: "malformed", detail: "unterminated-stream" }); break; }
    const objPos = normalized.lastIndexOf(" obj", m.index);
    const dictText = normalized.slice(objPos < 0 ? 0 : objPos, m.index);
    regions.push([dataStart, end]);
    streams.push({ dataStart, dataEnd: end, dictText });
    streamPattern.lastIndex = end + 9;
  }
  metrics.stream_count = streams.length;
  metrics.nesting_depth = scanNesting(normalized, regions);
  if (metrics.nesting_depth > LIMITS.MAX_NESTING) reasons.push({ code: "nesting-limit" });

  const scanTexts = [normalized.slice(0, MAX_SCAN_TEXT)];
  let decodedTotal = 0;
  let maxRatio = 0;
  let totalPixels = 0;
  for (const stream of streams) {
    const filterMatch = /\/Filter\s*(\/[A-Za-z0-9]+|\[[^\]]*\])/.exec(stream.dictText);
    const filters = filterMatch ? [...filterMatch[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((f) => f[1]) : [];
    if (/\/Subtype\s*\/Image\b/.test(stream.dictText)) {
      const width = Number((/\/Width\s+(\d+)/.exec(stream.dictText) ?? [])[1] ?? 0);
      const height = Number((/\/Height\s+(\d+)/.exec(stream.dictText) ?? [])[1] ?? 0);
      const pixels = width * height;
      metrics.max_image_pixels = Math.max(metrics.max_image_pixels ?? 0, pixels);
      totalPixels += pixels;
      if (pixels > LIMITS.MAX_IMAGE_PIXELS) reasons.push({ code: "pixel-limit", detail: `image ${width}x${height}` });
    }
    let data = bytes.subarray(stream.dataStart, stream.dataEnd);
    if (data.length >= 2 && data[data.length - 1] === 0x0a) data = data.subarray(0, data[data.length - 2] === 0x0d ? data.length - 2 : data.length - 1);
    const encodedLength = data.length;
    for (const filter of filters) {
      if (filter !== "FlateDecode" && filter !== "Fl") break;
      try {
        data = inflateSync(data, { maxOutputLength: LIMITS.MAX_DECODED_BYTES - decodedTotal + 1 });
      } catch (error) {
        if (error?.code === "ERR_BUFFER_TOO_LARGE") {
          reasons.push({ code: "decompression-bomb", detail: "decoded-total" });
          decodedTotal = LIMITS.MAX_DECODED_BYTES + 1;
        } else {
          metrics.undecodable_streams = (metrics.undecodable_streams ?? 0) + 1;
        }
        data = null;
        break;
      }
      decodedTotal += data.length;
      if (decodedTotal > LIMITS.MAX_DECODED_BYTES) { reasons.push({ code: "decompression-bomb", detail: "decoded-total" }); data = null; break; }
    }
    if (data && filters.length > 0 && data.length !== encodedLength) {
      maxRatio = Math.max(maxRatio, data.length / Math.max(1, encodedLength));
      if (data.length >= 2 && (data.toString("latin1", 0, 2) === "MZ" || data.toString("latin1", 0, 4) === "\x7fELF")) reasons.push({ code: "executable-payload" });
      scanTexts.push(decodeNameEscapes(data.toString("latin1", 0, Math.min(data.length, MAX_SCAN_TEXT))));
    } else if (data && filters.length === 0 && data.length >= 4 && (data.toString("latin1", 0, 2) === "MZ" || data.toString("latin1", 0, 4) === "\x7fELF")) {
      reasons.push({ code: "executable-payload" });
    }
    if (decodedTotal > LIMITS.MAX_DECODED_BYTES) break;
  }
  metrics.decoded_bytes = Math.min(decodedTotal, LIMITS.MAX_DECODED_BYTES + 1);
  metrics.max_stream_ratio = Number(maxRatio.toFixed(1));
  metrics.total_image_pixels = totalPixels;
  if (totalPixels > LIMITS.MAX_TOTAL_IMAGE_PIXELS) reasons.push({ code: "pixel-limit", detail: "total" });

  let pageCount = null;
  const activeHits = new Set();
  const embeddedHits = new Set();
  for (const scan of scanTexts) {
    if (ENCRYPT_TOKEN.test(scan)) reasons.push({ code: "encrypted" });
    for (const hit of scan.matchAll(ACTIVE_TOKEN)) activeHits.add(hit[1]);
    for (const hit of scan.matchAll(EMBEDDED_TOKEN)) embeddedHits.add(hit[1]);
    const openPattern = new RegExp(`/OpenAction${DELIM}`, "g");
    for (const hit of scan.matchAll(openPattern)) {
      if (!openActionAllowed(scan, hit.index + "/OpenAction".length)) reasons.push({ code: "open-action" });
    }
    const pagesPattern = /\/Type\s*\/Pages(?=[\s/\[\]<>(){}%]|$)/g;
    for (const hit of scan.matchAll(pagesPattern)) {
      const dict = enclosingDict(scan, hit.index);
      const body = dict ? scan.slice(dict[0], dict[1]) : scan.slice(hit.index, hit.index + 300);
      const count = /\/Count\s+(-?\d+)/.exec(body);
      if (count) pageCount = Math.max(pageCount ?? Number.NEGATIVE_INFINITY, Number(count[1]));
    }
  }
  if (activeHits.size > 0) reasons.push({ code: "active-content", detail: [...activeHits].sort().join(",") });
  if (embeddedHits.size > 0) reasons.push({ code: "embedded-file", detail: [...embeddedHits].sort().join(",") });
  metrics.page_count = pageCount;
  if (pageCount === null) reasons.push({ code: "no-pages" });
  else if (pageCount < 1) reasons.push({ code: "malformed", detail: "page-count" });
  else if (pageCount > LIMITS.MAX_PAGES) reasons.push({ code: "page-limit", detail: String(pageCount) });
};

const analyzePng = (bytes, reasons, metrics) => {
  let pos = 8;
  let sawIhdr = false;
  let idatBytes = 0;
  let ended = false;
  while (pos + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    if (length > 0x7fffffff || pos + 12 + length > bytes.length) { reasons.push({ code: "malformed-png", detail: "truncated-chunk" }); return; }
    const crc = bytes.readUInt32BE(pos + 8 + length);
    if (crc !== crc32(bytes.subarray(pos + 4, pos + 8 + length))) { reasons.push({ code: "malformed-png", detail: `crc:${type}` }); return; }
    if (!sawIhdr) {
      if (type !== "IHDR" || length !== 13) { reasons.push({ code: "malformed-png", detail: "ihdr-first" }); return; }
      const width = bytes.readUInt32BE(pos + 8);
      const height = bytes.readUInt32BE(pos + 12);
      const bitDepth = bytes[pos + 16];
      const colorType = bytes[pos + 17];
      metrics.image_width = width;
      metrics.image_height = height;
      if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) { reasons.push({ code: "malformed-png", detail: "dimensions" }); return; }
      if (![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colorType)) { reasons.push({ code: "malformed-png", detail: "ihdr-fields" }); return; }
      metrics.max_image_pixels = width * height;
      if (width * height > LIMITS.MAX_IMAGE_PIXELS) reasons.push({ code: "pixel-limit", detail: `${width}x${height}` });
      sawIhdr = true;
    } else if (type === "IDAT") {
      idatBytes += length;
    } else if (type === "IEND") {
      ended = true;
      pos += 12 + length;
      break;
    }
    pos += 12 + length;
  }
  if (!sawIhdr || !ended) { reasons.push({ code: "malformed-png", detail: ended ? "ihdr-missing" : "iend-missing" }); return; }
  if (idatBytes === 0) reasons.push({ code: "malformed-png", detail: "idat-missing" });
  metrics.trailing_bytes = bytes.length - pos;
  if (bytes.length > pos) reasons.push({ code: "trailing-data", detail: "after-iend" });
};

const analyzeJpeg = (bytes, reasons, metrics) => {
  let pos = 2;
  let sawSof = false;
  let sawEoi = false;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) { reasons.push({ code: "malformed-jpeg", detail: "marker-expected" }); return; }
    while (pos < bytes.length && bytes[pos] === 0xff) pos += 1; // fill bytes
    if (pos >= bytes.length) { reasons.push({ code: "malformed-jpeg", detail: "truncated" }); return; }
    const marker = bytes[pos];
    pos += 1;
    if (marker === 0xd9) { sawEoi = true; break; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > bytes.length) { reasons.push({ code: "malformed-jpeg", detail: "truncated" }); return; }
    const length = bytes.readUInt16BE(pos);
    if (length < 2 || pos + length > bytes.length) { reasons.push({ code: "malformed-jpeg", detail: "segment-length" }); return; }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (length < 8) { reasons.push({ code: "malformed-jpeg", detail: "sof-length" }); return; }
      const height = bytes.readUInt16BE(pos + 3);
      const width = bytes.readUInt16BE(pos + 5);
      metrics.image_width = width;
      metrics.image_height = height;
      if (width === 0 || height === 0) { reasons.push({ code: "malformed-jpeg", detail: "dimensions" }); return; }
      metrics.max_image_pixels = width * height;
      if (width * height > LIMITS.MAX_IMAGE_PIXELS) reasons.push({ code: "pixel-limit", detail: `${width}x${height}` });
      sawSof = true;
    }
    pos += length;
    if (marker === 0xda) {
      // entropy-coded data: 0xFF 뒤에 0x00 또는 RSTn 이 아닌 marker 가 나올 때까지
      while (pos < bytes.length) {
        if (bytes[pos] === 0xff && pos + 1 < bytes.length && bytes[pos + 1] !== 0x00 && !(bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7) && bytes[pos + 1] !== 0xff) break;
        pos += 1;
      }
    }
  }
  if (!sawSof) reasons.push({ code: "malformed-jpeg", detail: "sof-missing" });
  if (!sawEoi) { reasons.push({ code: "malformed-jpeg", detail: "eoi-missing" }); return; }
  metrics.trailing_bytes = bytes.length - pos;
  if (bytes.length > pos) reasons.push({ code: "trailing-data", detail: "after-eoi" });
};

const checkFilename = (filename, detectedType, reasons) => {
  if (typeof filename !== "string" || filename.length === 0 || filename.length > 255 || /[\\/\0]/.test(filename) || filename.split(".").some((s) => s === "..") || filename.startsWith(".")) {
    reasons.push({ code: "unsafe-filename" });
    return null;
  }
  const segments = filename.toLowerCase().split(".");
  if (segments.length < 2 || segments[segments.length - 1] === "") { reasons.push({ code: "extension-mismatch", detail: "no-extension" }); return null; }
  const extension = segments[segments.length - 1];
  const inner = segments.slice(1, -1);
  const allowedAll = Object.values(ALLOWED_TYPES).flatMap((t) => t.extensions);
  if (inner.some((s) => DANGEROUS_EXTENSIONS.has(s) || allowedAll.includes(s))) reasons.push({ code: "double-extension", detail: inner.join(".") });
  if (detectedType && !ALLOWED_TYPES[detectedType].extensions.includes(extension)) reasons.push({ code: "extension-mismatch", detail: extension });
  return extension;
};

export const inspectFile = ({ bytes, declaredMime, filename }) => {
  const reasons = [];
  const metrics = {};
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  metrics.bytes = input.length;
  if (input.length === 0) reasons.push({ code: "empty" });
  if (input.length > LIMITS.MAX_BYTES) {
    reasons.push({ code: "too-large", detail: String(input.length) });
    return { verdict: "REJECT", reasons, detected_mime: null, declared_mime: declaredMime ?? null, extension: null, metrics };
  }
  const detectedType = Object.keys(ALLOWED_TYPES).find((type) => ALLOWED_TYPES[type].detect(input)) ?? null;
  const foreign = detectedType ? null : FOREIGN_SIGNATURES.find(([, test]) => input.length > 0 && test(input))?.[0] ?? null;
  if (!detectedType && input.length > 0) reasons.push({ code: "unknown-type" });
  if (foreign) reasons.push({ code: "foreign-signature", detail: foreign });
  if (detectedType && declaredMime !== detectedType) reasons.push({ code: "type-mismatch", detail: `${declaredMime ?? "none"}!=${detectedType}` });
  const extension = checkFilename(filename, detectedType, reasons);
  if (detectedType) {
    const tail = input.subarray(Math.max(0, input.length - LIMITS.EOCD_SEARCH_BYTES));
    if (tail.indexOf("PK\x05\x06", 0, "latin1") >= 0) reasons.push({ code: "zip-appended", detail: "eocd" });
    if (detectedType !== "application/pdf" && input.indexOf("PK\x03\x04", 0, "latin1") >= 0) reasons.push({ code: "zip-appended", detail: "local-header" });
    if (detectedType !== "application/pdf" && input.indexOf("%PDF-", 0, "latin1") >= 0) reasons.push({ code: "foreign-signature", detail: "pdf-inside-image" });
    if (detectedType === "application/pdf") analyzePdf(input, reasons, metrics);
    else if (detectedType === "image/png") analyzePng(input, reasons, metrics);
    else analyzeJpeg(input, reasons, metrics);
  }
  const seen = new Set();
  const unique = reasons.filter((r) => { const key = `${r.code}:${r.detail ?? ""}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return { verdict: unique.length === 0 ? "ACCEPT" : "REJECT", reasons: unique, detected_mime: detectedType, declared_mime: declaredMime ?? null, extension, metrics };
};
