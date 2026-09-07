/**
 * lookup_statute · search_precedent — 법제처 공개 API.
 *
 * `B-LAW-01` 이 이 경로를 실제로 재서 채택했다. 등록 도메인을 Referer 로 보내면
 * Preview 와 Production 양쪽에서 통하고, 그 밖의 경우는 막힌다. 그래서 이 도구는
 * 기존 client 를 그대로 쓴다. 접근 조건을 여기서 다시 다루지 않는다.
 *
 * 목록 조회 결과만으로는 조문을 인용할 수 없다. 제목과 식별자는 metadata 이지
 * 본문이 아니기 때문이다 (EV-014 와 같은 이유다). 그래서 상위 결과의 본문을
 * 한 번 더 받아 온 것만 DIRECT 근거로 쓰고, 본문을 못 받은 것은 INDIRECT 로 둔다.
 */

import "server-only";
import { asArray, lawSearch, lawService } from "@/lib/tools/law_client";
import { filterToolText } from "@/lib/tools/filter";
import { sha256, type SourceItem, type ToolOutcome, type ToolCallContext } from "./runtime";

const MAX_BODY_FETCH = 2;
const MAX_EXCERPT = 1200;

type LawRow = { 법령명한글?: string; 법령ID?: string; 시행일자?: string; 공포일자?: string; 법령상세링크?: string };
type PrecRow = { 사건명?: string; 판례정보일련번호?: string; 선고일자?: string; 법원명?: string; 판례상세링크?: string };
type LawArticle = {
  조문번호?: string | number;
  조문가지번호?: string | number;
  조문내용?: string;
  항?: unknown;
};

const yyyymmdd = (value: unknown): string | null => {
  const text = String(value ?? "").replace(/[^0-9]/g, "");
  if (text.length !== 8) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
};

const isEffective = (effectiveFrom: string | null): boolean => {
  if (!effectiveFrom) return false;
  return effectiveFrom <= new Date().toISOString().slice(0, 10);
};

const articleNo = (unit: LawArticle): string | null => {
  const main = String(unit.조문번호 ?? "").replace(/[^0-9]/g, "");
  const branch = String(unit.조문가지번호 ?? "").replace(/[^0-9]/g, "");
  if (!main) return null;
  return `제${Number(main)}조${branch && Number(branch) > 0 ? `의${Number(branch)}` : ""}`;
};

const articleText = (unit: LawArticle): string => {
  const paragraphs = asArray(unit.항 as { 항내용?: string } | { 항내용?: string }[])
    .map((paragraph) => String(paragraph?.항내용 ?? "").trim())
    .filter(Boolean);
  return [String(unit.조문내용 ?? "").trim(), ...paragraphs].filter(Boolean).join("\n");
};

/**
 * LAW Snapshot은 DB 계약상 정확한 조문 번호가 필요하다. 검색어에 조문 번호가
 * 있으면 그 조문을 고르고, 없으면 검색어와 가장 많이 겹치는 조문 하나만 고른다.
 * 번호나 본문이 없는 목록 결과를 억지로 인용 가능한 LAW 근거로 만들지 않는다.
 */
const bodyEvidence = (payload: unknown, query: string): { articleNo: string; excerpt: string } | null => {
  const raw = (payload as { 법령?: { 조문?: { 조문단위?: unknown } } })?.법령?.조문?.조문단위;
  const units = asArray(raw as LawArticle | LawArticle[] | undefined)
    .map((unit, index) => ({ unit, index, articleNo: articleNo(unit), text: articleText(unit) }))
    .filter((entry): entry is { unit: LawArticle; index: number; articleNo: string; text: string } =>
      Boolean(entry.articleNo && entry.text));
  if (units.length === 0) return null;

  const requested = query.match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
  const requestedNo = requested
    ? `제${Number(requested[1])}조${requested[2] ? `의${Number(requested[2])}` : ""}`
    : null;
  const tokens = [...new Set(query.split(/\s+/)
    .map((token) => token.replace(/[^0-9A-Za-z가-힣]/g, ""))
    .filter((token) => token.length >= 2 && !/^제\d+조/.test(token)))];
  const selected = (requestedNo ? units.find((entry) => entry.articleNo === requestedNo) : null)
    ?? [...units].sort((a, b) => {
      const score = (entry: typeof a) => tokens.reduce((sum, token) => sum + (entry.text.includes(token) ? 1 : 0), 0);
      return score(b) - score(a) || a.index - b.index;
    })[0];
  // 외부 문자열의 명령문 패턴을 무해화하고 한 조문 범위만 전달한다.
  return { articleNo: selected.articleNo, excerpt: filterToolText(selected.text.slice(0, MAX_EXCERPT)).text };
};

export const lookupStatute = async (input: unknown, ctx?: ToolCallContext): Promise<ToolOutcome> => {
  const query = String((input as { query?: unknown })?.query ?? "").trim();
  if (query.length === 0) {
    return { items: [], provenanceComplete: true, candidateCount: 0, reasonCode: "EMPTY_QUERY" };
  }

  const listed = await lawSearch("law", { query, display: 5, type: "JSON" }, { signal: ctx?.signal, maxRetries: 0 });
  const rows = asArray(((listed as { LawSearch?: { law?: LawRow | LawRow[] } })?.LawSearch?.law));
  const items: SourceItem[] = [];

  for (const [index, row] of rows.entries()) {
    ctx?.signal?.throwIfAborted();
    const lawId = String(row.법령ID ?? "").trim();
    const name = String(row.법령명한글 ?? "").trim();
    if (lawId.length === 0 || name.length === 0) continue;
    const effectiveFrom = yyyymmdd(row.시행일자);

    let article: { articleNo: string; excerpt: string } | null = null;
    if (index < MAX_BODY_FETCH) {
      try {
        article = bodyEvidence(
          await lawService("law", { ID: lawId, type: "JSON" }, { signal: ctx?.signal, maxRetries: 0 }),
          query,
        );
      } catch {
        ctx?.signal?.throwIfAborted();
        article = null;
      }
    }
    if (!article) continue;

    const canonical = JSON.stringify({ lawId, name, articleNo: article.articleNo, effectiveFrom, excerpt: article.excerpt });
    items.push({
      sourceType: "LAW",
      authorityGrade: "A",
      publisher: "법제처",
      title: name,
      officialId: `law.go.kr:${lawId}:${article.articleNo}`,
      canonicalUrl: null,
      lawName: name,
      articleNo: article.articleNo,
      publishedAt: null,
      effectiveFrom,
      sourceVersion: effectiveFrom ?? "unknown",
      contentHash: sha256(canonical),
      // 같은 법령의 같은 시행일은 어디서 받아도 같은 원문이다.
      fingerprint: sha256(`law.go.kr:${lawId}:${article.articleNo}:${effectiveFrom ?? "unknown"}`),
      // 시행일이 지나지 않았으면 현행이 아니다. 최신으로 오인하지 않게 표시한다.
      freshness: isEffective(effectiveFrom) ? "FRESH" : "UNKNOWN",
      licenseCode: "LAW_GO_KR_PUBLIC",
      isComplete: true,
      isCitable: isEffective(effectiveFrom),
      locator: { kind: "statute", law_id: lawId, article_no: article.articleNo, effective_from: effectiveFrom },
      excerptMasked: article.excerpt,
      directness: "DIRECT",
      referenceOnly: false,
      selectionReasonCode: "STATUTE_SEARCH_HIT",
    });
  }

  return {
    items,
    provenanceComplete: true,
    candidateCount: rows.length,
    // 0건은 반증이 아니다. 부르는 쪽이 UNKNOWN 으로 다뤄야 한다 (EV-015).
    reasonCode: items.length === 0 ? "NO_MATCH" : null,
  };
};

export const searchPrecedent = async (input: unknown, ctx?: ToolCallContext): Promise<ToolOutcome> => {
  const query = String((input as { query?: unknown })?.query ?? "").trim();
  if (query.length === 0) {
    return { items: [], provenanceComplete: true, candidateCount: 0, reasonCode: "EMPTY_QUERY" };
  }

  const listed = await lawSearch("prec", { query, display: 5, type: "JSON" }, { signal: ctx?.signal, maxRetries: 0 });
  const rows = asArray(((listed as { PrecSearch?: { prec?: PrecRow | PrecRow[] } })?.PrecSearch?.prec));
  const items: SourceItem[] = rows.flatMap((row) => {
    const id = String(row.판례정보일련번호 ?? "").trim();
    const title = String(row.사건명 ?? "").trim();
    if (id.length === 0 || title.length === 0) return [];
    const decidedAt = yyyymmdd(row.선고일자);
    const canonical = JSON.stringify({ id, title, decidedAt, court: row.법원명 ?? null });
    return [{
      sourceType: "DISPUTE",
      authorityGrade: "B",
      publisher: String(row.법원명 ?? "법원"),
      title,
      officialId: `law.go.kr:prec:${id}`,
      canonicalUrl: null,
      publishedAt: decidedAt,
      sourceVersion: decidedAt ?? "unknown",
      contentHash: sha256(canonical),
      fingerprint: sha256(`law.go.kr:prec:${id}`),
      freshness: "FRESH",
      licenseCode: "LAW_GO_KR_PUBLIC",
      // 목록 조회는 metadata 다. 본문을 받지 않았으므로 완전하지 않다.
      isComplete: false,
      isCitable: false,
      locator: { kind: "precedent", precedent_id: id, decided_at: decidedAt },
      excerptMasked: `${title} (${decidedAt ?? "선고일 불명"})`,
      // EV-014: metadata 만 있는 판례는 직접 근거가 아니다.
      directness: "CONTEXT_ONLY",
      // EV-007: 유사 사례는 현재 거래의 위법을 증명하지 않는다.
      referenceOnly: true,
      selectionReasonCode: "PRECEDENT_SEARCH_HIT",
    } satisfies SourceItem];
  });

  return {
    items,
    provenanceComplete: true,
    candidateCount: rows.length,
    reasonCode: items.length === 0 ? "NO_MATCH" : null,
  };
};
