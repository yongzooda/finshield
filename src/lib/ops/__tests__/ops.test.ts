/**
 * B-4 운영 API 검증 — 신고(DR-301) · 카운터(DR-302) · 헬스체크(N-302).
 *
 * ⚠️ **쓰기 테스트는 전부 트랜잭션 안에서 하고 롤백한다.** 여기서 치는 DB는
 * 운영 DB이고, app_runtime 롤에는 DELETE 권한이 없어서(설계 의도) 테스트가 남긴
 * 행을 지울 방법이 없다. 커밋하면 KPI 카운터와 신고 목록이 테스트 값으로
 * 오염된다.
 */

import { describe, expect, it } from "vitest";
import { summarize, type CheckResult } from "../health";
import { readJson, str } from "../http";
import { isClientCounterEvent } from "../counters";
import type { SqlExec } from "../counters";

import { dbReady as ready } from "@/test/live";

const check = (name: CheckResult["name"], ok: boolean): CheckResult => ({ name, ok, ms: 1 });

describe("DR-302 카운터 권한 경계", () => {
  it("클라이언트가 올릴 수 있는 이벤트는 2종뿐이다", () => {
    expect(isClientCounterEvent("RECONSULT_ENTRY")).toBe(true);
    expect(isClientCounterEvent("DEMO_VIEWED")).toBe(true);
  });

  it("판단 관련 이벤트는 브라우저에서 올릴 수 없다 — KPI 조작 방지", () => {
    expect(isClientCounterEvent("JUDGMENT_DONE")).toBe(false);
    expect(isClientCounterEvent("WITHHELD")).toBe(false);
    expect(isClientCounterEvent("REPORT_SUBMITTED")).toBe(false);
  });
});

describe("N-302 헬스체크 등급", () => {
  it("전부 정상이면 ok", () => {
    expect(summarize([check("db", true), check("law_api", true), check("claude_api", true)])).toBe("ok");
  });

  it("일부 장애는 degraded — 예방 축·검증 결과는 계속 제공된다 (EX-401)", () => {
    expect(summarize([check("db", true), check("law_api", false), check("claude_api", true)])).toBe("degraded");
  });

  it("전부 장애면 down", () => {
    expect(summarize([check("db", false), check("law_api", false), check("claude_api", false)])).toBe("down");
  });
});

describe("운영 API 본문 처리", () => {
  const post = (body: string) => new Request("http://x/api/event", { method: "POST", body });

  it("깨진 JSON은 400이고, 받은 문자열을 응답에 싣지 않는다 (N-403)", async () => {
    const r = await readJson(post("{자문 원문이 섞인 깨진 본문"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(400);
    const text = await r.response.text();
    expect(text).not.toContain("자문 원문");
  });

  it("상한을 넘는 본문은 413", async () => {
    const r = await readJson(post(JSON.stringify({ a: "가".repeat(2000) })), 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(413);
  });

  it("문자열 아닌 필드는 null로 접는다", () => {
    expect(str({ event: 3 }, "event")).toBeNull();
    expect(str({ event: "DEMO_VIEWED" }, "event")).toBe("DEMO_VIEWED");
  });
});

describe("DR-301 신고 — DB 이전 단계", () => {
  /** 호출되면 실패하는 실행기. "DB에 닿지 않았다"를 증명하는 데 쓴다 */
  const forbidden = (() => {
    throw new Error("DB에 접근하면 안 되는 경로다");
  }) as unknown as SqlExec;

  it("빈 신고는 거절한다", async () => {
    const { submitReport } = await import("../reports");
    const r = await submitReport({ content: "   " }, { maxChars: 4000, exec: forbidden });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID");
  });

  it("상한 초과는 거절한다", async () => {
    const { submitReport } = await import("../reports");
    const r = await submitReport({ content: "가".repeat(4001) }, { maxChars: 4000, exec: forbidden });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID");
  });

  it("잔존 PII가 의심되면 **저장하지 않고** 되돌린다 (F-601 · EP-3)", async () => {
    const { submitReport } = await import("../reports");
    // 규칙으로 지우지 못한 긴 숫자열이 남는 입력이다(실측 확인). forbidden
    // 실행기가 호출되면 테스트가 죽으므로, 통과 = DB에 닿지 않았다는 뜻이다.
    const r = await submitReport(
      { content: "판단이 사실과 다릅니다. 증권번호 123456789012 확인해 주세요" },
      { maxChars: 4000, exec: forbidden },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // DB로 갔다면 forbidden이 던져 reason이 "DB"가 된다 — 그 경우도 실패로 잡힌다
    expect(r.reason).toBe("PII_RESIDUAL");
  });
});

describe.skipIf(!ready)("DR-301·302 실제 쓰기 — 전부 롤백", () => {
  it("카운터는 하루치 합계를 1 올린다", async () => {
    const { sql } = await import("../../db");
    const { bumpCounter } = await import("../counters");

    await expect(
      sql.begin(async (tx) => {
        // ⚠️ 질의 객체를 재사용하면 안 된다 — postgres.js의 PendingQuery는 한 번만
        // 실행되고 이후 await는 같은 결과를 돌려준다. 매번 새로 만든다.
        const today = () => tx<{ cnt: number }[]>`
          select cnt from usage_counters
          where event_type = 'DEMO_VIEWED'
            and event_date = (now() at time zone 'Asia/Seoul')::date
        `;
        const before = Number((await today())[0]?.cnt ?? 0);

        const ok = await bumpCounter("DEMO_VIEWED", tx as unknown as SqlExec);
        expect(ok).toBe(true);

        const after = Number((await today())[0]?.cnt ?? 0);
        expect(after).toBe(before + 1);

        throw new Error("ROLLBACK");
      }),
    ).rejects.toThrow("ROLLBACK");
  });

  it("신고는 마스킹된 본문만 INSERT한다 — 채널 UNKNOWN은 null로 접는다", async () => {
    const { sql } = await import("../../db");
    const { submitReport } = await import("../reports");

    await expect(
      sql.begin(async (tx) => {
        const r = await submitReport(
          {
            content: "설명의무 판단이 사실과 다릅니다. 계좌 110-234-567890 으로 이체했습니다",
            channel: "UNKNOWN",
            issueCode: "없는쟁점코드",
          },
          { maxChars: 4000, exec: tx as unknown as SqlExec },
        );

        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error("접수 실패");

        // 계좌번호는 마스킹돼 저장된다
        expect(r.masked.text).not.toContain("110-234-567890");
        expect(r.masked.total).toBeGreaterThan(0);
        // UNKNOWN은 error_reports.channel CHECK에 없다 → null로 접고 알린다
        expect(r.droppedChannel).toBe(true);
        // issue_tags에 없는 코드는 버리되 신고 자체는 살린다
        expect(r.droppedIssueCode).toBe(true);

        throw new Error("ROLLBACK");
      }),
    ).rejects.toThrow("ROLLBACK");
  });

  it("app_runtime은 접수분을 되읽을 수 없다 — 권한이 설계 방어선이다 (P-501)", async () => {
    const { sql } = await import("../../db");
    await expect(sql`select id from error_reports limit 1`).rejects.toThrow();
  });
});
