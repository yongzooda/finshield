/**
 * MCP로 공개하는 도구 5종 (SR-X08).
 *
 * ## 왜 공개하나
 *
 * 프리케이스가 쌓은 것은 화면이 아니라 **판단 근거를 꺼내 오는 방법**이다.
 * 조문 이관 이력, 사건번호 정확 대조, 채널×특성 사전 집계 — 이건 우리 화면에서만
 * 쓰기에는 아깝다. 다른 팀이 자기 서비스에서 같은 근거를 쓸 수 있으면
 * 불완전판매 판단의 바닥이 넓어진다.
 *
 * ## 공개해도 되는 이유
 *
 * 다섯 개 전부 **읽기 전용**이고, 읽는 대상이 전부 공개 자료다 — 법제처 API,
 * 공개된 분쟁조정 사례, 사전 집계값. **이용자 진술·슬롯·판단 결과는 어디에도
 * 저장되지 않으므로**(N-403) 애초에 이 도구들이 읽을 수 있는 곳에 없다.
 * 「공개하면 뭐가 새나」를 검토할 대상 자체가 존재하지 않는 구조다.
 *
 * ## 설명문에 결함을 적는다
 *
 * `search_precedent`의 설명에 **법제처 검색이 부분일치로 동작한다는 사실**을
 * 그대로 적었다. 우리 화면은 대조에 실패하면 인용하지 않는 것으로 막지만,
 * 남이 이 도구를 쓸 때는 그 사실을 모르면 무관한 판례를 인용하게 된다.
 * 도구를 내주면서 결함을 숨기는 건 근거를 오염시키는 것과 같다.
 */

import "server-only";
import { lookupStatute } from "@/lib/tools/lookup_statute";
import { searchPrecedent } from "@/lib/tools/search_precedent";
import { searchCase } from "@/lib/tools/search_case";
import { checkDocuments } from "@/lib/tools/check_documents";
import { analyzeRiskPattern } from "@/lib/tools/analyze_risk_pattern";
import {
  DB_CHANNELS,
  DB_TRAITS,
  PRODUCT_CODES,
  SECTORS,
  type DbChannel,
  type DbTrait,
  type ProductCode,
  type Sector,
} from "@/lib/types";

/** JSON Schema 조각 — 스키마 라이브러리를 새로 들이지 않는다 */
type Schema = Record<string, unknown>;

const str = (description: string, extra: Schema = {}): Schema => ({
  type: "string",
  description,
  ...extra,
});
const enumOf = (values: readonly string[], description: string): Schema => ({
  type: "string",
  enum: [...values],
  description,
});
const arrayOf = (items: Schema, description: string): Schema => ({
  type: "array",
  items,
  description,
});

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  /** 외부 API를 부르는 도구인지 — 상한을 따로 건다 */
  callsExternalApi: boolean;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

/** 배열 인자를 안전하게 좁힌다 — 열거 밖 값은 버린다 */
function pickAll<T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is T => typeof x === "string" && (allowed as readonly string[]).includes(x));
  return out.length > 0 ? out : undefined;
}

function pickOne<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

function strings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : undefined;
}

function num(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "lookup_statute",
    title: "법령 조문 조회",
    callsExternalApi: true,
    description: [
      "법령 조문 본문을 기준일 시점 기준으로 조회한다. 출처(API·스냅샷·캐시)와 조회 시각을 항상 함께 돌려준다.",
      "",
      "분기는 기준일 단독이 아니라 **조문에 종속**한다. 요청 조문이 2021.3.25 금융소비자보호법 이관으로 삭제된 6개 조문이고 기준일이 이관 전이면 내장 스냅샷을 쓰고, 그 밖에는 기준일과 무관하게 현행 API를 쓴다. 보험업법 제95조의2처럼 일부 항만 이관된 조문은 존치 항이 있으므로 현행 API 경로다.",
      "",
      "이관 조문이면 후속 조문 안내(transferredTo)를 함께 돌려준다. 폴백 경로로 얻은 값은 isFallback으로 표시하므로, 화면에 쓸 때 그 사실을 감추지 말 것.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        lawName: str("법령명. 예: 「상법」, 「보험업법」, 「자본시장과 금융투자업에 관한 법률」"),
        articleNo: str("조문 번호. 예: 「638조의3」, 「95조의2」. 가지번호는 「의N」로 적는다"),
        basisDate: str("기준일 YYYY-MM-DD. 계약 체결 시점에서 산정한다", {
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        }),
      },
      required: ["lawName", "articleNo", "basisDate"],
      additionalProperties: false,
    },
    run: (a) =>
      lookupStatute({
        lawName: String(a.lawName ?? ""),
        articleNo: String(a.articleNo ?? ""),
        basisDate: String(a.basisDate ?? ""),
      }),
  },

  {
    name: "search_precedent",
    title: "판례 검색 (사건번호 정확 대조)",
    callsExternalApi: true,
    description: [
      "법제처 판례 검색을 사건번호로 조회하고, **반환된 사건번호가 요청과 정확히 일치하는지 대조한다.**",
      "",
      "⚠️ 알려진 결함을 먼저 밝힌다. 법제처 검색은 부분일치로 동작한다. 「2010다76368」을 조회하면 무관한 2026년 사건이 1순위로 돌아오는 것을 실측으로 확인했다. 그래서 이 도구는 정확 일치하는 항목만 exact에 담고, citable=false이면 **그 결과를 인용하면 안 된다.** candidates는 사람이 눈으로 확인하라고 주는 것이지 인용 대상이 아니다.",
      "",
      "사건번호 없이 issueKeyword만 주면 대조할 대상이 없으므로 citable은 언제나 false다.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        caseNo: str("사건번호. 예: 「2010다76368」. 이 값과 정확히 일치하는 결과만 인용 가능으로 표시한다"),
        issueKeyword: str("사건번호 대조에 실패했을 때 재시도할 쟁점 키워드"),
      },
      additionalProperties: false,
    },
    run: (a) =>
      searchPrecedent({
        caseNo: typeof a.caseNo === "string" ? a.caseNo : undefined,
        issueKeyword: typeof a.issueKeyword === "string" ? a.issueKeyword : undefined,
      }),
  },

  {
    name: "search_case",
    title: "유사 분쟁조정 사례 검색",
    callsExternalApi: false,
    description: [
      "공개된 금융분쟁조정 사례에서 조건이 비슷한 건을 찾는다. 외부 API를 쓰지 않는다.",
      "",
      "모든 조건은 선택이다. 넘기지 않은 축은 필터를 걸지 않는다. 채널이 확인되지 않았다면 아예 빼는 편이 낫다 — 없는 값을 「미상」으로 만들어 넣으면 모집단이 틀어진다.",
      "",
      "factsText는 사실관계 비교용이며, 이용자 원문이 아니라 **정제된 사실관계**를 넣는 자리다.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        sector: enumOf(SECTORS, "업권"),
        productCode: enumOf(PRODUCT_CODES, "상품군 13종"),
        channel: enumOf(DB_CHANNELS, "판매채널. 확인되지 않았으면 넘기지 않는다"),
        traits: arrayOf(enumOf(DB_TRAITS, "소비자 특성"), "소비자 특성 (복수)"),
        issues: arrayOf(str("쟁점 태그 코드"), "쟁점 태그. 예: 「설명의무」, 「적합성원칙」"),
        factsText: str("사실관계 비교용 텍스트. 정제된 사실관계를 넣는다"),
        limit: { type: "integer", minimum: 1, maximum: 20, description: "최대 반환 건수" },
      },
      additionalProperties: false,
    },
    run: (a) =>
      searchCase({
        sector: pickOne<Sector>(a.sector, SECTORS),
        productCode: pickOne<ProductCode>(a.productCode, PRODUCT_CODES),
        channel: pickOne<DbChannel>(a.channel, DB_CHANNELS),
        traits: pickAll<DbTrait>(a.traits, DB_TRAITS),
        issues: strings(a.issues),
        factsText: typeof a.factsText === "string" ? a.factsText : undefined,
        limit: num(a.limit, 1, 20),
      }),
  },

  {
    name: "check_documents",
    title: "필요 자료 점검",
    callsExternalApi: false,
    description: [
      "쟁점과 판매채널을 기준으로 **분쟁에서 실제로 요구된 자료**를 돌려준다. 외부 API를 쓰지 않는다.",
      "",
      "채널마다 「설명을 들었다」를 입증하는 수단이 다르다 — 전화 판매는 녹취에, 창구는 서명본에 남는다. 그래서 같은 쟁점이어도 채널이 다르면 필요한 자료가 달라진다.",
      "",
      "possessed에 이미 가지고 있는 항목을 넘기면 남은 것만 골라낼 수 있다.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        issues: arrayOf(str("쟁점 태그 코드"), "쟁점 태그"),
        channel: enumOf(DB_CHANNELS, "판매채널"),
        possessed: arrayOf(str("이미 보유한 자료 key"), "이미 가지고 있는 자료"),
        clauseLimit: { type: "integer", minimum: 1, maximum: 20, description: "관련 약관 조항 최대 개수" },
      },
      additionalProperties: false,
    },
    run: (a) =>
      checkDocuments({
        issues: strings(a.issues),
        channel: pickOne<DbChannel>(a.channel, DB_CHANNELS),
        possessed: strings(a.possessed),
        clauseLimit: num(a.clauseLimit, 1, 20),
      }),
  },

  {
    name: "analyze_risk_pattern",
    title: "위험 패턴 조회",
    callsExternalApi: false,
    description: [
      "상품군·채널·소비자 특성 조합에서 **어떤 쟁점이 얼마나 다뤄졌는지**를 사전 집계값으로 돌려준다. 외부 API도, 모델도 쓰지 않는다.",
      "",
      "요청한 조합에 표본이 없으면 축을 하나씩 넓혀 가며 재시도하고, 실제로 무엇을 기준으로 센 값인지(granularity)를 함께 돌려준다. **이 값을 확인하지 않고 수치만 쓰면 안 된다** — 「TM×ELDER」를 물었는데 「전체」 집계가 돌아왔을 수 있다.",
      "",
      "빈도는 지금까지 공개된 사례를 센 값이지 앞으로의 결과를 예측한 값이 아니다.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        productCode: enumOf(PRODUCT_CODES, "상품군 13종"),
        channel: enumOf(DB_CHANNELS, "판매채널"),
        trait: enumOf(DB_TRAITS, "소비자 특성. 집계표의 trait 축이 단일값이라 하나만 받는다"),
      },
      additionalProperties: false,
    },
    run: (a) =>
      analyzeRiskPattern({
        productCode: pickOne<ProductCode>(a.productCode, PRODUCT_CODES),
        channel: pickOne<DbChannel>(a.channel, DB_CHANNELS),
        trait: pickOne<DbTrait>(a.trait, DB_TRAITS),
      }),
  },
];

export const TOOL_BY_NAME: ReadonlyMap<string, McpTool> = new Map(
  MCP_TOOLS.map((t) => [t.name, t]),
);
