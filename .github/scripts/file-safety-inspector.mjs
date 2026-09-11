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
// 두 글자 key(/JS·/AA·/EF)는 압축 바이트·그림 화소 같은 임의 바이트에서도 우연히 나온다.
// 실제 PDF 에서 이 key 가 뜻을 가지려면 값이 이어져야 하므로 값의 시작까지 함께 본다.
// /JS 는 문자열·hex 문자열·간접 참조, /AA·/EF 는 사전·간접 참조만 값이 될 수 있다.
// key 와 값 사이의 공백·주석은 Parser 처럼 건너뛴다.
const GAP = "(?:\\s|%[^\\r\\n]*(?:\\r\\n|\\r|\\n))*";
const REF = "\\d+\\s+\\d+\\s+R";
const ACTIVE_TOKEN = new RegExp(`/(JavaScript|Launch|SubmitForm|ImportData|RichMedia|XFA|GoToR|GoToE|Movie|Sound|Rendition)${DELIM}|/(JS)(?=${GAP}(?:\\(|<|${REF}))|/(AA)(?=${GAP}(?:<<|${REF}))`, "g");
const EMBEDDED_TOKEN = new RegExp(`/(EmbeddedFile|EmbeddedFiles|FileAttachment)${DELIM}|/(EF)(?=${GAP}(?:<<|${REF}))`, "g");
// 그림 전용 부호. 이 stream 은 어떤 Parser 도 PDF 문법으로 읽지 않으므로 원시 바이트를 훑지 않는다.
const IMAGE_ONLY_FILTERS = new Set(["DCTDecode", "DCT", "JPXDecode", "CCITTFaxDecode", "CCF", "JBIG2Decode"]);
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
  const objectCount = (text.match(/(?:^|[^0-9])\d+\s+\d+\s+obj\b/g) ?? []).length;
  metrics.object_count = objectCount;
  if (objectCount > LIMITS.MAX_OBJECTS) reasons.push({ code: "object-limit" });

  // stream 구간을 원시 바이트 위치로 찾는다. 이름의 #xx 풀기는 길이를 바꾸므로 위치 계산 뒤에만 쓴다.
  // 사전 텍스트는 직전 obj 부터 stream 키워드까지다.
  const regions = [];
  const streams = [];
  const streamPattern = /stream\r?\n/g;
  let m;
  while ((m = streamPattern.exec(text)) !== null) {
    if (m.index >= 3 && text.slice(m.index - 3, m.index) === "end") continue;
    const dataStart = m.index + m[0].length;
    const end = text.indexOf("endstream", dataStart);
    if (end < 0) { reasons.push({ code: "malformed", detail: "unterminated-stream" }); break; }
    const objPos = text.lastIndexOf(" obj", m.index);
    const dictText = decodeNameEscapes(text.slice(objPos < 0 ? 0 : objPos, m.index));
    regions.push([dataStart, end]);
    streams.push({ dataStart, dataEnd: end, dictText });
    streamPattern.lastIndex = end + 9;
  }
  metrics.stream_count = streams.length;
  metrics.nesting_depth = scanNesting(text, regions);
  if (metrics.nesting_depth > LIMITS.MAX_NESTING) reasons.push({ code: "nesting-limit" });

  // 풀어서 따로 훑는 stream 과 그림 전용 stream 의 원시 바이트는 첫 탐색 본문에서 공백으로 지운다.
  // 압축된 바이트는 어떤 Parser 도 PDF 문법으로 읽지 않는다. 풀지 못한 stream 은 그대로 훑는다.
  const blanked = [];
  const scanTexts = [];
  let decodedTotal = 0;
  let maxRatio = 0;
  let totalPixels = 0;
  for (const stream of streams) {
    const filterMatch = /\/Filter\s*(\/[A-Za-z0-9]+|\[[^\]]*\])/.exec(stream.dictText);
    const filters = filterMatch ? [...filterMatch[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((f) => f[1]) : [];
    if (filters.length > 0 && IMAGE_ONLY_FILTERS.has(filters[0])) blanked.push([stream.dataStart, stream.dataEnd]);
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
    let inflated = 0;
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
      inflated += 1;
      decodedTotal += data.length;
      if (decodedTotal > LIMITS.MAX_DECODED_BYTES) { reasons.push({ code: "decompression-bomb", detail: "decoded-total" }); data = null; break; }
    }
    if (data && inflated > 0) {
      if (data.length !== encodedLength) maxRatio = Math.max(maxRatio, data.length / Math.max(1, encodedLength));
      if (data.length >= 2 && (data.toString("latin1", 0, 2) === "MZ" || data.toString("latin1", 0, 4) === "\x7fELF")) reasons.push({ code: "executable-payload" });
      scanTexts.push(decodeNameEscapes(data.toString("latin1", 0, Math.min(data.length, MAX_SCAN_TEXT))));
      if (!IMAGE_ONLY_FILTERS.has(filters[0])) blanked.push([stream.dataStart, stream.dataEnd]);
    } else if (data && filters.length === 0 && data.length >= 4 && (data.toString("latin1", 0, 2) === "MZ" || data.toString("latin1", 0, 4) === "\x7fELF")) {
      reasons.push({ code: "executable-payload" });
    }
    if (decodedTotal > LIMITS.MAX_DECODED_BYTES) break;
  }
  // 첫 탐색 본문: stream 밖의 문법과 풀지 못한 stream 원문. 위치를 지키려고 길이는 그대로 둔다.
  let cursor = 0;
  const pieces = [];
  for (const [start, end] of blanked) {
    if (start < cursor) continue;
    pieces.push(text.slice(cursor, start), " ".repeat(end - start));
    cursor = end;
  }
  pieces.push(text.slice(cursor));
  scanTexts.unshift(decodeNameEscapes(pieces.join("").slice(0, MAX_SCAN_TEXT)));
  metrics.decoded_bytes = Math.min(decodedTotal, LIMITS.MAX_DECODED_BYTES + 1);
  metrics.max_stream_ratio = Number(maxRatio.toFixed(1));
  metrics.total_image_pixels = totalPixels;
  if (totalPixels > LIMITS.MAX_TOTAL_IMAGE_PIXELS) reasons.push({ code: "pixel-limit", detail: "total" });

  let pageCount = null;
  const activeHits = new Set();
  const embeddedHits = new Set();
  for (const scan of scanTexts) {
    if (ENCRYPT_TOKEN.test(scan)) reasons.push({ code: "encrypted" });
    for (const hit of scan.matchAll(ACTIVE_TOKEN)) activeHits.add(hit[1] ?? hit[2] ?? hit[3]);
    for (const hit of scan.matchAll(EMBEDDED_TOKEN)) embeddedHits.add(hit[1] ?? hit[2]);
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
  if (bytes.length > pos && !acceptTrailer(bytes, pos, pos, reasons, metrics)) reasons.push({ code: "trailing-data", detail: "after-iend" });
};

// ---------- 휴대폰 사진 끝의 제조사 정보 ----------
// 휴대폰 카메라는 그림 끝(EOI·IEND) 뒤에 정해진 구조를 붙인다. 구조가 정확히 맞을 때만 받아들이고
// 조금이라도 어긋나거나 설명하지 못하는 바이트가 남으면 지금처럼 trailing-data 로 거부한다.
//   - Samsung 확장 정보(SEFT): 파일 마지막 8바이트가 SEFH 디렉터리 길이(LE)와 "SEFT" 다.
//     디렉터리의 항목마다 (0·type, 디렉터리 시작에서 거꾸로 센 거리, 블록 크기)가 있고,
//     블록은 항목과 같은 머리 4바이트·이름 길이·이름·자료로 이뤄진다(ExifTool Samsung.pm 과 같은 해석).
//   - Multi-Picture Format(MPF, CIPA DC-007): 첫 그림의 APP2 "MPF\0" 가 보조 그림(HDR gain map 등)의
//     크기와 위치를 적는다. 보조 그림은 첫 그림 바로 뒤에 빈틈 없이 이어진 온전한 JPEG 여야 한다.
const MAX_SEFT_ENTRIES = 64;
const TRAILER_MARKUP = /<(?:script|html|!doctype|iframe|body|\?php)/i;

const parseSamsungTrailer = (bytes, from) => {
  const end = bytes.length;
  if (end - from < 20 || bytes.toString("latin1", end - 4, end) !== "SEFT") return null;
  const dirLength = bytes.readUInt32LE(end - 8);
  const dirPos = end - 8 - dirLength;
  if (dirLength < 24 || dirPos < from || bytes.toString("latin1", dirPos, dirPos + 4) !== "SEFH") return null;
  const count = bytes.readUInt32LE(dirPos + 8);
  if (count < 1 || count > MAX_SEFT_ENTRIES || 12 + 12 * count > dirLength) return null;
  const blocks = [];
  for (let i = 0; i < count; i += 1) {
    const entry = dirPos + 12 + 12 * i;
    const distance = bytes.readUInt32LE(entry + 4);
    const size = bytes.readUInt32LE(entry + 8);
    if (bytes.readUInt16LE(entry) !== 0 || distance > dirPos - from || size < 8 || size > distance) return null;
    const start = dirPos - distance;
    if (!bytes.subarray(start, start + 4).equals(bytes.subarray(entry, entry + 4))) return null;
    const nameLength = bytes.readUInt32LE(start + 4);
    if (nameLength < 1 || nameLength > 128 || 8 + nameLength > size) return null;
    if (!/^[A-Za-z0-9_.-]+$/.test(bytes.toString("latin1", start + 8, start + 8 + nameLength))) return null;
    blocks.push({ start, end: start + size, data: start + 8 + nameLength });
  }
  blocks.sort((a, b) => a.start - b.start);
  // 블록은 겹치지 않고 빈틈 없이 이어져 SEFH 바로 앞에서 끝나야 한다.
  for (let i = 1; i < blocks.length; i += 1) if (blocks[i].start !== blocks[i - 1].end) return null;
  if (blocks[blocks.length - 1].end !== dirPos) return null;
  return { start: blocks[0].start, blocks };
};

const readMpfEntries = (bytes, mpf) => {
  const view = bytes.subarray(mpf.base, mpf.end);
  if (view.length < 8) return null;
  const order = view.toString("latin1", 0, 2);
  const le = order === "II";
  if (!le && order !== "MM") return null;
  const u16 = (at) => (le ? view.readUInt16LE(at) : view.readUInt16BE(at));
  const u32 = (at) => (le ? view.readUInt32LE(at) : view.readUInt32BE(at));
  if (u16(2) !== 0x2a) return null;
  const ifd = u32(4);
  if (ifd + 2 > view.length) return null;
  const count = u16(ifd);
  if (count > 64 || ifd + 2 + count * 12 > view.length) return null;
  let images = null;
  let entryAt = null;
  let entryBytes = 0;
  for (let i = 0; i < count; i += 1) {
    const at = ifd + 2 + i * 12;
    const tag = u16(at);
    const type = u16(at + 2);
    const n = u32(at + 4);
    if (tag === 0xb001 && type === 4 && n === 1) images = u32(at + 8);
    if (tag === 0xb002 && type === 7) { entryBytes = n; entryAt = n <= 4 ? at + 8 : u32(at + 8); }
  }
  if (!images || images < 2 || images > 16 || entryAt === null || entryBytes !== images * 16 || entryAt + entryBytes > view.length) return null;
  return Array.from({ length: images }, (_, i) => ({ size: u32(entryAt + i * 16 + 4), offset: u32(entryAt + i * 16 + 8) }));
};

// from 부터 파일 끝까지를 받아들일 수 있는 구조로 모두 설명하면 true. 설명에 쓴 보조 그림의
// 화소 한도 위반은 reasons 에 남긴다.
const acceptTrailer = (bytes, from, primaryEnd, reasons, metrics, mpf = null) => {
  let cursor = from;
  const kinds = [];
  if (mpf) {
    const entries = readMpfEntries(bytes, mpf);
    if (entries) {
      const secondary = entries.slice(1).map((e) => ({ start: mpf.base + e.offset, size: e.size })).sort((a, b) => a.start - b.start);
      let next = cursor;
      const limitReasons = [];
      const covered = secondary.every((image) => {
        if (image.start !== next || image.size < 4 || image.start + image.size > bytes.length) return false;
        const sub = bytes.subarray(image.start, image.start + image.size);
        const subReasons = [];
        const walked = walkJpeg(sub, subReasons, metrics, false);
        if (!walked || walked.end !== sub.length || subReasons.some((r) => r.code !== "pixel-limit")) return false;
        limitReasons.push(...subReasons);
        next = image.start + image.size;
        return true;
      });
      if (covered) { cursor = next; kinds.push("mpf"); reasons.push(...limitReasons); }
    }
  }
  if (cursor < bytes.length) {
    const samsung = parseSamsungTrailer(bytes, cursor);
    if (!samsung || samsung.start !== cursor) return false;
    for (const block of samsung.blocks) {
      if (bytes.toString("latin1", block.data, block.data + 2) === "MZ" || bytes.toString("latin1", block.data, block.data + 4) === "\x7fELF") {
        reasons.push({ code: "executable-payload", detail: "trailer" });
      }
    }
    kinds.push("samsung");
  }
  // 받아들인 구조 안에도 웹 문서 조각이 있으면 polyglot 으로 거부한다.
  if (TRAILER_MARKUP.test(bytes.toString("latin1", primaryEnd))) reasons.push({ code: "polyglot-html", detail: "trailer" });
  metrics.trailer_kinds = kinds;
  return true;
};

// JPEG 한 장의 marker 를 따라가 EOI 다음 위치와 APP2 MPF 위치를 돌려준다. 구조가 깨지면 null.
// primary 가 아니면(보조 그림) 가로·세로 계측값을 덮지 않고 화소 한도만 확인한다.
const walkJpeg = (bytes, reasons, metrics, primary) => {
  let pos = 2;
  let sawSof = false;
  let sawEoi = false;
  let mpf = null;
  if (!primary && !(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    reasons.push({ code: "malformed-jpeg", detail: "soi-missing" });
    return null;
  }
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) { reasons.push({ code: "malformed-jpeg", detail: "marker-expected" }); return null; }
    while (pos < bytes.length && bytes[pos] === 0xff) pos += 1; // fill bytes
    if (pos >= bytes.length) { reasons.push({ code: "malformed-jpeg", detail: "truncated" }); return null; }
    const marker = bytes[pos];
    pos += 1;
    if (marker === 0xd9) { sawEoi = true; break; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > bytes.length) { reasons.push({ code: "malformed-jpeg", detail: "truncated" }); return null; }
    const length = bytes.readUInt16BE(pos);
    if (length < 2 || pos + length > bytes.length) { reasons.push({ code: "malformed-jpeg", detail: "segment-length" }); return null; }
    if (marker === 0xe2 && primary && mpf === null && length >= 10 && bytes.toString("latin1", pos + 2, pos + 6) === "MPF\0") {
      mpf = { base: pos + 6, end: pos + length };
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (length < 8) { reasons.push({ code: "malformed-jpeg", detail: "sof-length" }); return null; }
      const height = bytes.readUInt16BE(pos + 3);
      const width = bytes.readUInt16BE(pos + 5);
      if (primary) { metrics.image_width = width; metrics.image_height = height; }
      if (width === 0 || height === 0) { reasons.push({ code: "malformed-jpeg", detail: "dimensions" }); return null; }
      metrics.max_image_pixels = Math.max(primary ? 0 : metrics.max_image_pixels ?? 0, width * height);
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
  if (!sawEoi) { reasons.push({ code: "malformed-jpeg", detail: "eoi-missing" }); return null; }
  return { end: pos, mpf };
};

const analyzeJpeg = (bytes, reasons, metrics) => {
  const walked = walkJpeg(bytes, reasons, metrics, true);
  if (!walked) return;
  metrics.trailing_bytes = bytes.length - walked.end;
  if (bytes.length > walked.end && !acceptTrailer(bytes, walked.end, walked.end, reasons, metrics, walked.mpf)) {
    reasons.push({ code: "trailing-data", detail: "after-eoi" });
  }
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
