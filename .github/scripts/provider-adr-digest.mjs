import { createHash } from "node:crypto";
import remarkParse from "remark-parse";
import { unified } from "unified";

export const maskNonRenderedMarkdown = (source) => {
  const tree = unified().use(remarkParse).parse(source);
  const ranges = [];
  const visit = (node) => {
    if (["code", "html", "yaml"].includes(node.type)) {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (Number.isInteger(start) && Number.isInteger(end)) ranges.push([start, end]);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  const characters = source.split("");
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index += 1) {
      if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
    }
  }
  return characters.join("");
};

const canonicalizeAdrDecision = (source) => {
  const rawLines = source.split("\n");
  const structuralLines = maskNonRenderedMarkdown(source).split("\n");
  const canonical = [];
  let insideLedger = false;
  let insideGateTable = false;
  let emittedLedgerRows = false;

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    const structuralLine = structuralLines[index] ?? "";

    if (structuralLine === "### 14.1 현재 확보한 증거") insideLedger = true;
    if (structuralLine === "### 14.2 Implementation Gate 차단 항목") {
      insideLedger = false;
      insideGateTable = true;
    }
    if (structuralLine === "### 14.3 Implementation Gate 전환 규칙") insideGateTable = false;
    if (structuralLine === "### 14.4 Release Gate 차단 항목") insideGateTable = true;
    if (structuralLine === "## 15. Live 시험 계획") insideGateTable = false;

    if (insideLedger && /^\| `EVID-[A-Z0-9-]+` \|/.test(structuralLine)) {
      if (!emittedLedgerRows) canonical.push("<EVIDENCE-ROWS>");
      emittedLedgerRows = true;
      continue;
    }
    if (/^- Implementation Gate \(`N-QLT-010`\): `(NO-GO|GO)`$/.test(structuralLine)) {
      canonical.push("- Implementation Gate (`N-QLT-010`): `<STATE>`");
      continue;
    }
    if (/^- Release Gate \(`N-QLT-009`\): `(NOT-EVALUATED|NO-GO|GO)`$/.test(structuralLine)) {
      canonical.push("- Release Gate (`N-QLT-009`): `<STATE>`");
      continue;
    }
    if (insideGateTable && /^\| `B-[^`]+` \| [^|]+ \| (NOT-EVALUATED|PASS|FAIL|BLOCKED) \| [^|]+ \|$/.test(structuralLine)) {
      canonical.push(rawLine.replace(
        /^(\| `B-[^`]+` \| [^|]+ \| )(NOT-EVALUATED|PASS|FAIL|BLOCKED)( \| [^|]+ \|)$/,
        "$1<STATUS>$3",
      ));
      continue;
    }
    canonical.push(rawLine);
  }
  return canonical.join("\n");
};

export const adrDecisionDigest = (source) => createHash("sha256")
  .update(Buffer.from(canonicalizeAdrDecision(source)))
  .digest("hex");
