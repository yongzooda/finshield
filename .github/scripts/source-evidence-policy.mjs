// B-SOURCE-02·B-SOURCE-03 raw-metric 합격 정책.
//
// 결과 파일의 PASS 문자열을 믿지 않는다. 관측값에서 다시 판정한다.
//  - B-SOURCE-02: 두 API 가 승인된 키로 정상 코드(00)를 돌려주고 pagination 이
//    totalCount 와 일치하며, 라이선스 표기·기준일·개발 트래픽 상한이 registry 에 있다.
//  - B-SOURCE-03: 금융위 API 에 `햇살론15` 상품 레코드가 있고 진흥원 API 에
//    취급기관이 있으며, 금융위 레코드의 취급기관이 진흥원 목록과 하나 이상 일치하고,
//    공식 상품 페이지·이용안내 페이지가 200 으로 표지(제목·1397·수수료 문구)를 보인다.
//  - 모든 Snapshot 은 official_id·fetched_at·sha256·fingerprint 를 가진다.
import {
  CONNECT_ATTEMPTS, DECLARED_DEV_TRAFFIC_LIMIT, FORMULA_VERSION, FSC_ENDPOINT, KINFA_ENDPOINT, LICENSE_CHECKED_AT, LICENSE_LABEL,
  MAX_PAGES, OFFICIAL_DECLARE_URL, OFFICIAL_GUIDE_URL, OFFICIAL_PRODUCT_URL, PAGE_SIZE, PORTAL_PAGES, PRODUCT_NAME,
  REQUEST_INTERVAL_MS, canonicalJson, sha256Hex,
} from "./source-snapshot-spike.mjs";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, expected) => isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const isHex64 = (value) => /^[0-9a-f]{64}$/.test(value ?? "");
const isIso = (value) => /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value ?? "") && Number.isFinite(Date.parse(value));

const validApi = (api, fail, label) => {
  if (!exactKeys(api, ["result_code", "result_msg", "total_count", "fetched_count", "pagination_complete", "pages", "http",
    ...(label === "fsc"
      ? ["product_matches", "product_name_field", "institution_field", "exists_field", "bas_ym_field", "latest_bas_ym",
        "current_matches", "current_exists_values", "exists_values", "field_names", "snapshots"]
      : ["institution_matches", "field_names", "snapshots"])])) {
    fail(`${label} 관측 필드가 고정 schema 와 다릅니다.`);
    return false;
  }
  if (api.result_code !== "00" || typeof api.result_msg !== "string"
    || !Number.isInteger(api.total_count) || api.total_count < 1
    || !Number.isInteger(api.fetched_count) || api.fetched_count < 1
    || api.fetched_count !== Math.min(api.total_count, MAX_PAGES * PAGE_SIZE) || api.pagination_complete !== true
    || !Array.isArray(api.pages) || api.pages.length < 1 || api.pages.length > MAX_PAGES
    || api.pages.some((p, i) => !isRecord(p) || p.page_no !== i + 1 || !Number.isInteger(p.rows) || p.rows < 0 || !Number.isInteger(p.latency_ms) || p.latency_ms < 0)
    || api.pages.reduce((sum, p) => sum + p.rows, 0) !== api.fetched_count
    || !isRecord(api.http) || api.http.status !== 200 || typeof api.http.content_type !== "string"
    || !Number.isInteger(api.http.latency_ms) || api.http.latency_ms < 0 || !Array.isArray(api.http.header_names)
    || !Number.isInteger(api.http.connect_retries) || api.http.connect_retries < 0
    || api.http.connect_retries > (CONNECT_ATTEMPTS - 1) * MAX_PAGES) {
    fail(`${label} API 응답 코드·pagination·HTTP metadata 가 합격 조건과 다릅니다.`);
    return false;
  }
  if (!Array.isArray(api.field_names) || api.field_names.length < 2) {
    fail(`${label} 응답 필드 목록이 비어 있습니다.`);
    return false;
  }
  return true;
};

const validSnapshots = (snapshots, fail, label, { authority, sourceType, officialUrl }) => {
  if (!Array.isArray(snapshots) || snapshots.length < 1) {
    fail(`${label} Snapshot 이 없습니다.`);
    return false;
  }
  const ids = new Set();
  for (const s of snapshots) {
    if (!exactKeys(s, ["authority", "source_type", "official_id", "official_url", "fetched_at", "record", "sha256", "source_fingerprint"])
      || s.authority !== authority || s.source_type !== sourceType || s.official_url !== officialUrl
      || typeof s.official_id !== "string" || s.official_id.length < 8 || ids.has(s.official_id)
      || !isIso(s.fetched_at) || !isRecord(s.record) || Object.keys(s.record).length < 2
      || s.sha256 !== sha256Hex(canonicalJson(s.record)) || !isHex64(s.source_fingerprint)
      || s.source_fingerprint !== sha256Hex(`${authority}:${sourceType}:${s.official_id}:${s.sha256}`)) {
      fail(`${label} Snapshot 의 metadata·Hash·fingerprint 가 계약과 다릅니다.`);
      return false;
    }
    ids.add(s.official_id);
  }
  return true;
};

export const validateSourceEvidenceResult = (result, fail) => {
  if (!["B-SOURCE-02", "B-SOURCE-03"].includes(result?.blocker_id)) {
    fail("Source evidence 는 B-SOURCE-02 또는 B-SOURCE-03 만 다룹니다.");
    return;
  }
  if (!exactKeys(result?.observations, ["contract", "fsc", "kinfa", "cross_check", "official_pages", "registry"])) {
    fail("Source observations 필드가 고정 schema 와 다릅니다.");
    return;
  }
  const { contract, fsc, kinfa, cross_check: cross, official_pages: pages, registry } = result.observations;
  if (!exactKeys(contract, ["formula_version", "product_name", "fsc_endpoint", "kinfa_endpoint", "official_product_url",
    "official_guide_url", "official_declare_url", "page_size", "max_pages", "request_interval_ms", "connect_attempts"])
    || contract.formula_version !== FORMULA_VERSION || contract.product_name !== PRODUCT_NAME
    || contract.fsc_endpoint !== FSC_ENDPOINT || contract.kinfa_endpoint !== KINFA_ENDPOINT
    || contract.official_product_url !== OFFICIAL_PRODUCT_URL || contract.official_guide_url !== OFFICIAL_GUIDE_URL
    || contract.official_declare_url !== OFFICIAL_DECLARE_URL
    || contract.page_size !== PAGE_SIZE || contract.max_pages !== MAX_PAGES || contract.request_interval_ms !== REQUEST_INTERVAL_MS
    || contract.connect_attempts !== CONNECT_ATTEMPTS) {
    fail("Source 계약(산식·상품명·End Point·공식 URL·pagination)이 고정값과 다릅니다.");
  }
  const fscOk = validApi(fsc, fail, "fsc");
  const kinfaOk = validApi(kinfa, fail, "kinfa");
  if (!exactKeys(registry, ["license_label", "license_checked_at", "declared_dev_traffic_limit", "portal_pages", "fetched_at"])
    || registry.license_label !== LICENSE_LABEL || registry.license_checked_at !== LICENSE_CHECKED_AT
    || registry.declared_dev_traffic_limit !== DECLARED_DEV_TRAFFIC_LIMIT
    || !exactKeys(registry.portal_pages, ["fsc", "kinfa"])
    || registry.portal_pages.fsc !== PORTAL_PAGES.fsc || registry.portal_pages.kinfa !== PORTAL_PAGES.kinfa
    || !isIso(registry.fetched_at)) {
    fail("Source registry 의 라이선스 표기·기준일·트래픽 상한·포털 페이지가 고정값과 다릅니다.");
  }

  // B-SOURCE-03: 정확한 상품·취급기관 레코드와 공식 페이지
  if (fscOk) {
    // 현재(최신 기준월) 레코드가 있어야 하고 그 레코드에 종료(N) 표시가 없어야 한다. 과거 기준월은 이력이다.
    if (!Number.isInteger(fsc.product_matches) || fsc.product_matches < 1 || fsc.product_matches !== fsc.snapshots?.length
      || typeof fsc.product_name_field !== "string"
      || !Number.isInteger(fsc.current_matches) || fsc.current_matches < 1 || fsc.current_matches > fsc.product_matches
      || (fsc.latest_bas_ym !== null && !/^\d{6}$/.test(fsc.latest_bas_ym))
      || !Array.isArray(fsc.current_exists_values) || fsc.current_exists_values.some((v) => v === "N")
      || !Array.isArray(fsc.exists_values)) {
      fail("금융위 API 에 현재 기준월 `햇살론15` 상품 레코드가 없거나 종료(N) 표시가 있습니다.");
    }
    validSnapshots(fsc.snapshots, fail, "fsc", { authority: "금융위원회", sourceType: "PRODUCT", officialUrl: PORTAL_PAGES.fsc });
    if (Array.isArray(fsc.snapshots) && fsc.snapshots.some((s) => !String(s.record?.[fsc.product_name_field] ?? "").replace(/\s/g, "").includes(PRODUCT_NAME))) {
      fail("금융위 Snapshot 레코드의 상품명이 `햇살론15` 를 담지 않습니다.");
    }
  }
  if (kinfaOk) {
    if (!Number.isInteger(kinfa.institution_matches) || kinfa.institution_matches < 1 || kinfa.institution_matches !== kinfa.snapshots?.length) {
      fail("진흥원 API 에 `햇살론15` 취급기관 레코드가 없습니다.");
    }
    validSnapshots(kinfa.snapshots, fail, "kinfa", { authority: "서민금융진흥원", sourceType: "INSTITUTION", officialUrl: PORTAL_PAGES.kinfa });
    if (Array.isArray(kinfa.snapshots) && kinfa.snapshots.some((s) => typeof s.record?.insttNm !== "string" || s.record.insttNm.length < 2
      || !String(s.record?.prdNm ?? "").replace(/\s/g, "").includes(PRODUCT_NAME))) {
      fail("진흥원 Snapshot 레코드에 기관명·상품명이 없습니다.");
    }
  }
  // 교차 확인: 진흥원 취급기관 레코드 전부가 같은 상품명이고, 금융위 현재 레코드가 은행 취급을 말하며
  // 진흥원 목록에 은행이 있어야 한다. 금융위는 기관 이름을 나열하지 않으므로 이름 일치는 참고값이다.
  const join = isRecord(cross?.product_join) ? cross.product_join : null;
  const category = isRecord(cross?.category) ? cross.category : null;
  if (!exactKeys(cross, ["fsc_institution_texts", "fsc_institutions", "kinfa_institutions", "matched", "unmatched", "product_join", "category"])
    || !Array.isArray(cross.fsc_institution_texts) || cross.fsc_institution_texts.length < 1
    || !Array.isArray(cross.fsc_institutions) || !Array.isArray(cross.kinfa_institutions)
    || !Array.isArray(cross.matched) || !Array.isArray(cross.unmatched)
    || cross.kinfa_institutions.length < 1
    || cross.matched.length + cross.unmatched.length !== cross.fsc_institutions.length
    || cross.matched.some((name) => !cross.fsc_institutions.includes(name))
    || !join || !exactKeys(join, ["fsc_product_names", "kinfa_product_names", "joined_count"])
    || !Array.isArray(join.fsc_product_names) || join.fsc_product_names.length < 1
    || join.fsc_product_names.some((n) => !String(n).replace(/\s/g, "").includes(PRODUCT_NAME))
    || !Array.isArray(join.kinfa_product_names) || join.kinfa_product_names.length < 1
    || join.kinfa_product_names.some((n) => !String(n).replace(/\s/g, "").includes(PRODUCT_NAME))
    || !Number.isInteger(join.joined_count) || join.joined_count < 1 || join.joined_count !== (kinfaOk ? kinfa.institution_matches : join.joined_count)
    || join.joined_count !== cross.kinfa_institutions.length
    || !category || !exactKeys(category, ["fsc_mentions_bank", "fsc_declared_bank_count", "kinfa_bank_count"])
    || category.fsc_mentions_bank !== true
    || !(category.fsc_declared_bank_count === null || (Number.isInteger(category.fsc_declared_bank_count) && category.fsc_declared_bank_count > 0))
    || !Number.isInteger(category.kinfa_bank_count) || category.kinfa_bank_count < 1 || category.kinfa_bank_count > join.joined_count) {
    fail("두 API 의 상품·취급기관 교차 확인이 일치하지 않습니다. 기관이 일치하지 않는 상태는 성공 Demo 가 아닙니다.");
  }
  const pageKeys = ["role", "url", "status", "latency_ms", "connect_retries", "title", "reachable", "content_sha256", "content_length", "markers"];
  const markerKeys = ["hotline", "no_broker_fee", "broker_fee", "impersonation", "product"];
  if (!Array.isArray(pages) || pages.length !== 3
    || pages.some((p) => !exactKeys(p, pageKeys) || !isHex64(p.content_sha256) || !Number.isInteger(p.content_length)
      || !Number.isInteger(p.latency_ms) || !Number.isInteger(p.connect_retries) || p.connect_retries < 0 || p.connect_retries >= CONNECT_ATTEMPTS
      || typeof p.reachable !== "boolean" || !exactKeys(p.markers, markerKeys))) {
    fail("공식 페이지 관측이 고정 형식(역할·상태·Hash·표지)을 갖추지 않았습니다.");
  } else {
    const product = pages.find((p) => p.role === "PRODUCT" && p.url === OFFICIAL_PRODUCT_URL);
    const guide = pages.find((p) => p.role === "GUIDE" && p.url === OFFICIAL_GUIDE_URL);
    const declare = pages.find((p) => p.role === "DECLARE_CENTER" && p.url === OFFICIAL_DECLARE_URL);
    if (!product || product.status !== 200 || !product.reachable || product.content_length < 200
      || typeof product.title !== "string" || !product.title.includes(PRODUCT_NAME) || !product.markers.hotline) {
      fail("공식 상품 페이지가 200 이 아니거나 제목에 `햇살론15` 가 없거나 1397 표지가 없습니다.");
    }
    if (!declare || declare.status !== 200 || !declare.reachable || declare.content_length < 200
      || !declare.markers.hotline || !declare.markers.impersonation || !declare.markers.broker_fee) {
      fail("공식 사칭 신고센터 페이지에 1397·사칭·중개수수료 표지가 없습니다.");
    }
    // 이용안내 페이지는 실행 환경에서 기본 틀만 돌려줄 수 있다. 닿았다면 문구가 있어야 하고,
    // 닿지 않았다면 그 사실을 기록한다. 닿지 않은 것을 문구 확인으로 바꾸지 않는다.
    if (!guide || (guide.reachable && !(guide.markers.hotline && guide.markers.no_broker_fee))) {
      fail("공식 이용안내 페이지에 닿았는데 1397·중개수수료 미요구 문구가 없습니다.");
    }
  }
};
