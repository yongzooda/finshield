import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoUnavailableError, demoRecorder, readSeed } from "../demo";
import { TOOL_IMPLS } from "../tools";
import type { PendingToolRun, SourceItem, ToolCallContext } from "../tools/runtime";

const sourceId = "00000000-0000-4000-8000-000000000047";
const toolRunId = "00000000-0000-4000-8000-000000000048";
const productRow = {
  id: sourceId, source_type: "PRODUCT", authority_level: "A", publisher_name: "금융위원회",
  source_title: "햇살론15 기준 정보", canonical_url: "https://www.data.go.kr/data/15094787/openapi.do",
  official_id: "data.go.kr:15094787:햇살론15:202602:1", source_version: "202602",
  content_hash: "a".repeat(64), source_fingerprint: "b".repeat(64), published_at: "2026-02-01",
  effective_from: "2026-02-01", effective_to: null, license_code: "DATA_GO_KR_NO_RESTRICTION",
  is_complete: true, is_citable: true, freshness_status: "FRESH", retrieved_at: "2026-09-07T19:39:47.125Z",
  fresh_until: "2026-09-08T19:39:47.125Z", chunk_id: "00000000-0000-4000-8000-000000000049",
  chunk_text: "햇살론15 대출금리 15.9% 대출한도 2000만원", source_locator: { kind: "data_go_kr_record" },
  document_type: "PRODUCT", document_active: true, valid_from: "2026-02-01", valid_to: null,
  keyword_rank: 1, vector_distance: null,
};

const cancellable = <T,>(value: T) => Object.assign(Promise.resolve(value), { cancel: vi.fn() });

describe("공개 Demo의 승인 출처 경계", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08T03:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const scopedSql = () => Object.assign(vi.fn((parts: TemplateStringsArray) => {
    const query = parts.join("?");
    if (query.includes("select embedding_model")) return cancellable([{ embedding_model: null, embedding_dimension: null, embedding_model_version: null, documents: 1 }]);
    if (query.includes("with scoped as")) return cancellable([productRow]);
    throw new Error(`예상하지 않은 SQL: ${query}`);
  }), { unsafe: (value: string) => value });
  const demoCtx = (sql: unknown) => ({
    sql, allowedSourceSnapshotIds: [sourceId],
    manifest: { manifestId: "manifest", kbReleaseId: "release", agentIds: {}, toolIds: {} },
  }) as unknown as ToolCallContext;
  // 진흥원 공식 상품 페이지의 본문 구간. 실제 페이지와 같은 표지만 합성한다.
  const kinfaPage = (notice: string) => `<html><body><h3 id="ConTitle">햇살론15</h3>`
    + `<p>서민금융진흥원 보증 정책서민금융상품 ${notice} 대출한도 최대 2000만원 대출금리 연 15.9% (단일금리)</p>`
    + `<!--일반보증이란?--></body></html>`;

  it("상품 조회를 Seed가 승인한 Snapshot과 Manifest Release로 제한한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const sql = scopedSql();
    const result = await TOOL_IMPLS.search_financial_product({ query: "햇살론15 3.2%" }, demoCtx(sql));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ storedSnapshotId: sourceId, isCitable: true, directness: "DIRECT" });
    expect(sql.mock.calls.some((call) => call.some((value) =>
      Array.isArray(value) && value.includes(sourceId)))).toBe(true);
    // 공식 페이지를 읽지 못했으면 종료 여부를 추정하지 않고 그 사실만 남긴다.
    expect(result.observations).toMatchObject({ official_product_page: "UNAVAILABLE" });
  });

  it("회원 실행과 같은 공식 상품 페이지의 보증 종료 고지를 함께 돌려준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(kinfaPage("[2025년 12월 31일 보증 종료]"))));
    const result = await TOOL_IMPLS.search_financial_product({ query: "햇살론15 금리 한도" }, demoCtx(scopedSql()));
    expect(result.items[0]).toMatchObject({ storedSnapshotId: sourceId });
    const notice = result.items.find((item) => item.locator.permitted_use === "REFUTE_CURRENT_OFFER");
    expect(notice).toMatchObject({ officialId: "kinfa:hessalLoan", isCitable: true, directness: "DIRECT" });
    expect(notice?.locator).toMatchObject({ temporal_status: "ENDED", product_end_date: "2025-12-31" });
    expect(result.observations).toMatchObject({ official_product_page: "ENDED" });
  });

  // 진흥원 예방 공지의 합성 본문. 검토한 본문과 Hash 가 달라 비교 근거가 되지 않는다.
  const noticePage = `<div class="board-detail-header"><p class="tit">합성 예방 공지</p><li>2021-05-27</li></div>`
    + `<div class="board-detail-con contents"><p>서민금융진흥원은 문자메시지나 전화 광고 합성 문구</p>`
    + `<p>정상적인 금융기관 합성 문구</p><p>출처가 불분명한 앱 합성 문구</p></div><div class="board-detail-footer">목록</div>`;
  const guideSql = () => Object.assign(vi.fn((parts: TemplateStringsArray) => {
    const query = parts.join("?");
    if (query.includes("select embedding_model")) return cancellable([{ embedding_model: null, embedding_dimension: null, embedding_model_version: null, documents: 1 }]);
    if (query.includes("with scoped as")) return cancellable([]);
    throw new Error(`예상하지 않은 SQL: ${query}`);
  }), { unsafe: (value: string) => value });

  it("예방 안내 조회에 회원 실행과 같은 진흥원 공지를 함께 읽는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(noticePage)));
    const result = await TOOL_IMPLS.search_consumer_warning({ query: "정부지원 대출 문자 사칭" }, demoCtx(guideSql()));
    const notice = result.items.find((item) => item.officialId === "kinfa:notice:24020");
    // 검토한 본문과 다르면 비교 근거가 아니라 참고 자료로만 온다.
    expect(notice).toMatchObject({ isCitable: false, directness: "CONTEXT_ONLY", referenceOnly: true });
    expect(notice?.locator).toMatchObject({ permitted_use: "PUBLIC_GUIDANCE_COMPARISON", current_transaction_proof: false });
    expect(result.observations).toMatchObject({ kind: "APPROVED_DEMO_GUIDE_SEARCH", official_warning: "UNREVIEWED" });
  });

  it("예방 공지를 읽지 못하면 승인 Snapshot 결과만 돌려주고 그 사실을 남긴다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const result = await TOOL_IMPLS.search_consumer_warning({ query: "정부지원 대출 문자 사칭" }, demoCtx(guideSql()));
    expect(result.items).toEqual([]);
    expect(result.observations).toMatchObject({ official_warning: "UNAVAILABLE", current_transaction_proof: false });
  });

  it("햇살론15 가 아닌 상품 조회는 공식 페이지를 부르지 않는다", async () => {
    const fetch = vi.fn(async () => new Response(kinfaPage("")));
    vi.stubGlobal("fetch", fetch);
    await TOOL_IMPLS.search_financial_product({ query: "사잇돌 금리" }, demoCtx(scopedSql()));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Seed에 공식 출처가 없으면 공개 실행을 시작하지 않는다", async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ version: "v1", masked_input: "합성", expected_claim_manifest: { claims: [] } }])
      .mockResolvedValueOnce([]);
    await expect(readSeed(sql as never, sourceId)).rejects.toBeInstanceOf(DemoUnavailableError);
  });
});

describe("공개 Demo Tool 출처 원장", () => {
  it("SourceItem의 저장 Snapshot ID를 demo.tool_run_sources에 연결한다", async () => {
    const queries: string[] = [];
    const values: unknown[][] = [];
    const sql = Object.assign(vi.fn((parts: TemplateStringsArray, ...args: unknown[]) => {
      const query = parts.join("?"); queries.push(query); values.push(args);
      if (query.includes("insert into demo.tool_runs")) return Promise.resolve([{ id: toolRunId }]);
      if (query.includes("insert into demo.tool_run_sources")) return Promise.resolve([]);
      throw new Error(`예상하지 않은 SQL: ${query}`);
    }), { json: (value: unknown) => value });
    const item: SourceItem = {
      sourceType: "PRODUCT", authorityGrade: "A", publisher: "금융위원회", title: "햇살론15",
      officialId: "fixture", canonicalUrl: null, publishedAt: null, sourceVersion: "1",
      contentHash: "a".repeat(64), fingerprint: "b".repeat(64), freshness: "FRESH",
      storedSnapshotId: sourceId, licenseCode: null, isComplete: true, isCitable: true,
      locator: { kind: "record" }, excerptMasked: "합성", directness: "DIRECT", referenceOnly: false,
      selectionReasonCode: "TEST",
    };
    const pending: PendingToolRun = {
      toolCode: "search_financial_product", purposeCode: "VERIFY_PRODUCT", input: { query: "햇살론15" },
      startedAt: 1, finishedAt: 2, status: "SUCCEEDED", provenanceComplete: true,
      candidateCount: 1, errorCode: null, reasonCode: null, observations: null,
      items: [{ ref: "E1", item }],
    };
    const ids = await demoRecorder(sql as never, sourceId).toolRuns("agent", [pending]);
    expect(ids.get("E1")).toBe("E1");
    expect(values.flat()).toContain(sourceId);
    expect(queries.some((query) => query.includes("record_source_snapshot"))).toBe(false);
  });
});
