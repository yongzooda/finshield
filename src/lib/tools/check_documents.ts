/**
 * F-504 `check_documents` — 채널별 필요 자료 진단 (SR-304 · F-203 · F-309).
 *
 * 반환은 두 갈래이며 **출처가 다르다. 섞지 않는다.**
 *
 *  1. **필요 자료 목록** — 아래 큐레이션 표(`CHANNEL_DOCS`·`ISSUE_DOCS`)가 출처다.
 *     DB에 「필요 자료」 테이블이 없고, 채널·쟁점별로 무엇을 챙겨야 하는지는
 *     집계로 나오는 값이 아니다. **이 표가 곧 도구의 근거**이며, 도구 밖에서
 *     자료 목록을 만들어내면 그때가 F-603 위반이다.
 *     각 항목에 `source: "CURATED"`를 달아 집계값과 구분되게 한다.
 *
 *  2. **관련 약관 조항** — `terms_clauses`(266건) 실측이 출처다.
 *     이 표에는 쟁점 칼럼이 없으므로 **출처 사건을 거쳐 조인**한다
 *     (`terms_clauses.source_case_id → case_issues → issue_tags`).
 *     즉 "이 쟁점이 다뤄진 사건에서 실제로 문제가 된 조항"이며, 지어낸 예시가 아니다.
 *
 * 결여 항목은 이용자가 가진 것(`possessed`)을 빼서 낸다. 없으면 전량이 결여다.
 */

import "server-only";
import { sql } from "../db";
import { filterFields } from "./filter";
import type { DbChannel, ProductCode, Sector } from "../types";

/** 판매 경로 때문에 생기는 자료. 채널이 미확정이면 적용하지 않는다 */
const CHANNEL_DOCS: Record<DbChannel, readonly { key: string; label: string; why: string }[]> = {
  TM: [
    { key: "call_recording", label: "가입 당시 통화 녹취", why: "전화 판매는 설명 내용이 통화에만 남습니다" },
    { key: "call_log", label: "통화 일시 기록", why: "언제 어떤 설명을 들었는지 특정하는 데 씁니다" },
  ],
  BANCA_HS: [
    { key: "explain_confirm", label: "설명 확인서·서명본", why: "은행 창구·홈쇼핑 판매에서 설명 여부를 다투는 핵심 자료입니다" },
    { key: "broadcast_capture", label: "방송·상담 화면 캡처", why: "홈쇼핑이라면 당시 고지 화면이 근거가 됩니다" },
  ],
  AGENT: [
    { key: "agent_identity", label: "설계사 소속·성명 확인 자료", why: "명함·문자 등 누구에게 들었는지 특정하는 자료입니다" },
    { key: "messenger_log", label: "문자·메신저 대화 내용", why: "권유 과정의 설명이 여기 남아 있는 경우가 많습니다" },
  ],
  BRANCH: [
    { key: "branch_visit", label: "창구 방문 기록", why: "언제 어느 지점에서 가입했는지 확인합니다" },
    { key: "signed_form", label: "자필 서명한 서류 사본", why: "무엇에 서명했는지가 설명의무 판단의 출발점입니다" },
  ],
  ONLINE: [
    { key: "screen_capture", label: "가입 화면 캡처", why: "온라인 가입은 화면에 표시된 고지가 설명의 전부입니다" },
    { key: "email_sms", label: "안내 이메일·문자", why: "가입 직후 받은 안내가 설명 범위의 근거가 됩니다" },
  ],
};

/** 쟁점 때문에 생기는 자료. 쟁점 태그 코드(issue_tags.code) 기준 */
const ISSUE_DOCS: Record<string, readonly { key: string; label: string; why: string }[]> = {
  설명의무: [
    { key: "product_manual", label: "상품설명서", why: "무엇을 설명했어야 하는지의 기준 문서입니다" },
    { key: "subscription_form", label: "청약서 사본(자필 서명 부분 포함)", why: "설명을 들었다고 확인한 서명이 있는지 봅니다" },
  ],
  적합성원칙: [
    { key: "suitability_survey", label: "투자자성향 설문지 원본", why: "누가 작성했는지가 쟁점이 되는 경우가 많습니다" },
  ],
  부당권유: [
    { key: "recommend_record", label: "권유 당시 대화·녹취 기록", why: "어떤 표현으로 권유받았는지가 판단 근거입니다" },
  ],
  고지의무위반: [
    { key: "disclosure_form", label: "청약서의 「계약 전 알릴 의무」 기재란", why: "무엇을 알렸고 무엇이 빠졌는지 확인합니다" },
  ],
  약관해석: [
    { key: "terms_at_contract", label: "가입 당시 약관", why: "약관은 개정되므로 지금 약관이 아니라 가입 시점 약관이 기준입니다" },
  ],
  보험금지급범위: [
    { key: "medical_record", label: "진단서·진료기록", why: "지급 사유에 해당하는지 판단하는 근거입니다" },
    { key: "claim_form", label: "보험금 청구서 사본", why: "무엇을 어떤 사유로 청구했는지 확인합니다" },
  ],
  면책사유: [
    { key: "denial_notice", label: "보험금 부지급 통지서", why: "회사가 든 면책 사유가 문서로 남아 있어야 다툴 수 있습니다" },
  ],
  과실상계: [
    { key: "incident_record", label: "사고 경위 자료", why: "책임 비율을 나누는 근거가 됩니다" },
  ],
};

/** 쟁점·채널과 무관하게 항상 필요한 자료 */
const COMMON_DOCS: readonly { key: string; label: string; why: string }[] = [
  { key: "contract", label: "계약서·증권 사본", why: "어떤 계약인지 특정하는 기본 자료입니다" },
  { key: "contract_date", label: "가입 시점을 알 수 있는 자료", why: "가입 시점에 따라 적용되는 법이 달라집니다" },
];

export type RequiredDocument = {
  key: string;
  label: string;
  why: string;
  /** 이 항목이 왜 목록에 들어왔는지 — 공통 / 채널 / 쟁점 */
  origin: "COMMON" | "CHANNEL" | "ISSUE";
  /** 쟁점 때문이면 어느 쟁점인지 */
  issueCode?: string;
  /** 근거 출처 구분 — 집계값이 아니라 큐레이션 표에서 왔음을 명시한다 */
  source: "CURATED";
  possessed: boolean;
};

export type RelatedClause = {
  clauseText: string;
  sector: Sector | null;
  productCode: ProductCode | null;
  /** 이 조항이 실제로 문제된 사건의 의결번호 */
  fromDecisionNo: string | null;
  issueCode: string;
};

export type CheckDocumentsResult = {
  required: RequiredDocument[];
  /** 아직 없는 항목. 화면의 「결여 항목」이 이것이다 */
  missing: RequiredDocument[];
  /** 실제 분쟁에서 문제된 약관 조항 — terms_clauses 실측 */
  relatedClauses: RelatedClause[];
  /** 채널 미확정으로 채널 자료를 제시하지 못했는지 */
  channelUnknown: boolean;
  flagged: number;
};

export type CheckDocumentsInput = {
  issues?: readonly string[];
  channel?: DbChannel;
  /** 이용자가 이미 가지고 있다고 밝힌 항목 key */
  possessed?: readonly string[];
  clauseLimit?: number;
};

export async function checkDocuments(
  input: CheckDocumentsInput,
): Promise<CheckDocumentsResult> {
  const issues = [...new Set((input.issues ?? []).filter(Boolean))];
  const have = new Set(input.possessed ?? []);

  const required: RequiredDocument[] = [];
  const seen = new Set<string>();
  const add = (
    d: { key: string; label: string; why: string },
    origin: RequiredDocument["origin"],
    issueCode?: string,
  ) => {
    if (seen.has(d.key)) return;
    seen.add(d.key);
    required.push({ ...d, origin, issueCode, source: "CURATED", possessed: have.has(d.key) });
  };

  for (const d of COMMON_DOCS) add(d, "COMMON");
  if (input.channel) for (const d of CHANNEL_DOCS[input.channel]) add(d, "CHANNEL");
  for (const code of issues) for (const d of ISSUE_DOCS[code] ?? []) add(d, "ISSUE", code);

  // 관련 약관 조항 — 쟁점이 있을 때만. terms_clauses에 쟁점 칼럼이 없어
  // 출처 사건(case_issues)을 거쳐 잇는다.
  let clauses: RelatedClause[] = [];
  let flagged = 0;
  if (issues.length) {
    const rows = await sql<
      {
        clause_text: string;
        sector: Sector | null;
        product_code: ProductCode | null;
        decision_no: string | null;
        code: string;
      }[]
    >`
      select distinct on (tc.id)
             tc.clause_text, tc.sector, tc.product_code, c.decision_no, t.code
      from terms_clauses tc
      join cases c        on c.id = tc.source_case_id
      join case_issues ci on ci.case_id = c.id
      join issue_tags t   on t.id = ci.issue_tag_id
      where t.code = any(${issues}::text[])
      order by tc.id, length(tc.clause_text) desc
      limit ${Math.min(input.clauseLimit ?? 5, 20)}`;

    clauses = rows.map((r) => {
      const { row, flagged: n } = filterFields(r, ["clause_text"]);
      flagged += n;
      return {
        clauseText: row.clause_text,
        sector: row.sector,
        productCode: row.product_code,
        fromDecisionNo: row.decision_no,
        issueCode: row.code,
      };
    });
  }

  return {
    required,
    missing: required.filter((d) => !d.possessed),
    relatedClauses: clauses,
    channelUnknown: !input.channel,
    flagged,
  };
}
