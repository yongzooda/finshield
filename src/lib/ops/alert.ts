/**
 * N-303 운영자 알림 — 헬스체크 이상 · 쿼터 80% 도달 시.
 *
 * 명세는 「운영자 **모바일**로 즉시 알림」을 요구한다. 1인 운영이라 이메일만으로는
 * 놓친다는 것이 그 이유다. 다만 **실제 전달 채널은 배포자가 정한다** — 여기서는
 * POST 한 번을 쏠 뿐이고, 그 주소가 Slack이든 Discord든 ntfy든 상관하지 않는다.
 * 채널을 코드에 박으면 그 서비스가 죽을 때 알림도 함께 죽는다.
 *
 * 웹훅이 설정되지 않았으면 조용히 넘어간다 — 대신 `/api/health`가 상태를 드러내므로
 * 감시자가 그걸 읽어 알릴 수 있다 (D-4 구성 시 둘 중 하나는 반드시 갖출 것).
 *
 * ⚠️ 알림 본문에 **진술·슬롯·판단이 들어가지 않는다** (N-403). 나가는 것은
 * 사건 종류와 숫자뿐이다.
 */

import "server-only";
import { env } from "../env";

export type AlertKind = "QUOTA_WARNING" | "QUOTA_EXCEEDED" | "HEALTH_DOWN";

/** 같은 알림을 반복해 쏘지 않는다 — 인스턴스 단위 억제라 완전하지는 않다 */
const lastSent = new Map<AlertKind, number>();
const SUPPRESS_MS = 30 * 60_000;

export async function alertOperator(
  kind: AlertKind,
  detail: Record<string, string | number>,
): Promise<void> {
  const url = env.OPS_ALERT_WEBHOOK_URL;
  if (!url) return;

  const now = Date.now();
  if (now - (lastSent.get(kind) ?? 0) < SUPPRESS_MS) return;
  lastSent.set(kind, now);

  const text =
    kind === "QUOTA_WARNING"
      ? `[프리케이스] 오늘 API 예산 ${detail.percent}% 사용 ($${detail.spent} / $${detail.budget})`
      : kind === "QUOTA_EXCEEDED"
        ? `[프리케이스] ⚠️ API 예산 소진 — 신규 상담을 차단했습니다 ($${detail.spent} / $${detail.budget})`
        : `[프리케이스] ⚠️ 헬스체크 이상 — ${detail.failing}`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, kind, ...detail }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // 알림이 실패해도 서비스는 계속 간다. 여기서 던지면 알림 때문에 판단이 죽는다
  }
}
