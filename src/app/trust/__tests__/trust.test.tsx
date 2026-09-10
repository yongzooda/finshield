import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { parseGateStatus, readGateStatus } from "@/lib/finshield/gate-status";
import { BLOCKER_LABEL } from "../blocker-labels";
import TrustPage from "../page";

const adr = readFileSync(join(process.cwd(), "docs/adr/001-p0-provider-stack.md"), "utf8");

describe("신뢰센터 검증 현황 (OPS-001·규칙 8)", () => {
  it("ADR metadata 와 14.2·14.4 표를 그대로 읽는다", () => {
    const gate = readGateStatus();
    expect(gate.implementationGate).toBe(adr.match(/^- Implementation Gate \(`N-QLT-010`\): `([A-Z-]+)`$/m)?.[1]);
    expect(gate.releaseGate).toBe(adr.match(/^- Release Gate \(`N-QLT-009`\): `([A-Z-]+)`$/m)?.[1]);
    expect(gate.implementationBlockers).toHaveLength(20);
    expect(gate.releaseBlockers.map((row) => row.id)).toContain("B-CLAIM-01");
  });

  it("모든 차단 항목에 이용자가 읽을 이름이 있다", () => {
    const gate = readGateStatus();
    for (const row of [...gate.implementationBlockers, ...gate.releaseBlockers]) {
      expect(BLOCKER_LABEL[row.id], row.id).toBeTruthy();
    }
  });

  it("채택된 항목만 통과로, 기준 미달 항목은 미달로 보여 준다", () => {
    const gate = readGateStatus();
    const html = renderToStaticMarkup(<TrustPage />);
    for (const row of gate.implementationBlockers) {
      const label = BLOCKER_LABEL[row.id];
      if (row.status === "PASS") expect(html).toContain(`${label}: 채택된 시험 증거 있음`);
      else expect(html).not.toContain(`${label}: 채택된 시험 증거 있음`);
      if (row.status === "FAIL") expect(html).toContain(`${label} (기준 미달, 다시 준비 중)`);
    }
    const passed = gate.implementationBlockers.filter((row) => row.status === "PASS").length;
    expect(html).toContain(`구성요소 시험 20개 중 ${passed}개가 채택 기준을 통과했습니다`);
  });

  it("채택 PR 이 Gate 를 바꾸면 화면도 따라 바뀐다", () => {
    const flipped = adr.replace(/^(\| `B-OCR-01` \| [^|\n]+ \| )[A-Z-]+( \|)/m, "$1PASS$2");
    const gate = parseGateStatus(flipped, { entries: { "B-OCR-01": { adopted_at: "2026-09-30T00:00:00Z" } } });
    expect(gate.implementationBlockers.find((row) => row.id === "B-OCR-01")?.status).toBe("PASS");
    expect(gate.lastAdoptedAt).toBe("2026-09-30T00:00:00Z");
  });

  it("표 형식이 깨지면 비어 있는 현황을 보여 주지 않고 멈춘다", () => {
    expect(() => parseGateStatus(adr.replace("### 14.2 ", "### 14.x "), {})).toThrow();
    expect(() => parseGateStatus(adr.replace(/^- Implementation Gate .*$/m, ""), {})).toThrow();
  });

  it("영어 내부 용어 대신 이용자 말로 적는다", () => {
    const html = renderToStaticMarkup(<TrustPage />);
    expect(html).not.toMatch(/같은 Case|B-[A-Z]+-\d|NOT-EVALUATED 항목/);
  });
});
