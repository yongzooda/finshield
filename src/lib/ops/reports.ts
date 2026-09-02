/**
 * DR-301 오류 신고 접수 — F-404 "이 판단이 사실과 다릅니다".
 *
 * 신고는 **INSERT만** 한다. app_runtime 롤에 UPDATE·DELETE 권한이 없으므로
 * (마이그레이션 0002) 런타임 코드가 접수분을 고치거나 지울 수 없다. 상태 전이
 * (RECEIVED→REVIEWING→CORRECTED/DISMISSED)는 운영자 롤의 일이고, 공개는
 * `public_corrections` 뷰로만 나간다.
 *
 * ⚠️ 신고 본문도 진술과 똑같이 **마스킹을 거친다**(F-404 후단 · F-601). 신고
 * 창구라고 원문 저장 경로를 열어주면 DR-4xx의 저장 금지를 우회하는 뒷문이 된다.
 * 잔존 의심이 있으면 **저장하지 않고 되돌린다** — 신고를 받는 것보다 개인정보를
 * 남기지 않는 쪽이 무겁다 (EP-3).
 *
 * 저장하지 않는 것: 세션 ID · IP · User-Agent. 스키마에 컬럼 자체가 없다(P-604).
 */

import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "../db";
import { maskPii, type MaskResult } from "../agents/pii";
import { DB_CHANNELS, type DbChannel } from "../types";
import { pgCode, type SqlExec } from "./counters";

export type ReportInput = {
  /** 신고 본문. 마스킹 전 원문이며 이 함수 밖으로도, DB로도 원문 상태로 나가지 않는다 */
  content: string;
  /** 쟁점 분류 (선택) — issue_tags.code와 대조한다 */
  issueCode?: string | null;
  /** 판매채널 분류 (선택) */
  channel?: string | null;
};

export type ReportAccepted = {
  ok: true;
  /** 접수번호. 이용자가 나중에 S-06 정정 이력에서 자기 신고를 찾을 때 쓴다 */
  id: string;
  /** 무엇을 몇 개 가렸는지 — 화면이 "이런 정보를 지우고 접수했습니다"를 보여줄 근거 */
  masked: MaskResult;
  /**
   * 알 수 없는 쟁점 코드라 분류를 비우고 접수했는지.
   * 분류가 틀렸다고 신고 자체를 버리지는 않는다 — 본문이 더 중요하다.
   */
  droppedIssueCode: boolean;
  /** 채널이 열거 밖(UNKNOWN 포함)이라 비우고 접수했는지 */
  droppedChannel: boolean;
};

export type ReportRejected =
  /** 마스킹으로 지우지 못한 개인정보가 남았다 — 저장하지 않았다 */
  | { ok: false; reason: "PII_RESIDUAL"; ask: string; masked: MaskResult }
  /** 본문이 비었거나 상한을 넘었다 */
  | { ok: false; reason: "INVALID"; ask: string }
  /** DB 실패 — 이용자에게는 다시 시도를 안내한다 */
  | { ok: false; reason: "DB"; ask: string };

export type ReportResult = ReportAccepted | ReportRejected;

/**
 * `error_reports.channel`의 CHECK에는 **UNKNOWN이 없다**(마이그레이션 0001).
 * 슬롯 열거(SLOT_CHANNELS)는 UNKNOWN을 포함하므로 화면에서 그대로 넘어오면
 * CHECK 위반으로 신고가 통째로 실패한다. 여기서 null로 접는다.
 */
function normalizeChannel(v: string | null | undefined): {
  channel: DbChannel | null;
  dropped: boolean;
} {
  if (!v) return { channel: null, dropped: false };
  if ((DB_CHANNELS as readonly string[]).includes(v)) {
    return { channel: v as DbChannel, dropped: false };
  }
  return { channel: null, dropped: true };
}

/** 쟁점 코드의 정본은 `issue_tags` 룩업이다 — 31종을 코드에 박지 않는다 (B-1 규칙) */
async function normalizeIssueCode(
  v: string | null | undefined,
  exec: SqlExec,
): Promise<{ issueCode: string | null; dropped: boolean }> {
  if (!v) return { issueCode: null, dropped: false };
  const rows = await exec<{ code: string }[]>`
    select code from issue_tags where code = ${v} and active limit 1
  `;
  if (rows.length > 0) return { issueCode: rows[0].code, dropped: false };
  return { issueCode: null, dropped: true };
}

export type SubmitOptions = {
  /** 본문 길이 상한 — 호출부가 env.MAX_STATEMENT_CHARS를 넘긴다 (상한을 새로 만들지 않는다) */
  maxChars: number;
  exec?: SqlExec;
};

export async function submitReport(
  input: ReportInput,
  opts: SubmitOptions,
): Promise<ReportResult> {
  const exec = opts.exec ?? sql;
  const raw = input.content?.trim() ?? "";

  if (raw.length === 0) {
    return {
      ok: false,
      reason: "INVALID",
      ask: "어떤 점이 사실과 다른지 알려주시면 확인하겠습니다.",
    };
  }
  if (raw.length > opts.maxChars) {
    return {
      ok: false,
      reason: "INVALID",
      ask: `신고 내용은 ${opts.maxChars}자까지 받습니다. 핵심만 남겨 다시 보내주세요.`,
    };
  }

  const masked = maskPii(raw);
  if (masked.residualSuspicion) {
    // 여기서 끝낸다. DB에 닿지 않는다.
    return {
      ok: false,
      reason: "PII_RESIDUAL",
      masked,
      ask:
        "신고 내용에 개인정보로 보이는 부분이 남아 있어 접수하지 않았습니다. " +
        "이름·연락처·계좌번호·주민등록번호를 지우고 다시 보내주세요. " +
        "확인에는 그런 정보가 필요하지 않습니다.",
    };
  }

  const ch = normalizeChannel(input.channel);

  try {
    const issue = await normalizeIssueCode(input.issueCode, exec);

    // ⚠️ `returning id`를 쓰지 않는다. PostgreSQL은 RETURNING 절의 컬럼에
    // **SELECT 권한**을 요구하는데, app_runtime은 error_reports에 INSERT만 있다
    // (마이그레이션 0002). 접수분을 되읽을 수 없다는 성질이 설계 의도이므로,
    // 권한을 넓히는 대신 접수번호를 앱에서 만들어 넣는다.
    const id = randomUUID();
    await exec`
      insert into error_reports (id, masked_content, issue_code, channel)
      values (${id}, ${masked.text}, ${issue.issueCode}, ${ch.channel})
    `;
    return {
      ok: true,
      id,
      masked,
      droppedIssueCode: issue.dropped,
      droppedChannel: ch.dropped,
    };
  } catch (e) {
    // 본문은 로그에 남기지 않는다 (절대규칙 3). SQLSTATE만 남긴다.
    console.warn(`[ops] report insert failed pg=${pgCode(e)}`);
    return {
      ok: false,
      reason: "DB",
      ask: "지금은 신고를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}
