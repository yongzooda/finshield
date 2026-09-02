/**
 * ③ 개선 축 집계 — 기관 화면(SR-103)이 읽는 유일한 데이터 출처.
 *
 * ## 두 가지를 구조로 못박는다
 *
 * **1. 공개 조정례만 센다.** 이용자 상담 내용은 애초에 어디에도 저장되지 않으므로
 * (DR-4xx) 집계에 섞일 경로 자체가 없다. 이 모듈은 `cases`·`case_issues`·
 * `case_traits`만 읽고, 세션·판단 결과를 담는 테이블은 존재하지 않는다.
 * 기획서 9.3의 「축 간 데이터 분리」가 코드에서는 **읽을 것이 없다**는 형태다.
 *
 * **2. 얇은 곳을 얇다고 말한다.** 라벨 부착률이 축마다 크게 다르다 — 실측(388건
 * 기준)으로 채널 125 · 소비자 특성 39 · 배상비율 35다. 퍼센트만 뽑으면
 * 2건짜리 칸이 61건짜리 칸과 같은 굵기로 보인다. 그래서 **모든 반환값이 건수를
 * 들고 다니고**, 화면은 건수 없이 비율만 그릴 수 없다 (S-06에서 세운 원칙을
 * 기관 화면에도 그대로 적용).
 *
 * 읽기 전용이며 모델을 부르지 않는다.
 */

import "server-only";
import { sql } from "../db";
import type { DbChannel, DbTrait } from "../types";

/** 표본이 이만큼 아래면 화면이 「수치로 읽지 말라」고 말한다 (S-06과 같은 기준) */
export const SMALL_SAMPLE_N = 20;

/**
 * 집계 질의를 **프로세스 안에서 한 번에 하나만** 보낸다.
 *
 * ## 왜 필요한가
 *
 * 정적 생성은 워커 9개가 페이지 19개를 나눠 렌더한다. 한 워커가 `/insight`와
 * `/insight/channel`을 동시에 그리면 집계 질의가 겹치는데, 커넥션 풀(max 5)을
 * 넘긴 질의는 **같은 연결에 파이프라이닝**된다. Supavisor 트랜잭션 모드는 이
 * 상황을 견디지 못한다 — 실측(2026.08.25)으로 동시 12건에서 응답이 아예
 * 돌아오지 않았고, 빌드에서는 **한 질의가 다른 질의의 행을 받았다**
 * (`channelIssueMatrix`의 채널 질의에 특성 행이 왔다).
 *
 * 모양이 달라 빌드가 멈춘 것은 운이 좋았다. **열 이름이 겹쳤으면 틀린 수치가
 * 조용히 배포됐다.** 정확성을 걸고 하는 서비스에서 그건 최악이다.
 *
 * 그래서 이 모듈의 질의는 줄을 서서 나간다. 기관 화면은 1시간 ISR이라
 * 직렬화 비용이 사실상 없고, 판단 파이프라인은 이 큐를 쓰지 않으므로 영향이 없다.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // 앞 질의가 실패해도 줄이 끊기지 않게 한다
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * 질의 결과가 **약속한 모양인지 경계에서 확인한다.**
 *
 * 타입 단언(`sql<T[]>`)은 컴파일 시점의 약속일 뿐 런타임에 아무것도 막지 못한다.
 * 실제로 2026.08.25 빌드에서 이 함수가 **다른 질의의 행을 받은 적이 있다** —
 * Next 증분 빌드 캐시(`.next`)가 소스를 고친 직후 페이지를 옛 모듈 출력에 물려서,
 * 채널 5행이 와야 할 자리에 특성 4행이 왔다. 그때는 모양이 달라 화면이 터졌지만
 * **모양만 같았으면 틀린 수치가 조용히 배포됐을 것이다.**
 *
 * 그래서 「도구가 반환하지 않은 것은 렌더링되지 않는다」(절대 규칙 1)를 여기에도
 * 적용한다 — 약속한 열이 없으면 **화면을 그리지 않고 멈춘다.** 조용히 넘어가는
 * 것보다 빌드가 실패하는 편이 낫다.
 *
 * 참고: 이 오류를 만나면 `.next`를 지우고 다시 빌드한다 (Vercel은 빌드 캐시 삭제).
 */
function checkShape<T>(rows: readonly T[], keys: readonly (keyof T)[], where: string): void {
  if (rows.length === 0) return; // 빈 결과는 정상이다 — 코퍼스가 얇을 수 있다
  const missing = keys.filter((k) => rows[0][k] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `집계 결과의 모양이 약속과 다릅니다 (${where}) — 없는 열: ${missing.join(", ")}. ` +
        `받은 열: ${Object.keys(rows[0] as object).join(", ")}. ` +
        `빌드 캐시가 원인일 수 있습니다 — .next를 지우고 다시 빌드해 보세요.`,
    );
  }
}

export type Verdicts = { upheld: number; rejected: number };

/** 집계 한 칸 — **건수 없이는 만들 수 없다** */
export type Cell = { n: number } & Verdicts;

export type ChannelIssueMatrix = {
  /** 채널이 라벨된 사건 수. 히트맵의 모집단이다 */
  labelled: number;
  /** 전체 코퍼스 — 라벨 부착률을 화면이 계산할 수 있게 함께 준다 */
  corpus: number;
  channels: { channel: DbChannel; n: number }[];
  issues: { code: string; n: number }[];
  /** `${channel}|${issue}` → 칸 */
  cells: Record<string, Cell>;
};

/** 반복 쟁점 한 줄 */
export type IssueRow = {
  code: string;
  n: number;
  upheld: number;
  rejected: number;
  /** 배상비율은 표본이 따로 논다 — 있는 것만 센다 (SR-X10 병기 대상) */
  rateN: number;
  rateMedian: number | null;
  rateMin: number | null;
  rateMax: number | null;
  /** 이 쟁점이 가장 많이 나타난 채널 (라벨된 것 중) */
  topChannel: { channel: DbChannel; n: number } | null;
};

export type TraitRow = {
  trait: DbTrait;
  n: number;
  upheld: number;
  rejected: number;
  /** 이 특성에서 가장 잦은 쟁점 3개 */
  topIssues: { code: string; n: number }[];
};

export type TraitDistribution = {
  labelled: number;
  corpus: number;
  rows: TraitRow[];
};

/**
 * 채널 × 쟁점 — 어느 채널에서 어느 쟁점이 집중되는가.
 *
 * 채널이 `NULL`인 사건은 **세지 않는다.** 원문에 판매채널이 적혀 있지 않은
 * 것이지 「미상 채널」이라는 채널이 있는 것이 아니다 (D-2).
 */
async function channelIssueMatrixQuery(): Promise<ChannelIssueMatrix> {
  const [totals] = await sql<{ corpus: number; labelled: number }[]>`
    select count(*)::int as corpus,
           count(*) filter (where channel is not null)::int as labelled
      from cases`;

  const channels = await sql<{ channel: DbChannel; n: number }[]>`
    select channel, count(*)::int as n
      from cases where channel is not null
     group by channel order by n desc`;

  const issues = await sql<{ code: string; n: number }[]>`
    select t.code, count(distinct c.id)::int as n
      from cases c
      join case_issues ci on ci.case_id = c.id
      join issue_tags t on t.id = ci.issue_tag_id
     where c.channel is not null
     group by t.code order by n desc`;

  const raw = await sql<
    { channel: DbChannel; code: string; n: number; upheld: number; rejected: number }[]
  >`
    select c.channel, t.code,
           count(*)::int as n,
           count(*) filter (where c.verdict = 'UPHELD')::int as upheld,
           count(*) filter (where c.verdict = 'REJECTED')::int as rejected
      from cases c
      join case_issues ci on ci.case_id = c.id
      join issue_tags t on t.id = ci.issue_tag_id
     where c.channel is not null
     group by c.channel, t.code`;

  checkShape(channels, ["channel", "n"], "채널×쟁점 — 채널");
  checkShape(issues, ["code", "n"], "채널×쟁점 — 쟁점");
  checkShape(raw, ["channel", "code", "n", "upheld", "rejected"], "채널×쟁점 — 칸");

  const cells: Record<string, Cell> = {};
  for (const r of raw) {
    cells[`${r.channel}|${r.code}`] = { n: r.n, upheld: r.upheld, rejected: r.rejected };
  }

  return {
    corpus: totals.corpus,
    labelled: totals.labelled,
    channels,
    issues,
    cells,
  };
}

/**
 * 반복 쟁점 — 무엇이 몇 번 다뤄졌고 어떻게 끝났는가.
 *
 * 채널 라벨과 무관하게 **코퍼스 전체**를 센다. 채널은 부가 정보로만 붙인다 —
 * 채널이 없다고 그 사건의 쟁점이 없어지는 것은 아니다.
 */
async function issueRowsQuery(): Promise<{ corpus: number; rows: IssueRow[] }> {
  const [{ corpus }] = await sql<{ corpus: number }[]>`select count(*)::int as corpus from cases`;

  const rows = await sql<IssueRow[]>`
    with per_issue as (
      select t.id, t.code,
             count(*)::int as n,
             count(*) filter (where c.verdict = 'UPHELD')::int as upheld,
             count(*) filter (where c.verdict = 'REJECTED')::int as rejected,
             count(c.compensation_rate)::int as "rateN",
             percentile_cont(0.5) within group (order by c.compensation_rate)
               filter (where c.compensation_rate is not null) as "rateMedian",
             min(c.compensation_rate)::int as "rateMin",
             max(c.compensation_rate)::int as "rateMax"
        from issue_tags t
        join case_issues ci on ci.issue_tag_id = t.id
        join cases c on c.id = ci.case_id
       group by t.id, t.code
    ),
    top_channel as (
      select distinct on (t.id) t.id, c.channel, count(*)::int as n
        from issue_tags t
        join case_issues ci on ci.issue_tag_id = t.id
        join cases c on c.id = ci.case_id
       where c.channel is not null
       group by t.id, c.channel
       order by t.id, n desc, c.channel
    )
    select p.code, p.n, p.upheld, p.rejected,
           p."rateN", p."rateMedian", p."rateMin", p."rateMax",
           case when tc.channel is null then null
                else json_build_object('channel', tc.channel, 'n', tc.n) end as "topChannel"
      from per_issue p
      left join top_channel tc on tc.id = p.id
     order by p.n desc, p.code`;

  checkShape(rows, ["code", "n", "upheld", "rejected", "rateN"], "반복 쟁점");

  return {
    corpus,
    rows: rows.map((r) => ({
      ...r,
      rateMedian: r.rateMedian === null ? null : Number(r.rateMedian),
    })),
  };
}

/**
 * 소비자 특성별 분포.
 *
 * ⚠️ **이 축이 가장 얇다.** 특성은 조정결정서의 「위원회 판단」 서술에서만 드러나는
 * 경우가 많아 라벨 부착률이 낮다(실측 39/388). 그 사실을 숨기면 1건짜리 특성이
 * 지표처럼 보이므로, 모집단과 부착률을 함께 돌려준다.
 */
async function traitDistributionQuery(): Promise<TraitDistribution> {
  const [totals] = await sql<{ corpus: number; labelled: number }[]>`
    select (select count(*)::int from cases) as corpus,
           (select count(distinct case_id)::int from case_traits) as labelled`;

  const rows = await sql<TraitRow[]>`
    with per_trait as (
      select ct.trait,
             count(*)::int as n,
             count(*) filter (where c.verdict = 'UPHELD')::int as upheld,
             count(*) filter (where c.verdict = 'REJECTED')::int as rejected
        from case_traits ct
        join cases c on c.id = ct.case_id
       group by ct.trait
    )
    select p.trait, p.n, p.upheld, p.rejected,
           coalesce((
             select json_agg(x order by x.n desc, x.code)
               from (
                 select t.code, count(*)::int as n
                   from case_traits ct2
                   join case_issues ci on ci.case_id = ct2.case_id
                   join issue_tags t on t.id = ci.issue_tag_id
                  where ct2.trait = p.trait
                  group by t.code
                  order by n desc, t.code
                  limit 3
               ) x
           ), '[]'::json) as "topIssues"
      from per_trait p
     order by p.n desc, p.trait`;

  checkShape(rows, ["trait", "n", "upheld", "rejected", "topIssues"], "특성별 분포");

  return { corpus: totals.corpus, labelled: totals.labelled, rows };
}

/**
 * 판매 프로세스 점검 항목 — 채널별로 「무엇을 남겨 두어야 하는가」.
 *
 * 분쟁 패턴에서 **역산**한다: 그 채널에서 실제로 다퉈진 쟁점을 세고, 그 쟁점을
 * 다투려면 어떤 증빙이 필요한지 `terms_clauses`가 아니라 **채널의 성질**에서
 * 가져온다(전화는 녹취, 창구는 서명본). 근거는 건수이며 문장은 코드가 만든다 —
 * 모델을 부르지 않으므로 지어낼 여지가 없다.
 */
export type ChannelChecklist = {
  channel: DbChannel;
  n: number;
  upheld: number;
  rejected: number;
  /** 이 채널에서 잦은 쟁점 상위 5개 */
  issues: { code: string; n: number }[];
};

async function channelChecklistsQuery(): Promise<{
  labelled: number;
  rows: ChannelChecklist[];
}> {
  const [{ labelled }] = await sql<{ labelled: number }[]>`
    select count(*)::int as labelled from cases where channel is not null`;

  const rows = await sql<ChannelChecklist[]>`
    with per_channel as (
      select channel,
             count(*)::int as n,
             count(*) filter (where verdict = 'UPHELD')::int as upheld,
             count(*) filter (where verdict = 'REJECTED')::int as rejected
        from cases where channel is not null group by channel
    )
    select p.channel, p.n, p.upheld, p.rejected,
           coalesce((
             select json_agg(x order by x.n desc, x.code)
               from (
                 select t.code, count(*)::int as n
                   from cases c2
                   join case_issues ci on ci.case_id = c2.id
                   join issue_tags t on t.id = ci.issue_tag_id
                  where c2.channel = p.channel
                  group by t.code
                  order by n desc, t.code
                  limit 5
               ) x
           ), '[]'::json) as issues
      from per_channel p
     order by p.n desc`;

  checkShape(rows, ["channel", "n", "upheld", "rejected", "issues"], "채널별 점검표");

  return { labelled, rows };
}

/** 줄을 서서 나간다 — 위 `serialized` 주석 참조 */
export function channelIssueMatrix(): Promise<ChannelIssueMatrix> {
  return serialized(channelIssueMatrixQuery);
}

/** 줄을 서서 나간다 — 위 `serialized` 주석 참조 */
export function issueRows(): Promise<{ corpus: number; rows: IssueRow[] }> {
  return serialized(issueRowsQuery);
}

/** 줄을 서서 나간다 — 위 `serialized` 주석 참조 */
export function traitDistribution(): Promise<TraitDistribution> {
  return serialized(traitDistributionQuery);
}

/** 줄을 서서 나간다 — 위 `serialized` 주석 참조 */
export function channelChecklists(): Promise<{ labelled: number; rows: ChannelChecklist[] }> {
  return serialized(channelChecklistsQuery);
}
