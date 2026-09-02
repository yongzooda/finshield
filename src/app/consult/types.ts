/** S-03이 `/api/consult`에서 받는 응답 형태. 서버 라우트와 짝을 이룬다 */

import type { AnswerForm } from "@/lib/labels";

export type ConsultReply =
  | { kind: "SESSION"; session: string }
  | { kind: "ASK"; slot: string; question: string; form: AnswerForm | null; maskedCount: number; session: string }
  | { kind: "READY"; limited?: boolean; message?: string; maskedCount: number; session: string }
  | { kind: "OUT_OF_SCOPE"; message: string; maskedCount: number; session: string }
  | { kind: "PII_RESIDUAL"; message: string }
  | { kind: "INVALID"; message: string }
  | { kind: "MODEL_DOWN"; message: string }
  /** EX-404 예산 소진 — 이용자에겐 모델 장애와 같은 상황이다 */
  | { kind: "QUOTA"; message: string }
  | { kind: "EXPIRED"; message: string };
