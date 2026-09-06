/**
 * GET /api/law-probe — 법제처 API 관측 endpoint.
 *
 * ADR 5.2는 법제처가 요청의 `Referer`를 신청 시 등록한 도메인과 대조한다고 적었다.
 * 그리고 Preview와 Production 각각에서 probe해 어느 범위까지 통과하는지
 * `B-LAW-01`에서 확인하라고 요구한다. 그래서 배포 안에 이 endpoint가 필요하다.
 * 밖에서 부르면 우리 배포가 아니라 호출자의 환경을 재게 된다.
 *
 * 이 endpoint는 우리 OC로 외부 API를 부른다. 아무나 부르면 쿼터가 소모되므로
 * OC에서 유도한 시각 한정 표식을 요구한다. OC 자체는 오가지 않고, 시험을 돌리는
 * 쪽과 배포 쪽이 이미 같은 값을 환경에 들고 있어 새 secret이 필요 없다.
 *
 * 응답에는 상태와 소요 시간과 본문 길이와 본문 해시만 담는다. 요청 URL은 OC를
 * 담고 있으므로 절대 담지 않는다. 본문 원문도 담지 않는다.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { jsonNoStore } from "@/lib/ops/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 20_000;
const UNREGISTERED_ORIGIN = "https://finshield-unregistered.example/";

export const SCENARIOS = [
  "registered", "absent", "deployment_url", "unregistered", "snapshot", "change_recent",
] as const;
type Scenario = (typeof SCENARIOS)[number];

function registeredOrigin(): string | null {
  const explicit = process.env.LAW_API_REGISTERED_ORIGIN?.trim();
  if (explicit) return explicit.endsWith("/") ? explicit : `${explicit}/`;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host}/` : null;
}

// OC 에서 유도한 시각 한정 표식. 앞뒤 한 시간까지 받아 경계에서 흔들리지 않게 한다.
function expectedTokens(): string[] {
  const hour = 60 * 60 * 1000;
  const now = Date.now();
  return [now, now - hour].map((at) => {
    const stamp = new Date(at).toISOString().slice(0, 13);
    return createHash("sha256").update(`${env.LAW_API_OC}:${stamp}`, "utf8").digest("hex");
  });
}

function authorized(header: string | null): boolean {
  if (!header || !/^[0-9a-f]{64}$/.test(header)) return false;
  const given = Buffer.from(header, "hex");
  return expectedTokens().some((token) => timingSafeEqual(given, Buffer.from(token, "hex")));
}

function refererFor(scenario: Scenario): { value: string | null; kind: string } {
  if (scenario === "absent") return { value: null, kind: "none" };
  if (scenario === "unregistered") return { value: UNREGISTERED_ORIGIN, kind: "unregistered" };
  if (scenario === "deployment_url") {
    const host = process.env.VERCEL_URL?.trim();
    return { value: host ? `https://${host}/` : null, kind: host ? "deployment" : "none" };
  }
  return { value: registeredOrigin(), kind: "registered" };
}

function queryFor(scenario: Scenario): Record<string, string> {
  if (scenario === "change_recent") {
    // 변경 조문은 D+1 에 반영된다. 어제 자를 물어 실제 반영 시점을 기록한다.
    const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    return { target: "lsJoRvs", regDt: day, display: "5" };
  }
  if (scenario === "snapshot") {
    // 고정 질의. 같은 실행 안에서 두 번 불러 본문 해시가 같은지 본다.
    return { target: "law", query: "서민의 금융생활 지원에 관한 법률", display: "1" };
  }
  return { target: "law", query: "상법", display: "1" };
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request.headers.get("x-probe-auth"))) {
    return jsonNoStore({ error: "unauthorized" }, 401);
  }
  const requested = new URL(request.url).searchParams.get("scenario") ?? "";
  if (!(SCENARIOS as readonly string[]).includes(requested)) {
    return jsonNoStore({ error: "unknown scenario" }, 400);
  }
  const scenario = requested as Scenario;
  const referer = refererFor(scenario);

  const target = new URL(`${env.LAW_API_BASE}/lawSearch.do`);
  target.searchParams.set("OC", env.LAW_API_OC);
  target.searchParams.set("type", "JSON");
  for (const [key, value] of Object.entries(queryFor(scenario))) target.searchParams.set(key, value);

  const started = Date.now();
  let status = 0;
  let bytes = 0;
  let bodyHash: string | null = null;
  let contentType: string | null = null;
  let outcome = "unknown";
  let resultCode: string | null = null;

  try {
    const response = await fetch(target, {
      headers: {
        Accept: "application/json",
        ...(referer.value ? { Referer: referer.value } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    contentType = (response.headers.get("content-type") ?? "").split(";")[0] || null;
    const text = await response.text();
    bytes = Buffer.byteLength(text, "utf8");
    bodyHash = createHash("sha256").update(text, "utf8").digest("hex");
    if (!response.ok) {
      outcome = status === 429 ? "rate_limited" : status >= 500 ? "server_error" : "http_error";
    } else {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // 인증 실패 시 JSON 이 아니라 안내 HTML 이 온다.
        outcome = "auth_rejected";
      }
      if (outcome === "unknown") {
        const record = parsed as { result?: string } | null;
        if (typeof record?.result === "string") {
          outcome = "auth_rejected";
          resultCode = record.result.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
        } else {
          outcome = "ok";
        }
      }
    }
  } catch (error) {
    outcome = (error as Error)?.name === "TimeoutError" ? "timeout" : "network_error";
  }

  return jsonNoStore({
    schema_version: "1",
    scenario,
    referer_kind: referer.kind,
    referer_present: referer.value !== null,
    status,
    outcome,
    result_code: resultCode,
    content_type: contentType,
    bytes,
    body_sha256: bodyHash,
    ms: Date.now() - started,
    vercel_env: process.env.VERCEL_ENV ?? null,
    vercel_deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  }, 200);
}
