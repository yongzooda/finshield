/**
 * P0 실행 Manifest 정의.
 *
 * 규칙 2가 요구하는 「진짜 Multi-Agent」의 뼈대다. Agent 마다 별도 입력·출력
 * Schema 와 Tool Allowlist 와 실행 기록을 둔다. 화면에 이름만 여러 개 보이고
 * 실제로는 한 Prompt 에서 처리하는 구조를 만들지 않는다.
 *
 * 여기 값은 선언일 뿐이고 강제는 DB 가 한다. `private.check_agent_in_manifest`
 * 와 `private.check_tool_allowed` trigger 가 Manifest 에 없는 Agent 실행과
 * Allowlist 밖 Tool 호출을 막는다. 코드가 실수해도 기록이 남지 않는다.
 *
 * AI-021 이 P0 Domain Agent 를 네 개로 고정한다. 동적 선택과 병렬 실행은
 * AI-003·AI-004 의 P1 Gate 를 통과한 뒤에 연다. 그래서 parallel_group 은 없다.
 */

export const MANIFEST_VERSION = "finshield-p0-loan-v1";
export const SCENARIO = "LOAN" as const;
export const SCENARIO_VERSION = "sunshine15-v1";

export type AgentRole = "DOMAIN" | "EVIDENCE_JUDGE";

export type AgentSpec = {
  agentCode: string;
  logicalKey: string;
  role: AgentRole;
  version: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  promptVersion: string;
  required: boolean;
  /** 이 Agent 가 부를 수 있는 Tool 과 그 목적. 목록 밖 호출은 DB 가 막는다. */
  tools: { toolCode: string; purposeCode: string }[];
};

export type ToolSpec = {
  toolCode: string;
  version: string;
  transport: "FUNCTION" | "MCP";
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  maxPayloadBytes: number;
  maxBatchSize: number;
  timeoutMs: number;
  retryLimit: number;
};

// E-020: 내부 함수 등록부를 MCP 라고 부르지 않는다. 전송 방식이 FUNCTION 이면 그렇게 적는다.
export const TOOLS: readonly ToolSpec[] = Object.freeze([
  { toolCode: "search_financial_product", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "verify_financial_institution", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "get_source_snapshot", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 1048576, maxBatchSize: 10, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "parse_url_host", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 8192, maxBatchSize: 20, timeoutMs: 2000, retryLimit: 0 },
  { toolCode: "lookup_official_channel", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "search_consumer_warning", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 524288, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "analyze_risk_pattern", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "check_documents", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "lookup_statute", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 524288, maxBatchSize: 10, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "search_precedent", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 524288, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "search_dispute_case", version: "v1", transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 524288, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
]);

// 실행 순서가 곧 배열 순서다. AI-020 에 따라 Orchestrator 는 결론을 만들지 않는다.
export const AGENTS: readonly AgentSpec[] = Object.freeze([
  {
    agentCode: "PRODUCT_INSTITUTION", logicalKey: "PRODUCT_INSTITUTION", role: "DOMAIN",
    version: "v1", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "product-institution-v1",
    required: true,
    tools: [
      { toolCode: "search_financial_product", purposeCode: "VERIFY_PRODUCT" },
      { toolCode: "verify_financial_institution", purposeCode: "VERIFY_INSTITUTION" },
      { toolCode: "get_source_snapshot", purposeCode: "READ_SNAPSHOT" },
    ],
  },
  {
    agentCode: "FRAUD_CHANNEL", logicalKey: "FRAUD_CHANNEL", role: "DOMAIN",
    version: "v1", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "fraud-channel-v1",
    required: true,
    tools: [
      { toolCode: "parse_url_host", purposeCode: "PARSE_URL" },
      { toolCode: "lookup_official_channel", purposeCode: "VERIFY_CHANNEL" },
      { toolCode: "search_consumer_warning", purposeCode: "FIND_WARNING" },
    ],
  },
  {
    agentCode: "SALES_CONDUCT", logicalKey: "SALES_CONDUCT", role: "DOMAIN",
    version: "v1", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "sales-conduct-v1",
    required: true,
    tools: [
      { toolCode: "analyze_risk_pattern", purposeCode: "ASSESS_CONDUCT" },
      { toolCode: "check_documents", purposeCode: "CHECK_DOCUMENTS" },
    ],
  },
  {
    agentCode: "REGULATION_DISPUTE", logicalKey: "REGULATION_DISPUTE", role: "DOMAIN",
    version: "v1", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "regulation-dispute-v1",
    required: true,
    tools: [
      { toolCode: "lookup_statute", purposeCode: "LOOKUP_STATUTE" },
      { toolCode: "search_precedent", purposeCode: "SEARCH_PRECEDENT" },
      { toolCode: "search_dispute_case", purposeCode: "SEARCH_DISPUTE" },
    ],
  },
  {
    // AI-013: Judge 는 원문이 아니라 확인된 Claim·Evidence 구조만 본다. 그래서 Tool 이 없다.
    agentCode: "EVIDENCE_JUDGE", logicalKey: "EVIDENCE_JUDGE", role: "EVIDENCE_JUDGE",
    version: "v1", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "evidence-judge-v1",
    required: true,
    tools: [],
  },
]);

export const DOMAIN_AGENTS = AGENTS.filter((agent) => agent.role === "DOMAIN");

export const POLICY_VERSIONS = Object.freeze({
  promptBundleVersion: "p0-loan-prompts-v1",
  schemaBundleVersion: "p0-loan-schemas-v1",
  evidencePolicyVersion: "evidence-policy-v1",
  resultMatrixVersion: "result-matrix-v1",
  coverageContractVersion: "coverage-contract-v1",
  profilePolicyVersion: "profile-policy-v1",
  piiPolicyVersion: "pii-policy-v1",
});
