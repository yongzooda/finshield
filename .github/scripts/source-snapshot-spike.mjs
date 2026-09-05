// ============================================================
// B-SOURCE-02·B-SOURCE-03 공식 출처 Snapshot Spike (ADR 8.2)
//
// 금융위원회 `서민금융상품기본정보` 와 서민금융진흥원 `서민대출상품 취급기관`
// 공공데이터 API 에서 `햇살론15` 레코드를 받아 불변 Snapshot 으로 만들고,
// 두 API 의 취급기관을 교차 확인하며, 공식 상품 페이지·이용안내 페이지의
// 표지(1397·중개수수료 문구)를 확인한다.
//
// serviceKey 는 요청에만 쓰고 결과·로그·URL 기록에 남기지 않는다.
// 응답 원문 전체를 저장하지 않고 공개 레코드 필드·개수·Hash 만 남긴다.
// ============================================================
import { createHash } from "node:crypto";

export const FORMULA_VERSION = "source-snapshot-two-api-cross-check-v1";
export const PRODUCT_NAME = "햇살론15";
export const FSC_ENDPOINT = "https://apis.data.go.kr/1160100/service/GetSmallLoanFinanceInstituteInfoService/getOrdinaryFinanceInfo";
export const KINFA_ENDPOINT = "https://apis.data.go.kr/B553701/LoanProductHandlingAgencyInfoService/getLoanProductHandlingAgencyInfo";
export const OFFICIAL_PRODUCT_URL = "https://www.kinfa.or.kr/financialProduct/hessalLoan.do";
export const OFFICIAL_GUIDE_URL = "https://loan.kinfa.or.kr/tot/setupLoanProductsGuideSupri.ke";
export const PORTAL_PAGES = Object.freeze({
  fsc: "https://www.data.go.kr/data/15094787/openapi.do",
  kinfa: "https://www.data.go.kr/data/15074508/openapi.do",
});
// 공공데이터포털 상세 페이지에서 2026-09-05 확인한 표기. 수치는 개발계정 기준이다.
export const LICENSE_LABEL = "이용허락범위 제한 없음";
export const LICENSE_CHECKED_AT = "2026-09-05";
export const DECLARED_DEV_TRAFFIC_LIMIT = 10000;
export const PAGE_SIZE = 100;
export const MAX_PAGES = 20;
export const REQUEST_INTERVAL_MS = 300;
export const REQUEST_TIMEOUT_MS = 15_000;
export const GUIDE_MARKERS = Object.freeze({
  hotline: "1397",
  no_broker_fee: "수수료를 요구하지 않",
  product: PRODUCT_NAME,
});

const PRODUCT_NAME_FIELDS = Object.freeze(["finPrdNm", "prdNm", "fnPrdNm", "productNm"]);
const INSTITUTION_FIELDS = Object.freeze(["hdlInst", "hdlInstNm", "insttNm", "fnnstNm"]);
const EXISTS_FIELDS = Object.freeze(["prdExisYn", "existYn"]);

export const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");
export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

// 공공데이터포털 인증키는 Encoding 키(이미 % 가 있음)와 Decoding 키 두 종류다.
// % 가 있으면 그대로 붙이고, 없으면 한 번만 encode 한다. 두 번 encode 하지 않는다.
export const serviceKeyParam = (key) => (/%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key));

export const buildRequestUrl = (endpoint, params, apiKey) => {
  const query = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `${endpoint}?serviceKey=${serviceKeyParam(apiKey)}&${query.join("&")}`;
};

// 결과·로그용. serviceKey 를 지운 URL 만 남긴다.
export const redactUrl = (url) => url.replace(/serviceKey=[^&]*/g, "serviceKey=REDACTED");

const decodeEntities = (text) => text
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// 평면 <item> 구조의 data.go.kr XML 을 읽는다. 깊은 중첩·속성은 다루지 않는다.
export const parseXmlEnvelope = (xml) => {
  const tag = (name, scope = xml) => {
    const match = scope.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return match ? decodeEntities(match[1].trim()) : null;
  };
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = {};
    for (const field of match[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) item[field[1]] = decodeEntities(field[2].trim());
    return item;
  });
  return {
    header: { resultCode: tag("resultCode"), resultMsg: tag("resultMsg") },
    body: {
      totalCount: Number(tag("totalCount")), pageNo: Number(tag("pageNo")), numOfRows: Number(tag("numOfRows")),
      items,
    },
  };
};

export const parseJsonEnvelope = (json) => {
  const response = json?.response ?? json;
  const header = response?.header ?? {};
  const body = response?.body ?? {};
  const rawItems = body?.items?.item ?? body?.items ?? [];
  const items = Array.isArray(rawItems) ? rawItems : (rawItems && typeof rawItems === "object" ? [rawItems] : []);
  return {
    header: { resultCode: header.resultCode == null ? null : String(header.resultCode), resultMsg: header.resultMsg == null ? null : String(header.resultMsg) },
    body: { totalCount: Number(body.totalCount), pageNo: Number(body.pageNo), numOfRows: Number(body.numOfRows), items },
  };
};

export const pickField = (item, candidates) => {
  for (const key of candidates) if (item && item[key] != null && String(item[key]).trim() !== "") return { key, value: String(item[key]).trim() };
  return null;
};

export const normalizeInstitution = (name) => String(name ?? "")
  .replace(/\(주\)|주식회사|㈜/g, "")
  .replace(/[\s·・,.()\-_/]/g, "")
  .toLowerCase();

export const splitInstitutions = (text) => String(text ?? "")
  .split(/[,;/\n·]|\s및\s|\s등/)
  .map((part) => part.trim())
  .filter((part) => part.length >= 2);

export const buildSnapshot = ({ authority, sourceType, officialId, officialUrl, record, fetchedAt }) => {
  const canonical = canonicalJson(record);
  return {
    authority,
    source_type: sourceType,
    official_id: officialId,
    official_url: officialUrl,
    fetched_at: fetchedAt,
    record,
    sha256: sha256Hex(canonical),
    // 같은 레코드는 조회 시각과 무관하게 같은 fingerprint 를 가진다.
    source_fingerprint: sha256Hex(`${authority}:${sourceType}:${officialId}:${sha256Hex(canonical)}`),
  };
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export const fetchEnvelope = async ({ fetchImpl, endpoint, params, apiKey }) => {
  const url = buildRequestUrl(endpoint, params, apiKey);
  const startedAt = performance.now();
  const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: "error" });
  const latencyMs = Math.round(performance.now() - startedAt);
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const text = await response.text();
  if (response.status !== 200) {
    throw Object.assign(new Error(`Source API ${redactUrl(endpoint)} returned HTTP ${response.status}.`), { status: response.status });
  }
  let envelope;
  if (contentType.includes("json") || text.trimStart().startsWith("{")) {
    let json;
    try { json = JSON.parse(text); } catch { throw new Error("Source API response is not valid JSON."); }
    envelope = parseJsonEnvelope(json);
  } else {
    envelope = parseXmlEnvelope(text);
  }
  return {
    ...envelope,
    http: {
      status: response.status,
      content_type: contentType.split(";")[0],
      latency_ms: latencyMs,
      header_names: [...response.headers.keys()].map((name) => name.toLowerCase()).sort(),
    },
  };
};

// 전체 page 를 순회한다. totalCount 와 실제 수집 수가 다르면 pagination 불완전으로 남긴다.
export const fetchAllPages = async ({ fetchImpl, endpoint, params, apiKey, progress = () => {} }) => {
  const items = [];
  const pages = [];
  let totalCount = null;
  let header = null;
  let httpFirst = null;
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    if (pageNo > 1) await sleep(REQUEST_INTERVAL_MS);
    const envelope = await fetchEnvelope({ fetchImpl, endpoint, params: { ...params, pageNo, numOfRows: PAGE_SIZE }, apiKey });
    if (envelope.header.resultCode !== "00") {
      throw Object.assign(new Error(`Source API result code ${envelope.header.resultCode ?? "missing"}.`), { resultCode: envelope.header.resultCode });
    }
    header ??= envelope.header;
    httpFirst ??= envelope.http;
    totalCount ??= Number.isFinite(envelope.body.totalCount) ? envelope.body.totalCount : null;
    pages.push({ page_no: pageNo, rows: envelope.body.items.length, latency_ms: envelope.http.latency_ms });
    items.push(...envelope.body.items);
    progress(items.length, totalCount);
    if (envelope.body.items.length < PAGE_SIZE || (totalCount !== null && items.length >= totalCount)) break;
  }
  return {
    result_code: header?.resultCode ?? null,
    result_msg: header?.resultMsg ?? null,
    total_count: totalCount,
    fetched_count: items.length,
    pagination_complete: totalCount !== null && items.length === Math.min(totalCount, MAX_PAGES * PAGE_SIZE),
    pages,
    http: httpFirst,
    items,
  };
};

export const fetchOfficialPage = async ({ fetchImpl, url }) => {
  const startedAt = performance.now();
  const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: "follow" });
  const text = await response.text();
  const title = text.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  return {
    url,
    status: response.status,
    latency_ms: Math.round(performance.now() - startedAt),
    title,
    content_sha256: sha256Hex(text),
    content_length: text.length,
    markers: Object.fromEntries(Object.entries(GUIDE_MARKERS).map(([key, marker]) => [key, text.includes(marker)])),
  };
};

export const runSourceSpike = async ({ apiKey, fetchImpl = globalThis.fetch, now = () => new Date(), progress = () => {} }) => {
  if (typeof apiKey !== "string" || apiKey.length < 20) throw new Error("DATA_GO_KR_SERVICE_KEY is not configured for the spike environment.");
  const fetchedAt = now().toISOString();

  const fsc = await fetchAllPages({
    fetchImpl, endpoint: FSC_ENDPOINT, apiKey,
    params: { resultType: "json", likeFinPrdNm: PRODUCT_NAME },
    progress: (count, total) => progress("fsc", count, total),
  });
  const fscRecords = fsc.items
    .map((item) => ({ item, name: pickField(item, PRODUCT_NAME_FIELDS), institution: pickField(item, INSTITUTION_FIELDS), exists: pickField(item, EXISTS_FIELDS) }))
    .filter((row) => row.name && row.name.value.replace(/\s/g, "").includes(PRODUCT_NAME));
  const fscSnapshots = fscRecords.map((row, index) => buildSnapshot({
    authority: "금융위원회",
    sourceType: "PRODUCT",
    officialId: `data.go.kr:15094787:${row.name.value}:${row.item.basYm ?? "na"}:${index + 1}`,
    officialUrl: PORTAL_PAGES.fsc,
    record: row.item,
    fetchedAt,
  }));

  await sleep(REQUEST_INTERVAL_MS);
  const kinfa = await fetchAllPages({
    fetchImpl, endpoint: KINFA_ENDPOINT, apiKey,
    params: { type: "xml", prdNm: PRODUCT_NAME },
    progress: (count, total) => progress("kinfa", count, total),
  });
  const kinfaRecords = kinfa.items.filter((item) => String(item.prdNm ?? "").replace(/\s/g, "").includes(PRODUCT_NAME));
  const kinfaSnapshots = kinfaRecords.map((item, index) => buildSnapshot({
    authority: "서민금융진흥원",
    sourceType: "INSTITUTION",
    officialId: `data.go.kr:15074508:${item.idNo ?? index + 1}:${item.corpNo ?? "na"}`,
    officialUrl: PORTAL_PAGES.kinfa,
    record: item,
    fetchedAt,
  }));

  // 교차 확인: 금융위 레코드의 취급기관 문자열과 진흥원 취급기관 목록
  const kinfaNames = new Map(kinfaRecords.map((item) => [normalizeInstitution(item.insttNm), item.insttNm]));
  const fscInstitutionTexts = fscRecords.map((row) => row.institution?.value ?? "").filter(Boolean);
  const fscInstitutions = [...new Set(fscInstitutionTexts.flatMap(splitInstitutions))];
  const matched = fscInstitutions.filter((name) => kinfaNames.has(normalizeInstitution(name)));
  const unmatched = fscInstitutions.filter((name) => !kinfaNames.has(normalizeInstitution(name)));

  const officialPages = [];
  for (const url of [OFFICIAL_PRODUCT_URL, OFFICIAL_GUIDE_URL]) {
    await sleep(REQUEST_INTERVAL_MS);
    officialPages.push(await fetchOfficialPage({ fetchImpl, url }));
  }

  return {
    contract: {
      formula_version: FORMULA_VERSION,
      product_name: PRODUCT_NAME,
      fsc_endpoint: FSC_ENDPOINT,
      kinfa_endpoint: KINFA_ENDPOINT,
      official_product_url: OFFICIAL_PRODUCT_URL,
      official_guide_url: OFFICIAL_GUIDE_URL,
      page_size: PAGE_SIZE,
      max_pages: MAX_PAGES,
      request_interval_ms: REQUEST_INTERVAL_MS,
    },
    fsc: {
      result_code: fsc.result_code, result_msg: fsc.result_msg, total_count: fsc.total_count,
      fetched_count: fsc.fetched_count, pagination_complete: fsc.pagination_complete, pages: fsc.pages, http: fsc.http,
      product_matches: fscRecords.length,
      product_name_field: fscRecords[0]?.name.key ?? null,
      institution_field: fscRecords[0]?.institution?.key ?? null,
      exists_field: fscRecords[0]?.exists?.key ?? null,
      exists_values: [...new Set(fscRecords.map((row) => row.exists?.value ?? null))],
      field_names: [...new Set(fsc.items.flatMap((item) => Object.keys(item)))].sort(),
      snapshots: fscSnapshots,
    },
    kinfa: {
      result_code: kinfa.result_code, result_msg: kinfa.result_msg, total_count: kinfa.total_count,
      fetched_count: kinfa.fetched_count, pagination_complete: kinfa.pagination_complete, pages: kinfa.pages, http: kinfa.http,
      institution_matches: kinfaRecords.length,
      field_names: [...new Set(kinfa.items.flatMap((item) => Object.keys(item)))].sort(),
      snapshots: kinfaSnapshots,
    },
    cross_check: {
      fsc_institutions: fscInstitutions,
      kinfa_institutions: [...kinfaNames.values()].sort(),
      matched,
      unmatched,
    },
    official_pages: officialPages,
    registry: {
      license_label: LICENSE_LABEL,
      license_checked_at: LICENSE_CHECKED_AT,
      declared_dev_traffic_limit: DECLARED_DEV_TRAFFIC_LIMIT,
      portal_pages: { ...PORTAL_PAGES },
      fetched_at: fetchedAt,
    },
  };
};
