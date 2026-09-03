import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
if (realpathSync(process.cwd()) !== root) {
  console.error("Database spec validator는 저장소 root에서만 실행할 수 있습니다.");
  process.exit(1);
}
const paths = {
  spec: resolve(root, "docs/03-database-spec.md"),
  readme: resolve(root, "README.md"),
  docsReadme: resolve(root, "docs/README.md"),
  handoff: resolve(root, "HANDOFF.md"),
  agents: resolve(root, "AGENTS.md"),
  claude: resolve(root, "CLAUDE.md"),
};

const read = (path) => readFileSync(path, "utf8");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const spec = read(paths.spec);
const readme = read(paths.readme);
const docsReadme = read(paths.docsReadme);
const handoff = read(paths.handoff);
const agents = read(paths.agents);
const claude = read(paths.claude);
const errors = [];

const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) errors.push(message);
};

if (spec.length < 50_000) errors.push("DB 명세가 기준선 문서로 보기에는 지나치게 짧습니다.");
if ((spec.match(/```/g) ?? []).length % 2 !== 0) errors.push("Markdown code fence 수가 맞지 않습니다.");

for (const placeholder of ["TODO", "TBD", "FIXME", "작성 예정", "추후 작성"]) {
  if (spec.includes(placeholder)) errors.push(`DB 명세에 미해결 표기 '${placeholder}'가 남아 있습니다.`);
}

const requiredDatasets = [
  "profiles",
  "financial_profiles",
  "financial_profile_versions",
  "financial_cases",
  "case_inputs",
  "case_events",
  "claims",
  "verification_runs",
  "final_claim_versions",
  "evidences",
  "claim_evidences",
  "source_snapshots",
  "agent_runs",
  "tool_runs",
  "evidence_passports",
  "action_guides",
  "revalidation_jobs",
  "revalidation_events",
  "notifications",
  "notification_preferences",
  "precase_assessments",
  "precase_answers",
  "action_checklists",
  "knowledge_documents",
  "knowledge_chunks",
  "knowledge_embeddings",
  "trusted_access",
  "shared_comments",
  "access_audits",
];

const datasetMappingSection = spec.match(/## 3\.5 논리 데이터 집합과 물리 매핑([\s\S]*?)\n---/)?.[1] ?? "";
const dRequirementTraceSection = spec.match(/## 17\.1 D-001~D-032([\s\S]*?)\n## 17\.2/)?.[1] ?? "";

if (!datasetMappingSection) errors.push("3.5 논리 데이터 집합과 물리 매핑 절을 찾지 못했습니다.");
if (!dRequirementTraceSection) errors.push("17.1 D-001~D-032 추적 절을 찾지 못했습니다.");

for (const dataset of requiredDatasets) {
  requireMatch(datasetMappingSection, new RegExp("^\\| `" + escapeRegExp(dataset) + "` \\|", "m"), `논리 데이터 집합 '${dataset}' 매핑 행이 없습니다.`);
}

const seenDRequirements = new Set([...spec.matchAll(/\bD-(\d{3})\b/g)].map((match) => Number(match[1])));
for (let number = 1; number <= 32; number += 1) {
  const id = `D-${String(number).padStart(3, "0")}`;
  if (!seenDRequirements.has(number) || !new RegExp(`^\\| ${id} \\|`, "m").test(dRequirementTraceSection)) {
    errors.push(`${id} 추적 행이 없습니다.`);
  }
}
for (const number of seenDRequirements) {
  if (number < 1 || number > 32) errors.push(`알 수 없는 데이터 요구사항 D-${String(number).padStart(3, "0")}이 있습니다.`);
}

const requiredConcepts = [
  [/(owner_id.*복합 FK|복합 Owner FK)/s, "Owner 복합 FK 규칙"],
  [/Row Level Security|\bRLS\b/, "RLS 경계"],
  [/QUARANTINED[\s\S]*VALIDATED[\s\S]*EXTRACTED[\s\S]*MASKED[\s\S]*CLAIM_CONFIRMED[\s\S]*RAW_DELETED/, "입력 성공 상태 순서"],
  [/raw_delete_status/, "원본 삭제 상태 분리"],
  [/24시간/, "원본·임시 데이터 최대 보존시간"],
  [/execution_manifests/, "불변 실행 Manifest"],
  [/claim_revisions/, "Claim 수정 이력"],
  [/verification_run_claims/, "Run의 Claim revision 고정"],
  [/passport_diffs/, "재검증 Diff"],
  [/fencing token/i, "Job fencing token"],
  [/FOR UPDATE SKIP LOCKED/i, "Job lease claim"],
  [/Transactional Outbox|outbox_events/, "Transactional Outbox"],
  [/processing_consents/, "외부 OCR 처리 동의"],
  [/ocr_artifacts/, "전체 OCR 임시물 삭제 추적"],
  [/deletion_ledger/, "Backup 복원 삭제 Ledger"],
  [/export_jobs/, "P1 비동기 Export 경계"],
  [/kb\.knowledge_embeddings[\s\S]*private\.case_embeddings/, "공용·사용자 Vector 물리 분리"],
  [/0001~0006[\s\S]{0,300}FinShield 목표 Schema가 아니다/, "기존 PreCase Migration 비적용 경계"],
  [/DB 명세 완료와 구현 완료 구분/, "문서 확정과 구현 완료 구분"],
];

for (const [pattern, label] of requiredConcepts) requireMatch(spec, pattern, `${label}이 명시되지 않았습니다.`);

requireMatch(readme, /`docs\/03-database-spec\.md` \| 확정·DB 구현 기준/, "README의 DB 명세 상태가 동기화되지 않았습니다.");
requireMatch(docsReadme, /`03-database-spec\.md`[\s\S]*확정·DB 구현 기준/, "docs/README의 DB 명세 상태가 동기화되지 않았습니다.");
requireMatch(handoff, /DB 구현 기준: `docs\/03-database-spec\.md`/, "HANDOFF에 DB 구현 기준이 없습니다.");
requireMatch(agents, /`docs\/03-database-spec\.md`/, "AGENTS 읽기 순서에 DB 명세가 없습니다.");
requireMatch(claude, /`docs\/03-database-spec\.md`[\s\S]*Schema·Migration·RLS·Storage 구현 기준/, "CLAUDE에 DB 구현 기준이 없습니다.");

if (errors.length > 0) {
  console.error("Database spec validation failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Database spec validation passed: ${spec.length.toLocaleString()} chars, 29 datasets, D-001~D-032.`);
