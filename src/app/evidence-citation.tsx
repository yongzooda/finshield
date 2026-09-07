import { FsChip } from "./fs-shell";
import { FRESHNESS_LABEL } from "./fs-labels";

export type EvidenceCitationData = {
  id: string; title?: string | null; url?: string | null; publisher_name?: string | null;
  excerpt_masked?: string | null; published_at?: string | null; fetched_at?: string | null;
  created_at?: string; content_hash?: string; source_version?: string | null;
  official_id?: string | null; freshness_at_use: string; reference_only: boolean;
};

export function EvidenceCitation({ evidence }: { evidence: EvidenceCitationData }) {
  const url = evidence.url && /^https?:\/\//.test(evidence.url) ? evidence.url : null;
  return <div className="rounded-[10px] bg-[var(--fs-canvas)] px-4 py-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="font-bold">{evidence.title ?? "공식 근거"}</p>
      <FsChip tone={evidence.freshness_at_use === "FRESH" ? "verified" : "caution"}>
        {FRESHNESS_LABEL[evidence.freshness_at_use] ?? evidence.freshness_at_use}
      </FsChip>
      {evidence.reference_only ? <FsChip tone="caution">참고 사례</FsChip> : null}
    </div>
    <p className="fs-body mt-2">{evidence.excerpt_masked ?? "인용 본문이 없습니다."}</p>
    <p className="fs-meta mt-2">{evidence.publisher_name ?? "발행기관 미확인"}
      {" · "}발행 {evidence.published_at ? new Date(evidence.published_at).toLocaleDateString("ko-KR") : "미상"}
      {" · "}조회 {evidence.fetched_at ? new Date(evidence.fetched_at).toLocaleString("ko-KR") : "미상"}
    </p>
    {url ? <a className="fs-meta mt-2 inline-block underline" href={url} target="_blank" rel="noopener noreferrer">공식 원문 열기</a> : null}
    <details className="fs-details mt-2"><summary>출처 버전과 검증 기록</summary>
      <dl className="fs-meta grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 mt-2">
        <dt>공식 식별자</dt><dd>{evidence.official_id ?? "미제공"}</dd>
        <dt>출처 버전</dt><dd>{evidence.source_version ?? "본문 해시로 구분"}</dd>
        <dt>본문 해시</dt><dd className="break-all">{evidence.content_hash ?? "미확인"}</dd>
      </dl>
    </details>
  </div>;
}
