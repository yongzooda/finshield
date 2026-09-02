/**
 * MCP 서버 연결 안내 (SR-X08).
 *
 * ## 이 화면의 독자는 다르다
 *
 * 나머지 화면은 고령층 소비자가 읽는다. 여기는 **개발자가 읽는다.** 그래서
 * 본문 크기·대비 같은 접근성 기준은 그대로 지키되, 용어를 풀어 쓰지 않고
 * 붙여 넣을 설정을 먼저 준다. 「무엇을 클릭하세요」가 아니라 「이걸 복사하세요」다.
 *
 * ## 도구 목록을 코드에서 가져온다
 *
 * 도구 이름·설명을 이 파일에 다시 적지 않는다. `MCP_TOOLS`를 그대로 읽는다 —
 * 도구가 늘거나 설명이 바뀌면 이 화면이 따라온다. 문서와 구현이 어긋나는 것을
 * 사람 손에 맡기지 않는다 (데모 문구가 코드와 어긋났던 DR-107과 같은 실수를
 * 반복하지 않는다).
 *
 * 모델을 부르지 않는 정적 화면이라 장애와 무관하게 뜬다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { PROTOCOL_VERSIONS, SERVER_INFO } from "@/lib/mcp/server";

export const metadata: Metadata = {
  title: "MCP 서버 — 프리케이스",
  description:
    "프리케이스가 쓰는 판단 근거 도구 5종을 MCP로 공개합니다. 읽기 전용이며, 조문·판례·조정례·집계를 출처와 함께 돌려줍니다.",
};

const ENDPOINT = "https://precase.vercel.app/api/mcp";

const CLAUDE_CODE_CMD = `claude mcp add --transport http precase ${ENDPOINT}`;

const CONFIG_JSON = `{
  "mcpServers": {
    "precase": {
      "type": "http",
      "url": "${ENDPOINT}"
    }
  }
}`;

const CURL = `curl -X POST ${ENDPOINT} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

/** 가로로 긴 코드가 본문을 밀지 않도록 자기 안에서만 스크롤한다 */
function Code({ children, label }: { children: string; label: string }) {
  return (
    <div className="mt-3">
      <p className="font-bold text-fg">{label}</p>
      {/* 본문과 같은 18px를 유지한다 — 길면 자기 컨테이너 안에서 가로로 민다 */}
      <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-subtle px-4 py-3 leading-relaxed text-fg">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-[1.35rem] font-bold tracking-tight text-fg">
        {title}
      </h2>
      <div className="mt-4 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export default function McpGuide() {
  const external = MCP_TOOLS.filter((t) => t.callsExternalApi).map((t) => t.name);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-[0.95rem] font-bold text-accent">
        개발자용
      </p>
      <h1 className="mt-3 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
        MCP 서버
      </h1>
      <p className="mt-4 text-[1.15rem] leading-relaxed text-fg-muted">
        프리케이스가 판단에 쓰는 <strong className="text-fg">도구 {MCP_TOOLS.length}종</strong>을
        그대로 공개합니다. 조문·판례·조정례·사전 집계를 <strong className="text-fg">출처와
        함께</strong> 돌려주므로, 다른 서비스에서도 근거를 지어내지 않고 붙일 수 있습니다.
      </p>

      <div className="mt-6 rounded-md border-l-4 border-accent bg-accent-soft px-4 py-3">
        <p className="leading-relaxed text-navy">
          <strong>다섯 개 전부 읽기 전용입니다.</strong> 쓰기 연산이 없고, 인증을 받지
          않으며, 요청 본문을 저장하지 않습니다. 읽는 대상도 전부 공개 자료입니다 —
          법제처 국가법령정보와 공개된 분쟁조정 사례입니다.
        </p>
      </div>

      <Section id="connect" title="연결">
        <p className="text-fg-muted">
          Streamable HTTP 전송을 씁니다. 세션을 만들지 않는 요청-응답 서버라 설정에
          넣을 것은 주소 하나뿐입니다.
        </p>
        <Code label="Claude Code">{CLAUDE_CODE_CMD}</Code>
        <Code label="설정 파일에 직접 넣을 때">{CONFIG_JSON}</Code>
        <Code label="붙기 전에 확인만 해볼 때">{CURL}</Code>
        <p className="text-fg-muted">
          지원 프로토콜 버전 — {PROTOCOL_VERSIONS.join(" · ")}. 서버 이름은{" "}
          <code className="rounded bg-bg-subtle px-1.5 py-0.5">{SERVER_INFO.name}</code>입니다.
        </p>
      </Section>

      <Section id="tools" title={`도구 ${MCP_TOOLS.length}종`}>
        <ul className="space-y-5">
          {MCP_TOOLS.map((t) => (
            <li key={t.name} className="rounded-lg border border-border px-5 py-4">
              <p className="text-[1.1rem] font-bold text-fg">
                <code className="text-navy">{t.name}</code>
                <span className="ml-2 font-normal text-fg-muted">{t.title}</span>
              </p>
              <p className="mt-1 text-fg-muted">
                {t.callsExternalApi
                  ? "법제처 API를 호출합니다 (외부 의존)"
                  : "외부 API를 쓰지 않습니다 (DB 조회만)"}
              </p>
              {/* 설명 원문을 그대로 싣는다 — 모델이 읽는 문장과 사람이 읽는 문장이 같아야 한다 */}
              <p className="mt-3 whitespace-pre-line leading-relaxed text-fg">{t.description}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="honest" title="쓰기 전에 알아야 할 것">
        <p className="text-fg-muted">
          도구를 내주면서 결함을 숨기면 그 근거를 쓰는 쪽이 대신 틀립니다. 아는 것을
          적어 둡니다.
        </p>

        <div className="mt-4 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3">
          <p className="font-bold text-warn-fg">
            search_precedent — citable이 false면 인용하지 마세요
          </p>
          <p className="mt-1 leading-relaxed text-warn-fg">
            법제처 판례 검색이 부분일치로 동작합니다. <code>2010다76368</code>을 조회하면
            무관한 사건이 상위에 옵니다(실측). 이 도구는 사건번호를 정확 대조해 일치하는
            것만 <code>exact</code>에 담습니다. <code>candidates</code>는 사람이 눈으로
            확인하라고 주는 목록이지 인용 대상이 아닙니다.
          </p>
        </div>

        <div className="mt-3 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3">
          <p className="font-bold text-warn-fg">
            analyze_risk_pattern — granularity를 먼저 보세요
          </p>
          <p className="mt-1 leading-relaxed text-warn-fg">
            요청한 조합에 표본이 없으면 축을 넓혀 가며 물러나 읽습니다. 「TM×고령」을
            물었는데 <code>OVERALL</code> 집계가 돌아올 수 있고, 그 사실은{" "}
            <code>granularity</code>와 <code>matched</code>에 적혀 있습니다. 수치만 꺼내
            쓰면 없는 표본을 있는 것처럼 씁니다.
          </p>
        </div>

        <div className="mt-3 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3">
          <p className="font-bold text-warn-fg">lookup_statute — 폴백이면 그렇다고 나옵니다</p>
          <p className="mt-1 leading-relaxed text-warn-fg">
            법제처 API가 실패하면 캐시나 내장 스냅샷으로 내려갑니다.{" "}
            <code>source</code>와 <code>isFallback</code>에 그 사실이 남으므로 화면에 쓸 때
            감추지 마세요. <code>checkedAt</code>은 언제 확인한 값인지입니다.
          </p>
        </div>
      </Section>

      <Section id="limits" title="상한">
        <p className="text-fg-muted">
          공개해 두고 상한이 없으면 남의 호출이 이용자의 조회를 밀어냅니다. 소비자
          화면과 같은 <strong className="text-fg">IP 분당 상한</strong>을 그대로 적용합니다.
          넘으면 429와 함께 얼마나 기다리면 되는지 돌려줍니다.
        </p>
        <p className="text-fg-muted">
          외부 API를 부르는 것은 {external.join(" · ")} 둘뿐이고, 나머지 셋은 DB 조회라
          법제처가 멈춰도 동작합니다.
        </p>
      </Section>

      <Section id="privacy" title="무엇을 저장하나">
        <p className="text-fg-muted">
          <strong className="text-fg">요청 본문을 저장하지 않습니다.</strong> 남기는 것은
          어떤 도구가 몇 번 불렸는지에 대한 카운터뿐입니다. 프리케이스는 이용자 상담
          내용을 애초에 저장하지 않으므로, 이 도구들이 읽을 수 있는 곳에 개인의 진술이
          존재하지 않습니다.
        </p>
        <p className="text-fg-muted">
          자세한 것은{" "}
          <Link href="/privacy" className="text-accent underline">
            개인정보 처리방침
          </Link>
          에 적어 두었습니다.
        </p>
      </Section>

      <Section id="license" title="출처 표기">
        <p className="text-fg-muted">
          이 도구가 돌려주는 것은 <strong className="text-fg">공공 자료의 가공물</strong>
          입니다. 결과를 인용할 때 원 출처(법제처 국가법령정보 공동활용, 금융감독원
          분쟁조정사례)를 함께 밝혀 주세요. 프리케이스는 특정 금융회사를 평가하지
          않으며, 도구 결과도 그렇게 쓰이지 않기를 바랍니다.
        </p>
        <p className="text-fg-muted">
          도구가 돌려주지 않은 조문·판례·사례·통계를 만들어 붙이지 마세요. 이 영역에서
          지어낸 근거는 사람에게 실제 손해를 입힙니다.
        </p>
      </Section>
    </div>
  );
}
