import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  parsed: null as unknown,
  ocr: vi.fn(),
  queries: [] as string[],
}));
vi.mock("../files/storage", () => ({ readQuarantinedFile: async () => Buffer.from("%PDF-1.7 synthetic") }));
vi.mock("../files/parser", () => ({ parseIsolatedFile: async () => state.parsed }));
vi.mock("../files/ocr", () => ({ extractWithOcr: state.ocr }));
vi.mock("../files/cleanup", () => ({ cleanupCaseFiles: vi.fn() }));
import { processFileInput } from "../files/process";

const TEXT = "정부지원 햇살론15 연 3% 고정금리로 2천만원까지 가능합니다.";
const page = (page_no: number, text: string) => ({ page_no, text, words: [] });

// 실제 DB 대신 호출한 함수 이름만 기록하고 필요한 행을 돌려준다.
const sql = Object.assign((strings: TemplateStringsArray) => {
  const text = strings.join("?");
  const name = /private\.(\w+)/.exec(text)?.[1] ?? "unknown";
  state.queries.push(name);
  const rows: Record<string, unknown[]> = {
    file_input_context: [{ context: { object_id: "object", object_path: "path", declared_mime: "application/pdf", size_bytes: 18 } }],
    input_page_ids: [{ id: "page-1", page_no: 1 }, { id: "page-2", page_no: 2 }],
    record_file_claim: [{ id: "claim-1" }],
  };
  return Promise.resolve(rows[name] ?? [{ id: name }]);
}, { begin: async (callback: (tx: unknown) => Promise<unknown>) => callback(sql) });

const run = (ocrConsent: boolean) => processFileInput({
  sql: sql as never, ownerId: "owner", caseId: "case", inputId: "input", ocrConsent,
  extractClaims: async () => [{ claimType: "PRODUCT_TERM" as const, statementMasked: "연 3% 고정금리",
    materiality: "MATERIAL" as const, sourceQuote: "연 3% 고정금리로" }],
});

afterEach(() => { state.queries = []; state.ocr.mockReset(); });

it("빈 쪽이 섞인 PDF는 OCR 동의 없이 글자 층이 있는 쪽을 읽고 읽지 못한 쪽을 알린다", async () => {
  state.parsed = { ok: true, mime: "application/pdf", needs_ocr: true, unreadable_pages: [2], pages: [page(1, TEXT), page(2, "")] };
  const result = await run(false);
  expect(result.unread_pages).toEqual([2]);
  expect(result.claims).toHaveLength(1);
  expect(result.claims[0].source_page_no).toBe(1);
  expect(state.ocr).not.toHaveBeenCalled();
  expect(state.queries).not.toContain("register_ocr_artifact");
  expect(state.queries).not.toContain("acquire_provider_slot");
});

it("깨진 글자 쪽은 동의 없이 모델에 넘기지 않는다", async () => {
  state.parsed = { ok: true, mime: "application/pdf", needs_ocr: true, unreadable_pages: [2], pages: [page(1, TEXT), page(2, "\uFFFD\uFFFD 연 9%")] };
  const result = await run(false);
  expect(result.masked_pages[1].text).toBe("");
  expect(result.masked_text).not.toContain("9%");
});

it.each([
  ["전부 스캔인 PDF", { ok: true, mime: "application/pdf", needs_ocr: true, unreadable_pages: [1, 2], pages: [page(1, ""), page(2, "")] }],
  ["이미지", { ok: true, mime: "image/png", needs_ocr: true, pages: [page(1, "")] }],
])("%s는 여전히 OCR 동의가 필요하다", async (_label, parsed) => {
  state.parsed = parsed;
  await expect(run(false)).rejects.toThrow("OCR_CONSENT_REQUIRED");
  expect(state.ocr).not.toHaveBeenCalled();
});

it("동의한 경우에는 빈 쪽이 있으면 문서 전체를 OCR로 읽는다", async () => {
  vi.stubEnv("CLOVA_OCR_SECRET", "fixture"); vi.stubEnv("CLOVA_OCR_INVOKE_URL", "https://example.invalid");
  state.parsed = { ok: true, mime: "application/pdf", needs_ocr: true, unreadable_pages: [2], pages: [page(1, TEXT), page(2, "")] };
  state.ocr.mockResolvedValue([page(1, TEXT), page(2, "상환 기간 5년")]);
  const original = sql;
  const withSlot = Object.assign((strings: TemplateStringsArray) => /acquire_provider_slot/.test(strings.join("?"))
    ? (state.queries.push("acquire_provider_slot"), Promise.resolve([{ scheduled_at: new Date().toISOString() }]))
    : original(strings), { begin: async (callback: (tx: unknown) => Promise<unknown>) => callback(withSlot) });
  const result = await processFileInput({ sql: withSlot as never, ownerId: "owner", caseId: "case", inputId: "input", ocrConsent: true,
    extractClaims: async () => [{ claimType: "PRODUCT_TERM" as const, statementMasked: "연 3% 고정금리",
      materiality: "MATERIAL" as const, sourceQuote: "연 3% 고정금리로" }] });
  expect(state.ocr).toHaveBeenCalledOnce();
  expect(result.unread_pages).toEqual([]);
  expect(state.queries.filter(name => name === "register_ocr_artifact")).toHaveLength(2);
  vi.unstubAllEnvs();
});

it("긴 변이 8,000px 이상인 이미지는 OCR 로 보내기 전에 막는다", async () => {
  vi.stubEnv("CLOVA_OCR_SECRET", "fixture"); vi.stubEnv("CLOVA_OCR_INVOKE_URL", "https://example.invalid");
  state.parsed = { ok: true, mime: "image/png", needs_ocr: true, pages: [page(1, "")], image: { width: 1080, height: 9000 } };
  await expect(run(true)).rejects.toThrow("OCR_IMAGE_TOO_LONG");
  expect(state.ocr).not.toHaveBeenCalled();
  expect(state.queries).not.toContain("acquire_provider_slot");
  vi.unstubAllEnvs();
});
