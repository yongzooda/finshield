import assert from "node:assert/strict";
import { callOcr, loadFixture, safeFailure, summarizeResponse } from "./ocr-url-diagnostic.mjs";

const fixture = loadFixture();
assert.equal(fixture.pages.length, 10);
const requestId = "synthetic-request";
const vertices = (x, y, width = 40) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + 10 }, { x, y: y + 10 }];
const response = actualAt => ({
  version: "V2", requestId,
  images: fixture.pages.map((_page, pageIndex) => ({
    inferResult: "SUCCESS", convertedImageInfo: { pageIndex },
    fields: [
      { inferText: "주소:", inferConfidence: 0.99, boundingPoly: { vertices: vertices(10, 100) } },
      { inferText: actualAt(pageIndex), inferConfidence: 0.91, boundingPoly: { vertices: vertices(60, 100, 220) } },
      { inferText: "연 금리:", inferConfidence: 0.98, boundingPoly: { vertices: vertices(10, 130) } },
      { inferText: "3.4%", inferConfidence: 0.98, boundingPoly: { vertices: vertices(60, 130) } },
    ],
  })),
});

let checks = 0;
const exact = summarizeResponse(response(() => "https://refinance.example/loan"), requestId, fixture);
assert.deepEqual(exact.summary, { pages: 10, address_rows_found: 10, recognition_exact: 10, extractor_exact: 10 }); checks++;
const confused = summarizeResponse(response(index => index === 2 ? "https://refinance.examp1e/loan" : "https://refinance.example/loan"), requestId, fixture);
assert.equal(confused.summary.recognition_exact, 9);
assert.deepEqual(confused.pages[2].first_mismatch, { index: 23, expected_code_point: 108, actual_code_point: 49 });
assert.equal(confused.pages[2].minimum_confidence_milli, 910); checks++;
const unsafe = summarizeResponse(response(index => index === 1 ? "secret@example.com" : "https://refinance.example/loan"), requestId, fixture);
assert.equal(unsafe.pages[1].address_line, null);
assert.equal(unsafe.pages[1].recognition_value, null); checks++;

for (const change of [
  value => { value.version = "V1"; },
  value => { value.requestId = "wrong"; },
  value => { value.images.pop(); },
  value => { value.images[0].convertedImageInfo.pageIndex = 10; },
  value => { value.images[1].convertedImageInfo.pageIndex = 0; },
  value => { value.images[0].inferResult = "FAILURE"; },
  value => { value.images[0].fields = []; },
  value => { value.images[0].fields[0].boundingPoly.vertices[0].x = NaN; },
]) {
  const changed = structuredClone(response(() => "https://refinance.example/loan")); change(changed);
  assert.throws(() => summarizeResponse(changed, requestId, fixture), /OCR_/); checks++;
}

const endpoint = "https://synthetic.apigw.ntruss.com/custom/v1/example/general";
let calls = 0;
const fetchImpl = async (_url, options) => {
  calls++;
  const body = JSON.parse(options.body);
  assert.equal(body.images[0].format, "pdf");
  assert.equal(body.images[0].data, fixture.bytes.toString("base64"));
  assert.equal(body.enableTableDetection, false);
  return Response.json(response(() => "https://refinance.example/loan"));
};
assert.equal((await callOcr(fixture, { endpoint, secret: "synthetic-only", requestId, fetchImpl })).summary.extractor_exact, 10); checks++;
assert.equal(calls, 1);
for (const invalid of ["http://synthetic.apigw.ntruss.com/general", "https://example.com/general", endpoint + "?leak=1", "not-url"]) {
  await assert.rejects(callOcr(fixture, { endpoint: invalid, secret: "synthetic-only", requestId, fetchImpl }), /OCR_CONFIG_INVALID/); checks++;
}
assert.equal(calls, 1);
assert.equal(safeFailure(new Error("secret response")), "OCR_TRANSPORT_UNKNOWN"); checks++;
assert.equal(safeFailure(new DOMException("secret", "TimeoutError")), "OCR_TIMEOUT"); checks++;
console.log(`OCR URL 실패 진단 계약 시험 ${checks}건 통과. 실제 외부 호출 없음.`);
