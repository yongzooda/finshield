/** 검토한 예방 공지의 본문 변경과 검토 기한 임박을 예약 실행이 먼저 알린다 (EV-009). */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WARNING_REVIEW } from "../tools/warning-review";
import { extractWarningSection } from "../tools/official-warning";
import { assessWarningReview, readReviewConstants, RENEW_BEFORE_MS } from "../../../../scripts/kb/check-warning-review.mjs";

const html = `<div class="board-detail-header"><p class="tit">합성 공지</p><li>2021-05-27</li></div>`
  + `<div class="board-detail-con contents"><p>문자메시지나 전화 합성</p><p>정상적인 금융기관 합성</p><p>출처가 불분명한 앱 합성</p></div>`
  + `<div class="board-detail-footer">목록</div>`;
const sectionHash = createHash("sha256").update(extractWarningSection(html).original).digest("hex");

describe("검토한 예방 공지 점검", () => {
  it("운영 도구와 같은 경계로 본문 Hash 를 낸다", () => {
    const review = { officialId: "kinfa:notice:24020", contentHash: sectionHash, reviewDueAt: "2026-10-11T00:00:00Z" };
    expect(assessWarningReview({ review, html, now: Date.parse("2026-09-11T00:00:00Z") })).toMatchObject({ ok: true, observedHash: sectionHash });
  });

  it("본문이 달라지거나 구조가 바뀌면 다시 검토하라고 실패한다", () => {
    const review = { officialId: "kinfa:notice:24020", contentHash: "0".repeat(64), reviewDueAt: "2026-10-11T00:00:00Z" };
    expect(assessWarningReview({ review, html, now: Date.parse("2026-09-11T00:00:00Z") }).problems).toEqual(["공지 본문이 검토한 본문과 달라졌다"]);
    expect(assessWarningReview({ review, html: "<html>이동</html>", now: 0 }).problems[0]).toMatch(/구조가 바뀌어/);
  });

  it("검토 기한 72시간 전부터 실패해 다시 검토할 시간을 둔다", () => {
    const review = { officialId: "kinfa:notice:24020", contentHash: sectionHash, reviewDueAt: "2026-10-11T00:00:00Z" };
    const due = Date.parse(review.reviewDueAt);
    expect(assessWarningReview({ review, html, now: due - RENEW_BEFORE_MS - 1000 }).ok).toBe(true);
    expect(assessWarningReview({ review, html, now: due - RENEW_BEFORE_MS + 1000 }).problems[0]).toMatch(/시간 안에 끝난다/);
    expect(assessWarningReview({ review, html, now: due }).problems).toEqual(["검토 기한이 지났다"]);
  });

  it("저장소의 검토 값을 그대로 읽는다", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/finshield/tools/warning-review.ts"), "utf8");
    expect(readReviewConstants(source)).toEqual({
      officialId: WARNING_REVIEW.officialId, contentHash: WARNING_REVIEW.contentHash, reviewDueAt: WARNING_REVIEW.reviewDueAt,
    });
    expect(() => readReviewConstants("export const X = 1;")).toThrow();
  });
});

describe("예방 공지 받기", () => {
  it("연결 오류는 두 번 더 시도하고 표준 요청 헤더를 보낸다", async () => {
    const { fetchNotice } = await import("../../../../scripts/kb/check-warning-review.mjs");
    const seen: RequestInit[] = [];
    let calls = 0;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      seen.push(init); calls += 1;
      if (calls < 3) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
      return new Response(html);
    };
    await expect(fetchNotice({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => undefined })).resolves.toContain("board-detail-con");
    expect(calls).toBe(3);
    expect(seen[0].headers).toMatchObject({ "Accept-Language": "ko-KR,ko;q=0.9" });
  });

  it("세 번 모두 끊기면 원인 코드와 함께 실패하고, 오류 응답은 다시 시도하지 않는다", async () => {
    const { fetchNotice } = await import("../../../../scripts/kb/check-warning-review.mjs");
    const down = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); };
    await expect(fetchNotice({ fetchImpl: down as unknown as typeof fetch, sleep: async () => undefined })).rejects.toThrow("ECONNRESET");
    let calls = 0;
    const missing = async () => { calls += 1; return new Response("없음", { status: 404 }); };
    await expect(fetchNotice({ fetchImpl: missing as unknown as typeof fetch, sleep: async () => undefined })).rejects.toThrow("404");
    expect(calls).toBe(1);
  });
});
