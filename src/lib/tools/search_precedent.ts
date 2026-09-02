/**
 * F-502 `search_precedent` — 판례 조회 (SR-302 · E-02).
 *
 * **알려진 결함과 그 대응이 이 도구의 전부다.**
 *
 * 법제처 판례 검색은 부분일치로 동작해 **요청 사건번호가 1순위로 오지 않는다.**
 * 기획서 6.6은 이를 "무관한 사건이 1순위 반환"까지만 관찰하고 사실상 조회
 * 불가로 읽었는데, 2026.08.16 재조사에서 성격이 정정됐다 —
 * **요청 사건번호는 결과 목록 안에 실제로 있다. 뒤에 있을 뿐이다.**
 *
 *   2010다76368 → 16건 중 16번째 (대법원 2011.07.28 손해배상(기))
 *   2016다212272 →  5건 중  5번째
 *   2019다224238 →  4건 중  4번째
 *
 * 그래서 **1순위를 보지 않고 목록 전량을 스캔**한다(`display=100`). 사건번호
 * 조회는 결과가 4~16건 규모라 1회 호출로 전량 수신된다.
 * 실측에서 정확 일치가 항상 끝에 있었지만 **끝 항목을 집는 편법은 쓰지 않는다** —
 * 위치가 보장된 성질이 아니고, 전량 스캔이 비용도 같으면서 안전하다.
 *
 * 전량 스캔에도 없으면 결과를 반환하되 **표시 불가 플래그**를 붙인다.
 * 대조는 **캐시 적중 여부와 무관하게 항상 수행한다** — 캐시가 대조를 우회하는
 * 경로가 되어선 안 된다 (DR-202).
 */

import "server-only";
import { asArray, lawSearch } from "./law_client";
import { filterToolText } from "./filter";

export type PrecedentHit = {
  caseNo: string;
  caseName: string;
  courtName: string | null;
  judgmentDate: string | null;
  /** 법제처 상세 링크 구성용 일련번호 */
  serialNo: string | null;
};

export type SearchPrecedentResult = {
  /** 요청 사건번호와 정확히 일치한 판례. 없으면 null */
  exact: PrecedentHit | null;
  /**
   * 화면·프롬프트에 인용해도 되는지. `exact`가 없으면 false다.
   * false인 결과를 근거로 쓰면 부분일치 오반환을 그대로 인용하게 된다.
   */
  citable: boolean;
  /** 전량 스캔 대상이 된 결과. 진단·실행 로그용이며 근거로 쓰지 않는다 */
  candidates: PrecedentHit[];
  /** 정확 일치가 목록의 몇 번째였는지 (1-base). 없으면 null — 대조 성공률 측정에 쓴다 */
  exactRank: number | null;
  totalCount: number;
  /** 사건번호 대조 실패 후 쟁점 키워드로 재시도했는지 */
  retriedByKeyword: boolean;
  flagged: number;
};

const DISPLAY = 100;

/** 공백·하이픈 등 표기 흔들림을 흡수한다. 「2010다76368」과 「2010 다 76368」은 같다 */
function normalizeCaseNo(s: string): string {
  return s.replace(/[\s\-·]/g, "").trim();
}

type RawPrec = {
  사건번호?: string;
  사건명?: string;
  법원명?: string;
  선고일자?: string;
  판례일련번호?: string;
};

function toHit(r: RawPrec): PrecedentHit {
  return {
    caseNo: (r.사건번호 ?? "").trim(),
    caseName: (r.사건명 ?? "").trim(),
    courtName: r.법원명?.trim() ?? null,
    judgmentDate: r.선고일자?.trim() ?? null,
    serialNo: r.판례일련번호?.trim() ?? null,
  };
}

async function fetchList(query: string): Promise<{ hits: PrecedentHit[]; total: number }> {
  const json = (await lawSearch("prec", { query, display: DISPLAY })) as {
    PrecSearch?: { prec?: RawPrec | RawPrec[]; totalCnt?: number | string };
  };
  const s = json.PrecSearch;
  if (!s) return { hits: [], total: 0 };
  return { hits: asArray(s.prec).map(toHit), total: Number(s.totalCnt ?? 0) };
}

/**
 * 목록 전량에서 정확 일치를 찾는다. **1순위만 보지 않는다** (위 주석 참조).
 * 반환 순위(rank)는 연동 7장 체크 3의 대조 성공률 측정 자료가 된다.
 */
function findExact(
  hits: readonly PrecedentHit[],
  caseNo: string,
): { hit: PrecedentHit | null; rank: number | null } {
  const want = normalizeCaseNo(caseNo);
  for (const [i, h] of hits.entries()) {
    if (normalizeCaseNo(h.caseNo) === want) return { hit: h, rank: i + 1 };
  }
  return { hit: null, rank: null };
}

export type SearchPrecedentInput = {
  /** 사건번호. 있으면 정확 대조 대상이 된다 */
  caseNo?: string;
  /** 사건번호 대조 실패 시 재시도할 쟁점 키워드 */
  issueKeyword?: string;
};

export async function searchPrecedent(
  input: SearchPrecedentInput,
): Promise<SearchPrecedentResult> {
  const empty: SearchPrecedentResult = {
    exact: null, citable: false, candidates: [], exactRank: null,
    totalCount: 0, retriedByKeyword: false, flagged: 0,
  };

  // 사건번호 없이 키워드만 온 경우 — 정확 대조 대상이 없으므로 인용 불가다.
  // 후보를 돌려주되 citable=false를 유지한다.
  if (!input.caseNo) {
    if (!input.issueKeyword) return empty;
    const { hits, total } = await fetchList(input.issueKeyword);
    return { ...empty, candidates: hits, totalCount: total, retriedByKeyword: true };
  }

  const first = await fetchList(input.caseNo);
  const found = findExact(first.hits, input.caseNo);

  if (found.hit) {
    const f = filterToolText(found.hit.caseName);
    return {
      exact: { ...found.hit, caseName: f.text },
      citable: true,
      candidates: first.hits,
      exactRank: found.rank,
      totalCount: first.total,
      retriedByKeyword: false,
      flagged: f.flagged,
    };
  }

  // 대조 실패 → 쟁점 키워드로 1회 재시도 (F-502). 재시도 결과도 같은 대조를 거친다
  if (input.issueKeyword) {
    const second = await fetchList(input.issueKeyword);
    const again = findExact(second.hits, input.caseNo);
    if (again.hit) {
      const f = filterToolText(again.hit.caseName);
      return {
        exact: { ...again.hit, caseName: f.text },
        citable: true,
        candidates: second.hits,
        exactRank: again.rank,
        totalCount: second.total,
        retriedByKeyword: true,
        flagged: f.flagged,
      };
    }
    return {
      ...empty,
      candidates: second.hits,
      totalCount: second.total,
      retriedByKeyword: true,
    };
  }

  // 표시 불가 — 후보는 진단용으로만 남긴다
  return { ...empty, candidates: first.hits, totalCount: first.total };
}
