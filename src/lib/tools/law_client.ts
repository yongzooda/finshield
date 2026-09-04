/**
 * 법제처 국가법령정보 OPEN API 공통 클라이언트 (E-01~03).
 *
 * **⚠️ Referer 헤더가 인증의 일부다.** 법제처는 호출자를 `Referer`가 신청 시
 * 등록한 도메인과 일치하는지로 검증한다. 빠뜨리면 다음이 돌아온다:
 *
 *     {"result": "필수입력요소 검증에 실패하였습니다.",
 *      "msg": "필수 입력값이 존재하지 않습니다. 요청 URL을 확인해 주세요."}
 *
 * 파라미터 문제로 읽히지만 **원인은 Referer 부재다.** 2026.08.16 헤더 유무만
 * 바꿔가며 대조해 확정했다. 이 함수를 거치지 않는 호출 경로를 만들지 말 것 —
 * 그 순간 위 에러를 몇 시간 동안 디버깅하게 된다.
 *
 * IP 검증이 아니므로 Vercel의 동적 출구 IP는 문제되지 않는다. 다만 **배포
 * 도메인이 바뀌면 법제처 신청 정보의 도메인도 함께 바꿔야 한다.**
 *
 * 신청 계정과 도메인은 프로젝트마다 분리한다. 등록 도메인은
 * `LAW_API_REGISTERED_ORIGIN`으로 명시하고, 없으면 Vercel이 주는 배포
 * 도메인을 쓴다. 둘 다 없으면 실패한다 — 다른 프로젝트 도메인을 기본값으로
 * 두면 그 프로젝트를 사칭하는 요청이 된다.
 *
 * 타임아웃 10초 · 멱등 조회에 한해 1회 재시도 (EC-1).
 */

import "server-only";
import { env } from "../env";

const TIMEOUT_MS = 10_000;

export type LawApiTarget = "law" | "prec" | "expc";

export class LawApiError extends Error {
  constructor(
    message: string,
    readonly kind: "TIMEOUT" | "HTTP" | "SHAPE" | "AUTH",
  ) {
    super(message);
    this.name = "LawApiError";
  }
}

/**
 * 등록 도메인. Referer 대조 대상이라 배포 도메인과 반드시 일치해야 한다.
 *
 * 다른 프로젝트의 도메인을 기본값으로 두지 않는다. 그 값이 남아 있으면 로컬
 * 실행이 그 프로젝트를 사칭한 Referer 로 법제처를 호출하게 된다. 확인할 수
 * 없으면 조용히 다른 값을 쓰지 말고 실패한다.
 */
function registeredOrigin(): string {
  // LAW_API_BASE는 법제처 주소이므로 쓸 수 없다. 배포 도메인을 별도로 구성한다.
  const explicit = process.env.LAW_API_REGISTERED_ORIGIN?.trim();
  if (explicit) return explicit.endsWith("/") ? explicit : `${explicit}/`;
  // Vercel Production 배포는 자기 도메인을 환경에서 받는다.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (host) return `https://${host}/`;
  throw new LawApiError(
    "법제처 등록 도메인을 확인할 수 없다. LAW_API_REGISTERED_ORIGIN 에 신청 시 등록한 도메인을 설정할 것",
    "AUTH",
  );
}

async function once(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // 이 한 줄이 인증의 절반이다 (위 주석 참조)
        Referer: registeredOrigin(),
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new LawApiError(`HTTP ${res.status}`, "HTTP");

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // 인증 실패 시 JSON이 아니라 HTML 안내 페이지가 돌아온다
      throw new LawApiError(
        text.includes("미신청")
          ? "법제처 OPEN API 신청에 해당 법령종류가 체크되어 있지 않다"
          : "법제처가 JSON이 아닌 응답을 반환했다",
        "AUTH",
      );
    }
    const r = json as { result?: string; msg?: string };
    if (typeof r?.result === "string") {
      throw new LawApiError(
        `${r.result} ${r.msg ?? ""} — Referer 헤더(${registeredOrigin()})가 법제처 등록 도메인과 일치하는지 먼저 확인할 것`,
        "AUTH",
      );
    }
    return json;
  } catch (e) {
    if (e instanceof LawApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new LawApiError(`타임아웃 ${TIMEOUT_MS}ms 초과`, "TIMEOUT");
    }
    throw new LawApiError(String(e), "HTTP");
  } finally {
    clearTimeout(timer);
  }
}

function build(path: string, params: Record<string, string | number>): string {
  const u = new URL(`${env.LAW_API_BASE}/${path}`);
  u.searchParams.set("OC", env.LAW_API_OC);
  u.searchParams.set("type", "JSON");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

/** 조회는 멱등하므로 1회 재시도한다 (EC-1). 인증 실패는 재시도해도 같으므로 즉시 던진다 */
async function call(path: string, params: Record<string, string | number>): Promise<unknown> {
  const url = build(path, params);
  try {
    return await once(url);
  } catch (e) {
    if (e instanceof LawApiError && (e.kind === "AUTH" || e.kind === "SHAPE")) throw e;
    return await once(url);
  }
}

/** 목록 조회 — 법령·판례·법령해석례 */
export function lawSearch(
  target: LawApiTarget,
  params: Record<string, string | number>,
): Promise<unknown> {
  return call("lawSearch.do", { target, ...params });
}

/** 본문 조회 */
export function lawService(
  target: LawApiTarget,
  params: Record<string, string | number>,
): Promise<unknown> {
  return call("lawService.do", { target, ...params });
}

/** 법제처 응답은 단건이면 객체, 복수면 배열로 온다 — 항상 배열로 맞춘다 */
export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
