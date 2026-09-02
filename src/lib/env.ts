/**
 * 환경 설정 단독 진입점 — 상한·임계값 12종 + 서버 자격증명.
 *
 * 규칙:
 *   1. 런타임 코드는 process.env를 직접 읽지 않는다. 반드시 이 모듈을 거친다.
 *      확신도 임계(F-305)·상한값(N-201~203)이 코드에 하드코딩되는 경로를 없애기 위함이다.
 *   2. 기본값이 없다 — 설정 누락은 부팅 실패로 즉시 드러난다 (조용히 초기값으로
 *      돌아가면 Vercel 환경변수 이전 누락을 심사 중에 발견하게 된다).
 *   3. `server-only` — 클라이언트 번들에 딸려 들어가면 빌드가 실패한다 (EC-4).
 *   4. BATCH_DATABASE_URL은 여기 없다. 배치 자격증명은 런타임에 실리지 않는다 (P-502).
 *      필요한 코드가 생기면 그 코드가 잘못된 것이다.
 */

import "server-only";
import { z } from "zod";

const intStr = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

const EnvSchema = z.object({
  // ── 자격증명 (서버 한정 — EC-4) ─────────────────────────────
  /** app_runtime 롤 DSN — 정적 자산 SELECT + 캐시·신고·카운터 쓰기만 가능한 롤이다 */
  DATABASE_URL: z.string().startsWith("postgres"),
  ANTHROPIC_API_KEY: z.string().min(10),
  /** 운영 모델 — 교체 시 확신도 임계 재보정 필수 (A-2·A-6) */
  ANTHROPIC_MODEL: z.string().min(1),
  /** 법제처 OPEN API 인증키 (OC 파라미터) */
  LAW_API_OC: z.string().min(1),
  LAW_API_BASE: z.url(),

  // ── 도구 호출 상한 (F-607 · N-201) ──────────────────────────
  MAX_TOOL_CALLS_PER_CYCLE: intStr(1, 100),
  MAX_TOOL_CALLS_PER_SESSION: intStr(1, 300),

  // ── 되묻기 상한 (N-202) ─────────────────────────────────────
  MAX_FOLLOWUP_QUESTIONS: intStr(1, 50),
  MAX_FOLLOWUP_TOTAL: intStr(1, 50),

  // ── 입력·세션 (N-205 · N-401) ───────────────────────────────
  MAX_STATEMENT_CHARS: intStr(100, 100_000),
  SESSION_IDLE_MINUTES: intStr(1, 1440),

  // ── 확신도 임계 (F-305 · SR-403) — 하드코딩 금지의 대상 그 자체 ──
  CONFIDENCE_THRESHOLD: intStr(1, 5),

  // ── Claude API 하드 쿼터 (N-204) ────────────────────────────
  /**
   * **하루** 예산 (USD). 기획서 C-4의 월 8~10만 원을 일 단위로 나눈 값이다
   * (≈ $55~70/월 ≈ **$1.8~2.3/일**).
   *
   * 달러로 두는 이유 — 모델 단가가 USD로 고시된다. 원화로 두면 환율이라는
   * 두 번째 변수가 생기고, 그 환율이 낡으면 쿼터가 조용히 어긋난다.
   *
   * 80% 도달 시 운영자 알림 · 100%에서 신규 상담 차단 (EX-404).
   */
  DAILY_BUDGET_USD: z.coerce.number().positive().max(1000),

  /**
   * 운영자 알림 웹훅 (선택). N-303은 「운영자 모바일로 즉시 알림」을 요구하는데,
   * 실제 전달 채널은 배포자가 정한다 — Slack·Discord·ntfy 등 POST를 받는 주소면
   * 무엇이든 된다. 비워 두면 알림 대신 `/api/health`에 상태로만 드러난다.
   */
  OPS_ALERT_WEBHOOK_URL: z.url().optional(),

  // ── IP 레이트 리밋 (N-203) ──────────────────────────────────
  RATE_LIMIT_PER_MINUTE: intStr(1, 10_000),
  RATE_LIMIT_SESSIONS_PER_HOUR: intStr(1, 1000),
  RATE_LIMIT_JUDGMENTS_PER_DAY: intStr(1, 1000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `환경 설정 불량 — [${missing}] 확인. .env.local(로컬) 또는 Vercel 환경변수(배포)에 값이 있어야 한다.`,
  );
}

export const env = parsed.data;
export type Env = typeof env;
