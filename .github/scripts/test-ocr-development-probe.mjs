import assert from "node:assert/strict";
import { loadFixtures, summarizeResponse, callOcr, safeFailure } from "./ocr-development-probe.mjs";

const fixtures = loadFixtures();
assert.deepEqual(fixtures.map(item => item.pages.length), [1, 1, 10]);
assert.equal(fixtures.reduce((sum, item) => sum + item.pages.length, 0), 12);
const requestId = "synthetic-request";
const response = fixture => ({ version: "V2", requestId, images: fixture.pages.map((anchors, pageIndex) => ({
  inferResult: "SUCCESS", convertedImageInfo: { pageIndex }, fields: anchors.map(inferText => ({ inferText,
    boundingPoly: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] } })),
})) });
let checks = 0;
for (const fixture of fixtures) {
  const raw = response(fixture);
  assert.equal(summarizeResponse(raw, requestId, fixture).all_anchors_exact, true); checks++;
  for (const change of [
    value => { value.requestId = "wrong"; },
    value => { value.version = "V1"; },
    value => { value.images.pop(); },
    value => { value.images[0].inferResult = "FAILURE"; },
    value => { value.images[0].fields = []; },
    value => { value.images[0].fields[0].boundingPoly.vertices[0].x = NaN; },
    value => { value.images[0].fields[0].boundingPoly.vertices.pop(); },
  ]) {
    const changed = structuredClone(raw); change(changed);
    assert.throws(() => summarizeResponse(changed, requestId, fixture), /OCR_/); checks++;
  }
  for (const wrong of ["수수료를요구합니다.", "3.7%", "https://www.kinfa.example"]) {
    const changed = response(fixture);
    const target = wrong.startsWith("수수료") ? 4 : wrong.startsWith("https") ? 7 : 2;
    changed.images[0].fields[target].inferText = wrong;
    assert.equal(summarizeResponse(changed, requestId, fixture).all_anchors_exact, false); checks++;
  }
}
const ten = fixtures[2], reversed = response(ten);
reversed.images.reverse();
assert.deepEqual(summarizeResponse(reversed, requestId, ten).pages.map(item => item.page_index), Array.from({ length: 10 }, (_, index) => index)); checks++;
for (const change of [
  value => { value.images[1].convertedImageInfo.pageIndex = 0; },
  value => { delete value.images[0].convertedImageInfo; },
  value => { value.images[0].convertedImageInfo.pageIndex = 10; },
]) {
  const changed = response(ten); change(changed);
  assert.throws(() => summarizeResponse(changed, requestId, ten), /OCR_/); checks++;
}
const endpoint = "https://synthetic.apigw.ntruss.com/custom/v1/example/general";
let calls = 0;
const fixture = fixtures[0];
const fetchImpl = async (_url, options) => {
  calls++;
  const body = JSON.parse(options.body);
  assert.equal(options.redirect, "error");
  assert.equal(body.enableTableDetection, false);
  assert.equal(body.images[0].url, undefined);
  assert.equal(body.images[0].data, fixture.bytes.toString("base64"));
  return Response.json(response(fixture));
};
await callOcr(fixture, { endpoint, secret: "synthetic-only", requestId, fetchImpl }); checks++;
for (const invalid of ["http://synthetic.apigw.ntruss.com/general", "https://example.com/general", endpoint + "?leak=1", "https://user:pass@synthetic.apigw.ntruss.com/general", "not-url"]) {
  await assert.rejects(callOcr(fixture, { endpoint: invalid, secret: "synthetic-only", requestId, fetchImpl }), /OCR_CONFIG_INVALID/); checks++;
}
assert.equal(calls, 1);
for (const [status, code] of [[401, "OCR_AUTH_FAILED"], [403, "OCR_AUTH_FAILED"], [429, "OCR_RATE_LIMITED"], [500, "OCR_HTTP_FAILED"]]) {
  await assert.rejects(callOcr(fixture, { endpoint, secret: "synthetic-only", fetchImpl: async () => new Response("secret error body", { status }) }), new RegExp(code)); checks++;
}
await assert.rejects(callOcr(fixture, { endpoint, secret: "synthetic-only", fetchImpl: async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1)) }), /OCR_RESPONSE_TOO_LARGE/); checks++;
await assert.rejects(callOcr(fixture, { endpoint, secret: "synthetic-only", fetchImpl: async () => new Response("secret malformed JSON") }), /OCR_JSON_INVALID/); checks++;
assert.equal(safeFailure(new Error("secret endpoint and response")), "OCR_TRANSPORT_UNKNOWN"); checks++;
assert.equal(safeFailure(new DOMException("secret", "TimeoutError")), "OCR_TIMEOUT"); checks++;
console.log(`OCR 개발 진단 계약 시험 ${checks}건 통과. 합성 3문서·12쪽, 실제 외부 호출 없음.`);
