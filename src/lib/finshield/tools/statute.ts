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
const MAX_EXCERPT = 6000;
const ARTICLE_REFERENCE = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/;

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
  // 국내 법령의 시행일은 한국 날짜다. UTC 자정까지 9시간 보류하지 않는다.
  const koreanDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return effectiveFrom <= koreanDate;
};

const articleNo = (unit: LawArticle): string | null => {
  const main = String(unit.조문번호 ?? "").replace(/[^0-9]/g, "");
  const branch = String(unit.조문가지번호 ?? "").replace(/[^0-9]/g, "");
  if (!main) return null;
  return `제${Number(main)}조${branch && Number(branch) > 0 ? `의${Number(branch)}` : ""}`;
};

const articleText = (unit: LawArticle): string => {
  const content = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(content)
    : typeof value === "string" ? [value.trim()] : [];
  const collect = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(collect);
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, entry]) =>
      /^(항|호|목)내용$/u.test(key) ? content(entry) : collect(entry));
  };
  const paragraphs = collect(unit.항).filter(Boolean);
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

  const requested = query.match(ARTICLE_REFERENCE);
  const requestedNo = requested
    ? `제${Number(requested[1])}조${requested[2] ? `의${Number(requested[2])}` : ""}`
    : null;
  if (requestedNo && !units.some(entry => entry.articleNo === requestedNo)) return null;
  const tokens = [...new Set(query.split(/\s+/)
    .map((token) => token.replace(/[^0-9A-Za-z가-힣]/g, ""))
    .filter((token) => token.length >= 2 && !/^제\d+조/.test(token)))];
  const selected = (requestedNo ? units.find((entry) => entry.articleNo === requestedNo) : null)
    ?? [...units].sort((a, b) => {
      const score = (entry: typeof a) => tokens.reduce((sum, token) => sum + (entry.text.includes(token) ? 1 : 0), 0);
      return score(b) - score(a) || a.index - b.index;
    })[0];
  // 외부 문자열의 명령문 패턴을 무해화하고 한 조문 범위만 전달한다.
  // 잘린 조문을 완전한 본문으로 표시하지 않는다. 긴 조문은 별도 구간 조회가 필요하다.
  if (selected.text.length > MAX_EXCERPT) return null;
  return { articleNo: selected.articleNo, excerpt: filterToolText(selected.text).text };
};

export const lookupStatute = async (input: unknown, ctx?: ToolCallContext): Promise<ToolOutcome> => {
  const query = String((input as { query?: unknown })?.query ?? "").trim();
  if (query.length === 0) {
    return { items: [], provenanceComplete: true, candidateCount: 0, reasonCode: "EMPTY_QUERY" };
  }

  // 법령 검색 API에는 조문 번호를 넣으면 0건이 돌아올 수 있다. 모델이 지정한
  // 조문은 본문 선택에 보존하고, 목록 검색에는 정확한 법령명만 보낸다.
  const lawQuery = query.replace(ARTICLE_REFERENCE, " ").replace(/\s+/g, " ").trim();
  if (lawQuery.length === 0) {
    return { items: [], provenanceComplete: true, candidateCount: 0, reasonCode: "LAW_NAME_REQUIRED" };
  }

  const listed = await lawSearch("law", { query: lawQuery, display: 5, type: "JSON" }, { signal: ctx?.signal, maxRetries: 0 });
  const candidates = asArray(((listed as { LawSearch?: { law?: LawRow | LawRow[] } })?.LawSearch?.law));
  const normalizeName = (name: string) => name.replace(/\s+/g, "");
  const exact = candidates.filter(row => normalizeName(String(row.법령명한글 ?? "")) === normalizeName(lawQuery));
  const rows = exact.length ? exact : candidates;
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
    const effective = isEffective(effectiveFrom);
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
      // 시행 전 수집한 불변 Snapshot의 인용 불가 상태를 덮어쓰거나 재사용하지 않는다.
      // 원문 시행 버전은 locator에 보존하며, 조회 자격이 바뀔 때 새 Snapshot을 만든다.
      sourceVersion: `${effectiveFrom ?? "unknown"}:${effective ? "effective" : "pending"}`,
      contentHash: sha256(canonical),
      // 같은 법령의 같은 시행일은 어디서 받아도 같은 원문이다.
      fingerprint: sha256(`law.go.kr:${lawId}:${article.articleNo}:${effectiveFrom ?? "unknown"}`),
      // 시행일이 지나지 않았으면 현행이 아니다. 최신으로 오인하지 않게 표시한다.
      freshness: effective ? "FRESH" : "UNKNOWN",
      licenseCode: "LAW_GO_KR_PUBLIC",
      isComplete: true,
      isCitable: effective,
      locator: { kind: "statute", law_id: lawId, article_no: article.articleNo, effective_from: effectiveFrom,
        official_source_version: effectiveFrom, assessment_timezone: "Asia/Seoul", eligibility: effective ? "EFFECTIVE" : "PENDING" },
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
