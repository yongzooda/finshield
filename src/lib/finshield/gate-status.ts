/**
 * 신뢰센터가 보여 줄 검증 현황을 ADR 과 증거 index 에서 그대로 읽는다.
 *
 * 현재 Gate 값의 유일한 기준은 `docs/adr/001-p0-provider-stack.md` 다 (규칙 8).
 * 화면에 목록을 손으로 적어 두면 채택 PR 이 Gate 를 바꿔도 화면이 따라가지 않는다.
 * 채택 PR 은 ADR·index 밖의 파일을 고칠 수 없으므로 화면이 이 두 파일을 읽어야
 * 한다. 형식이 어긋나면 조용히 비우지 않고 멈춘다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type BlockerStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT-EVALUATED";
export type GateRow = { id: string; status: BlockerStatus };
export type GateStatus = {
  implementationGate: string;
  releaseGate: string;
  implementationBlockers: GateRow[];
  releaseBlockers: GateRow[];
  /** PASS 항목을 마지막으로 채택한 시각. PASS 가 없으면 null 이다. */
  lastAdoptedAt: string | null;
};

const ADR_PATH = "docs/adr/001-p0-provider-stack.md";
const INDEX_PATH = "evidence/provider-stack-gate.json";

const section = (adr: string, start: string, end: string): string => {
  const from = adr.indexOf(start);
  const to = adr.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`ADR 에서 '${start}' 절을 찾지 못했습니다`);
  return adr.slice(from, to);
};

const rowsOf = (block: string): GateRow[] => [...block.matchAll(
  /^\| `(B-[A-Z0-9-]+)` \| [^|\n]+ \| (PASS|FAIL|BLOCKED|NOT-EVALUATED) \| [^|\n]+ \|$/gm,
)].map((match) => ({ id: match[1], status: match[2] as BlockerStatus }));

const metadata = (adr: string, label: string): string => {
  const match = adr.match(new RegExp(`^- ${label}: \`([A-Z-]+)\`$`, "m"));
  if (!match) throw new Error(`ADR metadata '${label}' 를 찾지 못했습니다`);
  return match[1];
};

export const parseGateStatus = (adr: string, index: unknown): GateStatus => {
  const implementationBlockers = rowsOf(section(adr, "### 14.2 ", "### 14.3 "));
  const releaseBlockers = rowsOf(section(adr, "### 14.4 ", "### 14.5 "));
  if (implementationBlockers.length === 0 || releaseBlockers.length === 0) {
    throw new Error("ADR 차단 항목 표를 읽지 못했습니다");
  }
  const entries = (index as { entries?: Record<string, { adopted_at?: unknown }> })?.entries ?? {};
  const adopted = implementationBlockers
    .filter((row) => row.status === "PASS")
    .map((row) => entries[row.id]?.adopted_at)
    .filter((value): value is string => typeof value === "string")
    .sort();
  return {
    implementationGate: metadata(adr, "Implementation Gate \\(`N-QLT-010`\\)"),
    releaseGate: metadata(adr, "Release Gate \\(`N-QLT-009`\\)"),
    implementationBlockers,
    releaseBlockers,
    lastAdoptedAt: adopted.at(-1) ?? null,
  };
};

/** 빌드할 때 저장소의 두 파일을 읽는다. 신뢰센터는 정적으로 만들어진다. */
export const readGateStatus = (root = process.cwd()): GateStatus => parseGateStatus(
  readFileSync(join(root, ADR_PATH), "utf8"),
  JSON.parse(readFileSync(join(root, INDEX_PATH), "utf8")),
);
