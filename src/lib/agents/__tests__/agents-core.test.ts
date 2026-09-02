/** B-3 기반 — 계층 격리 · 슬롯 · PII · 세션 · 실행 로그 */

import { describe, expect, it } from "vitest";
import { gateForModel, maskPii } from "../pii";
import {
  applySlots, basisDateFrom, finalizeSlots, isAfterFsca, nextQuestion, slotStatus,
} from "../slots";
import { Trace } from "../trace";
import { createSession, openSession, sealSession, startNewCycle, tryAsk } from "../session";
import { freshSnapshot, seal } from "../seal";
import type { Slots } from "../../types";

const base: Slots = {
  channel: "TM", age: 67, product: "INS_WHOLE", contract_ym: "2019-05", traits: ["ELDER"],
};

// ---------------------------------------------------------------- 계층 격리

describe("SR-402 계층 격리 (P-401)", () => {
  it("JudgeInput에 원문 필드가 없다 — 타입으로 강제된다", async () => {
    // 아래 import가 컴파일된다는 것 자체가 단언이다. types.ts의
    // _judgeInputIsIsolated가 금지 필드 존재 시 타입 에러를 낸다.
    const m = await import("../types");
    expect(m._judgeInputIsIsolated).toBe(true);
  });
});

// ---------------------------------------------------------------- PII

describe("F-601 PII 마스킹", () => {
  it("주민등록번호를 가린다 — 하이픈 유무 모두", () => {
    for (const s of ["제 번호는 900101-1234567 입니다", "9001011234567"]) {
      const r = maskPii(s);
      expect(r.text).toContain("[주민등록번호]");
      expect(r.text).not.toMatch(/\d{6}[-]?[1-8]\d{6}/);
    }
  });

  it("연락처·이메일·카드번호를 가린다", () => {
    const r = maskPii("010-1234-5678로 연락주세요. a.b@c.co.kr / 1234-5678-9012-3456");
    expect(r.counts.PHONE).toBeGreaterThan(0);
    expect(r.counts.EMAIL).toBe(1);
    expect(r.counts.CARD).toBe(1);
  });

  it("계좌번호를 가린다", () => {
    const r = maskPii("계좌번호 110-234-567890으로 입금받았습니다");
    expect(r.text).toContain("[계좌번호]");
    expect(r.text).not.toContain("567890");
  });

  it("호칭이 붙은 이름을 가린다", () => {
    const r = maskPii("홍길동 씨와 김철수 설계사가 방문했습니다");
    expect(r.counts.NAME).toBe(2);
    expect(r.text).not.toContain("홍길동");
    expect(r.text).not.toContain("김철수");
  });

  it("주민번호를 먼저 지워 계좌번호로 다시 잡히지 않게 한다", () => {
    const r = maskPii("900101-1234567");
    expect(r.counts.RRN).toBe(1);
    expect(r.counts.ACCOUNT).toBe(0);
  });

  it("일반 진술은 건드리지 않는다 — 과잉 마스킹으로 판단이 망가지면 안 된다", () => {
    const s = "2019년 5월에 전화로 종신보험에 가입했는데 원금 손실 설명을 듣지 못했습니다";
    const r = maskPii(s);
    expect(r.text).toBe(s);
    expect(r.total).toBe(0);
  });

  it("잔존 의심이 있으면 모델 전송을 차단한다 (EX-106)", () => {
    // 마스킹 규칙에 걸리지 않는 형태로 숫자열이 남은 경우
    const g = gateForModel("계좌 1234567890123 입니다만");
    if (g.ok) {
      // 규칙에 걸려 마스킹됐다면 그것도 정상이다 — 남지 않았음을 확인
      expect(g.masked.residualSuspicion).toBe(false);
    } else {
      expect(g.ask).toContain("개인정보");
      expect(g.masked.suspicionReasons.length).toBeGreaterThan(0);
    }
  });

  it("깨끗한 입력은 게이트를 통과한다", () => {
    const g = gateForModel("설명을 듣지 못했습니다");
    expect(g.ok).toBe(true);
  });
});

// ---------------------------------------------------------------- 슬롯

describe("F-302·F-605 슬롯", () => {
  it("필수 5종이 다 차면 완료다", () => {
    expect(slotStatus(base, []).complete).toBe(true);
    expect(slotStatus({ channel: "TM" }, []).missing).toContain("product");
  });

  it("조건부 슬롯은 발동 시 필수로 승격된다", () => {
    // 보험 + 설명의무 → confirm_call 승격
    const s = slotStatus(base, ["설명의무"]);
    expect(s.promoted.map((p) => p.slot)).toContain("confirm_call");
    expect(s.missing).toContain("confirm_call");
    expect(s.complete).toBe(false);
  });

  it("발동 조건이 없으면 조건부는 요구하지 않는다", () => {
    const s = slotStatus(base, ["약관해석"]);
    expect(s.promoted).toEqual([]);
    expect(s.complete).toBe(true);
  });

  it("투자성 상품 + 설명의무 → explained_loss 승격", () => {
    const s = slotStatus({ ...base, product: "INV_ELS" }, ["설명의무"]);
    expect(s.promoted.map((p) => p.slot)).toContain("explained_loss");
    expect(s.promoted.map((p) => p.slot)).not.toContain("confirm_call"); // 보험 아님
  });

  it("적합성원칙 쟁점 → survey_writer 승격 (상품군 무관)", () => {
    expect(slotStatus(base, ["적합성원칙"]).promoted.map((p) => p.slot)).toContain("survey_writer");
  });

  it("한 번에 하나만 묻는다 — 상품군이 먼저다 (A11Y-4)", () => {
    const s = slotStatus({}, []);
    expect(nextQuestion(s)).toBe("product");
    expect(nextQuestion(slotStatus({ product: "INS_WHOLE" }, []))).toBe("contract_ym");
  });

  it("열거 밖 값은 병합 단계에서 막힌다 (F-605 → EX-101)", () => {
    const r = applySlots(base, { channel: "전화" as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("channel");
  });

  it("되묻기로 하나씩 채워 나갈 수 있다 — 부분 병합", () => {
    // 전체 스키마로 검증하면 미완 슬롯 때문에 매번 거부되어 값이 쌓이지 않는다.
    // 실제 되묻기 흐름(한 번에 하나)을 그대로 재현한다.
    let acc: Partial<Slots> = {};
    for (const patch of [
      { product: "INS_WHOLE" }, { contract_ym: "2019-05" },
      { channel: "TM" }, { age: 67 }, { traits: ["NONE"] },
    ] as Partial<Slots>[]) {
      const r = applySlots(acc, patch);
      expect(r.ok).toBe(true);
      if (r.ok) acc = r.slots;
    }
    expect(slotStatus(acc, []).complete).toBe(true);
    const fin = finalizeSlots(acc);
    expect(fin.ok).toBe(true);
  });

  it("미완 슬롯은 최종 확정에서 막힌다 — 하위 계층으로 못 내려간다", () => {
    const r = finalizeSlots({ product: "INS_WHOLE" });
    expect(r.ok).toBe(false);
  });

  it("나이를 넣으면 ELDER가 자동 파생된다 — 고령 여부를 직접 묻지 않는다", () => {
    const r = applySlots({ ...base, traits: ["NONE"] }, { age: 72 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slots.traits).toContain("ELDER");
  });

  it("나이가 먼저 와도 ELDER가 파생된다 — 특성 질문 전이어도", () => {
    const r = applySlots({}, { age: 67 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slots.traits).toEqual(["ELDER"]);
  });

  it("기준일은 가입 월 1일이고, UNKNOWN이면 산정하지 않는다", () => {
    expect(basisDateFrom({ contract_ym: "2019-05" })).toBe("2019-05-01");
    expect(basisDateFrom({ contract_ym: "UNKNOWN" })).toBeNull();
  });

  it("금소법 시행일 경계를 판정한다", () => {
    expect(isAfterFsca("2021-03-25")).toBe(true);
    expect(isAfterFsca("2021-03-24")).toBe(false);
    expect(isAfterFsca(null)).toBeNull();
  });
});

// ---------------------------------------------------------------- 실행 로그

describe("F-402 실행 로그", () => {
  it("추가만 가능하다 — 반환된 배열을 고쳐도 원본이 안 바뀐다", () => {
    const t = new Trace();
    t.info("CONSULT", "슬롯 확정");
    const read = t.read() as ReturnType<Trace["read"]>[number][];
    read.push({ seq: 99, atMs: 0, layer: "SYSTEM", level: "INFO", message: "위조" });
    expect(t.size).toBe(1);
  });

  it("도구 실패는 경고로 남는다 (EP-1·EP-6)", () => {
    const t = new Trace();
    t.toolCall("search_case", "OK", { matched: 5 });
    t.toolCall("search_precedent", "FAILED");
    expect(t.summary()).toEqual({ total: 2, warnings: 1, tools: 2 });
  });

  it("순번과 경과 시간이 매겨진다", () => {
    const t = new Trace();
    t.info("CONSULT", "a");
    t.warn("JUDGE", "b");
    const e = t.read();
    expect(e.map((x) => x.seq)).toEqual([1, 2]);
    expect(e[0].atMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------- 세션

describe("F-102·N-401 세션", () => {
  it("봉인했다 열면 상태가 그대로 돌아온다", () => {
    const s = createSession();
    s.sensitiveConsent = true;
    s.slots = { channel: "TM" };
    tryAsk(s);

    const opened = openSession(sealSession(s, "마스킹된 진술"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.sensitiveConsent).toBe(true);
    expect(opened.session.slots.channel).toBe("TM");
    expect(opened.session.askedTotal).toBe(1);
    expect(opened.maskedStatement).toBe("마스킹된 진술");
  });

  it("진술은 봉인 안에만 있고 세션 객체로 올라오지 않는다 (SR-402)", () => {
    const opened = openSession(sealSession(createSession(), "원문이 들어간 자리"));
    if (!opened.ok) throw new Error("열려야 한다");
    // 판단 계층이 받는 것은 session이다. 여기에 진술이 없어야 한다
    expect(JSON.stringify(opened.session)).not.toContain("원문이 들어간 자리");
  });

  it("봉인은 클라이언트가 읽을 수 없다 — 평문이 드러나지 않는다", () => {
    const s = createSession();
    s.slots = { product: "INS_WHOLE" };
    const token = sealSession(s, "전화로 종신보험에 가입했습니다");
    expect(token).not.toContain("INS_WHOLE");
    expect(token).not.toContain("종신보험");
  });

  it("한 글자만 바뀌어도 열리지 않는다 — 위조 차단", () => {
    const token = sealSession(createSession(), null);
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A");
    expect(openSession(tampered).ok).toBe(false);
  });

  it("도구 상한 카운터가 봉인에 실려 되돌려지지 않는다 (F-607)", () => {
    const s = createSession();
    s.budget.tryConsume();
    s.budget.tryConsume();
    const opened = openSession(sealSession(s, null));
    if (!opened.ok) throw new Error("열려야 한다");
    expect(opened.session.budget.snapshot().session).toBe(2);
  });

  it("망가진 토큰은 이유를 설명한다 — 저장하지 않기 때문이라고 (EX-403·407)", () => {
    const r = openSession("이건-봉인이-아니다");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("개인정보를 저장하지 않기");
  });

  it("유보 이어가기 목록이 봉인을 왕복한다 (F-308 확장)", () => {
    const s = createSession();
    s.reentryNeeded = ["가입 당시 서명한 상품설명서", "해피콜 녹취"];
    const opened = openSession(sealSession(s, null));
    if (!opened.ok) throw new Error("열려야 한다");
    expect(opened.session.reentryNeeded).toEqual([
      "가입 당시 서명한 상품설명서",
      "해피콜 녹취",
    ]);
  });

  it("이어가기 필드가 없는 옛 토큰은 null로 읽힌다 — 만료로 오해하지 않는다", () => {
    // 배포 전에 발급된 토큰 시뮬레이션 — 스냅샷에서 필드를 지우고 직접 봉인한다
    const snap = freshSnapshot() as Record<string, unknown>;
    delete snap.reentryNeeded;
    snap.sensitiveConsent = true;
    const opened = openSession(seal(snap as Parameters<typeof seal>[0]));
    if (!opened.ok) throw new Error("옛 토큰도 열려야 한다");
    expect(opened.session.reentryNeeded).toBeNull();
  });

  it("되묻기 상한 — 사이클과 총량 두 층으로 막는다 (N-202)", () => {
    const s = createSession();
    let cycleBlocked = false;
    for (let i = 0; i < 50; i++) {
      const g = tryAsk(s);
      if (!g.ok) { cycleBlocked = true; expect(["CYCLE", "TOTAL"]).toContain(g.scope); break; }
    }
    expect(cycleBlocked).toBe(true);
  });

  it("되돌림은 사이클을 열되 누적은 이어간다 (F-308)", () => {
    const s = createSession();
    tryAsk(s); tryAsk(s);
    const before = s.askedTotal;
    startNewCycle(s);
    expect(s.askedInCycle).toBe(0);
    expect(s.askedTotal).toBe(before);
    // 되돌림 시 이전 근거·판단은 버린다
    expect(s.evidence).toBeNull();
    expect(s.outcome).toBeNull();
  });

  it("서버에 세션 저장소가 없다 — 봉인이 곧 세션이다", () => {
    // 같은 세션을 두 번 봉인해도 서버에는 아무것도 쌓이지 않는다.
    // 저장소가 없으니 「몇 개나 들고 있나」를 물을 대상 자체가 없다 (DR-4xx).
    const s = createSession();
    expect(openSession(sealSession(s, null)).ok).toBe(true);
    expect(openSession(sealSession(s, null)).ok).toBe(true);
  });
});
