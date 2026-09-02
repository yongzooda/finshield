/**
 * 슬롯 어휘 정합 — 명세(F-201) · 이용자측 추출 · 코퍼스 라벨 · 화면 표기.
 *
 * 채널을 분류하는 곳이 **두 군데**다: 이용자 진술을 읽는 상담 프롬프트와,
 * 코퍼스 388건에 라벨을 붙인 분류 스크립트. 둘이 같은 정의를 보지 않으면
 * 이용자 슬롯과 사건 라벨이 서로 만나지 못한다 — `search_case`·
 * `analyze_risk_pattern`이 전부 이 값으로 거르므로 **엉뚱한 비교군을 끌어온다.**
 *
 * 실제로 어긋나 있었다(2026.08.21 발견). 상담 프롬프트만 BANCA_HS를
 * 「은행창구」로 알려줘서, 「은행 창구에서 ELS 가입」이 BANCA_HS로 잡히고
 * 화면에 「방카슈랑스」로 표시됐다. 방카슈랑스는 은행에서 파는 보험이다.
 *
 * 눈으로 훑는 점검은 다음 커밋에서 무너지므로 소스를 읽어 대조한다.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHANNEL_LABELS } from "../../labels";

/** 정본은 `docs/02-functional.md` F-201이다. */
const CANON: Record<string, string> = {
  TM: "전화",
  BANCA_HS: "방카슈랑스·홈쇼핑",
  AGENT: "모집인·설계사",
  BRANCH: "창구·대면",
  ONLINE: "온라인·모바일",
};

/** `CODE(풀이)` 꼴을 전부 걷어 온다. */
function glosses(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/\b(TM|BANCA_HS|AGENT|BRANCH|ONLINE)\(([^)]+)\)/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

const consultLine = readFileSync("src/lib/agents/consult.ts", "utf8")
  .split("\n")
  .find((l) => l.includes("- channel:"));

const corpusLine = readFileSync("scripts/classify_corpus.py", "utf8")
  .split("\n")
  .find((l) => l.includes("BANCA_HS(") && l.includes("BRANCH("));

describe("채널 어휘가 네 곳에서 일치한다", () => {
  it("상담 프롬프트에 채널 정의가 있다", () => {
    expect(consultLine, "consult.ts의 `- channel:` 줄을 찾지 못했다").toBeTruthy();
  });

  it("코퍼스 분류 스크립트에 채널 정의가 있다", () => {
    expect(corpusLine, "classify_corpus.py의 채널 열거를 찾지 못했다").toBeTruthy();
  });

  it("⚠️ 상담 프롬프트 = 코퍼스 라벨 정의 — 어긋나면 비교군이 어긋난다", () => {
    const a = glosses(consultLine!);
    const b = glosses(corpusLine!);
    for (const code of Object.keys(CANON)) {
      expect(a[code], `consult.ts의 ${code}`).toBe(CANON[code]);
      expect(b[code], `classify_corpus.py의 ${code}`).toBe(CANON[code]);
    }
  });

  it("화면 표기가 분류 정의와 어긋나지 않는다", () => {
    for (const [code, canon] of Object.entries(CANON)) {
      expect(
        CHANNEL_LABELS[code as keyof typeof CHANNEL_LABELS],
        `화면의 ${code} 표기가 분류 정의(${canon})를 담지 않는다`,
      ).toContain(canon);
    }
  });

  it("방카슈랑스가 보험이라는 사실을 프롬프트가 밝힌다", () => {
    // 「방카슈랑스·홈쇼핑」만으로는 은행 창구 ELS를 어디에 넣을지 모호하다.
    const src = readFileSync("src/lib/agents/consult.ts", "utf8");
    expect(src).toContain("은행 창구에서 판 ELS·펀드·대출은 BRANCH다");
  });
});
