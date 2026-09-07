import "server-only";
import { bearerToken, resolveOwner } from "./auth";

export class ReauthenticationRequiredError extends Error {}
export class RequestOriginError extends Error {}
export const RECENT_AUTH_SECONDS = 300;

/** AUTH-011·DB 13.2: Token 발급·갱신 시각 대신 검증된 비밀번호 인증 시각을 본다. */
export async function resolveRecentlyAuthenticatedOwner(request: Request): Promise<string> {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new RequestOriginError("이 화면에서 삭제를 다시 요청해 주세요");
  }
  // 반드시 발급처 검증을 먼저 끝낸다. 아래 Payload 파싱은 서명 검증의 대체가 아니다.
  const ownerId = await resolveOwner(request);
  const token = bearerToken(request);
  try {
    if (!token || token.length > 16384 || token.split(".").length !== 3) throw new Error();
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.sub !== ownerId || payload.is_anonymous !== false || !Array.isArray(payload.amr) || payload.amr.length > 32
      || !payload.amr.some((entry: unknown) => {
        if (!entry || typeof entry !== "object") return false;
        const { method, timestamp } = entry as {method?:unknown; timestamp?:unknown};
        return method === "password" && typeof timestamp === "number" && Number.isSafeInteger(timestamp)
          && timestamp <= now + 30 && timestamp >= now - RECENT_AUTH_SECONDS;
      })) throw new Error();
  } catch {
    throw new ReauthenticationRequiredError("자료를 삭제하려면 비밀번호로 다시 로그인해 주세요");
  }
  return ownerId;
}
