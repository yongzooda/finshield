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

// 시험 fixture 와 같은 이름을 쓰지 않도록 제품 정의는 p0-v2 을 버전으로 쓴다.
export const DEFINITION_VERSION = "p0-v3";
export const MANIFEST_VERSION = "finshield-p0-loan-v9";
export const FINSHIELD_MODEL = "claude-sonnet-5";
export const SCENARIO = "LOAN" as const;
export const SCENARIO_VERSION = "sunshine15-v1";

/**
 * 실제 Sonnet 5 응답 시간으로 확인한 단계별 상한이다.
 *
 * 선택과 판단의 합보다 바깥 단계 상한이 짧지 않게 두고, 공개 Demo의 110초
 * 전체 상한 안에서 여섯 Agent와 Judge가 순차 종결될 수 있게 한다.
 */
export const MODEL_TIMEOUTS = Object.freeze({
  domainChoiceMs: 4_000,
  domainDecisionMs: 11_000,
  domainStageMs: 16_000,
  reviewChoiceMs: 5_000,
  reviewDecisionMs: 12_000,
  reviewStageMs: 18_000,
  judgeMs: 12_000,
  demoRunMs: 115_000,
});

export type AgentRole = "DOMAIN" | "COVE" | "RED_TEAM" | "EVIDENCE_JUDGE";

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
  { toolCode: "search_financial_product", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "verify_financial_institution", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "get_source_snapshot", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 1048576, maxBatchSize: 10, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "parse_url_host", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 8192, maxBatchSize: 20, timeoutMs: 2000, retryLimit: 0 },
  { toolCode: "lookup_official_channel", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "search_consumer_warning", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 524288, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "analyze_risk_pattern", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "check_documents", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 262144, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "lookup_statute", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 524288, maxBatchSize: 10, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "search_precedent", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 524288, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
  { toolCode: "search_dispute_case", version: DEFINITION_VERSION, transport: "FUNCTION", inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", maxPayloadBytes: 524288, maxBatchSize: 20, timeoutMs: 20000, retryLimit: 1 },
]);

// 실행 순서가 곧 배열 순서다. AI-020 에 따라 Orchestrator 는 결론을 만들지 않는다.
export const AGENTS: readonly AgentSpec[] = Object.freeze([
  {
    agentCode: "PRODUCT_INSTITUTION", logicalKey: "PRODUCT_INSTITUTION", role: "DOMAIN",
    version: DEFINITION_VERSION, inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "product-institution-v3",
    required: true,
    tools: [
      { toolCode: "search_financial_product", purposeCode: "VERIFY_PRODUCT" },
      { toolCode: "verify_financial_institution", purposeCode: "VERIFY_INSTITUTION" },
      { toolCode: "get_source_snapshot", purposeCode: "READ_SNAPSHOT" },
    ],
  },
  {
    agentCode: "FRAUD_CHANNEL", logicalKey: "FRAUD_CHANNEL", role: "DOMAIN",
    version: DEFINITION_VERSION, inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "fraud-channel-v3",
    required: true,
    tools: [
      { toolCode: "parse_url_host", purposeCode: "PARSE_URL" },
      { toolCode: "lookup_official_channel", purposeCode: "VERIFY_CHANNEL" },
      { toolCode: "search_consumer_warning", purposeCode: "FIND_WARNING" },
    ],
  },
  {
    agentCode: "SALES_CONDUCT", logicalKey: "SALES_CONDUCT", role: "DOMAIN",
    version: DEFINITION_VERSION, inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "sales-conduct-v3",
    required: true,
    tools: [
      { toolCode: "analyze_risk_pattern", purposeCode: "ASSESS_CONDUCT" },
      { toolCode: "check_documents", purposeCode: "CHECK_DOCUMENTS" },
    ],
  },
  {
    agentCode: "REGULATION_DISPUTE", logicalKey: "REGULATION_DISPUTE", role: "DOMAIN",
    version: DEFINITION_VERSION, inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "regulation-dispute-v3",
    required: true,
    tools: [
      { toolCode: "lookup_statute", purposeCode: "LOOKUP_STATUTE" },
      { toolCode: "search_precedent", purposeCode: "SEARCH_PRECEDENT" },
      { toolCode: "search_dispute_case", purposeCode: "SEARCH_DISPUTE" },
    ],
  },
  {
    // 규칙 3: CoVe 는 초기 결론을 다시 읽는 self-review 가 아니다. 초기 Query 와
    // 결론에서 분리된 검색으로 Material Claim 을 다시 확인한다. 그래서 이 Agent 는
    // Domain Agent 의 판단을 보지 못하고 Claim 만 받는다.
    agentCode: "COVE", logicalKey: "COVE", role: "COVE",
    version: DEFINITION_VERSION, inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "cove-v3",
    required: true,
    tools: [
      { toolCode: "lookup_statute", purposeCode: "RECHECK_STATUTE" },
      { toolCode: "search_financial_product", purposeCode: "RECHECK_PRODUCT" },
      { toolCode: "lookup_official_channel", purposeCode: "RECHECK_CHANNEL" },
      { toolCode: "search_consumer_warning", purposeCode: "RECHECK_WARNING" },
    ],
  },
  {
    // 규칙 3: Red Team 은 초기 결론을 뒤집을 공식 반대 근거를 찾는다.
    // 못 찾았다는 사실이 확인이 되지 않는다 (AI-011).
    agentCode: "RED_TEAM", logicalKey: "RED_TEAM", role: "RED_TEAM",
    version: DEFINITION_VERSION, inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "red-team-v3",
    required: true,
    tools: [
      { toolCode: "search_financial_product", purposeCode: "FIND_COUNTER_PRODUCT" },
      { toolCode: "lookup_official_channel", purposeCode: "FIND_COUNTER_CHANNEL" },
      { toolCode: "lookup_statute", purposeCode: "FIND_COUNTER_STATUTE" },
      { toolCode: "search_consumer_warning", purposeCode: "FIND_COUNTER_WARNING" },
      { toolCode: "search_dispute_case", purposeCode: "FIND_COUNTER_DISPUTE" },
    ],
  },
  {
    // AI-013: Judge 는 원문이 아니라 확인된 Claim·Evidence 구조만 본다. 그래서 Tool 이 없다.
    agentCode: "EVIDENCE_JUDGE", logicalKey: "EVIDENCE_JUDGE", role: "EVIDENCE_JUDGE",
    version: DEFINITION_VERSION, inputSchemaVersion: "in-v1", outputSchemaVersion: "out-v1", promptVersion: "evidence-judge-v3",
    required: true,
    tools: [],
  },
]);

export const DOMAIN_AGENTS = AGENTS.filter((agent) => agent.role === "DOMAIN");
export const COVE_AGENT = AGENTS.find((agent) => agent.role === "COVE");
export const RED_TEAM_AGENT = AGENTS.find((agent) => agent.role === "RED_TEAM");

export const POLICY_VERSIONS = Object.freeze({
  promptBundleVersion: "p0-loan-prompts-v3",
  schemaBundleVersion: "p0-loan-schemas-v1",
  evidencePolicyVersion: "evidence-policy-v1",
  resultMatrixVersion: "result-matrix-v1",
  coverageContractVersion: "coverage-contract-v1",
  profilePolicyVersion: "profile-policy-v2",
  piiPolicyVersion: "pii-policy-v1",
});

/**
 * 정책 본문. Manifest 가 참조하는 값이고 Run 마다 어떤 규칙이 걸렸는지 되짚는 근거다.
 * 숫자와 낱말을 여기 한 곳에만 둔다. 화면과 판정이 서로 다른 기준을 쓰지 않게 한다.
 */
export const POLICIES = Object.freeze([
  {
    policyType: "EVIDENCE",
    version: POLICY_VERSIONS.evidencePolicyVersion,
    schemaVersion: "1",
    rules: {
      // 규칙 1: 확정에는 근거가 있어야 하고 참고용만으로는 확정하지 못한다.
      min_independent_evidence_for_confirmed: 1,
      confirmed_states: ["VERIFIED", "CONTRADICTED"],
      reference_only_can_confirm: false,
      // EV-006: 같은 원문의 재게시는 독립 근거로 세지 않는다.
      independence_key: "source_fingerprint",
      // EV-008: 못 찾았다는 사실은 안전의 근거가 아니다.
      absence_is_not_safety: true,
      // EV-015: 검색 0건은 반증이 아니다.
      zero_hit_becomes: "UNKNOWN",
      // EV-005: 충돌하는 공식 자료는 평균 내지 않고 둘 다 남긴다.
      conflict_resolution: "preserve_both",
      // EV-014: metadata 만 있는 판례는 직접 근거가 아니다.
      metadata_only_directness: "CONTEXT_ONLY",
    },
  },
  {
    policyType: "RESULT_MATRIX",
    version: POLICY_VERSIONS.resultMatrixVersion,
    schemaVersion: "1",
    rules: {
      // RES-002: 0~100 점수를 만들지 않는다. 상태와 축으로만 말한다.
      numeric_score: false,
      axes: ["PRODUCT_INSTITUTION", "FRAUD_CHANNEL", "SALES_CONDUCT", "REGULATION_DISPUTE"],
      // 하나라도 Material 이 반증되면 전체를 그 쪽으로 끌고 간다.
      material_contradicted_dominates: true,
      partial_agent_marks_run: "PARTIAL",
    },
  },
  {
    policyType: "COVERAGE",
    version: POLICY_VERSIONS.coverageContractVersion,
    schemaVersion: "1",
    rules: {
      required_axes: ["PRODUCT_INSTITUTION", "FRAUD_CHANNEL", "REGULATION_DISPUTE"],
      // Sales Conduct 는 가입 뒤 축이라 거래 전 단계에서는 필수가 아니다.
      optional_axes: ["SALES_CONDUCT"],
      material_claims_must_be_addressed: true,
    },
  },
  {
    policyType: "PROFILE",
    version: POLICY_VERSIONS.profilePolicyVersion,
    schemaVersion: "2",
    rules: {
      // AUTH-006·007: 프로필을 건너뛰면 적합성 축만 보류하고 나머지는 진행한다.
      skip_suspends_axes: ["SUITABILITY"],
      snapshot_at: "RUN_START",
      implementation: "db-profile-policy-v2",
      rules: ["LOAN_DEBT_BURDEN", "LOAN_EMERGENCY_BUFFER", "LOAN_PURPOSE", "LOAN_HORIZON", "LOAN_LIQUIDITY", "LOAN_ELIGIBILITY", "LOAN_AFFORDABILITY"],
      approval_inference: false,
      annualize_monthly_income: false,
    },
  },
  {
    policyType: "PII",
    version: POLICY_VERSIONS.piiPolicyVersion,
    schemaVersion: "1",
    rules: {
      // 규칙 4: 동의한 외부 OCR 예외 말고는 마스킹 텍스트만 모델에 넘긴다.
      model_input: "masked_only",
      gate: "non_model",
      external_ocr_requires_consent: true,
    },
  },
]);
