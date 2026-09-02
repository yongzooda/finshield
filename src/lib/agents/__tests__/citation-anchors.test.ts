/**
 * 근거 각주 대조 (S-04) — **확실히 대조된 조문만 링크되고, 애매하면 평문**이다.
 * 잘못 이으면 없는 근거를 만드는 일이라(F-603), 이 테스트가 그 경계를 고정한다.
 */

import { describe, expect, it } from "vitest";
import { annotateStatutes, statuteAnchorId } from "../citations";
import type { Evidence } from "../types";

function statute(lawName: string, articleNo: string): Evidence["statutes"][number] {
  return {
    lawName, articleNo, articleTitle: null, articleText: "…", effectiveDate: null,
    source: "API", checkedAt: "2026-08-29", transferredTo: null, isFallback: false, flagged: 0,
  };
}

const rejoin = (segs: ReturnType<typeof annotateStatutes>) => segs.map((s) => s.text).join("");

describe("annotateStatutes", () => {
  it("근거에 있는 조문만 링크 조각이 된다", () => {
    const ev = [statute("보험업법", "제95조의2")];
    const text = "보험업법 제95조의2와 민법 제750조가 언급된다.";
    const segs = annotateStatutes(text, ev);
    const links = segs.filter((s) => s.kind === "statute");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ anchorId: statuteAnchorId("보험업법", "제95조의2") });
    expect(rejoin(segs)).toBe(text); // 무손실 — 글자가 달라질 수 없다
  });

  it("근거에 없는 조문뿐이면 전부 평문이다", () => {
    const segs = annotateStatutes("민법 제750조가 문제된다.", [statute("상법", "제651조")]);
    expect(segs.every((s) => s.kind === "text")).toBe(true);
  });

  it("직전에 다른 법령명이 붙어 있으면 잇지 않는다 — 민법 제651조를 상법 카드로 보내지 않는다", () => {
    const segs = annotateStatutes("민법 제651조에 따르면…", [statute("상법", "제651조")]);
    expect(segs.every((s) => s.kind === "text")).toBe(true);
    // 법령명 없이 조문만 쓰면(대상이 하나뿐이니) 잇는다
    const bare = annotateStatutes("같은 법 제651조에 따르면…", [statute("상법", "제651조")]);
    expect(bare.some((s) => s.kind === "statute")).toBe(true);
  });

  it("같은 조문번호가 두 법령에 있으면 문맥의 법령명으로만 가른다", () => {
    const ev = [statute("약관의 규제에 관한 법률", "제3조"), statute("전자상거래법", "제3조")];
    const named = annotateStatutes("약관의 규제에 관한 법률 제3조가 적용된다.", ev);
    const link = named.find((s) => s.kind === "statute");
    expect(link).toMatchObject({ anchorId: statuteAnchorId("약관의 규제에 관한 법률", "제3조") });
    // 법령명 없는 「제3조」는 어느 쪽인지 모른다 — 링크하지 않는다
    const bare = annotateStatutes("제3조가 적용된다.", ev);
    expect(bare.every((s) => s.kind === "text")).toBe(true);
  });

  it("제N조의M 표기도 통째로 잇는다", () => {
    const ev = [statute("상법", "제638조의3")];
    const segs = annotateStatutes("상법 제638조의3 위반 여부가 쟁점이다.", ev);
    const link = segs.find((s) => s.kind === "statute");
    expect(link?.text).toBe("제638조의3");
    expect(rejoin(segs)).toBe("상법 제638조의3 위반 여부가 쟁점이다.");
  });
});
