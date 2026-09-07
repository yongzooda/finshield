import { cleanupCaseFiles } from "@/lib/finshield/files/cleanup";
/**
 * POST /api/finshield/cases/[id]/delete — Case 삭제 요청 (S-017, AUTH-005).
 *
 * 요청 즉시 접근을 막고 원본·중간물·Case vector 를 청소 대상으로 넣는다. 실제
 * 물리 삭제 완료는 청소가 객체 부재를 확인한 뒤에 기록된다. 그래서 이 응답은
 * «지웠다» 가 아니라 «지우기 시작했다» 이다. 화면도 그렇게 적는다.
 *
 * 삭제 원장에는 Case 식별자를 그대로 남기지 않는다. 서버 열쇠로 만든 HMAC 만
 * 남긴다. 열쇠가 없으면 원장을 못 만드므로 삭제를 시작하지 않고 그 사실을
 * 알린다. 원장 없는 삭제를 하지 않기 위해서다.
 */

import { createHash, createHmac } from "node:crypto";
import { jsonNoStore } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { bearerToken, UnauthenticatedError } from "@/lib/finshield/auth";
import { resolveRecentlyAuthenticatedOwner, ReauthenticationRequiredError, RequestOriginError } from "@/lib/finshield/reauthentication";
import { restSelect } from "@/lib/finshield/rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_VERSION = "k1";
const POLICY_VERSION = "deletion-policy-v1";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await resolveRecentlyAuthenticatedOwner(request);
  } catch (error) {
    if (error instanceof ReauthenticationRequiredError) return jsonNoStore({error:error.message,code:"REAUTHENTICATION_REQUIRED"},403);
    if (error instanceof RequestOriginError) return jsonNoStore({error:error.message,code:"ORIGIN_REJECTED"},403);
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    throw error;
  }
  const { id: caseId } = await context.params;
  if (!UUID.test(caseId)) return jsonNoStore({ error: "잘못된 주소입니다" }, 400);

  const key = process.env.DELETION_HMAC_KEY ?? "";
  if (key.length < 16) {
    return jsonNoStore({
      error: "이 배포에는 삭제 기록 열쇠가 없어 삭제를 시작할 수 없습니다",
    }, 503);
  }

  const targetHmac = createHmac("sha256", key).update(`CASE:${caseId}`).digest("hex");
  const idempotencyKey = `case-delete:${caseId}`;
  const requestHash = createHash("sha256").update(`${ownerId}:${caseId}:${POLICY_VERSION}`).digest("hex");

  try {
    const rows = await fsql()`
      select private.request_case_deletion(${ownerId}::uuid, ${caseId}::uuid,
        ${idempotencyKey}::text, ${requestHash}::text, ${targetHmac}::text,
        ${KEY_VERSION}::text, ${POLICY_VERSION}::text) as id`;
    await cleanupCaseFiles(fsql(),ownerId,caseId).catch(()=>undefined);
    const purged = await fsql()`select private.purge_case(${rows[0].id}::uuid) as ok`.catch(()=>[]);
    // 완료 응답이 유실돼 재요청하면 Purge 대상 Case는 이미 없다. 본인 삭제 원장의 종결 상태를 복원한다.
    const previous = purged[0]?.ok ? [] : await restSelect({token:bearerToken(request)!,path:"deletion_requests",
      query:{select:"status",id:`eq.${rows[0].id}`,owner_id:`eq.${ownerId}`,limit:"1"}});
    const completed = purged[0]?.ok || (previous[0] as {status?:string}|undefined)?.status === "COMPLETED";
    return jsonNoStore({ deletion_request_id: rows[0].id, status: completed ? "COMPLETED" : "PENDING" }, 200);
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "");
    if (code === "42501") return jsonNoStore({ error: "이 Case 를 찾을 수 없습니다" }, 404);
    throw error;
  }
}
