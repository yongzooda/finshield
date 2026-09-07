import { describe, expect, it } from "vitest";
import { deletionReceipt, setDeletionReceipt } from "../deletion-receipt";
const id = "dc674cb6-49ad-4133-9999-ccc008000001";
const key = "synthetic-receipt-key-no-secret";
const now = 1788800000000;
const request = new Request("https://finshield.example/api/finshield/account/delete");
function cookieRequest(cookie: string) { return new Request(request, { headers: { cookie } }); }
describe("탈퇴 완료 영수증", () => {
  it("Auth가 없어도 서명된 요청 하나만 복원하며 HttpOnly·Secure·Strict를 사용한다", () => {
    const response = setDeletionReceipt(new Response(), request, id, key, now);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("__Host-fs-deletion=");
    expect(cookie).toContain("HttpOnly; SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(deletionReceipt(cookieRequest(cookie), key, now)).toBe(id);
  });
  it("다른 요청으로 바꾸기·서명 변조·키 교체·만료·과도한 미래 유효기간을 거부한다", () => {
    const cookie = setDeletionReceipt(new Response(), request, id, key, now).headers.get("set-cookie")!;
    expect(deletionReceipt(cookieRequest(cookie.replace(id, id.replace(/1$/, "2"))), key, now)).toBeNull();
    expect(deletionReceipt(cookieRequest(cookie), "another-synthetic-key", now)).toBeNull();
    expect(deletionReceipt(cookieRequest(cookie), key, now + 7 * 86400000)).toBeNull();
    expect(deletionReceipt(cookieRequest(cookie), key, now - 1000)).toBeNull();
    expect(deletionReceipt(cookieRequest(cookie), "", now)).toBeNull();
  });
});
