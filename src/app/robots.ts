import type { MetadataRoute } from "next";

/**
 * 공개 화면만 검색에 노출한다. 회원 기록·프로필·알림과 API 는 로그인 뒤 보는
 * 자리이므로 수집하지 않게 한다. 옛 PreCase 주소는 FinShield 화면으로 옮겨진다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/cases", "/profile", "/notifications"],
    }],
  };
}
