/**
 * ② 조사 계층 (F-303 · F-501~505 · F-607).
 *
 * **원문을 보지 않는다.** 입력은 확정 슬롯과 정제 사실관계뿐이며, 타입이
 * 그것을 강제한다 (`InvestigateInput`).
 *
 * 도구·순서는 모델이 자율 선택한다 (F-303). 다만 자율의 범위를 세 겹으로 좁힌다:
 *
 *  1. **법령명은 허용 목록 안에서만** 고를 수 있다. 열려 있으면 존재하지 않는
 *     법을 조회해 「조회 실패」를 근거 공백으로 남기게 된다.
 *  2. **호출마다 상한을 소진**한다 (F-607). 초과는 예외가 아니라 조사 종료
 *     신호이며, 모아둔 근거로 판단을 계속한다 (EX-204).
 *  3. **근거는 도구 반환값에서만 쌓인다.** 모델이 요약한 문장은 근거가 되지
 *     않는다 — 아래 루프가 `Evidence`를 만들 때 모델 텍스트를 일절 읽지 않는
 *     것이 F-603의 구조적 구현이다.
 *
 * 조문 선택은 시점에 종속된다 (기획서 6.4). 금소법 시행일(2021.3.25) 전후로
 * 적용 법령이 갈리므로 그 판정 결과를 프롬프트에 **사실로 박아** 넣는다 —
 * 모델이 시점을 추론하게 두면 금소법 오적용이 되살아난다.
 */

import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./model";
import { env } from "../env";
import { FSCA_EFFECTIVE, lookupStatute } from "../tools/lookup_statute";
import { searchPrecedent } from "../tools/search_precedent";
import { searchCase } from "../tools/search_case";
import { checkDocuments } from "../tools/check_documents";
import { analyzeRiskPattern } from "../tools/analyze_risk_pattern";
import { LawApiError } from "../tools/law_client";
import type { ToolBudget } from "../tools/budget";
import type { Trace } from "./trace";
import type { Evidence, InvestigateInput } from "./types";
import type { DbChannel, DbTrait, Sector, Slots } from "../types";

/** 조회 가능한 법령 (기획서 8.2에서 8종 조회 확인). 밖의 법령명은 도구가 거부한다 */
const LAW_NAMES = [
  "금융소비자 보호에 관한 법률",
  "자본시장과 금융투자업에 관한 법률",
  "보험업법",
  "상법",
  "민법",
  "약관의 규제에 관한 법률",
  "할부거래에 관한 법률",
] as const;

/** 모델이 한 번의 조사에서 돌 수 있는 최대 왕복. 상한(F-607)과 별개의 안전장치다 */
const MAX_TURNS = 8;

// ---------------------------------------------------------------- 슬롯 → 도구 인자

/** 상품군 코드의 접두사가 업권이다 (기능 명세 2.3 업권 2단 구조) */
export function sectorOf(product: Slots["product"]): Sector {
  if (product.startsWith("INS_")) return "INSURANCE";
  if (product.startsWith("INV_")) return "INVESTMENT";
  if (product.startsWith("BNK_")) return "BANKING";
  return "UNKNOWN";
}

/** DB 채널은 미식별을 NULL로 표현한다 — 슬롯의 UNKNOWN은 필터 미적용이 된다 */
const dbChannel = (c: Slots["channel"]): DbChannel | undefined =>
  c === "UNKNOWN" ? undefined : c;

/** NONE은 「특성 없음」이라 필터로 쓸 수 없다 (DB는 행 부재로 표현한다) */
const dbTraits = (t: Slots["traits"]): DbTrait[] =>
  t.filter((x): x is DbTrait => x !== "NONE");

// ---------------------------------------------------------------- 도구 정의

const TOOLS: Anthropic.Tool[] = [
  {
    name: "lookup_statute",
    description:
      "법령 조문 원문을 조회한다. 기준일에 따라 구법 스냅샷 또는 현행 조문을 돌려주며, " +
      "이관된 조문이면 이관처를 함께 알려준다. 조문 원문은 반드시 이 도구로만 확보한다.",
    input_schema: {
      type: "object",
      properties: {
        lawName: { type: "string", enum: [...LAW_NAMES] },
        articleNo: { type: "string", description: "제19조, 제95조의2, 제651조 형식" },
      },
      required: ["lawName", "articleNo"],
    },
  },
  {
    name: "search_precedent",
    description:
      "대법원 판례를 사건번호 또는 쟁점 키워드로 조회한다. 사건번호가 정확히 일치하는 " +
      "판례만 인용 가능으로 표시된다.",
    input_schema: {
      type: "object",
      properties: {
        caseNo: { type: "string", description: "예: 2013다26746" },
        issueKeyword: { type: "string", description: "예: 설명의무" },
      },
    },
  },
  {
    name: "search_case",
    description:
      "금융분쟁조정위원회 조정례를 검색한다. 결과는 이용자에게 참고 자료로 보여줄 뿐 " +
      "판단 근거로 쓰지 않는다.",
    input_schema: {
      type: "object",
      properties: {
        issues: { type: "array", items: { type: "string" } },
        useProductFilter: { type: "boolean", description: "상품군으로 좁힐지" },
        useChannelFilter: { type: "boolean", description: "채널로 좁힐지" },
      },
    },
  },
  {
    name: "check_documents",
    description: "쟁점·채널에 따라 필요한 증빙 목록과 관련 약관 조항을 돌려준다.",
    input_schema: {
      type: "object",
      properties: { issues: { type: "array", items: { type: "string" } } },
      required: ["issues"],
    },
  },
  {
    name: "analyze_risk_pattern",
    description:
      "상품군·채널·특성 조합에서 어떤 쟁점이 얼마나 자주 인정·기각됐는지 집계를 돌려준다.",
    input_schema: {
      type: "object",
      properties: {
        useTrait: { type: "string", enum: [...(["PRO", "ELDER", "INEXP", "CAPACITY"] as const)] },
      },
    },
  },
];

// ---------------------------------------------------------------- 결과 타입

export type InvestigateResult = {
  evidence: Evidence;
  /** 상한 소진 지점. null이면 정상 종료 (EX-204 판정용) */
  exhausted: { scope: "CYCLE" | "SESSION"; used: number; limit: number } | null;
};

export type InvestigateCtx = { budget: ToolBudget; trace: Trace };

// ---------------------------------------------------------------- 본체

function buildSystem(input: InvestigateInput): string {
  const after =
    input.basisDate === null ? null : input.basisDate >= FSCA_EFFECTIVE;

  const era =
    after === null
      ? `가입 시점을 알 수 없다. **시점별 법령 분기가 불가능하므로 금융소비자보호법도 구 자본시장법·구 보험업법도 조회하지 마라.** 시점 무관 법령(상법·민법·약관의 규제에 관한 법률·할부거래에 관한 법률)만 조회한다. 보험 사건이면 보험업법 제95조의2 존치 항은 조회해도 된다. (EX-2xx)`
      : after
        ? `가입 시점이 금융소비자보호법 시행일(${FSCA_EFFECTIVE}) 이후다. 적합성 제17조 · 적정성 제18조 · 설명의무 제19조 · 부당권유 제21조 · 손해배상과 입증책임 전환 제44조가 적용된다. **구 자본시장법 제46·46의2·47·49조와 구 보험업법 제95조의3은 이 사건에 적용되지 않는다.**`
        : `가입 시점이 금융소비자보호법 시행일(${FSCA_EFFECTIVE}) 이전이다. **금융소비자보호법을 인용하면 안 된다.** 증권·펀드는 자본시장과 금융투자업에 관한 법률 제46조(적합성)·제46조의2(적정성)·제47조(설명의무)·제49조(부당권유), 보험은 보험업법 제95조의2(설명의무)·제95조의3(적합성)이 당시 법령이다.`;

  return `당신은 금융 분쟁 판단에 쓸 근거를 모으는 조사 담당이다.
판단하지 않는다. 결론을 내지 않는다. 어떤 근거가 필요한지 정하고 도구로 확보하는 것이 전부다.

## 사건
- 상품군: ${input.slots.product} (업권 ${sectorOf(input.slots.product)})
- 판매채널: ${input.slots.channel}
- 가입 연월: ${input.slots.contract_ym}
- 가입 당시 나이: ${input.slots.age}
- 소비자 특성: ${input.slots.traits.join(", ")}
- 쟁점: ${input.facts.issues.join(", ") || "미확정"}
- 사실관계:
${input.facts.statements.map((s) => `  · ${s}`).join("\n")}

## 적용 법령 시점 (판정 완료 — 다시 추론하지 마라)
${era}

## 보완 법리
보험 분쟁은 보험계약법이 함께 작동한다. 고지의무위반은 상법 제651조, 보험사고의 객관적 확정은 제644조,
위험변경증가 통지는 제652조, 약관 해석의 작성자 불이익 원칙은 약관의 규제에 관한 법률 제5조다.

## 방법
- 쟁점마다 근거 법령을 조회한다. 조문 원문을 직접 쓰지 말고 반드시 lookup_statute로 확보한다.
- 판례는 사건번호를 알 때만 search_precedent로 확인한다. 기억에 의존해 판례를 인용하지 않는다.
- 필요한 조사가 끝나면 도구를 더 부르지 말고 무엇을 확보했고 무엇이 비었는지 한 문단으로 답한다.
- 도구 호출 상한에 걸리면 즉시 멈춘다. 모은 만큼으로 진행한다.`;
}

/** 도구 실행 — 성공/실패와 무관하게 evidence·trace에 흔적을 남긴다 */
async function runTool(
  name: string,
  args: Record<string, unknown>,
  input: InvestigateInput,
  ev: Evidence,
  trace: Trace,
): Promise<string> {
  const slots = input.slots;
  try {
    switch (name) {
      case "lookup_statute": {
        const lawName = String(args.lawName ?? "");
        const articleNo = String(args.articleNo ?? "");
        if (!(LAW_NAMES as readonly string[]).includes(lawName)) {
          trace.toolCall("lookup_statute", "BLOCKED", { law: lawName });
          return "조회할 수 없는 법령이다. 허용 목록 안에서 고를 것.";
        }
        // 기준일이 없으면 시점 종속 조회 자체가 불가하다. 현행 조회로 대신하지 않는다.
        const basisDate = input.basisDate;
        if (basisDate === null) {
          trace.toolCall("lookup_statute", "BLOCKED", { reason: "NO_BASIS_DATE" });
          ev.gaps.push("가입 시점을 몰라 시점별 법령 적용을 하지 못했습니다");
          return "기준일이 없어 시점별 법령 조회가 불가능하다.";
        }
        const r = await lookupStatute({ lawName, articleNo, basisDate });
        if (!r) {
          trace.toolCall("lookup_statute", "EMPTY", { law: lawName, article: articleNo });
          ev.gaps.push(`${lawName} ${articleNo} 조문을 확인하지 못했습니다`);
          return "조문을 찾지 못했다.";
        }
        ev.statutes.push(r);
        // 인젝션 필터가 무해화 표기한 문장 수 — 방어가 발동한 사실을 로그에 남긴다 (F-606·EP-1)
        trace.toolCall("lookup_statute", "OK", {
          law: lawName, article: articleNo, source: r.source, fallback: r.isFallback,
          ...(r.flagged > 0 ? { sanitized: r.flagged } : {}),
        });
        if (r.isFallback) ev.gaps.push(`${lawName} ${articleNo}는 캐시본입니다`);
        const moved = r.transferredTo
          ? ` (이관: ${r.transferredTo.lawName} ${r.transferredTo.articleNo})`
          : "";
        return `확보. 출처 ${r.source}, 확인일 ${r.checkedAt}${moved}. 길이 ${r.articleText.length}자.`;
      }

      case "search_precedent": {
        const r = await searchPrecedent({
          caseNo: typeof args.caseNo === "string" ? args.caseNo : undefined,
          issueKeyword: typeof args.issueKeyword === "string" ? args.issueKeyword : undefined,
        });
        // 인용 가능(citable)이 아니면 근거에 담지 않는다 — 표시 보류가 기본이다 (F-502)
        if (r.exact && r.citable) {
          ev.precedents.push(r.exact);
          trace.toolCall("search_precedent", "OK", {
            rank: r.exactRank, total: r.totalCount,
            ...(r.flagged > 0 ? { sanitized: r.flagged } : {}),
          });
          return `대조 성공: ${r.exact.caseName} (후보 ${r.totalCount}건 중 ${r.exactRank}번째).`;
        }
        trace.toolCall("search_precedent", "EMPTY", {
          total: r.totalCount, retried: r.retriedByKeyword,
        });
        ev.gaps.push("판례 대조에 실패해 판례는 근거에서 제외했습니다");
        return `대조 실패(후보 ${r.totalCount}건). 이 판례는 인용하지 않는다.`;
      }

      case "search_case": {
        const issues = Array.isArray(args.issues) ? (args.issues as string[]) : input.facts.issues;
        const factsText = input.facts.statements.join(" ");
        // 필터가 전부 AND라 조건을 다 걸면 공집합이 흔하다 (코퍼스 388건).
        // 실주행에서 INS_WHOLE×TM×ELDER×설명의무가 0건이었다. 조정례는 판단
        // 근거가 아니라 이용자에게 보여줄 참고 자료이므로(기획서 6.5), 0건이면
        // 조건을 넓혀 다시 찾는다 — analyze_risk_pattern의 폴백 사다리와 같은 방식이다.
        const ladder = [
          { productCode: slots.product, channel: dbChannel(slots.channel), traits: dbTraits(slots.traits) },
          { productCode: slots.product, channel: dbChannel(slots.channel), traits: [] },
          { productCode: slots.product, channel: undefined, traits: [] },
          { productCode: undefined, channel: undefined, traits: [] },
        ];
        let step = 0;
        let r = await searchCase({ sector: sectorOf(slots.product), ...ladder[0], issues, factsText });
        while (r.cases.length === 0 && step < ladder.length - 1) {
          step += 1;
          r = await searchCase({ sector: sectorOf(slots.product), ...ladder[step], issues, factsText });
        }
        ev.cases = r.cases;
        trace.toolCall("search_case", r.cases.length ? "OK" : "EMPTY", {
          matched: r.matchedTotal, returned: r.cases.length,
          filters: r.appliedFilters.join("·"), widened: step,
          ...(r.flagged > 0 ? { sanitized: r.flagged } : {}),
        });
        if (step > 0 && r.cases.length) {
          // 조건을 넓혔다는 사실은 화면에 그대로 보여야 한다 (EP-1)
          ev.gaps.push("조건이 완전히 같은 조정례가 없어 범위를 넓혀 찾았습니다");
        }
        if (r.cases.length === 0) ev.gaps.push("참고할 조정례를 찾지 못했습니다");
        return `조정례 ${r.matchedTotal}건 중 ${r.cases.length}건 확보${step ? ` (조건 ${step}단계 완화)` : ""}. 참고 자료로만 쓴다.`;
      }

      case "check_documents": {
        const r = await checkDocuments({
          issues: Array.isArray(args.issues) ? (args.issues as string[]) : input.facts.issues,
          channel: dbChannel(slots.channel),
        });
        ev.documents = r;
        trace.toolCall("check_documents", "OK", {
          required: r.required.length, clauses: r.relatedClauses.length,
          channelUnknown: r.channelUnknown,
        });
        return `필요 증빙 ${r.required.length}종, 관련 약관 조항 ${r.relatedClauses.length}건.`;
      }

      case "analyze_risk_pattern": {
        const trait = dbTraits(slots.traits);
        const r = await analyzeRiskPattern({
          productCode: slots.product,
          channel: dbChannel(slots.channel),
          trait: typeof args.useTrait === "string"
            ? (args.useTrait as DbTrait)
            : trait[0],
        });
        if (!r) {
          // 폴백 사다리 끝(OVERALL)까지 내려가도 집계가 없다 — 통계 근거 없이 간다
          trace.toolCall("analyze_risk_pattern", "EMPTY", { reason: "NO_ROWS" });
          ev.gaps.push("비슷한 조건의 통계 집계가 없습니다");
          return "집계 결과가 없다.";
        }
        ev.riskPattern = r;
        trace.toolCall("analyze_risk_pattern", r.issues.length ? "OK" : "EMPTY", {
          granularity: r.granularity, fellBack: r.fellBack, issues: r.issues.length,
        });
        return `${r.granularity} 단위 집계 ${r.issues.length}건${r.fellBack ? " (범위를 넓혀 재집계)" : ""}.`;
      }

      default:
        trace.toolCall(name, "BLOCKED", { reason: "UNKNOWN_TOOL" });
        return "없는 도구다.";
    }
  } catch (e) {
    // 도구 실패는 조사 실패가 아니다. 공백으로 남기고 계속 간다 (EP-1).
    //
    // ⚠️ **오류 메시지 원문을 싣지 않는다** (N-403). postgres는 파라미터 값을
    // 메시지에 실어 주므로("invalid input syntax ... \"...\"") 슬롯 값이 실행
    // 로그와 모델 입력으로 새어 나간다. 분류만 남긴다.
    const kind = failureKind(e);
    trace.toolCall(name, "FAILED", { reason: kind });
    ev.gaps.push(`${name} 조회에 실패했습니다`);
    return `실패: ${kind}. 이 근거 없이 계속하라.`;
  }
}

/**
 * 오류를 **분류만** 한다 — 메시지 원문은 어디에도 남기지 않는다 (N-403).
 *
 * 남기는 값은 전부 내용이 아닌 것이다: 법제처 오류 종류 · DB SQLSTATE ·
 * 예외 클래스 이름. 이용자가 무엇을 입력했는지 되짚을 수 있는 조각이 없다.
 */
function failureKind(e: unknown): string {
  if (e instanceof LawApiError) return `LAW_${e.kind}`;
  if (e && typeof e === "object" && "code" in e) {
    const c = (e as { code: unknown }).code;
    if (typeof c === "string") return `DB_${c}`;
  }
  if (e instanceof Error) return e.name || "ERROR";
  return "ERROR";
}

export async function investigate(
  input: InvestigateInput,
  ctx: InvestigateCtx,
): Promise<InvestigateResult> {
  const ev: Evidence = {
    statutes: [], precedents: [], cases: [], documents: null, riskPattern: null, gaps: [],
  };
  let exhausted: InvestigateResult["exhausted"] = null;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "조사를 시작한다. 필요한 근거를 도구로 확보하라." },
  ];
  const system = buildSystem(input);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4_000,
      system,
      tools: TOOLS,
      messages,
    });

    const calls = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (res.stop_reason !== "tool_use" || calls.length === 0) break;

    messages.push({ role: "assistant", content: res.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const c of calls) {
      const grant = ctx.budget.tryConsume();
      if (!grant.ok) {
        // 상한 도달은 오류가 아니라 조사 종료다 (EX-204). 모델에도 그렇게 알린다.
        exhausted = { scope: grant.scope, used: grant.used, limit: grant.limit };
        ctx.trace.warn("INVESTIGATE", "도구 호출 상한에 도달해 조사를 마칩니다", {
          scope: grant.scope, used: grant.used, limit: grant.limit,
        });
        results.push({
          type: "tool_result",
          tool_use_id: c.id,
          content: "도구 호출 상한에 도달했다. 더 부르지 말고 지금까지의 근거로 정리하라.",
        });
        continue;
      }
      const text = await runTool(
        c.name, (c.input ?? {}) as Record<string, unknown>, input, ev, ctx.trace,
      );
      results.push({ type: "tool_result", tool_use_id: c.id, content: text });
    }

    messages.push({ role: "user", content: results });
    if (exhausted) break;
  }

  if (ev.statutes.length === 0) {
    ev.gaps.push("근거 법령을 확보하지 못했습니다");
  }
  ctx.trace.info("INVESTIGATE", "근거 수집을 마쳤습니다", {
    statutes: ev.statutes.length,
    precedents: ev.precedents.length,
    cases: ev.cases.length,
    gaps: ev.gaps.length,
  });

  return { evidence: ev, exhausted };
}
