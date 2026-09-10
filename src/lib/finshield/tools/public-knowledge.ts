import "server-only";
import { z } from "zod";
import { searchOfficialWarning } from "./official-warning";
import { lookupStatute } from "./statute";
import { queryWithSignal } from "../query-signal";
import { embedQuery, rerankKnowledge, RetrievalProviderError } from "../retrieval-provider";
import { RETRIEVAL_POLICY } from "../manifest";
import { gateForModel } from "@/lib/agents/pii";
import { filterToolText } from "@/lib/tools/filter";
import type { SourceItem, ToolCallContext, ToolOutcome } from "./runtime";
import { toSnapshotItem, SNAPSHOT_FIELDS, FETCH_JOIN, type SnapshotRow } from "./registry";

const queryInput = z.object({ query: z.string().trim().min(1).max(2000) }).strict();
const snapshotInput = z.object({ query: z.string().trim().max(2000).optional(), values: z.array(z.string().min(1).max(128)).max(10).optional() }).strict();
const DAY = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
/** 공개 Demo 의 승인 범위 검색. Provider 를 부르지 않는 설정이며 저하가 아니다. */
const APPROVED_SCOPE = "APPROVED_SCOPE_KEYWORD_ONLY";
export type ChunkRow = SnapshotRow & { chunk_id: string; chunk_text: string; source_locator: Record<string, unknown>; document_type: string;
  document_active?: boolean; valid_from: string | null; valid_to: string | null; effective_to: string | null; keyword_rank: number | null; vector_distance: number | null };

/** 공용 KB의 원문만 인용한다. 회원 문서/Embedding을 이 경로에 섞지 않는다. */
export function knowledgeItem(row: ChunkRow, reason: string): SourceItem {
  const asOf = DAY();
  const inForce = row.document_active !== false && (!row.valid_from || row.valid_from <= asOf) && (!row.valid_to || row.valid_to >= asOf)
    && (!row.effective_from || row.effective_from <= asOf) && (!row.effective_to || row.effective_to >= asOf);
  const referenceOnly = ["DISPUTE", "PRECASE_CASE", "ALERT"].includes(row.document_type);
  const gate = gateForModel(row.chunk_text);
  if (!gate.ok) throw new RetrievalProviderError("KNOWLEDGE_PII_BLOCKED");
  const excerpt = filterToolText(gate.masked.text).text.slice(0, 4000);
  const item = toSnapshotItem(row, { ...row.source_locator, chunk_id: row.chunk_id, assessed_on: asOf,
    excerpt_truncated: gate.masked.text.length > 4000, applicability: inForce ? "IN_RANGE" : "OUT_OF_RANGE" }, excerpt, reason, inForce && !referenceOnly ? "DIRECT" : "CONTEXT_ONLY");
  return { ...item, referenceOnly, isCitable: item.isCitable && inForce && !referenceOnly };
}

/** 같은 출처의 복제 Chunk는 독립 근거를 늘리지 않는다. */
export function rankKnowledge(rows: ChunkRow[], relevanceScores?: number[]): ChunkRow[] {
  if (relevanceScores && (relevanceScores.length !== rows.length
    || relevanceScores.some(value => !Number.isFinite(value) || value < 0 || value > 1))) {
    throw new RetrievalProviderError("RERANK_RESULT_INVALID");
  }
  const fastScores = relevanceScores
    ? new Map(rows.map((row, index) => [row.chunk_id, relevanceScores[index]]))
    : null;
  const maxRank = Math.max(0, ...rows.map(row => row.keyword_rank ?? 0));
  const dates = rows.map(row => row.effective_from).filter((value): value is string => Boolean(value)).sort();
  const oldest = Date.parse(dates[0]), newest = Date.parse(dates.at(-1) ?? "");
  const score = (row: ChunkRow) => {
    const relevance = fastScores?.get(row.chunk_id)
      ?? (.7 * Math.max(0, Math.min(1, 1 - (row.vector_distance ?? 1)))
        + .3 * (maxRank ? (row.keyword_rank ?? 0) / maxRank : 0));
    const freshness = newest > oldest && row.effective_from ? Math.max(0, Math.min(1, (Date.parse(row.effective_from) - oldest) / (newest - oldest))) : 1;
    return .60 * relevance + .25 * ({ A: 1, B: .6, C: .3, D: 0 }[row.authority_level]) + .15 * freshness;
  };
  const authority = { A: 1, B: .6, C: .3, D: 0 };
  const ranked = [...rows].sort((a, b) => score(b) - score(a)
    || authority[b.authority_level] - authority[a.authority_level]
    || String(b.effective_from ?? "").localeCompare(String(a.effective_from ?? ""))
    || a.chunk_id.localeCompare(b.chunk_id));
  const seen = new Set<string>();
  return ranked.filter(row => { if (seen.has(row.source_fingerprint)) return false; seen.add(row.source_fingerprint); return true; })
    .slice(0, RETRIEVAL_POLICY.topK);
}

export async function searchPublicKnowledge(input: unknown, ctx: ToolCallContext, types: string[]): Promise<ToolOutcome> {
  const parsed = queryInput.safeParse(input);
  if (!parsed.success) return { items: [], provenanceComplete: false, candidateCount: 0, errorCode: "TOOL_INPUT_INVALID" };
  ctx.signal?.throwIfAborted();
  const sql = ctx.sql;
  const sourceScope = ctx.allowedSourceSnapshotIds ?? [];
  // 공개 Demo 는 승인된 Seed 범위만 본다. Cohere 비용 예약은 회원 Run 만 받으므로 호출하지 않는다.
  const providerEligible = sourceScope.length === 0;
  const [release] = await queryWithSignal(sql`select embedding_model,embedding_dimension,embedding_model_version,
    (select count(*)::int from kb.knowledge_documents where kb_release_id=r.id and document_type=any(${types}::text[])) as documents
    from kb.kb_releases r where id=${ctx.manifest.kbReleaseId}::uuid`, ctx.signal);
  const vectorExpected = Boolean(release?.documents && release.embedding_model === "embed-v4.0"
    && release.embedding_dimension === 1024);
  let vector: number[] | null = null;
  let vectorStatus = !vectorExpected ? "NOT_CONFIGURED" : providerEligible ? "NOT_RUN" : APPROVED_SCOPE;
  if (vectorExpected && providerEligible) {
    try { vector = await embedQuery(parsed.data.query, ctx); vectorStatus = "AVAILABLE"; }
    catch (error) { ctx.signal?.throwIfAborted(); vectorStatus = error instanceof RetrievalProviderError ? error.code : "VECTOR_BUDGET_UNAVAILABLE"; }
  }
  // Release와 유형·적용 기간을 먼저 한정한다. 모델이 만든 상품/기관명을 임의 코드로 치환하지 않는다.
  const rows = await queryWithSignal(sql`
    with scoped as (
      select d.* from kb.knowledge_documents d where d.kb_release_id=${ctx.manifest.kbReleaseId}::uuid
        and d.document_type=any(${types}::text[]) and 'LOAN'=any(d.scenario_codes)
        and (${sourceScope.length === 0} or d.source_snapshot_id=any(${sourceScope}::uuid[]))
        and (d.valid_from is null or d.valid_from<=${DAY()}::date) and (d.valid_to is null or d.valid_to>=${DAY()}::date)
        and not exists(select 1 from kb.knowledge_document_events e where e.knowledge_document_id=d.id and e.event_type in ('WITHDRAWN','SUPERSEDED'))
        and not exists(select 1 from kb.kb_release_events e where e.kb_release_id=d.kb_release_id and e.event_type in ('WITHDRAWN','RETIRED'))
    ), keyword_candidates as (
      select c.id,ts_rank(c.search_vector,private.keyword_tsquery(${parsed.data.query})) as rank
      from scoped d join kb.knowledge_chunks c on c.knowledge_document_id=d.id and c.kb_release_id=d.kb_release_id
      where c.search_vector @@ private.keyword_tsquery(${parsed.data.query}) order by rank desc,c.id
      limit ${RETRIEVAL_POLICY.keywordCandidatePool}
    ), vector_candidates as (
      select c.id,(e.embedding operator(extensions.<=>) ${vector ? `[${vector.join(",")}]` : null}::extensions.vector) as distance
      from scoped d join kb.knowledge_chunks c on c.knowledge_document_id=d.id and c.kb_release_id=d.kb_release_id
        join kb.knowledge_embeddings e on e.knowledge_chunk_id=c.id and e.kb_release_id=d.kb_release_id
      where ${vector !== null} and e.model_id='embed-v4.0' and e.model_version=${release?.embedding_model_version ?? ""}
      order by distance,c.id limit ${RETRIEVAL_POLICY.vectorCandidatePool}
    ), candidates as (
      select coalesce(k.id,v.id) as id,k.rank,v.distance from keyword_candidates k full outer join vector_candidates v on v.id=k.id
    )
    select ${sql.unsafe(SNAPSHOT_FIELDS)},to_char(s.effective_to,'YYYY-MM-DD') as effective_to,
      c.id as chunk_id,c.chunk_text,c.source_locator,d.document_type,
      to_char(d.valid_from,'YYYY-MM-DD') as valid_from,to_char(d.valid_to,'YYYY-MM-DD') as valid_to,
      matched.rank as keyword_rank,matched.distance as vector_distance
    from candidates matched join kb.knowledge_chunks c on c.id=matched.id join scoped d on d.id=c.knowledge_document_id
      join kb.source_snapshots s on s.id=d.source_snapshot_id ${sql.unsafe(FETCH_JOIN)}
    where s.authority_level in ('A','B','C') order by matched.distance nulls last,matched.rank desc nulls last,c.id
    limit ${RETRIEVAL_POLICY.maxRerankCandidates}`, ctx.signal);
  ctx.signal?.throwIfAborted();
  const candidates = rows as unknown as ChunkRow[];
  let relevanceScores: number[] | undefined;
  let rerankStatus = !candidates.length ? "NO_CANDIDATES" : providerEligible ? "NOT_RUN" : APPROVED_SCOPE;
  if (candidates.length && providerEligible) {
    try {
      relevanceScores = await rerankKnowledge(parsed.data.query, candidates.map(row => row.chunk_text), ctx);
      rerankStatus = "AVAILABLE";
    } catch (error) {
      ctx.signal?.throwIfAborted();
      rerankStatus = error instanceof RetrievalProviderError ? error.code : "RERANK_PROVIDER_UNCONFIRMED";
    }
  }
  // 저하는 시도해야 했던 Provider 단계가 실패한 경우만이다. Embedding 이 없는 Release 와
  // 승인 범위 Demo 는 설정된 검색 범위이지 실패가 아니다. 두 경우도 이유 코드는 남긴다.
  const degraded = candidates.length > 0 && providerEligible && ((vectorExpected && !vector) || !relevanceScores);
  const reasonCode = !rows.length ? "NO_DOCUMENT_MATCH"
    : !providerEligible ? APPROVED_SCOPE
      : vectorExpected && !vector ? vectorStatus
        : !relevanceScores ? rerankStatus
          : !vectorExpected ? "KEYWORD_ONLY_VECTOR_PENDING" : null;
  return { items: rankKnowledge(candidates, relevanceScores).map(row => knowledgeItem(row,
    relevanceScores ? "PUBLIC_KB_FAST_RERANK_MATCH" : vector ? "PUBLIC_KB_HYBRID_MATCH" : "PUBLIC_KB_KEYWORD_MATCH")),
    provenanceComplete: true, candidateCount: rows.length,
    errorCode: degraded ? "RETRIEVAL_DEGRADED" : null, reasonCode,
    observations: { schema_version: "1", scope: "PUBLIC_LOAN_KB", types,
      retrieval: relevanceScores ? vector ? "METADATA_KEYWORD_VECTOR_FAST_RERANK" : "METADATA_KEYWORD_FAST_RERANK"
        : vector ? "METADATA_KEYWORD_VECTOR_RERANK" : "METADATA_KEYWORD_RERANK",
      vector_status: vectorStatus, rerank_status: rerankStatus, no_match_is_safe: false } };
}

export async function getSourceSnapshot(input: unknown, ctx: ToolCallContext): Promise<ToolOutcome> {
  const parsed = snapshotInput.safeParse(input);
  if (!parsed.success || (!parsed.data.query && !parsed.data.values?.length)) return { items: [], provenanceComplete: false, candidateCount: 0, errorCode: "TOOL_INPUT_INVALID" };
  ctx.signal?.throwIfAborted();
  const sql = ctx.sql, values = parsed.data.values ?? [], query = parsed.data.query ?? "";
  const sourceScope = ctx.allowedSourceSnapshotIds ?? [];
  const rows = await queryWithSignal(sql`
    select ${sql.unsafe(SNAPSHOT_FIELDS)},to_char(s.effective_to,'YYYY-MM-DD') as effective_to,
      c.id as chunk_id,c.chunk_text,c.source_locator,d.document_type,
      to_char(d.valid_from,'YYYY-MM-DD') as valid_from,to_char(d.valid_to,'YYYY-MM-DD') as valid_to,
      not exists(select 1 from kb.knowledge_document_events e where e.knowledge_document_id=d.id and e.event_type in ('WITHDRAWN','SUPERSEDED'))
        and not exists(select 1 from kb.kb_release_events e where e.kb_release_id=d.kb_release_id and e.event_type in ('WITHDRAWN','RETIRED')) as document_active,
      1::real as keyword_rank,null::float8 as vector_distance
    from kb.knowledge_documents d join kb.knowledge_chunks c on c.knowledge_document_id=d.id and c.kb_release_id=d.kb_release_id
      join kb.source_snapshots s on s.id=d.source_snapshot_id ${sql.unsafe(FETCH_JOIN)}
    where d.kb_release_id=${ctx.manifest.kbReleaseId}::uuid and s.authority_level in ('A','B','C')
      and (${sourceScope.length === 0} or d.source_snapshot_id=any(${sourceScope}::uuid[]))
      and (s.official_id=any(${values}::text[]) or s.id::text=any(${values}::text[]) or s.official_id=${query} or s.source_title=${query})
    order by s.id,c.chunk_no limit 10`, ctx.signal);
  ctx.signal?.throwIfAborted();
  return { items: (rows as unknown as ChunkRow[]).map(row => knowledgeItem(row, "STORED_SOURCE_BODY")), provenanceComplete: true,
    candidateCount: rows.length, reasonCode: rows.length ? null : "SNAPSHOT_BODY_NOT_FOUND" };
}

export async function checkDocuments(input: unknown, ctx: ToolCallContext): Promise<ToolOutcome> {
  const outcome = await searchPublicKnowledge(input, ctx, ["TERMS", "GUIDE", "PRECASE_GUIDE"]);
  if (outcome.errorCode) return outcome;
  // PC-005: 등록된 설명·계약 자료 확인 경로에서 현행 설명의무 원문을 조회한다.
  // 비어 있는 KB를 유사사례나 모델 상식으로 대신하지 않는다. Demo는 Seed 범위를 유지한다.
  const statute = ctx.aftercareJobId && !ctx.allowedSourceSnapshotIds?.length
    ? await lookupStatute({ query: "금융소비자 보호에 관한 법률 제19조" }, ctx) : null;
  return { ...outcome, items: [...outcome.items, ...(statute?.items ?? [])],
    candidateCount: outcome.candidateCount + (statute?.candidateCount ?? 0),
    reasonCode: outcome.items.length || statute?.items.length ? null : outcome.reasonCode,
    observations: { ...outcome.observations, material_basis: "CURATED_LOAN_PREPARATION_V1",
    required_materials: [
      { code: "CONTRACT_AT_SIGNUP", label: "가입 당시 계약서", reason: "약정한 조건과 가입 시점을 확인합니다" },
      { code: "TERMS_AT_SIGNUP", label: "가입 당시 적용 약관", reason: "개정된 현재 약관과 구분합니다" },
      { code: "PRODUCT_EXPLANATION", label: "상품설명서와 금리·수수료 안내", reason: "계약 전에 안내한 비용과 조건을 확인합니다" },
      { code: "SALES_RECORD", label: "권유 당시 문자·통화·상담 기록", reason: "실제로 어떤 설명을 들었는지 비교합니다" },
      { code: "REPAYMENT_SCHEDULE", label: "상환 일정과 납입 내역", reason: "약정한 상환 조건과 실제 납입을 비교합니다" },
    ], possession_status: "NOT_ASSESSED", legal_violation_determined: false } };
}

/** 관련 공식 경보·사례의 패턴을 찾는다. 빈 결과나 문서 빈도를 안전 확률로 바꾸지 않는다. */
export async function analyzeRiskPattern(input: unknown, ctx: ToolCallContext): Promise<ToolOutcome> {
  const [outcome, guidance] = await Promise.all([
    searchPublicKnowledge(input, ctx, ["ALERT", "DISPUTE", "PRECASE_CASE"]),
    ctx.allowedSourceSnapshotIds?.length ? Promise.resolve(null) : searchOfficialWarning(input, ctx),
  ]);
  return { ...outcome, items: [
    ...outcome.items.map(item => ({ ...item, referenceOnly: true, isCitable: false, directness: "CONTEXT_ONLY" as const })),
    ...(guidance?.items ?? []),
  ], candidateCount: outcome.candidateCount + (guidance?.candidateCount ?? 0),
    observations: { ...outcome.observations, kind: "REFERENCE_PATTERN_SEARCH", probability_estimated: false,
      current_transaction_proof: false, result: outcome.items.length ? "RELATED_REFERENCE_FOUND" : "INSUFFICIENT_PATTERN_DATA" } };
}
export const searchDisputeCase = (input: unknown, ctx: ToolCallContext) => searchPublicKnowledge(input, ctx, ["DISPUTE", "PRECASE_CASE"]);
