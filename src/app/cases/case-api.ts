"use client";

import { sessionFetch } from "../session-client";

/**
 * Case 읽기 요청.
 *
 * 화면은 상태만 다루고, 서버에 묻는 일은 여기로 모은다. 실패를 예외로 던지지
 * 않고 값으로 돌려주는 이유는, 화면이 실패를 지우지 않고 그대로 보여 주어야
 * 하기 때문이다.
 *
 * token 은 요청 헤더에만 싣는다. 주소에 넣지 않는다.
 */

export type CaseFetch<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

const ask = async <T,>(path: string, token: string): Promise<CaseFetch<T>> => {
  try {
    const response = await sessionFetch(path, token);
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (!response.ok || body === null) {
      const error = typeof body?.error === "string" ? body.error : "불러오지 못했습니다";
      return { ok: false, status: response.status, error };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: "연결이 끊어졌습니다. 다시 열어 주세요." };
  }
};

export const fetchCase = <T,>(caseId: string, token: string): Promise<CaseFetch<T>> =>
  ask<T>(`/api/finshield/cases/${encodeURIComponent(caseId)}`, token);

export const fetchCases = <T,>(token: string, cursor?: string | null): Promise<CaseFetch<T>> =>
  ask<T>(`/api/finshield/cases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, token);

export const fetchNotifications = <T,>(token: string): Promise<CaseFetch<T>> =>
  ask<T>("/api/finshield/notifications", token);

export const fetchProfile = <T,>(token: string): Promise<CaseFetch<T>> =>
  ask<T>("/api/finshield/profile", token);
