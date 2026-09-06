"use client";

/**
 * S-03 상담 대화 (SR-203) — 진행 상태를 클라이언트가 들고 간다.
 *
 * S-02와 달리 URL로 상태를 나를 수 없다. 되묻기가 몇 번 일어날지 에이전트가
 * 자율 결정하고(F-302), 세션 id가 요청마다 필요하기 때문이다.
 *
 * 화면에 **판단 비슷한 말을 쓰지 않는다** — 「가능성 높아 보입니다」류의 중간
 * 피드백은 금지다(화면 명세 S-03 금지사항). 판단은 S-04에서만 나온다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnswerInput } from "./answer-input";
import { useFocusOnChange } from "./announce";
import { keepSession, takeReconsult } from "./session-store";
import type { ConsultReply } from "./types";

/**
 * 중단 화면에서 「다시 시도」가 무엇을 하는가.
 *
 * - `RESEND` 방금 보낸 요청을 그대로 다시 보낸다. **진술을 다시 쓰게 하지 않는다.**
 *   연결 끊김·모델 장애처럼 내용은 멀쩡한데 왕복만 실패한 경우다
 * - `RESTART` 처음부터 다시 — 범위 밖 판정처럼 같은 내용을 또 보내봐야 답이 같은 경우
 * - `false` 다시 시도할 길이 없다 (세션 만료)
 */
type Retry = "RESEND" | "RESTART" | false;

type Phase =
  /** 민감정보 별도 동의 (F-602) — 건강정보가 섞일 수 있으므로 진술 입력 전에 받는다 */
  | { name: "CONSENT" }
  /** `reentry`가 있으면 유보 이어가기(F-308 확장) — 동의·세션 생성을 건너뛴다 */
  | { name: "STATEMENT"; notice?: string; reentry?: string[] }
  | { name: "ASK"; reply: Extract<ConsultReply, { kind: "ASK" }> }
  | { name: "READY"; message?: string }
  | { name: "STOPPED"; title: string; message: string; retry: Retry };

const MAX_CHARS = 4000;

async function post(body: unknown): Promise<ConsultReply> {
  const res = await fetch("/api/consult", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as ConsultReply;
}

export function ConsultFlow() {
  const [phase, setPhase] = useState<Phase>({ name: "CONSENT" });
  const [busy, setBusy] = useState(false);
  /**
   * 지금까지 주고받은 내용 — S-03 필수 구성 「대화 스레드」의 구현체.
   * 화면 자체는 「한 화면에 하나의 질문」(A11Y-4)을 지키므로 스레드는
   * 접이식으로 둔다. 이용자가 「내가 뭐라고 답했더라」를 확인할 수 없으면
   * 여러 턴 뒤에는 답을 번복할지조차 판단할 수 없다.
   */
  const [transcript, setTranscript] = useState<{ q: string; a: string }[]>([]);
  /** 봉인된 세션. 응답마다 갱신본이 오므로 최신 것을 들고 있어야 한다 */
  const session = useRef<string | null>(null);
  /**
   * 마지막으로 보낸 요청 — 실패했을 때 **그대로 다시 보내기 위해서** 들고 있다.
   *
   * 예전에는 중단 화면의 「다시 시도하기」가 `location.reload()`였다. 그러면
   * 이 컴포넌트의 상태가 통째로 날아가 동의 화면부터 다시 시작한다 —
   * **폰에서 4,000자를 다시 쓰라는 뜻이다.** 인앱 브라우저에서 상담 한 턴
   * (P95 20초) 도중 다른 앱을 잠깐 보면 실제로 일어나는 일이라 (N-701)
   * 여기서 되살릴 수 있어야 한다.
   */
  const lastRequest = useRef<Record<string, unknown> | "CONSENT" | null>(null);

  /**
   * 유보 이어가기 부팅 (F-308 확장) — S-04에서 재봉인 세션을 들고 왔으면 동의를
   * 다시 받지 않는다(세션 안에 동의가 이미 있다).
   *
   * **첫 렌더에서는 판정할 수 없다** — `sessionStorage`는 브라우저에만 있다.
   * 그래서 서버 렌더는 동의 화면이고, 마운트 뒤에 이어가기로 바뀐다.
   * S-04의 진입 판정(`judgment-progress.tsx`의 `begin`)과 같은 상황·같은 꼴이다.
   */
  const booted = useRef(false);
  const boot = useCallback(() => {
    const r = takeReconsult();
    if (!r) return;
    session.current = r.token;
    setPhase({ name: "STATEMENT", reentry: r.needed });
  }, []);

  useEffect(() => {
    // 개발 모드의 이중 마운트에서 운반값을 두 번 읽지 않는다 (한 번 읽으면 지워진다)
    if (booted.current) return;
    booted.current = true;
    boot();
  }, [boot]);

  /** 응답 한 건을 화면 상태로 옮긴다 — 분기가 한곳에 모여 있어야 빠뜨리지 않는다 */
  const apply = useCallback((r: ConsultReply) => {
    // 응답이 새 봉인을 실어 오면 즉시 교체한다 — 놓치면 다음 요청이 옛 상태로 간다
    if ("session" in r && typeof r.session === "string") session.current = r.session;

    switch (r.kind) {
      case "ASK":
        setPhase({ name: "ASK", reply: r });
        return;
      case "READY":
        // 판단 화면이 이어받을 수 있게 봉인을 넘긴다
        if (session.current) keepSession(session.current);
        setPhase({ name: "READY", message: r.message });
        return;
      case "OUT_OF_SCOPE":
        // 거절이지 오류가 아니다. 대화가 끊긴 느낌을 주지 않는다 (F-604).
        // 같은 진술을 다시 보내도 같은 답이 오므로 처음부터가 맞다
        setPhase({ name: "STOPPED", title: "이 내용은 다루지 못합니다", message: r.message, retry: "RESTART" });
        return;
      case "PII_RESIDUAL":
      case "INVALID":
        // 이어가기 도중의 반려면 이어가기 화면으로 되돌린다 — 표식을 잃으면
        // 배너와 문구가 신규 상담처럼 바뀌어 이용자가 길을 잃는다
        setPhase((p) => ({
          name: "STATEMENT",
          notice: r.message,
          reentry: p.name === "STATEMENT" ? p.reentry : undefined,
        }));
        return;
      case "QUOTA":
      case "MODEL_DOWN":
        // 내용은 멀쩡하다 — 잠시 후 같은 요청을 그대로 다시 보내면 된다
        setPhase({ name: "STOPPED", title: "지금은 상담을 시작할 수 없습니다", message: r.message, retry: "RESEND" });
        return;
      case "EXPIRED":
        session.current = null;
        setPhase({ name: "STOPPED", title: "상담 내용이 사라졌습니다", message: r.message, retry: false });
        return;
      default:
        setPhase((p) => ({
          name: "STATEMENT",
          notice: "다시 한 번 말씀해 주세요.",
          reentry: p.name === "STATEMENT" ? p.reentry : undefined,
        }));
    }
  }, []);

  /** 왕복이 아예 실패했을 때 — 내용은 남아 있으니 다시 보낼 길을 준다 */
  const dropped = useCallback(() => {
    setPhase({
      name: "STOPPED",
      title: "연결이 끊겼습니다",
      message:
        "다른 앱을 보시는 동안 연결이 끊길 수 있습니다. 말씀해 주신 내용은 아직 " +
        "남아 있습니다. 아래에서 다시 시도해 주세요.",
      retry: "RESEND",
    });
  }, []);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      lastRequest.current = body;
      setBusy(true);
      try {
        apply(await post({ ...body, session: session.current }));
      } catch {
        dropped();
      } finally {
        setBusy(false);
      }
    },
    [apply, dropped],
  );

  const agree = useCallback(async () => {
    lastRequest.current = "CONSENT";
    setBusy(true);
    try {
      const r = await post({ consent: true });
      if (r.kind === "SESSION") {
        session.current = r.session;
        setPhase({ name: "STATEMENT" });
      } else {
        apply(r);
      }
    } catch {
      dropped();
    } finally {
      setBusy(false);
    }
  }, [apply, dropped]);

  /** 마지막 요청을 그대로 다시 — 진술·답변을 다시 입력하게 하지 않는다 */
  const resend = useCallback(() => {
    const last = lastRequest.current;
    if (last === null) {
      // 보낸 것이 없다. 동의 화면으로 되돌리는 편이 정직하다
      setPhase({ name: "CONSENT" });
      return;
    }
    if (last === "CONSENT") {
      void agree();
      return;
    }
    void send(last);
  }, [agree, send]);

  if (phase.name === "CONSENT") return <Consent busy={busy} onAgree={agree} />;
  if (phase.name === "STATEMENT")
    return (
      <Statement
        busy={busy}
        notice={phase.notice}
        reentry={phase.reentry}
        onSubmit={(t) => {
          setTranscript([{ q: phase.reentry ? "보탠 내용" : "있었던 일", a: t }]);
          send({ statement: t });
        }}
      />
    );
  if (phase.name === "ASK")
    return (
      <Ask
        reply={phase.reply}
        busy={busy}
        transcript={transcript}
        onAnswer={(value, display) => {
          setTranscript((prev) => [...prev, { q: phase.reply.question, a: display }]);
          send({ slot: phase.reply.slot, value });
        }}
      />
    );
  if (phase.name === "READY") return <Ready message={phase.message} />;
  return <Stopped {...phase} busy={busy} onResend={resend} />;
}

// ─────────────────────────────────────── F-602 민감정보 별도 동의

function Consent({ busy, onAgree }: { busy: boolean; onAgree: () => void }) {
  return (
    <Frame title="시작하기 전에 하나만 확인할게요">
      <p className="leading-relaxed">
        말씀하시는 내용에 <strong>건강에 관한 정보</strong>가 들어갈 수 있습니다. 보험금 지급을
        다투는 경우 병명이나 진료 사실이 함께 나오기 때문입니다.
      </p>
      <p className="mt-4 leading-relaxed">
        이런 정보는 개인정보보호법에 따라 <strong>따로 동의를 받아야</strong> 처리할 수 있습니다.
        프리케이스는 입력하신 내용을 <strong>저장하지 않고</strong>, 상담이 끝나거나 30분 동안
        입력이 없으면 즉시 지웁니다. 회원가입도 없습니다.
      </p>
      <p className="mt-4 leading-relaxed text-fg-muted">
        동의하지 않으셔도 됩니다. 그 경우 병명·진료 내용은 빼고 말씀해 주시면 됩니다.
      </p>

      <div className="mt-8 space-y-3">
        <button
          type="button"
          disabled={busy}
          onClick={onAgree}
          className="flex w-full items-center justify-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg disabled:opacity-50"
        >
          동의하고 시작하기
        </button>
        <Link
          href="/precheck"
          className="flex w-full items-center justify-center rounded-lg border-2 border-border px-7 py-3 text-[1.05rem] font-bold text-fg no-underline"
        >
          동의하지 않고 「가입 전 확인」 보기
        </Link>
      </div>
    </Frame>
  );
}

// ─────────────────────────────────────── 진술 입력 (F-301)

/** 테스트가 직접 렌더한다 — 이어가기 변형이 신규 문구를 건드리지 않는 것을 고정 */
export function Statement({
  busy,
  notice,
  reentry,
  onSubmit,
}: {
  busy: boolean;
  notice?: string;
  /** 유보 이어가기(F-308 확장) — 직전 유보에서 안내한 «필요 자료» 목록 */
  reentry?: string[];
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const over = text.length > MAX_CHARS;

  return (
    <Frame title={reentry ? "이어서 진행합니다" : "어떤 일이 있었는지 말씀해 주세요"}>
      {reentry ? (
        <>
          <p className="leading-relaxed text-fg-muted">
            앞서 말씀해 주신 내용과 답변은 <strong className="text-fg">그대로 남아
            있습니다.</strong> 지난번에는 아래 자료가 확인되면 판단이 달라질 수 있다고
            안내드렸습니다.
          </p>
          <ul className="mt-4 space-y-2">
            {reentry.map((n, i) => (
              <li key={`${i}-${n}`} className="rounded-md border border-border bg-bg-subtle px-4 py-3 leading-relaxed text-fg">
                {n}
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-relaxed text-fg-muted">
            확인하신 내용이나 새로 아신 사실을 적어 주세요. 일부만 확인하셨어도 됩니다.
          </p>
        </>
      ) : (
        <p className="leading-relaxed text-fg-muted">
          언제, 어디서, 무엇에 가입했고, 무엇이 문제인지 편하게 적어 주세요. 문장이 다듬어지지
          않아도 괜찮습니다. 약관 내용을 옮겨 적으셔도 됩니다.
        </p>
      )}

      {notice && (
        <p role="alert" className="mt-4 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
          {notice}
        </p>
      )}

      <label htmlFor="statement" className="mt-6 block font-bold text-fg">
        {reentry ? "보탠 내용" : "있었던 일"}
      </label>
      <textarea
        id="statement"
        placeholder={
          reentry
            ? "예) 보험사에 요청해서 해피콜 녹취를 들어봤는데, 원금 손실 설명이 없었습니다."
            : "예) 2019년 5월에 은행 창구에서 ELS에 가입했는데, 원금이 보장된다고 들었습니다. 지금 원금의 40%가 손실됐습니다."
        }
        rows={9}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        className="mt-2 block w-full rounded-lg border-2 border-border-strong px-4 py-3 text-[1.05rem] leading-relaxed text-fg"
      />
      <p className={"mt-2 " + (over ? "text-warn-fg" : "text-fg-muted")}>
        {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}자
      </p>

      {/*
        약관·상품설명서를 넣는 길 (G).

        파일 업로드를 두지 않는다. 1차 범위 밖이기도 하지만 더 큰 이유는
        **파일을 받으면 그걸 어딘가에 둬야 한다**는 것이다. 이 서비스가
        「아무것도 보관하지 않습니다」라고 말할 수 있는 근거가 거기서 무너진다.

        대신 붙여넣기 경로를 **분명하게** 안내한다. 「옮겨 적으셔도 됩니다」
        한 줄로는 할 수 있다는 사실이 전달되지 않는다 — 무엇을, 어디서,
        얼마나 가져오면 되는지까지 적는다.
      */}
      <details className="group mt-4 rounded-lg border border-border px-5 py-4">
        <summary className="cursor-pointer list-none font-bold text-fg">
          <span aria-hidden="true" className="mr-2 inline-block transition-transform group-open:rotate-90">
            ▶
          </span>
          약관이나 상품설명서 내용을 같이 넣고 싶다면
        </summary>
        <div className="mt-3 space-y-3 leading-relaxed text-fg-muted">
          <p>
            <strong className="text-fg">위 칸에 그대로 붙여 넣으시면 됩니다.</strong> 문제가
            된 조항만 골라 넣으셔도 충분하고, 한 번에 {MAX_CHARS.toLocaleString()}자까지
            들어갑니다. 길면 나눠서 보내셔도 됩니다.
          </p>
          <ul className="space-y-2">
            <li>
              · <strong className="text-fg">이메일·문자로 받은 약관</strong> — 해당 부분을
              길게 눌러 복사한 뒤 붙여 넣으세요.
            </li>
            <li>
              · <strong className="text-fg">PDF 파일</strong> — 파일을 열어 글자를 선택해
              복사하면 됩니다.
            </li>
            <li>
              · <strong className="text-fg">종이 약관</strong> — 문제가 된 문장만 손으로 옮겨
              적으셔도 됩니다.
            </li>
          </ul>
          {/* 파일을 안 받는 사유는 남긴다 — 없는 기능으로만 두면 「못 하는구나」로 읽힌다 (PR #96) */}
          <p>
            <strong className="text-fg">파일은 받지 않습니다.</strong> 아무것도 보관하지 않는
            서비스라서입니다. 붙여 넣으신 글도 판단이 끝나면 사라집니다.
          </p>
        </div>
      </details>

      {/* F-601 고지 — 입력창 하단 (화면 명세 S-03) */}
      <p className="mt-4 leading-relaxed text-fg-muted">
        이름·연락처·주민등록번호·계좌번호는 <strong>보내기 전에 자동으로 가려집니다.</strong>{" "}
        판단에는 그런 정보가 필요하지 않습니다.
      </p>

      <button
        type="button"
        disabled={busy || text.trim().length === 0 || over}
        onClick={() => onSubmit(text)}
        className="mt-6 flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg disabled:opacity-50"
      >
        {busy ? "읽고 있습니다…" : "보내기"}
      </button>

      {busy && <Progress />}
    </Frame>
  );
}

// ─────────────────────────────────────── 되묻기 (F-302 · A11Y-4)

function Ask({
  reply,
  busy,
  transcript,
  onAnswer,
}: {
  reply: Extract<ConsultReply, { kind: "ASK" }>;
  busy: boolean;
  transcript: { q: string; a: string }[];
  onAnswer: (value: unknown, display: string) => void;
}) {
  return (
    <Frame title={reply.question}>
      <p className="text-fg-muted">
        몇 가지만 더 여쭤볼게요. 모르시면 「기억나지 않습니다」를 고르셔도 괜찮습니다.
      </p>

      <div className="mt-7">
        {reply.form ? (
          <AnswerInput form={reply.form} disabled={busy} onAnswer={onAnswer} />
        ) : (
          <p className="rounded-md border border-border bg-bg-subtle px-4 py-4 leading-relaxed">
            이 질문은 아직 답변 형식을 준비하지 못했습니다. 처음부터 다시 시도해 주세요.
          </p>
        )}
      </div>

      {busy && <Progress />}

      {/* 대화 스레드 (S-03) — 기본 접힘. 질문 하나가 화면의 주인공이어야 한다 */}
      {transcript.length > 0 && (
        <details className="group mt-8 rounded-xl border border-border bg-bg-subtle px-5 py-3">
          <summary className="flex min-h-12 cursor-pointer list-none items-center font-bold text-fg-muted">
            <span
              aria-hidden="true"
              className="mr-2 inline-block shrink-0 text-fg-muted transition-transform group-open:rotate-90"
            >
              ▶
            </span>

            지금까지 말씀하신 내용 보기 ({transcript.length}가지)
          </summary>
          <dl className="mt-2 space-y-3 border-t border-border pt-4">
            {transcript.map((t, i) => (
              <div key={i}>
                <dt className="text-[0.95rem] text-fg-muted">{t.q}</dt>
                <dd className="mt-0.5 leading-relaxed text-fg">{t.a}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </Frame>
  );
}

// ─────────────────────────────────────── 완료 → S-04

function Ready({ message }: { message?: string }) {
  return (
    <Frame title="말씀해 주신 내용을 다 확인했습니다">
      {message && <p className="leading-relaxed">{message}</p>}
      <p className="mt-4 leading-relaxed text-fg-muted">
        이제 관련 법령과 비슷한 분쟁조정 사례를 찾아 성립 가능성을 살펴봅니다. 자료를 하나씩
        확인하기 때문에 <strong>2분 정도 걸릴 수 있습니다.</strong>
      </p>
      <p className="mt-6">
        <Link
          href="/judgment"
          className="inline-flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg no-underline"
        >
          살펴보기 시작
        </Link>
      </p>
    </Frame>
  );
}

// ─────────────────────────────────────── 중단 (범위 밖·모델 장애·만료)

function Stopped({
  title,
  message,
  retry,
  busy,
  onResend,
}: {
  title: string;
  message: string;
  retry: Retry;
  busy: boolean;
  onResend: () => void;
}) {
  return (
    <Frame title={title}>
      <p className="leading-relaxed">{message}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {retry && (
          <button
            type="button"
            disabled={busy}
            onClick={retry === "RESEND" ? onResend : () => window.location.reload()}
            className="flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg disabled:opacity-50"
          >
            {retry === "RESEND" ? "다시 시도하기" : "처음부터 다시 하기"}
          </button>
        )}
        <Link
          href="/precheck"
          className="flex items-center rounded-lg border-2 border-border px-7 py-3 text-[1.05rem] font-bold text-fg no-underline"
        >
          가입 전 확인 보기
        </Link>
        {/* 가입 뒤 축의 첫 화면은 /precase 다. 루트는 FinShield 첫 화면이다. */}
        <Link
          href="/precase"
          className="flex items-center rounded-lg border-2 border-border px-7 py-3 text-[1.05rem] font-bold text-fg no-underline"
        >
          처음으로
        </Link>
      </div>
    </Frame>
  );
}

/** 무단계 스피너를 두지 않는다 — 지금 무엇을 하는지 문장으로 (화면 4.3) */
function Progress() {
  return (
    <p aria-live="polite" className="mt-5 rounded-md border border-border bg-bg-subtle px-4 py-3 leading-relaxed">
      말씀해 주신 내용을 읽고 있습니다. 잠시만 기다려 주세요.
    </p>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  // 제목이 바뀌면 포커스를 옮긴다 — 스크린리더 이용자에게 화면 전환을 알린다 (A11Y-7)
  const heading = useFocusOnChange(title);
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg"
      >
        {title}
      </h1>
      <div className="mt-4">{children}</div>
    </div>
  );
}
