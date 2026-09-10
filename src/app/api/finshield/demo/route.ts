/**
 * POST /api/finshield/demo — 공개 Live Seed Demo 실행 (S-001, ROLE-001).
 *
 * 로그인 없이 부를 수 있다. 그래서 방문자의 문장을 받지 않는다. 미리 승인한
 * 합성 Seed 하나만 돌린다. 받지 않으면 마스킹을 잘못할 일도, 남길 일도 없다.
 *
 * 실행 기록은 격리된 demo 표에만 남는다. 끝난 뒤에 회원 Case·프로필·입력이
 * 하나도 생기지 않는다.
 *
 * 공개 경로라 상한을 둔다. 상한을 넘으면 사전 계산 결과로 돌리지 않고 그냥
 * 기다려 달라고 말한다. 사전 계산을 실시간 실행처럼 보이게 하지 않는다.
 */

import { createHash } from "node:crypto";
import { ndjsonStream } from "@/lib/ops/ndjson";
import { jsonNoStore } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import {
  DemoUnavailableError, allowDemo, createSession, readSeed, runDemo,
} from "@/lib/finshield/demo";
import { MODEL_TIMEOUTS } from "@/lib/finshield/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 방문자 식별은 해시로만 한다. 주소 자체를 남기지 않는다. */
const visitorKey = (request: Request): string => {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",")[0].trim() || "unknown";
  return createHash("sha256").update(`demo:${address}`).digest("hex").slice(0, 32);
};

export async function POST(request: Request): Promise<Response> {
  const sql = fsql();
  let session;
  let seed;
  try {
    if (!(await allowDemo(sql, visitorKey(request)))) {
      // 상한에 걸려도 사전 계산 결과로 바꿔 돌리지 않는다. 화면이 지난 실제 실행 기록을
      // 실행 시각과 함께 따로 보여 줄 수 있게만 알린다.
      return jsonNoStore({
        error: "지금은 공개 체험 실행 한도에 도달했습니다. 잠시 뒤에 다시 시도하거나 가장 최근 실행 결과를 확인해 주세요.",
        code: "DEMO_LIMIT_REACHED",
      }, 429);
    }
    session = await createSession(sql);
    seed = await readSeed(sql, session.seedVersionId);
  } catch (error) {
    if (error instanceof DemoUnavailableError) return jsonNoStore({ error: error.message }, 503);
    // 공개 경로다. 내부 사정을 그대로 흘리지 않되 빈 500 으로 끝내지도 않는다.
    return jsonNoStore({ error: "지금은 공개 실행을 시작할 수 없습니다" }, 503);
  }

  const events: unknown[] = [];
  const waiters: (() => void)[] = [];
  let finished = false;
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(MODEL_TIMEOUTS.demoRunMs)]);
  const wake = () => { while (waiters.length > 0) waiters.pop()?.(); };
  const push = (event: unknown) => { events.push(event); wake(); };

  const work = (async () => {
    try {
      push({
        type: "started",
        mode: "LIVE",
        seed_version: seed.version,
        masked_input: seed.maskedInput,
        claims: seed.claims,
        expires_at: session.expiresAt,
      });
      const result = await runDemo({ sql, session, signal, progress: (event) => push(event) });
      push({ type: "done", mode: "LIVE", is_precomputed: false, ...result.manifest });
    } catch (error) {
      push({ type: "error", message: "실행을 끝내지 못했습니다", code: (error as { code?: string })?.code ?? null });
    } finally {
      finished = true;
      wake();
    }
  })();

  async function* stream(): AsyncGenerator<unknown> {
    let index = 0;
    while (!finished || index < events.length) {
      if (index < events.length) { yield events[index]; index += 1; continue; }
      await new Promise<void>((resolve) => { waiters.push(resolve); });
    }
    await work;
  }

  return ndjsonStream(stream(),()=>abort.abort());
}
