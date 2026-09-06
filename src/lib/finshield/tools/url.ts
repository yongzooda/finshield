/**
 * parse_url_host — 문자열 수준 URL 분석.
 *
 * E-022 가 P0 에서 URL 분석을 문자열 수준으로 제한한다. 그래서 이 도구는
 * 주소를 열지 않는다. 접속하면 상대가 우리를 탐지할 수 있고, 응답 내용이
 * 모델 입력으로 들어오면 주입 통로가 된다.
 *
 * 판단도 하지 않는다. 호스트와 구성 요소를 뜯어 사실만 남기고, 그것이 공식
 * 채널인지는 등록부를 보는 다른 도구가 정한다. RES-007 에 따라 주소를 모델이
 * 지어내는 일은 어느 경로에서도 허용하지 않는다.
 */

import type { ToolOutcome } from "./runtime";

const PUNYCODE = /(^|\.)xn--/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export type UrlFacts = {
  raw: string;
  parsed: boolean;
  scheme: string | null;
  host: string | null;
  registrable_suffix: string | null;
  is_ip_literal: boolean;
  has_punycode: boolean;
  has_userinfo: boolean;
  has_port: boolean;
  path_depth: number;
  /** 눈으로 헷갈리기 쉬운 문자가 섞였는가. 판단이 아니라 관측이다. */
  mixed_script: boolean;
  /** 정규화 전 원문에 적혀 있던 호스트. punycode 로 바뀌기 전 모습이다. */
  raw_host: string | null;
};

const HANGUL_OR_CJK = /[ㄱ-힣一-鿿]/;
const LATIN = /[A-Za-z]/;

/**
 * URL 표준은 국제화 호스트를 punycode 로 정규화한다. 그래서 파싱된 hostname 만
 * 보면 한글이 섞였다는 사실이 사라진다. 눈으로 헷갈리는 주소를 관측하려면
 * 정규화 전 원문에서 호스트 자리를 그대로 떼어 봐야 한다.
 */
const rawHostOf = (raw: string): string | null => {
  const withoutScheme = raw.trim().replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "");
  const authority = withoutScheme.split(/[/?#]/)[0] ?? "";
  const afterUserinfo = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
  const host = afterUserinfo.replace(/:\d+$/, "");
  return host.length > 0 ? host : null;
};

export const parseUrlFacts = (raw: string): UrlFacts => {
  const rawHost = rawHostOf(raw);
  const base: UrlFacts = {
    raw, parsed: false, scheme: null, host: null, registrable_suffix: null,
    is_ip_literal: false, has_punycode: false, has_userinfo: false, has_port: false,
    path_depth: 0, mixed_script: false, raw_host: rawHost,
  };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return base;
  }
  const host = url.hostname;
  const labels = host.split(".");
  return {
    ...base,
    parsed: true,
    scheme: url.protocol.replace(/:$/, ""),
    host,
    registrable_suffix: labels.length >= 2 ? labels.slice(-2).join(".") : null,
    is_ip_literal: IPV4.test(host) || host.startsWith("["),
    has_punycode: PUNYCODE.test(host),
    has_userinfo: url.username !== "" || url.password !== "",
    has_port: url.port !== "",
    path_depth: url.pathname.split("/").filter(Boolean).length,
    mixed_script: rawHost !== null && HANGUL_OR_CJK.test(rawHost) && LATIN.test(rawHost),
  };
};

/**
 * 관측 결과는 근거가 아니다. 사용자가 낸 문자열은 공식 출처가 아니므로
 * Snapshot 이 되지 않는다. 이 도구는 사실만 남기고, 그 주소가 공식 채널인지는
 * 등록부를 보는 다른 도구가 정한다. 그래야 「공식 채널이 아니다」라는 판단에
 * 실제 공식 자료가 붙는다.
 */
export const parseUrlHost = async (input: unknown): Promise<ToolOutcome> => {
  const urls = Array.isArray((input as { urls?: unknown })?.urls)
    ? ((input as { urls: unknown[] }).urls.filter((value) => typeof value === "string") as string[])
    : [];
  const facts = urls.slice(0, 20).map((raw) => parseUrlFacts(raw));
  return {
    items: [],
    observations: { schema_version: "1", kind: "url_facts", facts },
    provenanceComplete: true,
    candidateCount: urls.length,
  };
};
