// ============================================================
// 공개 Demo 가 고정한 공식 근거 Snapshot 에 재수집 기록을 잇는다.
//
// Demo Seed 는 승인한 Snapshot ID 로만 근거를 찾는다. 공식 근거의 신선도는 그
// Snapshot 의 가장 최근 수집 기록이 정하므로 24시간 안에 새 수집 기록이 없으면
// STALE 이 되고 Demo 의 확정 판정이 UNKNOWN 으로 떨어진다.
//
// 적재기(load-source-snapshots.mjs)는 금융위 상품 레코드처럼 identity 가 같으면
// 같은 Snapshot 에 UNCHANGED 기록을 남긴다. 반면 공식 페이지는 날짜가 identity 에
// 들어가 매일 새 Snapshot 이 생기고 Demo 가 고정한 행에는 기록이 붙지 않는다.
// 이 스크립트는 방금 수집한 원문 해시가 고정 Snapshot 의 해시와 같을 때만 그 행에
// UNCHANGED 기록을 남긴다. 해시가 다르면 쓰지 않는다. 내용이 바뀐 자료를 옛
// Snapshot 의 신선한 근거로 둔갑시키지 않기 위해서다 (규칙 8).
//
// 사용:
//   node scripts/kb/refresh-demo-seed-sources.mjs --result evidence-output/result.json
//   (DATABASE_URL 의 finshield_worker 로 실행한다. DSN 은 출력하지 않는다.)
//
// 끝에 고정 근거마다 신선 기한을 확인하고, 하나라도 신선하지 않으면 실패로 끝낸다.
// 예약 실행이 실패하면 저장소 관리자에게 알림이 가서 Demo 가 낡기 전에 알 수 있다.
// ============================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// 공개 Demo 가 여는 Seed 다. private.create_demo_session 과 같은 방식으로 최신 판을 고른다.
const SEED_CODE = "sunshine-loan-15";
// 적재기가 쓰는 수집 경로 이름이다. 신선도 계산은 조회 도구의 캐시 기록을 빼고 본다.
const CACHE_ADAPTERS = ["lookup_official_channel", "verify_financial_institution", "search_financial_product", "get_source_snapshot"];

/**
 * 고정 근거마다 방금 수집한 원문 해시를 찾아 기록할지 정한다. DB 에 닿지 않는 순수 함수다.
 *
 * pins: [{ snapshot_id, official_id, source_type, content_hash }]
 * 돌려주는 값: { links: [...기록할 것], skipped: [...기록하지 않는 까닭] }
 */
export const planSeedRefresh = ({ pins, result }) => {
  if (result?.blocker_id !== "B-SOURCE-03" || result?.schema_version !== 3) {
    throw new Error("B-SOURCE-03 결과 파일이 아니다");
  }
  const { fsc, official_pages: pages, registry } = result.observations ?? {};
  const runId = result.run?.id;
  if (!Number.isInteger(runId)) throw new Error("수집 실행 번호가 없다");
  const observed = new Map();
  for (const snapshot of fsc?.snapshots ?? []) {
    observed.set(snapshot.official_id, { hash: snapshot.sha256, fetchedAt: snapshot.fetched_at, adapter: "data_go_kr_fsc_small_loan" });
  }
  const pageIds = { PRODUCT: "kinfa:hessalLoan", DECLARE_CENTER: "kinfa:declare-center", GUIDE: "kinfa:loan-guide" };
  for (const page of pages ?? []) {
    // 실행 환경에서 본문을 받지 못한 페이지는 확인한 것이 아니다.
    if (!page.reachable || page.status !== 200) continue;
    observed.set(pageIds[page.role], { hash: page.content_sha256, fetchedAt: registry?.fetched_at, adapter: "kinfa_official_page" });
  }
  const links = [];
  const skipped = [];
  for (const pin of pins) {
    const seen = observed.get(pin.official_id);
    if (!seen) skipped.push({ ...pin, reason: "NOT_OBSERVED" });
    else if (!/^[0-9a-f]{64}$/.test(seen.hash ?? "") || !seen.fetchedAt) skipped.push({ ...pin, reason: "OBSERVATION_INCOMPLETE" });
    else if (seen.hash !== pin.content_hash) skipped.push({ ...pin, reason: "CONTENT_CHANGED" });
    else links.push({
      snapshotId: pin.snapshot_id, officialId: pin.official_id, adapter: seen.adapter, fetchedAt: seen.fetchedAt,
      requestKey: `${pin.official_id}:${seen.fetchedAt}:demo-seed-refresh-run-${runId}:${pin.snapshot_id}`,
    });
  }
  return { links, skipped };
};

const main = async () => {
  const args = process.argv.slice(2);
  const resultPath = args[args.indexOf("--result") + 1];
  if (!args.includes("--result") || !resultPath) {
    console.error("사용법: --result <B-SOURCE-03 result.json>");
    process.exit(2);
  }
  const result = JSON.parse(readFileSync(resolve(process.cwd(), resultPath), "utf8"));
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error("DATABASE_URL 이 필요하다");
  const { default: postgres } = await import("postgres");
  const sql = postgres(dsn, { prepare: false, max: 1 });
  try {
    const pins = await sql`
      select ss.source_snapshot_id as snapshot_id, s.official_id, s.source_type, s.content_hash, ss.purpose_code
        from demo.seed_sources ss
        join kb.source_snapshots s on s.id = ss.source_snapshot_id
       where ss.seed_version_id = (select id from demo.seed_versions where seed_code = ${SEED_CODE} order by created_at desc limit 1)
       order by ss.purpose_code`;
    if (pins.length === 0) throw new Error("Demo 고정 근거가 없다");
    const { links, skipped } = planSeedRefresh({ pins, result });
    for (const link of links) {
      // 같은 수집 시각 이후의 기록이 이미 있으면 새로 쓰지 않는다. 적재기가 같은 행에 남긴 경우다.
      const inserted = await sql`
        insert into kb.source_fetch_events
          (source_snapshot_id, source_adapter, request_key, outcome, freshness_status, retrieved_at, fresh_until)
        select ${link.snapshotId}::uuid, ${link.adapter}, ${link.requestKey}, 'UNCHANGED', 'FRESH',
               ${link.fetchedAt}::timestamptz, ${link.fetchedAt}::timestamptz + interval '24 hours'
         where not exists (
           select 1 from kb.source_fetch_events e
            where e.source_snapshot_id = ${link.snapshotId}::uuid and e.retrieved_at >= ${link.fetchedAt}::timestamptz
              and e.source_adapter <> all(${CACHE_ADAPTERS}))
        on conflict (source_adapter, request_key) do nothing
        returning id`;
      console.log(`재수집 연결 ${link.officialId}: ${inserted.length ? "새 기록" : "이미 기록됨"}`);
    }
    for (const skip of skipped) console.log(`재수집 연결 안 함 ${skip.official_id}: ${skip.reason}`);

    const state = await sql`
      select s.official_id, ss.purpose_code,
             (select e.fresh_until from kb.source_fetch_events e
               where e.source_snapshot_id = s.id and e.source_adapter <> all(${CACHE_ADAPTERS})
               order by e.retrieved_at desc limit 1) as fresh_until
        from demo.seed_sources ss join kb.source_snapshots s on s.id = ss.source_snapshot_id
       where ss.seed_version_id = (select id from demo.seed_versions where seed_code = ${SEED_CODE} order by created_at desc limit 1)
       order by ss.purpose_code`;
    const stale = state.filter((row) => !(row.fresh_until instanceof Date) || row.fresh_until <= new Date());
    for (const row of state) {
      console.log(`Demo 고정 근거 ${row.purpose_code} ${row.official_id}: 신선 기한 ${row.fresh_until?.toISOString?.() ?? "없음"}`);
    }
    if (stale.length > 0) {
      console.error(`신선하지 않은 Demo 고정 근거 ${stale.length}건. Seed 고정 근거를 다시 검토해야 한다.`);
      process.exitCode = 1;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    // DB 오류 원문에는 접속 정보나 값이 섞일 수 있어 코드만 남긴다. 이 스크립트가 던진 오류는 문장을 쓴다.
    console.error(`재수집 연결 실패: ${error?.code ? `DB ${error.code}` : String(error?.message ?? "unknown").slice(0, 120)}`);
    process.exit(1);
  });
}
