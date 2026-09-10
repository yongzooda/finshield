import { permanentRedirect } from "next/navigation";

/**
 * 옛 MCP 서버 안내 주소다. 들여온 PreCase 단독 화면은 FinShield 안에서 다시 열지 않는다.
 * 옛 주소로 들어와도 같은 목적의 FinShield 화면으로 옮긴다 (규칙 6).
 */
export default function LegacyPage() {
  permanentRedirect("/trust");
}
