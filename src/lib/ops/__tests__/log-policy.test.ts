/**
 * N-403 서버 로그 정책 — **진술·슬롯 값·판단 본문이 로그에 남지 않는다.**
 *
 * 배포 전 전수 점검 1회가 명세 요구지만, 사람이 눈으로 훑는 점검은 다음 커밋에서
 * 무너진다. 소스를 직접 읽어 **승인되지 않은 로그 경로가 새로 생기면 실패**하게
 * 만든다. 이 테스트가 깨지면 새 로그를 승인 목록에 넣기 전에 무엇을 찍는지
 * 확인하라는 뜻이다.
 *
 * 허용 로그 필드(명세 N-403): 익명 세션 해시 · 이벤트 유형 · 도구명 · 소요 시간.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/** 승인된 로그 경로. **줄 내용까지 고정한다** — 같은 파일에 다른 로그가 붙으면 걸린다 */
const APPROVED: { file: string; snippet: string; why: string }[] = [
  {
    file: "lib/ops/reports.ts",
    snippet: "console.warn(`[ops] report insert failed pg=${pgCode(e)}`)",
    why: "SQLSTATE만 — 신고 본문은 싣지 않는다",
  },
  {
    file: "lib/ops/budget.ts",
    snippet: "console.warn(`[ops] budget record failed model=${model} pg=${pgCode(e)}`)",
    why: "모델명 + SQLSTATE — 둘 다 내용이 아니다. 토큰 수·금액도 싣지 않는다",
  },
  {
    file: "lib/ops/budget.ts",
    snippet: "console.warn(`[ops] budget read failed pg=${pgCode(e)}`)",
    why: "SQLSTATE만",
  },
  {
    file: "lib/ops/counters.ts",
    snippet: "console.warn(`[ops] counter bump failed event=${event} pg=${pgCode(e)}`)",
    why: "이벤트 유형(허용 필드) + SQLSTATE",
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "test") continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC);

describe("N-403 로그 경로 전수 점검", () => {
  it("승인되지 않은 console 호출이 없다", () => {
    const found: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1);
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!/\bconsole\.(log|warn|error|info|debug|trace)\s*\(/.test(line)) return;
          const ok = APPROVED.some((a) => rel === a.file && line.includes(a.snippet.slice(0, 40)));
          if (!ok) found.push(`${rel}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(
      found,
      "승인되지 않은 로그다. 무엇을 찍는지 확인하고 APPROVED에 사유와 함께 등록하라:\n" +
        found.join("\n"),
    ).toHaveLength(0);
  });

  it("오류 객체를 통째로 찍지 않는다 — 드라이버가 파라미터 값을 메시지에 싣는다", () => {
    const found: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1);
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!/console\.\w+\(/.test(line)) return;
          // console.xxx(e) · console.xxx(err) · ${e.message} · ${String(e)}
          if (/console\.\w+\(\s*(e|err|error)\s*[,)]/.test(line) || /\$\{\s*(e|err|error)(\.message)?\s*\}/.test(line) || /String\(\s*e\s*\)/.test(line)) {
            found.push(`${rel}:${i + 1}  ${line.trim()}`);
          }
        });
    }
    expect(found, "오류 원문을 로그에 실었다:\n" + found.join("\n")).toHaveLength(0);
  });

  it("실행 로그에 오류 메시지 원문을 넣지 않는다 (N-403)", () => {
    // 실측으로 겪은 경로다 — investigate가 `{ error: msg }`를 detail에 실었고,
    // postgres 오류는 파라미터 값을 메시지에 담는다("invalid input syntax ... \"값\"").
    //
    // ⚠️ 비교문(`e.message === "TIMEOUT"`)은 잡지 않는다. 값을 **싣는** 것만 문제다.
    const found: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1);
      const src = readFileSync(f, "utf8");
      // ⚠️ 줄 단위로 보면 놓친다 — 실제로 `trace.warn(...)`이 여러 줄에 걸치고
      // `error: e.message`가 다음 줄에 있던 누수를 한 번 놓쳤다(judge.ts, 2026.08.17).
      // 호출 전체를 괄호 단위로 떠서 본다.
      for (const m of src.matchAll(/\btrace\.(info|warn|toolCall)\(/g)) {
        const start = m.index ?? 0;
        let depth = 0;
        let end = start;
        for (let i = src.indexOf("(", start); i < src.length; i++) {
          if (src[i] === "(") depth++;
          else if (src[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
        }
        const call = src.slice(start, end + 1);
        const carries =
          /\.message\s*(?![=!]=)/.test(call) || /\b(msg|errMsg|errorMessage)\b/.test(call);
        if (carries) {
          const line = src.slice(0, start).split("\n").length;
          found.push(`${rel}:${line}  ${call.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    expect(found, "실행 로그에 오류 원문이 들어간다:\n" + found.join("\n")).toHaveLength(0);
  });

  it("측정 전용 judgeRaw가 제품 경로로 새지 않는다 (절대 규칙 4)", () => {
    // 임계 미만 결론을 들고 다니면 화면에 표시될 여지가 생긴다.
    // 측정 하네스(테스트)만 쓰고, src/app 아래에서는 import되면 안 된다.
    const leaked = files
      .filter((f) => f.slice(SRC.length + 1).startsWith("app/"))
      .filter((f) => /\bjudgeRaw\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1));
    expect(leaked, "judgeRaw가 화면 코드로 새어 들어갔다: " + leaked.join(", ")).toHaveLength(0);
  });

  it("허용 로그 필드를 문서와 함께 못 박아 둔다", () => {
    // 명세 N-403: 익명 세션 해시 · 이벤트 유형 · 도구명 · 소요 시간
    // 승인 목록의 각 항목이 그 범위 안인지 사람이 판단한 결과를 사유로 남긴다
    for (const a of APPROVED) expect(a.why.length, `${a.file} 승인 사유 없음`).toBeGreaterThan(5);
  });
});
