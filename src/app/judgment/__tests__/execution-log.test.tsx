/**
 * S-08 실행 로그 표현 — **「기술 로그 원문이 아니라 일반 사용자가 읽을 수 있는
 * 문장으로. 도구 원어명은 보조 표기」**(화면 명세 S-08).
 *
 * 실기(2026.08.24, 카카오톡 인앱)에서 화면에 이런 줄이 그대로 나갔다:
 *
 * ```
 * [조사] 도구 호출 lookup_statute — OK
 * 18.5초 · tool lookup_statute · outcome OK · law 자본시장과 금융투자업에
 * 관한 법률 · article 제47조 · source SNAPSHOT · fallback false
 * ```
 *
 * 이용자가 「코드 같아서 이해가 안 된다」고 지적했고, 명세 위반이기도 했다.
 * **줄이지 않고 옮기는 것**이 조건이라 두 가지를 함께 고정한다 — 코드 잔재가
 * 없을 것, 그리고 값이 사라지지 않을 것.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutionLog } from "../execution-log";
import { toolMessage } from "@/lib/agents/trace";
import type { ToolOutcome, TraceEntry } from "@/lib/agents/trace";

const entries: TraceEntry[] = [
  { seq: 1, atMs: 0, layer: "CONSULT", level: "INFO", message: "민감정보 처리에 동의했습니다" },
  {
    seq: 2, atMs: 18_500, layer: "INVESTIGATE", level: "INFO",
    message: toolMessage("lookup_statute", "OK"),
    detail: {
      tool: "lookup_statute", outcome: "OK",
      law: "자본시장과 금융투자업에 관한 법률", article: "제47조",
      source: "SNAPSHOT", fallback: false,
    },
  },
  {
    seq: 3, atMs: 40_000, layer: "INVESTIGATE", level: "WARN",
    message: toolMessage("search_precedent", "EMPTY"),
    detail: { tool: "search_precedent", outcome: "EMPTY", total: 12, retried: true },
  },
  {
    seq: 4, atMs: 90_000, layer: "JUDGE", level: "WARN",
    message: "확신도가 기준에 미치지 않아 결론을 표시하지 않습니다",
    detail: { confidence: 3, threshold: 4 },
  },
];

const html = renderToStaticMarkup(<ExecutionLog entries={entries} />);

describe("실행 로그 표현 (S-08)", () => {
  it("도구 호출을 사람 문장으로 적는다", () => {
    expect(html).toContain("법령 조문을 찾았습니다");
    expect(html).toContain("사건번호가 맞는 판례가 없어 판례는 쓰지 않았습니다");
  });

  it("코드 잔재를 본문에 남기지 않는다", () => {
    // 예전 형태: `도구 호출 lookup_statute — OK` · `outcome OK` · `fallback false`
    expect(html).not.toContain("도구 호출 lookup_statute");
    expect(html).not.toContain("outcome OK");
    expect(html).not.toContain("fallback false");
    expect(html).not.toContain("retried true");
  });

  it("도구 원어명은 보조 표기로 남긴다 — 검증하려는 사람에게 필요하다", () => {
    expect(html).toContain("도구 lookup_statute");
    expect(html).toContain("도구 search_precedent");
  });

  it("값이 사라지지 않는다 — 옮겨 적을 뿐이다 (EP-1)", () => {
    expect(html).toContain("자본시장과 금융투자업에 관한 법률");
    expect(html).toContain("제47조");
    expect(html).toContain("보관된 옛 조문"); // source SNAPSHOT
    expect(html).toContain("후보 수 12");
    expect(html).toContain("확신도 3");
    expect(html).toContain("기준 4");
  });

  it("참·거짓을 예·아니요로 적는다", () => {
    expect(html).toContain("보관본 사용 아니요"); // fallback false
    expect(html).toContain("쟁점 바꿔 재시도 예"); // retried true
  });

  it("실패는 ⚠로 그대로 드러낸다 (EP-1)", () => {
    expect(html).toContain("⚠");
  });

  it("모르는 도구 이름을 지어내지 않는다", () => {
    expect(toolMessage("some_new_tool", "OK")).toContain("some_new_tool");
    expect(toolMessage("some_new_tool", "FAILED")).toContain("some_new_tool");
  });

  it("도구 5종 · 결과 4종에 전부 문장이 있다", () => {
    const tools = ["lookup_statute", "search_precedent", "search_case", "check_documents", "analyze_risk_pattern"];
    for (const t of tools) {
      for (const o of ["OK", "EMPTY", "FAILED", "BLOCKED"] as const) {
        const m = toolMessage(t, o);
        expect(m, `${t}:${o}`).not.toContain(t); // 원어명이 문장에 섞이지 않는다
        expect(m.endsWith("니다"), `${t}:${o} — ${m}`).toBe(true);
      }
    }
  });
});

/**
 * 데모 3종의 실행 로그도 같은 규칙을 따라야 한다.
 *
 * 데모는 배포 번들의 **정적 자산**이라(DR-107) 코드가 바뀌어도 저절로 갱신되지
 * 않는다. 그런데 **심사위원이 실제로 보는 화면**은 데모다(글로벌 푸터에서 상시
 * 접근, F-701·T-4). 새 판단만 읽기 좋고 데모는 코드 덤프인 상태가 되면
 * 고친 의미가 없다.
 */
describe("데모 실행 로그 (DR-107)", () => {
  it("옛 기술 로그 문구가 남아 있지 않다", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = new URL("../../../lib/demo/", import.meta.url).pathname;
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(dir + f, "utf8");
      expect(src, `${f}에 옛 문구가 남아 있다`).not.toMatch(/도구 호출 [a-z_]+ — (OK|EMPTY|FAILED|BLOCKED)/);
    }
  });

  it("데모가 실은 문구가 지금 규칙이 만드는 문구와 같다", async () => {
    const { readFileSync } = await import("node:fs");
    const dir = new URL("../../../lib/demo/", import.meta.url).pathname;
    const src = readFileSync(dir + "concluded.ts", "utf8");
    // detail.tool·outcome이 있는 항목은 그 조합이 만드는 문장을 갖고 있어야 한다
    const pairs = [...src.matchAll(/"message":\s*"([^"]+)",\s*"detail":\s*\{\s*"tool":\s*"([a-z_]+)",\s*"outcome":\s*"(OK|EMPTY|FAILED|BLOCKED)"/g)];
    expect(pairs.length).toBeGreaterThan(0);
    for (const [, message, tool, outcome] of pairs) {
      expect(message, `${tool}:${outcome}`).toBe(toolMessage(tool, outcome as ToolOutcome));
    }
  });
});
