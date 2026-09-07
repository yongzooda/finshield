import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 7 * 24 * 60 * 60;
export function receiptCookieName(request: Request) {
  return new URL(request.url).protocol === "https:" ? "__Host-fs-deletion" : "fs-deletion";
}
function sign(payload: string, key: string) {
  return createHmac("sha256", key).update(`account-deletion-receipt-v1:${payload}`).digest("base64url");
}
/** Auth 소실 뒤에도 이 요청의 완료 상태만 조회할 수 있다. 사용자 데이터 접근 권한은 없다. */
export function deletionReceipt(request: Request, key: string, now = Date.now()): string | null {
  if (key.length < 16) return null;
  const name = receiptCookieName(request);
  const value = request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value || value.length > 256) return null;
  const [id, expiration, mac, extra] = value.split(".");
  if (extra || !UUID.test(id) || !/^\d{10}$/.test(expiration) || !mac) return null;
  const exp = Number(expiration), seconds = Math.floor(now / 1000);
  if (exp <= seconds || exp > seconds + TTL) return null;
  const actual = Buffer.from(mac), expected = Buffer.from(sign(`${id}.${expiration}`, key));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
}
export function setDeletionReceipt(response: Response, request: Request, id: string, key: string, now = Date.now()) {
  const payload = `${id}.${Math.floor(now / 1000) + TTL}`;
  const secure = new URL(request.url).protocol === "https:";
  response.headers.append("Set-Cookie", `${receiptCookieName(request)}=${payload}.${sign(payload, key)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL}${secure ? "; Secure" : ""}`);
  return response;
}
