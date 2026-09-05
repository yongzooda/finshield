// ============================================================
// 채택된 B-SOURCE-03 결과를 kb.source_snapshots·source_fetch_events·
// official_channel_registry 에 적재한다 (명세 15절 14번 묶음의 첫 단계).
//
// 입력은 evidence/results/B-SOURCE-03/<run>.json 하나뿐이다. API 를 다시
// 호출하지 않는다. content_hash·source_fingerprint 는 결과 파일의 값을 그대로
// 쓰므로 적재된 행은 채택된 증거와 1:1 로 대조할 수 있다.
//
// 사용:
//   node scripts/kb/load-source-snapshots.mjs --result evidence/results/B-SOURCE-03/<run>.json --emit-sql
//   node scripts/kb/load-source-snapshots.mjs --result ... --apply      (DATABASE_URL 의 finshield_worker 로 실행)
//
// --emit-sql 은 statement 를 stdout 에 쓰고 DB 에 접속하지 않는다. 같은 statement 를
// --apply 가 실행한다. 두 경로가 다른 SQL 을 만들지 않도록 한 함수에서 만든다.
// ============================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const resultPath = option("--result");
const emitSql = args.includes("--emit-sql");
const apply = args.includes("--apply");
if (!resultPath || (emitSql === apply)) {
  console.error("사용법: --result <경로> 와 --emit-sql 또는 --apply 중 하나");
  process.exit(2);
}

const result = JSON.parse(readFileSync(resolve(process.cwd(), resultPath), "utf8"));
if (result.blocker_id !== "B-SOURCE-03" || result.schema_version !== 3) throw new Error("B-SOURCE-03 결과 파일이 아니다");
const { contract, fsc, kinfa, official_pages: pages, registry } = result.observations;
if (!/^source-snapshot-two-api-cross-check-v2$/.test(contract.formula_version)) throw new Error(`지원하지 않는 산식 버전 ${contract.formula_version}`);

const LICENSE_CODE = "DATA_GO_KR_NO_RESTRICTION";
const FRESH_HOURS = 24; // ADR 8.5 갱신 후보 6~24시간의 상한. 실제 TTL 은 재실행 결과로 정한다.
const lit = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);

// 하나의 Snapshot 을 멱등 적재하는 statement. 같은 identity 가 있으면 새 행을 만들지 않고
// Fetch Event 만 UNCHANGED 로 남긴다.
const snapshotStatement = ({ sourceType, authority, title, canonicalUrl, officialId, sourceVersion, publishedAt, retrievedAt,
  contentHash, fingerprint, licenseUrl, isComplete, isCitable, adapter, requestKey }) => `
with existing as (
  select id from kb.source_snapshots
   where source_type = ${lit(sourceType)} and official_id is not distinct from ${lit(officialId)}
     and source_version is not distinct from ${lit(sourceVersion)} and content_hash = ${lit(contentHash)}
), inserted as (
  insert into kb.source_snapshots
    (source_type, authority_level, publisher_name, source_title, canonical_url, official_id, published_at,
     retrieved_at, source_version, content_hash, source_fingerprint, freshness_status, fresh_until,
     license_code, license_url, is_complete, is_citable)
  select ${lit(sourceType)}, 'A', ${lit(authority)}, ${lit(title)}, ${lit(canonicalUrl)}, ${lit(officialId)}, ${lit(publishedAt)}::timestamptz,
         ${lit(retrievedAt)}::timestamptz, ${lit(sourceVersion)}, ${lit(contentHash)}, ${lit(fingerprint)}, 'FRESH',
         ${lit(retrievedAt)}::timestamptz + interval '${FRESH_HOURS} hours',
         ${lit(LICENSE_CODE)}, ${lit(licenseUrl)}, ${isComplete}, ${isCitable}
   where not exists (select 1 from existing)
  returning id
)
insert into kb.source_fetch_events (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
select coalesce((select id from inserted), (select id from existing)), ${lit(adapter)}, ${lit(requestKey)},
       case when exists (select 1 from inserted) then 'CHANGED' else 'UNCHANGED' end, 'FRESH',
       ${lit(retrievedAt)}::timestamptz, ${lit(retrievedAt)}::timestamptz + interval '${FRESH_HOURS} hours'
on conflict (source_adapter, request_key) do nothing;`;

const statements = ["begin;"];
const fetchedAt = registry.fetched_at;

// 1. 금융위 상품 레코드: 최신 기준월만 현재 상품이다. 과거 기준월은 이력이므로 STALE 대신 적재하지 않는다.
const currentSnapshots = fsc.snapshots.filter((s) => fsc.latest_bas_ym === null || s.record[fsc.bas_ym_field] === fsc.latest_bas_ym);
if (currentSnapshots.length < 1) throw new Error("현재 기준월 상품 Snapshot 이 없다");
for (const s of currentSnapshots) {
  const rec = s.record;
  statements.push(snapshotStatement({
    sourceType: "PRODUCT", authority: s.authority,
    title: `${rec[fsc.product_name_field]} (${rec.prdCtg ?? "서민금융"}, 기준 ${rec[fsc.bas_ym_field] ?? "미상"})`,
    canonicalUrl: s.official_url, officialId: s.official_id, sourceVersion: rec[fsc.bas_ym_field] ?? null,
    publishedAt: rec[fsc.bas_ym_field] ? `${String(rec[fsc.bas_ym_field]).slice(0, 4)}-${String(rec[fsc.bas_ym_field]).slice(4, 6)}-01` : null,
    retrievedAt: s.fetched_at, contentHash: s.sha256, fingerprint: s.source_fingerprint, licenseUrl: registry.portal_pages.fsc,
    isComplete: true, isCitable: true, adapter: "data_go_kr_fsc_small_loan", requestKey: s.official_id,
  }));
}

// 2. 진흥원 취급기관 레코드
for (const s of kinfa.snapshots) {
  const rec = s.record;
  statements.push(snapshotStatement({
    sourceType: "INSTITUTION", authority: s.authority,
    title: `${rec.insttNm} 햇살론15 취급기관`, canonicalUrl: s.official_url, officialId: s.official_id, sourceVersion: null,
    publishedAt: null, retrievedAt: s.fetched_at, contentHash: s.sha256, fingerprint: s.source_fingerprint,
    licenseUrl: registry.portal_pages.kinfa, isComplete: true, isCitable: true,
    adapter: "data_go_kr_kinfa_handling_agency", requestKey: s.official_id,
  }));
}

// 3. 공식 페이지: 본문이 서버에서 오지 않는(JS) 상품 페이지는 불완전으로 적재해 인용 불가로 둔다.
const pageSpecs = {
  PRODUCT: { title: "햇살론15 공식 상품 안내 (서민금융진흥원)", complete: false },
  DECLARE_CENTER: { title: "서민금융 사칭 신고센터 (서민금융진흥원)", complete: true },
  GUIDE: { title: "서민금융 잇다 상품 이용안내 (서민금융진흥원)", complete: true },
};
const declareSnapshotId = "(select id from kb.source_snapshots where source_type = 'GUIDE' and official_id = 'kinfa:declare-center' order by retrieved_at desc limit 1)";
for (const page of pages) {
  if (!page.reachable) continue; // 실행 환경에서 닿지 않은 페이지는 적재하지 않는다. 결과 파일이 그 사실을 보존한다.
  const spec = pageSpecs[page.role];
  const officialId = page.role === "PRODUCT" ? "kinfa:hessalLoan" : page.role === "DECLARE_CENTER" ? "kinfa:declare-center" : "kinfa:loan-guide";
  // 페이지 fingerprint 는 URL 과 본문 Hash 로 만든다. 결과 파일에는 없으므로 여기서 계산하되 규칙을 고정한다.
  const fingerprint = createHash("sha256").update(`서민금융진흥원:GUIDE:${page.url}:${page.content_sha256}`).digest("hex");
  statements.push(snapshotStatement({
    sourceType: "GUIDE", authority: "서민금융진흥원", title: spec.title, canonicalUrl: page.url, officialId,
    sourceVersion: fetchedAt.slice(0, 10), publishedAt: null, retrievedAt: fetchedAt, contentHash: page.content_sha256,
    fingerprint, licenseUrl: page.url, isComplete: spec.complete, isCitable: spec.complete,
    adapter: "kinfa_official_page", requestKey: `${officialId}:${fetchedAt.slice(0, 10)}`,
  }));
}
// 4. 공식 채널: 서민금융콜센터 1397 (사칭 신고센터 페이지가 근거)
if (pages.some((p) => p.role === "DECLARE_CENTER" && p.reachable && p.markers.hotline)) {
  statements.push(`
insert into kb.official_channel_registry (institution_code, channel_type, normalized_value, display_value, source_snapshot_id, valid_from)
select 'INST_KINFA', 'PHONE', '1397', '서민금융콜센터 1397 (국번 없이)', ${declareSnapshotId}, ${lit(fetchedAt.slice(0, 10))}::date
 where exists ${declareSnapshotId.replace("select id", "select 1")}
on conflict (institution_code, channel_type, normalized_value, valid_from) do nothing;
insert into kb.official_channel_registry (institution_code, channel_type, normalized_value, display_value, source_snapshot_id, valid_from)
select 'INST_KINFA', 'REPORTING', ${lit(contract.official_declare_url)}, '서민금융 사칭 신고센터', ${declareSnapshotId}, ${lit(fetchedAt.slice(0, 10))}::date
 where exists ${declareSnapshotId.replace("select id", "select 1")}
on conflict (institution_code, channel_type, normalized_value, valid_from) do nothing;`);
}
statements.push("commit;");

const sql = statements.join("\n");
if (emitSql) {
  process.stdout.write(`${sql}\n`);
} else {
  const { default: postgres } = await import("postgres");
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error("DATABASE_URL 이 필요하다");
  const db = postgres(dsn, { prepare: false, max: 1 });
  try {
    await db.unsafe(sql);
    const [counts] = await db`select (select count(*) from kb.source_snapshots) as snapshots, (select count(*) from kb.source_fetch_events) as fetch_events, (select count(*) from kb.official_channel_registry) as channels`;
    console.log(`적재 완료: snapshots ${counts.snapshots}, fetch_events ${counts.fetch_events}, channels ${counts.channels}`);
  } finally {
    await db.end({ timeout: 5 });
  }
}
