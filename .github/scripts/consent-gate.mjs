// ============================================================
// B-CONSENT-01 동의 격리 prototype.
//
// 원본(마스킹 전 바이트)이 외부 OCR 로 나가는 경로는 이 파일의 함수 하나뿐이다.
// 그 함수는 동의가 GRANTED 일 때만 바이트를 넘기고, 어느 경우든 감사 row 를 남긴다.
// ADR 14.2 가 이 blocker 를 prototype 으로 규정한다. 제품이 이 계약을 그대로 구현한다.
//
// 요구사항: SEC-PRI-010(동의 거절 시 외부 전송 0회), INP-013(처리 순서 고정),
//           SEC-AI-007(모델에는 마스킹된 데이터만).
// ============================================================
export const CONSENT_TYPE = "EXTERNAL_OCR_RAW_TRANSFER";
export const EVENT_SENT = "EXTERNAL_OCR_RAW_SENT";
export const EVENT_BLOCKED = "EXTERNAL_OCR_RAW_BLOCKED";
export const BLOCK_REASONS = Object.freeze(["ABSENT", "DENIED", "REVOKED", "SUPERSEDED", "RAW_DELETED", "WRONG_INPUT"]);

// 그 입력에 대한 가장 최근 동의. 다른 입력이나 다른 Case 의 동의를 끌어오지 않는다.
export const latestConsent = async ({ sql, ownerId, caseId, inputId }) => {
  const rows = await sql`
    select c.id, c.decision, c.created_at,
           exists (select 1 from public.processing_consents s
                    where s.supersedes_consent_id = c.id and s.owner_id = c.owner_id and s.case_id = c.case_id) as superseded
      from public.processing_consents c
     where c.owner_id = ${ownerId}::uuid and c.case_id = ${caseId}::uuid
       and c.case_input_id = ${inputId}::uuid and c.consent_type = ${CONSENT_TYPE}
     order by c.created_at desc, c.id desc
     limit 1`;
  return rows[0] ?? null;
};

const audit = async ({ sql, correlationId, eventCode, statusCode, errorCode, ownerId, caseId }) => {
  await sql`
    insert into private.audit_events (correlation_id, event_code, actor_type, owner_ref, case_id, status_code, error_code)
    values (${correlationId}::uuid, ${eventCode}, 'SYSTEM', ${ownerId}::uuid, ${caseId}::uuid, ${statusCode}, ${errorCode})`;
};

// 원본을 외부 OCR 로 보내는 유일한 경로.
export const sendRawToExternalOcr = async ({ sql, ownerId, caseId, inputId, bytes, correlationId, ocrClient }) => {
  const block = async (reason) => {
    await audit({ sql, correlationId, eventCode: EVENT_BLOCKED, statusCode: "BLOCKED", errorCode: reason, ownerId, caseId });
    return { sent: false, reason };
  };

  // 원본이 이미 지워졌으면 동의가 있어도 보낼 것이 없다 (규칙 4).
  const objects = await sql`
    select count(*)::int as alive from private.input_objects
     where case_input_id = ${inputId}::uuid and deleted_at is null`;
  if (objects[0].alive === 0) return block("RAW_DELETED");

  const consent = await latestConsent({ sql, ownerId, caseId, inputId });
  if (!consent) return block("ABSENT");
  if (consent.superseded) return block("SUPERSEDED");
  if (consent.decision !== "GRANTED") return block(consent.decision);

  // 입력 행이 그 동의를 가리키고 있어야 한다. 다른 입력의 동의를 빌려 쓰지 못한다.
  const linked = await sql`
    select count(*)::int as ok from public.case_inputs
     where id = ${inputId}::uuid and owner_id = ${ownerId}::uuid and case_id = ${caseId}::uuid
       and external_ocr_consent_id = ${consent.id}::uuid`;
  if (linked[0].ok !== 1) return block("WRONG_INPUT");

  const text = await ocrClient.send({ inputId, bytes });
  await audit({ sql, correlationId, eventCode: EVENT_SENT, statusCode: "OK", errorCode: null, ownerId, caseId });
  return { sent: true, text };
};

// 모델·Embedding 으로 나가는 경로. 마스킹을 통과하지 못하면 아무것도 보내지 않는다.
export const maskedIntake = ({ text, gate }) => {
  const result = gate(text);
  if (!result.ok) return { sent: false, reason: "RESIDUAL_PII", masked: null };
  return { sent: true, reason: null, masked: result.masked.text };
};
