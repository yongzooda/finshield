/**
 * 입력 접수 — 원문에서 Claim 까지.
 *
 * 규칙 4 가 요구하는 경계가 여기 있다. 원문은 저장하지 않는다. 비모델 PII Gate 를
 * 먼저 지나고, 마스킹된 문장만 DB 와 모델에 간다. Gate 가 잔존을 의심하면 그
 * 자리에서 멈추고 사용자에게 되묻는다. 의심스러운 채로 모델에 넘기지 않는다.
 *
 * 입력 단계는 한 칸씩 올린다. QUARANTINED 에서 MASKED 로 건너뛰면 어디서
 * 걸러졌는지 기록이 남지 않는다.
 */

import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { gateForModel } from "@/lib/agents/pii";
import type { ConfirmedClaim } from "./schemas";

type Sql = ReturnType<typeof postgres>;

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const PII_POLICY_VERSION = "pii-policy-v1";

export type ExtractedClaim = {
  claimType: string;
  statementMasked: string;
  materiality: "MATERIAL" | "NON_MATERIAL" | "UNDETERMINED";
};

export type ClaimExtractor = (maskedText: string) => Promise<ExtractedClaim[]>;

export type IntakeBlocked = { ok: false; reason: "PII_RESIDUAL"; ask: string };
export type IntakeAccepted = {
  ok: true;
  caseId: string;
  inputId: string;
  maskedText: string;
  claims: (ConfirmedClaim & { claimId: string })[];
};

export const startIntake = async (args: {
  sql: Sql;
  ownerId: string;
  rawText: string;
  titleMasked: string;
  extractClaims: ClaimExtractor;
}): Promise<IntakeAccepted | IntakeBlocked> => {
  const { sql, ownerId } = args;
  const raw = args.rawText.trim();
  if (raw.length === 0) throw new Error("입력이 비어 있다");
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > MAX_INPUT_BYTES) throw new Error("크기 상한을 넘었다");

  // 비모델 Gate 가 먼저다. 여기서 막히면 원문은 아무 데도 가지 않는다.
  const gate = gateForModel(raw);
  if (!gate.ok) return { ok: false, reason: "PII_RESIDUAL", ask: gate.ask };
  const maskedText = gate.masked.text;

  const created = await sql`
    select private.create_case(${ownerId}::uuid, 'LOAN'::public.case_scenario, ${args.titleMasked},
      ${`intake-${ownerId}-${Date.now()}`}::text, ${sha256(maskedText)}::text) as id`;
  const caseId = created[0].id as string;

  const input = await sql`
    select private.create_text_input(${ownerId}::uuid, ${caseId}::uuid, ${bytes}::bigint, 86400) as id`;
  const inputId = input[0].id as string;

  for (const [stage, patch] of [
    ["VALIDATED", {}],
    ["EXTRACTED", {}],
    ["MASKED", {
      masked_text: maskedText,
      masked_text_hash: sha256(maskedText),
      pii_policy_version: PII_POLICY_VERSION,
    }],
  ] as const) {
    await sql`select id from private.advance_input_stage(${ownerId}::uuid, ${caseId}::uuid,
      ${inputId}::uuid, ${stage}::public.input_stage, ${JSON.stringify(patch)}::text::jsonb)`;
  }

  // Claim 추출은 마스킹된 문장만 본다.
  const extracted = await args.extractClaims(maskedText);
  const claims: (ConfirmedClaim & { claimId: string })[] = [];
  for (const [index, claim] of extracted.entries()) {
    const row = await sql`
      select private.record_extracted_claim(${ownerId}::uuid, ${caseId}::uuid, ${inputId}::uuid, null,
        ${claim.claimType}, ${claim.statementMasked}, ${claim.materiality}, 'MODEL') as id`;
    claims.push({
      claimId: row[0].id as string,
      claim_ref: `C${index + 1}`,
      claim_type: claim.claimType,
      statement_masked: claim.statementMasked,
      materiality: claim.materiality,
    });
  }

  return { ok: true, caseId, inputId, maskedText, claims };
};

/** 사용자가 고른 Claim 만 확정한다. 확정하지 않은 것은 검증 대상이 아니다. */
export const confirmClaims = async (args: {
  sql: Sql;
  ownerId: string;
  caseId: string;
  claimIds: string[];
}): Promise<number> => {
  let confirmed = 0;
  for (const claimId of args.claimIds) {
    await args.sql`select private.confirm_claim(${args.ownerId}::uuid, ${args.caseId}::uuid,
      ${claimId}::uuid) as n`;
    confirmed += 1;
  }
  return confirmed;
};
