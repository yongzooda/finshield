// ============================================================
// B-SOURCE-02·B-SOURCE-03 Snapshot Spike 의 오프라인 시험
//
// 공공데이터 API 를 호출하지 않는다. 가짜 fetch 로 JSON·XML·HTML 응답을 주고
// harness 가 레코드·교차 확인·공식 페이지 표지를 바르게 만드는지, 그리고
// 조작된 결과를 정책이 실제로 거부하는지 확인한다.
// ============================================================
import assert from "node:assert/strict";
import { validateSourceEvidenceResult } from "./source-evidence-policy.mjs";
import {
  FSC_ENDPOINT, KINFA_ENDPOINT, OFFICIAL_GUIDE_URL, OFFICIAL_PRODUCT_URL, PRODUCT_NAME,
  buildRequestUrl, canonicalJson, normalizeInstitution, parseJsonEnvelope, parseXmlEnvelope, redactUrl,
  runSourceSpike, serviceKeyParam, sha256Hex, splitInstitutions,
} from "./source-snapshot-spike.mjs";

const apiKey = "abcDEF0123456789abcDEF0123456789abcDEF0123456789";
const fscItem = { basYm: "202609", finPrdNm: "햇살론15", usge: "생활안정", trgt: "저신용·저소득", prdCtg: "고금리대안", hdlInst: "광주은행, 전북은행, 하나은행(주)", prdExisYn: "Y", lnLmt: "2000만원", irt: "연 15.9%" };
const kinfaXml = (page) => `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>
<item><insttNm>광주은행</insttNm><corpNo>1101110000001</corpNo><fninstAdr>광주 동구</fninstAdr><prdNm><![CDATA[햇살론15]]></prdNm><idNo>1</idNo></item>
<item><insttNm>하나은행</insttNm><corpNo>1101110000002</corpNo><fninstAdr>서울 중구</fninstAdr><prdNm>햇살론15</prdNm><idNo>2</idNo></item>
</items><numOfRows>100</numOfRows><pageNo>${page}</pageNo><totalCount>2</totalCount></body></response>`;
const productHtml = `<html><head><title>햇살론15 &gt; 고금리대안자금(소액대출) &gt; 금융상품|서민금융진흥원</title></head><body>${"본문 ".repeat(60)}서민금융콜센터1397</body></html>`;
const guideHtml = `<html><head><title>서민금융 잇다</title></head><body>${"안내 ".repeat(60)}대표전화 국번없이 1397. 제휴된 금융회사에서는 고객에게 대출중개(알선) 수수료를 요구하지 않습니다.</body></html>`;

const makeResponse = (status, contentType, body) => ({
  status,
  headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null), keys: () => ["content-type", "date"][Symbol.iterator]() },
  text: async () => body,
});
const fakeFetch = (overrides = {}) => async (url) => {
  assert.ok(!url.includes("serviceKey=REDACTED"));
  if (url.startsWith(FSC_ENDPOINT)) {
    assert.ok(url.includes("likeFinPrdNm=%ED%96%87%EC%82%B4%EB%A1%A015"));
    return overrides.fsc?.(url) ?? makeResponse(200, "application/json;charset=UTF-8", JSON.stringify({
      response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." }, body: { numOfRows: 100, pageNo: 1, totalCount: 1, items: { item: [fscItem] } } },
    }));
  }
  if (url.startsWith(KINFA_ENDPOINT)) return overrides.kinfa?.(url) ?? makeResponse(200, "application/xml;charset=UTF-8", kinfaXml(1));
  if (url === OFFICIAL_PRODUCT_URL) return overrides.product?.() ?? makeResponse(200, "text/html", productHtml);
  if (url === OFFICIAL_GUIDE_URL) return overrides.guide?.() ?? makeResponse(200, "text/html", guideHtml);
  throw new Error(`unexpected url ${redactUrl(url)}`);
};

// 기본 도구
assert.equal(serviceKeyParam("abc%2Bdef"), "abc%2Bdef");
assert.equal(serviceKeyParam("abc+def/ghi=="), "abc%2Bdef%2Fghi%3D%3D");
assert.equal(redactUrl(buildRequestUrl(FSC_ENDPOINT, { pageNo: 1 }, apiKey)), `${FSC_ENDPOINT}?serviceKey=REDACTED&pageNo=1`);
assert.deepEqual(splitInstitutions("광주은행, 전북은행/하나은행(주) 및 카카오뱅크 등"), ["광주은행", "전북은행", "하나은행(주)", "카카오뱅크"]);
assert.equal(normalizeInstitution("하나은행(주)"), normalizeInstitution("(주) 하나 은행"));
const xml = parseXmlEnvelope(kinfaXml(1));
assert.equal(xml.header.resultCode, "00"); assert.equal(xml.body.totalCount, 2); assert.equal(xml.body.items[0].prdNm, "햇살론15");
assert.deepEqual(parseJsonEnvelope({ response: { header: { resultCode: "00" }, body: { items: { item: fscItem }, totalCount: 1 } } }).body.items, [fscItem]);
assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');

// 정상 실행
const now = () => new Date("2026-09-05T12:00:00Z");
const observations = await runSourceSpike({ apiKey, fetchImpl: fakeFetch(), now });
assert.equal(observations.fsc.product_matches, 1);
assert.equal(observations.fsc.product_name_field, "finPrdNm");
assert.equal(observations.kinfa.institution_matches, 2);
assert.deepEqual(observations.cross_check.matched, ["광주은행", "하나은행(주)"]);
assert.deepEqual(observations.cross_check.unmatched, ["전북은행"]);
assert.ok(observations.official_pages[0].title.includes(PRODUCT_NAME));
assert.equal(observations.official_pages[1].markers.no_broker_fee, true);
assert.equal(observations.fsc.snapshots[0].sha256, sha256Hex(canonicalJson(fscItem)));
const result = (blockerId, obs = observations) => ({ blocker_id: blockerId, observations: JSON.parse(JSON.stringify(obs)) });
const errorsOf = (r) => { const errors = []; validateSourceEvidenceResult(r, (m) => errors.push(m)); return errors; };
assert.deepEqual(errorsOf(result("B-SOURCE-02")), []);
assert.deepEqual(errorsOf(result("B-SOURCE-03")), []);
assert.ok(!JSON.stringify(observations).includes(apiKey));

// 거부 경로: 조작된 결과
const rejects = (name, mutate) => {
  const r = result("B-SOURCE-03");
  mutate(r.observations, r);
  assert.ok(errorsOf(r).length > 0, `거부되어야 할 결과가 통과했습니다: ${name}`);
};
rejects("blocker 이름", (o, r) => { r.blocker_id = "B-EMBED-01"; });
rejects("금융위 결과 코드", (o) => { o.fsc.result_code = "30"; });
rejects("금융위 상품 레코드 없음", (o) => { o.fsc.product_matches = 0; o.fsc.snapshots = []; });
rejects("상품 종료 표시", (o) => { o.fsc.exists_values = ["N"]; });
rejects("pagination 불완전", (o) => { o.fsc.total_count = 3; o.fsc.pagination_complete = false; });
rejects("page 합계 불일치", (o) => { o.fsc.pages[0].rows = 5; });
rejects("HTTP 200 아님", (o) => { o.kinfa.http.status = 500; });
rejects("진흥원 기관 없음", (o) => { o.kinfa.institution_matches = 0; o.kinfa.snapshots = []; o.cross_check.kinfa_institutions = []; });
rejects("교차 확인 불일치", (o) => { o.cross_check.matched = []; o.cross_check.unmatched = [...o.cross_check.fsc_institutions]; });
rejects("교차 확인 집계 조작", (o) => { o.cross_check.matched = ["가짜은행", ...o.cross_check.matched]; });
rejects("Snapshot Hash 변조", (o) => { o.fsc.snapshots[0].sha256 = "0".repeat(64); });
rejects("Snapshot 레코드 변조", (o) => { o.fsc.snapshots[0].record.irt = "연 5%"; });
rejects("Snapshot 상품명 불일치", (o) => { o.fsc.snapshots[0].record.finPrdNm = "햇살론유스"; o.fsc.snapshots[0].sha256 = sha256Hex(canonicalJson(o.fsc.snapshots[0].record)); o.fsc.snapshots[0].source_fingerprint = sha256Hex(`금융위원회:PRODUCT:${o.fsc.snapshots[0].official_id}:${o.fsc.snapshots[0].sha256}`); });
rejects("fingerprint 변조", (o) => { o.kinfa.snapshots[0].source_fingerprint = "1".repeat(64); });
rejects("공식 상품 페이지 404", (o) => { o.official_pages[0].status = 404; });
rejects("상품 페이지 제목 불일치", (o) => { o.official_pages[0].title = "근로자햇살론"; });
rejects("이용안내 수수료 문구 없음", (o) => { o.official_pages[1].markers.no_broker_fee = false; });
rejects("1397 표지 없음", (o) => { o.official_pages[1].markers.hotline = false; });
rejects("라이선스 표기 변경", (o) => { o.registry.license_label = "출처표시"; });
rejects("트래픽 상한 변경", (o) => { o.registry.declared_dev_traffic_limit = 100000; });
rejects("End Point 변경", (o) => { o.contract.fsc_endpoint = "https://example.invalid/api"; });
rejects("산식 버전 변경", (o) => { o.contract.formula_version = "v0"; });
rejects("관측 필드 추가", (o) => { o.extra = true; });

// 거부 경로: harness 가 실제로 실패하는 입력
await assert.rejects(runSourceSpike({ apiKey: "short", fetchImpl: fakeFetch(), now }), /DATA_GO_KR_SERVICE_KEY/);
await assert.rejects(runSourceSpike({ apiKey, now, fetchImpl: fakeFetch({ fsc: () => makeResponse(200, "application/json", JSON.stringify({
  response: { header: { resultCode: "30", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" }, body: {} } })) }) }), /result code 30/);
await assert.rejects(runSourceSpike({ apiKey, now, fetchImpl: fakeFetch({ kinfa: () => makeResponse(429, "text/xml", "") }) }), /HTTP 429/);
await assert.rejects(runSourceSpike({ apiKey, now, fetchImpl: fakeFetch({ fsc: () => makeResponse(200, "application/json", "not json") }) }), /valid JSON/);
// 상품이 없으면 정책이 거부한다 (harness 는 관측을 만들고 정책이 판정).
const empty = await runSourceSpike({ apiKey, now, fetchImpl: fakeFetch({ fsc: () => makeResponse(200, "application/json", JSON.stringify({
  response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." }, body: { numOfRows: 100, pageNo: 1, totalCount: 1, items: { item: [{ ...fscItem, finPrdNm: "햇살론유스" }] } } } })) }) });
assert.equal(empty.fsc.product_matches, 0);
assert.ok(errorsOf(result("B-SOURCE-03", empty)).length > 0);

console.log("B-SOURCE-02·B-SOURCE-03 Snapshot spike 시험 통과: 합격 2건, 결과 거부 23건, 실행 거부 5건.");
