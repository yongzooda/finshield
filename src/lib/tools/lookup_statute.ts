/**
 * F-501 `lookup_statute` — 법령 조문 조회 (SR-301 · E-01 · E-05).
 *
 * **분기는 조문 종속이지 기준일 종속이 아니다.** 흔한 오해라 명시해 둔다:
 *
 *   요청 조문이 금소법 이관 삭제 조문(`statute_timeline` 6건)인가?
 *     ├ 예 · 기준일 ≤ 2021-03-24 → 내장 스냅샷 (구 조문 원문)
 *     ├ 예 · 기준일 ≥ 2021-03-25 → 현행 API + 「금소법 제N조로 이관」 안내
 *     └ 아니오                    → **기준일과 무관하게** 현행 API
 *
 * 상법·민법·약관규제법·할부거래법은 시점 무관 법령이라 언제나 현행 조회다.
 * 보험업법 제95조의2는 ①②항만 이관됐고 ③④항은 존치라, 현행 API에 살아 있다
 * (실측 확인 — 제목 「설명의무 등」, 항 4개). 반면 제95조의3은 현행에서
 * `제95조의3 삭제 <2020.3.24>` 껍데기만 남는다. 이 경우 이관 안내가 없으면
 * 이용자는 조문이 사라진 줄로만 알게 되므로, 후속 조문을 함께 돌려준다.
 *
 * 캐시(DR-201): 키 = 법령명+조문번호+기준일 · TTL 1일 ·
 * **만료 행을 삭제하지 않는다** — 만료분이 곧 API 장애 시의 폴백 스냅샷이다.
 */

import "server-only";
import { sql } from "../db";
import { asArray, LawApiError, lawSearch, lawService } from "./law_client";
import { filterToolText } from "./filter";

/** 법령 목록 전량 수신 — 부분일치 결함 대응 (아래 fetchCurrentArticle 주석 참조) */
const LAW_LIST_DISPLAY = 100;

/** 금소법 시행일. 이관 삭제 조문의 분기 경계 */
export const FSCA_EFFECTIVE = "2021-03-25";

export type StatuteSource = "API" | "SNAPSHOT" | "CACHE" | "CACHE_STALE";

export type LookupStatuteResult = {
  lawName: string;
  articleNo: string;
  articleTitle: string | null;
  articleText: string;
  /** 조문 시행일 (API 조회 시) */
  effectiveDate: string | null;
  source: StatuteSource;
  /** 이 값을 화면에 표시한다 (F-501 출처·시점 반환 의무 / F-702 폴백 배지) */
  checkedAt: string;
  /** 금소법 이관 조문일 때의 후속 조문 안내 */
  transferredTo: { lawName: string; articleNo: string; note: string | null } | null;
  /** 폴백 경로로 얻은 값인지 — 화면에 배지로 표시한다 (EP-1) */
  isFallback: boolean;
  flagged: number;
};

/**
 * 조문 본문 첫머리에서 조문 제목을 뽑는다 — 「제638조의3(보험약관의 교부ㆍ설명 의무) ①…」
 *
 * ⚠️ **왜 본문에서 뽑나** — `statute_cache`·`statute_snapshots`에 제목 컬럼이 없다.
 * 그래서 API 조회가 실패해 캐시·스냅샷으로 내려가면 화면에 「보험업법 제95조의2」만
 * 남고 「(설명의무 등)」이 사라졌다. 이용자가 무슨 조문인지 알 수 없게 된다.
 *
 * 법제처 본문은 제목을 항상 이 형태로 앞에 달고 오므로(실측: 캐시·스냅샷 전 행)
 * 컬럼을 늘리는 마이그레이션 없이 **기존 행까지 그대로 살릴 수 있다.**
 * 못 뽑으면 null이다 — 없는 제목을 지어내지 않는다.
 */
export function titleFromArticleText(text: string): string | null {
  const m = /^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?\s*\(([^)]{1,60})\)/.exec(text);
  return m ? m[1].trim() : null;
}

/** 「제95조의2」 → { main: 95, branch: 2 }. 법제처는 조문번호와 가지번호를 나눠 쓴다 */
export function parseArticleNo(s: string): { main: number; branch: number } | null {
  const m = s.match(/제?\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
  if (!m) return null;
  return { main: Number(m[1]), branch: m[2] ? Number(m[2]) : 0 };
}

/**
 * 표기를 대조 키로 정규화한다.
 * `statute_timeline`은 「제95조의2(이관 항)」처럼 설명이 붙은 표기를 쓰므로
 * 괄호 주석과 공백을 떼야 이용자 입력(「제95조의2」)과 맞출 수 있다.
 */
function normalizeArticleNo(s: string): string {
  return s.replace(/\([^)]*\)/g, "").replace(/\s/g, "").trim();
}

type TimelineRow = {
  law_name: string;
  article_no: string;
  applies_to: Date | null;
  successor_law: string | null;
  successor_article: string | null;
  note: string | null;
};

/** 이관 삭제 조문인지 판정한다 — 이 표에 있으면 분기 대상이다 */
async function findTimeline(lawName: string, articleNo: string): Promise<TimelineRow | null> {
  const want = normalizeArticleNo(articleNo);
  const rows = await sql<TimelineRow[]>`
    select law_name, article_no, applies_to, successor_law, successor_article, note
    from statute_timeline where law_name = ${lawName}`;
  return rows.find((r) => normalizeArticleNo(r.article_no) === want) ?? null;
}

async function readSnapshot(
  lawName: string,
  timelineArticleNo: string,
): Promise<{ text: string; capturedAt: Date; validTo: Date | null } | null> {
  // 스냅샷의 article_no는 timeline과 같은 표기를 쓴다 (A-3에서 1:1 조인 검증됨)
  const rows = await sql<{ article_text: string; captured_at: Date; valid_to: Date | null }[]>`
    select article_text, captured_at, valid_to
    from statute_snapshots
    where law_name = ${lawName} and article_no = ${timelineArticleNo}`;
  const r = rows[0];
  return r ? { text: r.article_text, capturedAt: r.captured_at, validTo: r.valid_to } : null;
}

type CacheRow = { article_text: string; effective_date: Date | null; source: string; fetched_at: Date; expires_at: Date };

async function readCache(lawName: string, articleNo: string, basisDate: string): Promise<CacheRow | null> {
  const rows = await sql<CacheRow[]>`
    select article_text, effective_date, source, fetched_at, expires_at
    from statute_cache
    where law_name = ${lawName} and article_no = ${articleNo} and basis_date = ${basisDate}`;
  return rows[0] ?? null;
}

async function writeCache(
  lawName: string, articleNo: string, basisDate: string,
  text: string, effectiveDate: string | null, source: "API" | "SNAPSHOT",
): Promise<void> {
  // 만료 행은 삭제하지 않고 덮어쓴다 (DR-201 — 만료분이 폴백이다)
  await sql`
    insert into statute_cache
      (law_name, article_no, basis_date, article_text, effective_date, source, fetched_at, expires_at)
    values (${lawName}, ${articleNo}, ${basisDate}, ${text},
            ${effectiveDate}, ${source}, now(), now() + interval '1 day')
    on conflict (law_name, article_no, basis_date) do update
      set article_text = excluded.article_text,
          effective_date = excluded.effective_date,
          source = excluded.source,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at`;
}

type RawArticle = {
  조문번호?: string | number;
  조문가지번호?: string | number;
  조문제목?: string | null;
  조문내용?: string;
  조문시행일자?: string | number;
  항?: unknown;
};

/** 항 배열을 본문으로 펼친다. 조문내용만으로는 제목 줄밖에 안 나오는 경우가 있다 */
function flattenArticle(a: RawArticle): string {
  const head = String(a.조문내용 ?? "").trim();
  const paras = asArray(a.항 as { 항내용?: string; 호?: unknown } | { 항내용?: string }[])
    .map((p) => String((p as { 항내용?: string })?.항내용 ?? "").trim())
    .filter(Boolean);
  return [head, ...paras].filter(Boolean).join("\n");
}

/** 현행 법령 본문에서 해당 조문을 뽑는다 */
async function fetchCurrentArticle(
  lawName: string,
  articleNo: string,
): Promise<{ title: string | null; text: string; effectiveDate: string | null } | null> {
  const want = parseArticleNo(articleNo);
  if (!want) return null;

  // ⚠️ 법령 검색도 부분일치다 — 판례(F-502)와 같은 결함이 여기에도 있다.
  // 「상법」 조회 시 56건이 걸리는데 정확 일치가 **34번째**라 기본 20건으로는
  // 영영 못 찾는다(가나다순이라 「1980년해직공무원…」이 앞선다). 실측 2026.08.16.
  // 그래서 목록을 전량 받아(display=100) 이름이 정확히 같은 법령을 고른다.
  const list = (await lawSearch("law", { query: lawName, display: LAW_LIST_DISPLAY })) as {
    LawSearch?: { law?: { 법령명한글?: string; 법령일련번호?: string } | { 법령명한글?: string; 법령일련번호?: string }[] };
  };
  const laws = asArray(list.LawSearch?.law);
  // 「보험업법 시행령」이 아니라 「보험업법」이어야 한다. 정확 일치가 없으면
  // 엉뚱한 법령의 조문을 반환하느니 실패한다 — 잘못된 근거보다 없는 편이 낫다(EP-3)
  const target = laws.find((l) => l.법령명한글?.trim() === lawName);
  if (!target?.법령일련번호) return null;

  const body = (await lawService("law", { MST: target.법령일련번호 })) as {
    법령?: { 조문?: { 조문단위?: RawArticle | RawArticle[] } };
  };
  const arts = asArray(body.법령?.조문?.조문단위);
  const hit = arts.find(
    (a) =>
      Number(a.조문번호) === want.main &&
      Number(a.조문가지번호 ?? 0) === want.branch,
  );
  if (!hit) return null;

  const d = hit.조문시행일자 ? String(hit.조문시행일자) : null;
  return {
    title: hit.조문제목 ? String(hit.조문제목) : null,
    text: flattenArticle(hit),
    effectiveDate: d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d,
  };
}

export type LookupStatuteInput = {
  lawName: string;
  articleNo: string;
  /** 기준일 (YYYY-MM-DD). 필수 — 슬롯 `contract_ym`에서 산정해 넘긴다 */
  basisDate: string;
};

export async function lookupStatute(
  input: LookupStatuteInput,
): Promise<LookupStatuteResult | null> {
  const { lawName, articleNo, basisDate } = input;
  const timeline = await findTimeline(lawName, articleNo);
  // 이관 전 구간인지 — timeline이 있고 기준일이 유효기간 안일 때만이다
  const beforeTransfer =
    timeline?.applies_to != null &&
    basisDate <= timeline.applies_to.toISOString().slice(0, 10);

  const transferredTo =
    timeline?.successor_law && timeline.successor_article
      ? { lawName: timeline.successor_law, articleNo: timeline.successor_article, note: timeline.note }
      : null;

  // ── 경로 1: 이관 삭제 조문 + 기준일이 이관 전 → 내장 스냅샷 ──────────
  if (beforeTransfer && timeline) {
    const snap = await readSnapshot(lawName, timeline.article_no);
    if (snap) {
      const f = filterToolText(snap.text);
      await writeCache(lawName, articleNo, basisDate, snap.text, null, "SNAPSHOT");
      return {
        lawName, articleNo,
        articleTitle: titleFromArticleText(snap.text),
        articleText: f.text,
        effectiveDate: null,
        source: "SNAPSHOT",
        checkedAt: snap.capturedAt.toISOString().slice(0, 10),
        transferredTo,
        isFallback: false, // 스냅샷은 이 경로의 정상 응답이지 폴백이 아니다
        flagged: f.flagged,
      };
    }
    // 스냅샷이 있어야 하는데 없다 — EX-207. 현행 조회로 넘어가되 이관 안내는 유지한다
  }

  // ── 경로 2: 그 외 전부 → 현행 API (기준일 무관) ──────────────────────
  const today = new Date().toISOString().slice(0, 10);
  try {
    const cur = await fetchCurrentArticle(lawName, articleNo);
    if (cur) {
      const f = filterToolText(cur.text);
      await writeCache(lawName, articleNo, basisDate, cur.text, cur.effectiveDate, "API");
      return {
        lawName, articleNo,
        // API가 제목을 안 주는 경우가 있어 본문에서 보강한다
        articleTitle: cur.title ?? titleFromArticleText(cur.text),
        articleText: f.text,
        effectiveDate: cur.effectiveDate,
        source: "API",
        checkedAt: today,
        transferredTo,
        isFallback: false,
        flagged: f.flagged,
      };
    }
  } catch (e) {
    if (!(e instanceof LawApiError)) throw e;
    // 폴백 체인으로 내려간다 (E-01)
  }

  // ── 폴백: 캐시 → 만료 캐시 → 없음 (E-01 폴백 체인) ────────────────────
  const cached = await readCache(lawName, articleNo, basisDate);
  if (cached) {
    const stale = cached.expires_at.getTime() < Date.now();
    const f = filterToolText(cached.article_text);
    return {
      lawName, articleNo,
      articleTitle: titleFromArticleText(cached.article_text),
      articleText: f.text,
      effectiveDate: cached.effective_date?.toISOString().slice(0, 10) ?? null,
      source: stale ? "CACHE_STALE" : "CACHE",
      checkedAt: cached.fetched_at.toISOString().slice(0, 10),
      transferredTo,
      // 만료분을 쓴 경우만 폴백 배지를 단다. TTL 내 캐시는 정상 응답이다
      isFallback: stale,
      flagged: f.flagged,
    };
  }

  // 근거 없이 진행한다 — 조사 계층이 확신도에 반영하고, 부족하면 유보로 간다
  return null;
}
