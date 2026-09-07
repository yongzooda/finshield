import "server-only";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 범위·일정 계산용 Payload. 인증 판단은 발급처가 수행한다. */
export function tokenSession(token: string | null): { id: string; owner: string; expires: number } | null {
  try {
    if (!token || token.length > 16384 || token.split(".").length !== 3) return null;
    const body = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (!UUID.test(body.session_id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(body.session_id)) return null;
    return { id: body.session_id.toLowerCase(), owner: body.sub, expires: body.exp };
  } catch { return null; }
}

export function sameSessionOrigin(request: Request): boolean {
  const url = new URL(request.url);
  return request.headers.get("origin") === `${url.protocol}//${request.headers.get("host") ?? url.host}`;
}

function cookieConfig(request: Request, sessionId: string) {
  if (!UUID.test(sessionId)) throw new Error("SESSION_REQUIRED");
  const url = new URL(request.url);
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const secure = !local || url.protocol === "https:";
  return { name: `${secure ? "__Host-" : ""}finshield-refresh-${sessionId}`, attributes: `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}` };
}

export function readRefreshCookie(request: Request, sessionId: string): string | null {
  const { name } = cookieConfig(request, sessionId);
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (cookies.length !== 1) return null;
  const value = cookies[0].slice(name.length + 1);
  return /^[A-Za-z0-9._~-]{1,2048}$/.test(value) ? value : null;
}

export function setRefreshCookie(response: Response, request: Request, sessionId: string, value: string | null): Response {
  const { name, attributes } = cookieConfig(request, sessionId);
  if (value !== null && !/^[A-Za-z0-9._~-]{1,2048}$/.test(value)) throw new Error("INVALID_REFRESH_RESPONSE");
  response.headers.append("Set-Cookie", `${name}=${value ?? ""}; ${attributes}${value === null ? "; Max-Age=0" : ""}`);
  return response;
}
