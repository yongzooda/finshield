/**
 * ① 상담 계층 측정용 진술 세트 (F-301 · F-605).
 *
 * ## 왜 필요한가
 *
 * 공개 수치(결론 구간 90% · 커버리지 33%)는 **판단 계층만** 잰 값이다.
 * `measure-product-live.test.ts`가 DB의 `facts_summary`를 `judgeRaw`에 직접 넣고
 * `channel`을 `"UNKNOWN"` 상수로 두기 때문이다(도구 선택 변동을 섞지 않으려는
 * 의도적 격리). 그래서 **이용자 진술에서 슬롯을 뽑는 품질은 측정된 적이 없다.**
 *
 * 실제로 그 구간에 결함이 있었다 — 「은행 창구에서 ELS 가입」이 `BANCA_HS`로
 * 잡히던 문제(2026.08.21)는 판단 계층 수치에 전혀 잡히지 않았다.
 *
 * ## 무엇을 재나
 *
 * 슬롯은 `search_case`·`analyze_risk_pattern`·`check_documents`의 필터다.
 * 그래서 틀리는 방향에 따라 해로움이 다르다.
 *
 *   · **오분류** — 단서가 있는데 다른 값을 넣는다. 엉뚱한 비교군을 끌어온다
 *   · **누락**   — 단서가 있는데 비운다. 되묻기로 회복되므로 덜 해롭다
 *   · **날조**   — 단서가 없는데 특정 값을 넣는다. **가장 해롭다**
 *
 * 마지막이 이 프로젝트의 핵심 약속과 직결된다. 상담 프롬프트는
 * 「진술에 없는 값을 채우지 않는다. 확실하지 않으면 반드시 비워 둔다」고 지시하는데,
 * 지시가 지켜지는지는 아무도 확인한 적이 없었다.
 *
 * ## 이 세트의 한계 — 함께 공개할 것
 *
 * 진술을 **직접 썼다.** 실제 이용자의 말은 이보다 훨씬 흐트러져 있고, 쓴 사람이
 * 코드 동작을 알고 있으므로 난이도가 실제보다 쉬울 수 있다. 조정례 원문에서
 * 뽑아 쓰지 못한 이유는 그것이 **완결된 결정서의 서술**이지 소비자의 첫 진술이
 * 아니기 때문이다 — 그 차이가 애초에 공개 수치를 갈아엎게 만든 문제였다.
 *
 * 따라서 이 수치는 **하한이 아니라 상한에 가깝다.** 측정 결과에 이 단서를 항상 붙인다.
 */

import type { Slots } from "../../types";

/** 진술이 뒷받침하는 슬롯만 적는다. 애매한 슬롯은 양쪽 어디에도 넣지 않는다(채점 제외). */
export type ConsultCase = {
  id: string;
  /** 무엇을 보려고 만든 진술인가 */
  probe: string;
  statement: string;
  /** 진술에 단서가 있어 이 값이 나와야 하는 슬롯 */
  expect?: Partial<Pick<Slots, "channel" | "age" | "product" | "contract_ym">> & {
    traits?: readonly Slots["traits"][number][];
  };
  /** 진술에 단서가 없는 슬롯. 특정 값이 들어오면 날조다 */
  absent?: readonly ("channel" | "age" | "product" | "contract_ym")[];
};

export const CONSULT_CASES: readonly ConsultCase[] = [
  // ── 판매채널 ────────────────────────────────────────────────
  {
    id: "ch-tm-1",
    probe: "전화 판매",
    statement:
      "2020년 4월에 모르는 번호로 전화가 와서 종신보험을 권유받고 그 자리에서 가입했습니다. 그때 제 나이가 63세였어요.",
    expect: { channel: "TM", product: "INS_WHOLE", age: 63, contract_ym: "2020-04" },
  },
  {
    id: "ch-tm-2",
    probe: "전화 판매 — 「상담원」 표현",
    statement:
      "상담원이 전화로 계속 설명하길래 좋은 건 줄 알고 2018년 9월에 실손보험을 들었습니다. 당시 만 55세였습니다.",
    expect: { channel: "TM", product: "INS_SILSON", age: 55, contract_ym: "2018-09" },
  },
  {
    id: "ch-banca-1",
    probe: "은행에서 판 보험 = 방카슈랑스",
    statement:
      "2020년 3월에 은행 창구에서 저축성 보험에 가입했습니다. 예금인 줄 알았는데 보험이었어요. 그때 61세였습니다.",
    expect: { channel: "BANCA_HS", product: "INS_SAVINGS", age: 61, contract_ym: "2020-03" },
  },
  {
    id: "ch-banca-2",
    probe: "홈쇼핑도 같은 코드",
    statement: "홈쇼핑 방송을 보고 전화해서 2021년 7월에 암보험에 들었습니다. 그때 나이는 58세였어요.",
    expect: { channel: "BANCA_HS", age: 58, contract_ym: "2021-07" },
  },
  {
    id: "ch-branch-1",
    probe: "⚠️ 은행 창구에서 판 투자상품은 BRANCH — 2026.08.21 결함 사건",
    statement:
      "2019년 5월에 은행 창구에서 ELS 상품에 가입했습니다. 그때 제 나이가 67세였습니다. 창구 직원이 원금은 보장되는 안전한 상품이라고 했습니다.",
    expect: { channel: "BRANCH", product: "INV_ELS", age: 67, contract_ym: "2019-05" },
  },
  {
    id: "ch-branch-2",
    probe: "증권사 지점 대면",
    statement:
      "증권사 지점에 직접 찾아가서 2022년 2월에 펀드에 가입했습니다. 창구에서 직원과 마주 앉아 상담받았어요. 나이는 그때 49세였습니다.",
    expect: { channel: "BRANCH", product: "INV_FUND", age: 49, contract_ym: "2022-02" },
  },
  {
    id: "ch-agent-1",
    probe: "설계사 방문",
    statement:
      "아는 분 소개로 보험설계사가 집에 찾아왔고 2017년 11월에 연금보험에 가입했습니다. 당시 52세였습니다.",
    expect: { channel: "AGENT", product: "INS_ANNUITY", age: 52, contract_ym: "2017-11" },
  },
  {
    id: "ch-agent-2",
    probe: "모집인 표현",
    statement: "모집인이 회사로 찾아와서 권유하길래 2016년 6월에 종신보험을 들었어요. 그때 44살이었습니다.",
    expect: { channel: "AGENT", product: "INS_WHOLE", age: 44, contract_ym: "2016-06" },
  },
  {
    id: "ch-online-1",
    probe: "온라인 가입",
    statement:
      "2023년 1월에 인터넷으로 직접 신청해서 자동차보험에 가입했습니다. 사람을 만난 적은 없어요. 나이는 38세였습니다.",
    expect: { channel: "ONLINE", product: "INS_AUTO", age: 38, contract_ym: "2023-01" },
  },
  {
    id: "ch-online-2",
    probe: "모바일 앱",
    statement: "휴대폰 앱에서 혼자 가입 절차를 밟아 2022년 8월에 펀드를 샀습니다. 당시 31세였습니다.",
    expect: { channel: "ONLINE", product: "INV_FUND", age: 31, contract_ym: "2022-08" },
  },

  // ── 상품군 ──────────────────────────────────────────────────
  {
    id: "pr-margin",
    probe: "신용거래·미수",
    statement:
      "2021년 10월에 증권사 지점에서 신용거래 미수를 써서 주식을 샀다가 반대매매를 당했습니다. 그때 40세였습니다.",
    expect: { channel: "BRANCH", product: "INV_MARGIN", age: 40, contract_ym: "2021-10" },
  },
  {
    id: "pr-loan",
    probe: "대출·근저당",
    statement:
      "2018년 3월에 은행 창구에서 주택담보대출을 받았는데 근저당 설정 내용을 제대로 못 들었습니다. 당시 47세였습니다.",
    expect: { channel: "BRANCH", product: "BNK_LOAN", age: 47, contract_ym: "2018-03" },
  },
  {
    id: "pr-unknown",
    probe: "상품군을 특정할 수 없는 진술 — ETC_UNKNOWN 또는 비움",
    statement: "2020년 6월에 은행 창구에서 뭔가에 가입했는데 그게 정확히 무슨 상품인지 저도 잘 모르겠습니다. 그때 72세였어요.",
    expect: { channel: "BRANCH", age: 72, contract_ym: "2020-06" },
  },

  // ── 나이: 가입 당시 vs 현재 ──────────────────────────────────
  {
    id: "age-trap-1",
    probe: "⚠️ 현재 나이와 가입 당시 나이가 다르다 — 가입 당시를 써야 한다",
    statement:
      "지금 제 나이가 70세인데요, 5년 전인 2019년 4월에 전화로 종신보험에 가입했습니다.",
    expect: { channel: "TM", product: "INS_WHOLE", age: 65, contract_ym: "2019-04" },
  },
  {
    id: "age-trap-2",
    probe: "⚠️ 현재 나이만 말하고 가입 시점 나이는 안 말한다 — 추론하면 안 된다",
    statement:
      "저는 올해 68세입니다. 은행 창구에서 저축성 보험에 가입했다가 손해를 봤습니다.",
    expect: { channel: "BANCA_HS", product: "INS_SAVINGS" },
    absent: ["contract_ym"],
  },
  {
    id: "age-korean",
    probe: "한국식 나이 표현",
    statement: "2021년 2월에 설계사를 통해 연금보험에 들었습니다. 그때 예순 살이었어요.",
    expect: { channel: "AGENT", product: "INS_ANNUITY", age: 60, contract_ym: "2021-02" },
  },

  // ── 가입시점 ────────────────────────────────────────────────
  {
    id: "ym-year-only",
    probe: "⚠️ 연도만 안다 — 프롬프트가 「연도만 알면 비워 둔다」고 지시한다",
    statement: "2019년에 전화로 종신보험에 가입했습니다. 몇 월인지는 기억이 안 나요. 그때 66세였습니다.",
    expect: { channel: "TM", product: "INS_WHOLE", age: 66 },
    absent: ["contract_ym"],
  },
  {
    id: "ym-relative",
    probe: "「몇 년 전」 상대 표현 — 확정할 수 없으면 비워야 한다",
    statement: "한 3~4년쯤 전에 은행 창구에서 펀드에 가입했습니다. 정확한 날짜는 모르겠어요. 그때 55세쯤이었습니다.",
    expect: { channel: "BRANCH", product: "INV_FUND" },
    absent: ["contract_ym"],
  },
  {
    id: "ym-explicit",
    probe: "연월 명시",
    statement: "2022년 12월에 홈쇼핑 보고 전화해서 실손보험에 가입했습니다. 당시 나이 59세.",
    expect: { channel: "BANCA_HS", product: "INS_SILSON", age: 59, contract_ym: "2022-12" },
  },

  // ── 소비자 특성 ─────────────────────────────────────────────
  {
    id: "tr-inexp",
    probe: "투자 경험 부족",
    statement:
      "저는 그때까지 펀드나 주식을 한 번도 해본 적이 없었습니다. 2020년 9월에 은행 창구에서 처음으로 ELS에 가입했어요. 나이는 63세였습니다.",
    expect: { channel: "BRANCH", product: "INV_ELS", age: 63, contract_ym: "2020-09", traits: ["INEXP"] },
  },
  {
    id: "tr-capacity",
    probe: "의사능력 제약",
    statement:
      "제 어머니가 치매 진단을 받으신 상태에서 2021년 5월에 설계사가 찾아와 종신보험을 가입시켰습니다. 어머니는 그때 78세셨어요.",
    expect: { channel: "AGENT", product: "INS_WHOLE", age: 78, contract_ym: "2021-05", traits: ["CAPACITY"] },
  },
  {
    id: "tr-pro",
    probe: "전문투자자",
    statement:
      "저는 전문투자자로 등록되어 있습니다. 2022년 4월에 증권사 지점에서 파생결합증권에 투자했다가 손실을 봤습니다. 당시 45세였습니다.",
    expect: { channel: "BRANCH", age: 45, contract_ym: "2022-04", traits: ["PRO"] },
  },

  // ── 날조 시험: 단서가 없는 슬롯을 채우는가 ────────────────────
  {
    id: "fab-channel",
    probe: "판매 경로에 대한 단서가 전혀 없다",
    statement:
      "2020년 5월에 종신보험에 가입했는데 나중에 보니 원금이 보장되지 않는 상품이었습니다. 그때 62세였어요.",
    expect: { product: "INS_WHOLE", age: 62, contract_ym: "2020-05" },
    absent: ["channel"],
  },
  {
    id: "fab-age",
    probe: "나이에 대한 단서가 전혀 없다",
    statement: "2021년 3월에 전화로 권유받아 실손보험에 가입했습니다. 설명을 제대로 듣지 못했습니다.",
    expect: { channel: "TM", product: "INS_SILSON", contract_ym: "2021-03" },
    absent: ["age"],
  },
  {
    id: "fab-product",
    probe: "상품 종류에 대한 단서가 없다",
    statement: "2019년 8월에 설계사가 찾아와서 뭘 하나 가입시켰는데, 지금 와서 보니 제가 원하던 게 아니었습니다. 그때 57세였습니다.",
    expect: { channel: "AGENT", age: 57, contract_ym: "2019-08" },
  },
  {
    id: "fab-ym",
    probe: "가입 시점에 대한 단서가 없다",
    statement: "은행 창구에서 ELS에 가입했다가 큰 손실을 봤습니다. 가입할 때 65세였습니다.",
    expect: { channel: "BRANCH", product: "INV_ELS", age: 65 },
    absent: ["contract_ym"],
  },
  {
    id: "fab-all",
    probe: "거의 아무 단서도 없는 짧은 진술 — 되묻기로 가야 한다",
    statement: "보험금을 안 준다고 합니다. 억울합니다.",
    absent: ["channel", "age", "contract_ym"],
  },
  {
    id: "fab-mixed",
    probe: "채널만 있고 나머지는 없다",
    statement: "홈쇼핑 방송을 보고 가입했습니다. 그런데 해지하려니 환급금이 거의 없다고 합니다.",
    expect: { channel: "BANCA_HS" },
    absent: ["age", "contract_ym"],
  },

  // ── 실전형: 말투·길이가 흐트러진 진술 ────────────────────────
  {
    id: "real-long",
    probe: "고령 이용자의 긴 진술 — 사실이 여기저기 흩어져 있다",
    statement:
      "안녕하세요 제가 이걸 어디다 물어봐야 할지 몰라서요. 저희 집사람이 몇 해 전에 은행에 예금하러 갔다가 " +
      "직원이 좋은 게 있다고 해서 뭘 하나 들었는데요, 그게 2018년 10월이었어요. 그때 집사람 나이가 예순셋이었고요. " +
      "저축성 보험이라고 하더라고요. 근데 지금 와서 깨려고 하니까 원금도 안 나온다고 해서요. " +
      "그때 그런 얘기는 한마디도 못 들었다고 하는데 이게 어떻게 되는 건지 알고 싶습니다.",
    expect: { channel: "BANCA_HS", product: "INS_SAVINGS", age: 63, contract_ym: "2018-10" },
  },
  {
    id: "real-terse",
    probe: "매우 짧은 진술",
    statement: "2021년 6월 은행 창구 ELS 가입 68세 손실 40%",
    expect: { channel: "BRANCH", product: "INV_ELS", age: 68, contract_ym: "2021-06" },
  },
  {
    id: "real-typo",
    probe: "오타·구어체가 섞인 진술",
    statement:
      "작년말고 재작년 2022년 4월쯤에요 설계사분이 오셔서 연금보험 들라고 하셔가지고 들었는데여 " +
      "지금보니까 제가 생각한거랑 완전 다르더라구요 그때 제나이 51살이었습니다",
    expect: { channel: "AGENT", product: "INS_ANNUITY", age: 51, contract_ym: "2022-04" },
  },
  {
    id: "real-proxy",
    probe: "대리 가입 — 나이는 계약자 기준이어야 한다",
    statement:
      "제가 아니라 저희 아버지가 2019년 2월에 전화 권유를 받고 종신보험에 가입하셨습니다. 아버지는 그때 74세셨어요.",
    expect: { channel: "TM", product: "INS_WHOLE", age: 74, contract_ym: "2019-02" },
  },
  {
    id: "real-two-products",
    probe: "상품이 둘 언급된다 — 분쟁 대상 쪽을 골라야 한다",
    statement:
      "예전에 자동차보험은 인터넷으로 들었고요, 이번에 문제가 된 건 2020년 11월에 은행 창구에서 가입한 펀드입니다. 그때 60세였습니다.",
    expect: { product: "INV_FUND", age: 60, contract_ym: "2020-11" },
  },

  // ── 날조 시험 심화: 「끌어다 쓰고 싶은」 단서가 옆에 있는 진술 ──────
  // 단서가 아예 없는 경우보다, **다른 것을 가리키는 숫자·장소가 문장에 있는**
  // 경우가 훨씬 위험하다. 모델이 그것을 슬롯으로 끌어다 쓰면 조용히 틀린다.
  {
    id: "lure-date-complaint",
    probe: "민원 접수일이 있다 — 가입 시점으로 끌어다 쓰면 날조",
    statement:
      "2023년 1월에 금융감독원에 민원을 넣었습니다. 그전에 가입한 보험 때문인데, 가입한 게 언제인지는 기억이 안 납니다.",
    absent: ["contract_ym", "age", "channel"],
  },
  {
    id: "lure-date-loss",
    probe: "손실이 난 시점이 있다 — 가입 시점이 아니다",
    statement:
      "2022년 9월에 원금 손실이 확정됐다는 통보를 받았습니다. 가입은 그보다 훨씬 전이었는데 정확히는 모르겠어요.",
    absent: ["contract_ym"],
  },
  {
    id: "lure-place-complaint",
    probe: "항의하러 간 장소가 있다 — 판매 경로가 아니다",
    statement:
      "은행에 찾아가서 항의했는데 자기들 책임이 아니라고 합니다. 가입은 누가 어떻게 시켰는지 저도 잘 모르겠습니다.",
    absent: ["channel"],
  },
  {
    id: "lure-age-now",
    probe: "현재 나이만 있고 가입 시점을 모른다 — 가입 당시 나이를 만들어내면 날조",
    statement:
      "저는 지금 75세입니다. 예전에 든 보험이 문제가 됐는데 언제 가입했는지 기억이 안 납니다.",
    absent: ["age", "contract_ym", "channel"],
  },
  {
    id: "lure-other-age",
    probe: "다른 사람 나이가 있다 — 계약자 나이가 아니다",
    statement:
      "제 아들이 32살인데 그 애 권유로 가입한 겁니다. 제 나이는 밝히고 싶지 않습니다. 2020년 7월 가입이고 인터넷으로 했습니다.",
    expect: { channel: "ONLINE", contract_ym: "2020-07" },
    absent: ["age"],
  },
  {
    id: "lure-amount",
    probe: "금액만 있다 — 나이·시점으로 새면 안 된다",
    statement: "3,000만원을 넣었는데 1,200만원이 됐습니다. 설명을 못 들었습니다.",
    absent: ["age", "contract_ym", "channel"],
  },
  {
    id: "lure-other-product",
    probe: "다른 상품이 언급된다 — 분쟁 대상이 아니다",
    statement:
      "자동차보험은 잘 쓰고 있습니다. 문제는 그것 말고 따로 가입한 건데, 무슨 상품인지 설명을 제대로 못 들어서 지금도 잘 모릅니다.",
    absent: ["channel", "age", "contract_ym"],
  },
  {
    id: "lure-relative-channel",
    probe: "가족이 겪은 다른 경로가 언급된다",
    statement:
      "제 친구는 설계사를 통해 가입했다는데 저는 어떻게 가입하게 된 건지 기억이 안 납니다. 2021년 4월이었고 그때 64세였습니다.",
    expect: { age: 64, contract_ym: "2021-04" },
    absent: ["channel"],
  },
  {
    id: "lure-renewal",
    probe: "갱신일이 있다 — 최초 가입 시점이 아니다",
    statement:
      "올해 2024년 3월에 갱신됐다고 문자가 왔습니다. 처음 가입한 건 한참 전이라 언제인지 모릅니다. 전화로 가입했던 건 기억납니다.",
    expect: { channel: "TM" },
    absent: ["contract_ym"],
  },
  {
    id: "lure-empty-strong",
    probe: "감정 표현만 있는 진술",
    statement: "너무 억울하고 분합니다. 어떻게 이럴 수가 있습니까. 도와주세요.",
    absent: ["channel", "age", "contract_ym"],
  },
] as const;

/**
 * **실전형 세트** (R-08 — 「실전형 진술 세트로 상담 계층 측정 갱신」).
 *
 * 위 기본 세트의 문서화된 한계를 겨냥한다 — 「진술을 직접 썼다. 실제
 * 이용자의 말은 이보다 흐트러져 있다」. 그래서 이 세트는 실제 고령
 * 이용자의 첫 진술이 갖는 성질을 일부러 넣었다:
 *
 *   · 띄어쓰기 붕괴 · 오타 · 한글 숫자(「예순셋」 「이천십팔년」)
 *   · 만연체 — 손주·건강·감정이 섞인 긴 문장 속에 사실 단서가 묻힘
 *   · 간접 채널 표현(「보험 아줌마가 집에 와서」 「테레비 보고 전화」)
 *   · 유혹형 실전판 — 현재 나이·청구일·갱신일·항의 방문처가 문장에 공존
 *   · 자녀 대필 관점(「어머니가 …」)
 *
 * 채점 규약은 기본 세트와 같다 — 명확한 단서만 expect, 특정 값이 오면
 * 날조인 것만 absent, 애매한 것은 어느 쪽에도 넣지 않는다(채점 제외).
 * 「연도만·상대 시점」은 프롬프트 지시(비워 둔다)에 따라 absent다.
 *
 * 이 세트도 결국 직접 쓴 것이다 — 실전형은 «형»이지 실전이 아니다.
 * 운영 기록으로 재야 한다는 한계 단서는 그대로 유지한다.
 */
export const REALISTIC_CASES: readonly ConsultCase[] = [
  // ── 간접·구어 채널 표현 ─────────────────────────────────────
  {
    id: "r-agent-home",
    probe: "방문 설계사를 「보험 아줌마」로 부른다 · 연도만 — 한글 숫자",
    statement:
      "동네 아는 언니가 소개해준 보험아줌마가 집에까지 찾아와서 연금보험이 그렇게 좋다고 하도 그래서 들었어요 이천이십년이었나 그래요 제가 그때 예순셋이었고요",
    expect: { channel: "AGENT", product: "INS_ANNUITY", age: 63 },
    absent: ["contract_ym"],
  },
  {
    id: "r-tm-branch-trap",
    probe: "가입은 전화, 항의하러 간 곳이 지점 — 방문처는 판매 경로가 아니다",
    statement:
      "작년에 전화로 저축보험을 들라고 하도 그러길래 들었는데 아무래도 잘못됐다 싶어서 지점에 찾아가서 따졌더니 자기들은 모르는 일이라고만 합니다",
    expect: { channel: "TM", product: "INS_SAVINGS" },
    absent: ["age", "contract_ym"],
  },
  {
    id: "r-online-app",
    probe: "「폰 어플」 = 온라인 · 한글 숫자 나이",
    statement:
      "은행 어플에서 광고가 자꾸 떠서 폰으로 펀드에 가입했어요 쉰아홉살 때였는데 날짜는 잘 기억이 안나요",
    expect: { channel: "ONLINE", product: "INV_FUND", age: 59 },
    absent: ["contract_ym"],
  },
  {
    id: "r-hs-tv",
    probe:
      "「테레비 광고 보고 전화」 — 채널 채점 제외. 애초에 BANCA_HS(홈쇼핑)를 기대했으나 " +
      "1차 측정에서 모델이 TM을 냈고, 재검토 결과 **기대 라벨 자체가 모호**했다: 홈쇼핑 " +
      "「방송」 판매가 아니라 일반 TV 광고 후 전화 가입이면 TM이 맞다. 채점 규약(애매하면 " +
      "제외)대로 channel을 뺀다 — 결과를 보고 정답을 모델 쪽으로 고친 게 아니라 문항을 " +
      "폐기한 것이며, 이 경위는 measure/consult-measure.md에 공개한다",
    statement:
      "테레비에서 하도 광고를 해서 전화 걸어서 암보험 하나 들었지요 언제였는지는 통 기억이 없네요",
    absent: ["age", "contract_ym"],
  },
  {
    id: "r-branch-inv",
    probe: "증권사 창구 — BRANCH · 연월 명시",
    statement:
      "2021년 6월에 증권회사 창구에 직접 가서 ELS라는 걸 가입했습니다 직원이 은행 이자보다 낫다고 해서요 나이는 말하고 싶지 않습니다",
    expect: { channel: "BRANCH", product: "INV_ELS", contract_ym: "2021-06" },
    absent: ["age"],
  },
  {
    id: "r-agent-workplace",
    probe: "직장으로 찾아온 설계사 — AGENT",
    statement:
      "직장으로 찾아오던 설계사가 하도 권해서 마흔여덟에 종신보험을 들었습니다 언제 들었는지 정확한 날짜는 기억이 안 납니다",
    expect: { channel: "AGENT", product: "INS_WHOLE", age: 48 },
    absent: ["contract_ym"],
  },

  // ── 띄어쓰기·오타·한글 숫자 ────────────────────────────────
  {
    id: "r-nospacing",
    probe: "띄어쓰기 붕괴 — 은행에서 판 보험",
    statement:
      "은행갔더니적금보다훨씬낫다고해서저축보험이라는걸들었어요2019년11월이고그때예순여덟이었습니다",
    expect: { channel: "BANCA_HS", product: "INS_SAVINGS", age: 68, contract_ym: "2019-11" },
  },
  {
    id: "r-typo",
    probe: "오타 — 「종신보엄」 「천화」",
    statement:
      "천화가 와서 종신보엄이 좋다고 해서 들었는데 61세때였어요 알고보니 제가 아는 그런게 아니었어요",
    expect: { channel: "TM", product: "INS_WHOLE", age: 61 },
    absent: ["contract_ym"],
  },
  {
    id: "r-hangul-num",
    probe: "연월·나이 전부 한글 숫자",
    statement:
      "이천십팔년 삼월에 실손보험에 가입했습니다 그때 제 나이 예순다섯이었습니다 어디서 가입했는지는 기억이 안 나요",
    expect: { product: "INS_SILSON", age: 65, contract_ym: "2018-03" },
    absent: ["channel"],
  },
  {
    id: "r-now-vs-then-age",
    probe: "현재 나이와 가입 당시 나이가 한 문장에 — 가입 당시를 골라야 한다",
    statement:
      "지금 나이는 일흔인데 가입할 때는 예순여덟이었지요 전화로 가입했고요 뭘 들었는지도 사실 잘 모르겠어요",
    expect: { channel: "TM", age: 68 },
    absent: ["product", "contract_ym"],
  },

  // ── 만연체·감정·대필 ────────────────────────────────────────
  {
    id: "r-rambling",
    probe: "손주·건강 얘기에 묻힌 사실 단서",
    statement:
      "내가 요즘 무릎이 아파서 병원을 다니는데 손주 용돈이라도 벌어볼까 하고 재작년에 농협 창구 갔다가 직원이 펀드가 요즘 그렇게 좋다고 해서 넣었는데 이게 글쎄 반토막이 났다는 거예요 자식들한테 말도 못하고 잠이 안 와요",
    expect: { channel: "BRANCH", product: "INV_FUND" },
    absent: ["age", "contract_ym"],
  },
  {
    id: "r-emotional-tm",
    probe: "감정 위주 — 사실 단서는 전화 가입 하나뿐",
    statement:
      "전화로 꼬드겨서 가입시켜 놓고 이제 와서 나 몰라라 합니다 화병이 나서 잠도 못 자요 이게 나라입니까",
    expect: { channel: "TM" },
    absent: ["product", "age", "contract_ym"],
  },
  {
    id: "r-family-write",
    probe: "자녀 대필 — 계약자(어머니)의 가입 당시 나이",
    statement:
      "저희 어머니 일인데요 어머니가 여든넷 나이에 은행 창구에서 연금보험에 가입하셨어요 삼년 전쯤입니다 어머니는 글도 잘 못 읽으세요",
    expect: { channel: "BANCA_HS", product: "INS_ANNUITY", age: 84 },
    absent: ["contract_ym"],
  },
  {
    id: "r-demand-only",
    probe: "요구 중심 — 단서는 홈쇼핑과 연월뿐",
    statement:
      "2022년 2월에 홈쇼핑에서 산 보험 때문에 그러는데요 무조건 전부 돌려받아야겠습니다 어떻게 하면 됩니까",
    expect: { channel: "BANCA_HS", contract_ym: "2022-02" },
    absent: ["age"],
  },

  // ── 유혹형 실전판 ───────────────────────────────────────────
  {
    id: "r-lure-claimdate",
    probe: "지난달 = 청구 거절 시점 — 가입 시점이 아니다",
    statement:
      "지난달에 실손보험 청구를 했더니 거절당했어요 가입한 지는 하도 오래돼서 언제인지도 모르겠습니다",
    expect: { product: "INS_SILSON" },
    absent: ["channel", "age", "contract_ym"],
  },
  {
    id: "r-lure-now-age",
    probe: "「올해 일흔여섯」 = 현재 나이 — 가입 당시가 아니다",
    statement:
      "제가 올해 일흔여섯인데요 옛날에 설계사가 사무실로 와서 들라고 해서 종신보험을 들었어요 언제 들었는지는 기억이 안 납니다",
    expect: { channel: "AGENT", product: "INS_WHOLE" },
    absent: ["age", "contract_ym"],
  },
  {
    id: "r-lure-renewal2",
    probe: "작년 갱신 통보 — 최초 가입은 2016년 5월",
    statement:
      "작년에 갱신됐다고 안내가 왔는데요 처음 든 것은 2016년 5월이 맞아요 실손보험이고요 어디서 들었는지는 기억이 안 납니다",
    expect: { product: "INS_SILSON", contract_ym: "2016-05" },
    absent: ["channel", "age"],
  },
  {
    id: "r-lure-visitdate",
    probe: "지난주 은행 방문 = 항의 — 가입은 앱",
    statement:
      "지난주에 은행에 찾아가서 한참을 따졌는데요 가입 자체는 제가 폰 어플로 했어요 펀드였고요 손실이 이렇게 클 줄은 몰랐습니다",
    expect: { channel: "ONLINE", product: "INV_FUND" },
    absent: ["age", "contract_ym"],
  },
  {
    id: "r-lure-family-age",
    probe: "남편 나이(함정)와 본인 가입 당시 나이가 공존",
    statement:
      "남편은 지금 일흔아홉이고요 이건 제 앞으로 든 겁니다 제가 예순아홉에 전화로 들었어요 뭘 들었는지는 서류를 봐야 알겠어요",
    expect: { channel: "TM", age: 69 },
    absent: ["product", "contract_ym"],
  },

  // ── 특성·복합 ───────────────────────────────────────────────
  {
    id: "r-inexp",
    probe: "투자 경험 없음 — INEXP · 연도만",
    statement:
      "저는 주식이니 펀드니 그런 건 평생 해본 적이 없는 사람이에요 그런데 이천이십년에 은행 창구 직원이 ELS라는 걸 정기예금처럼 안전하다고 해서 예순여섯에 처음 넣어봤어요",
    expect: { channel: "BRANCH", product: "INV_ELS", age: 66, traits: ["INEXP"] },
    absent: ["contract_ym"],
  },
  {
    id: "r-family-pro-trap",
    probe: "아들이 증권사 직원 — 본인이 전문투자자인 게 아니다",
    statement:
      "우리 아들이 증권회사에 다니는데도 저한테 말도 없이 제가 2019년 7월에 전화로 연금보험을 들었어요 그때 일흔하나였습니다",
    expect: { channel: "TM", product: "INS_ANNUITY", age: 71, contract_ym: "2019-07" },
  },
  {
    id: "r-two-products",
    probe: "예금하러 갔다가 두 상품 — 분쟁 대상은 반토막 난 펀드",
    statement:
      "예금 하러 은행에 갔다가 직원 말 듣고 펀드하고 보험을 같이 들었는데요 보험은 그렇다 치고 펀드가 반토막이 났어요 이게 말이 됩니까",
    expect: { channel: "BRANCH", product: "INV_FUND" },
    absent: ["age", "contract_ym"],
  },
  {
    id: "r-tied-insurance",
    probe: "대출 끼워팔기 — 분쟁 대상은 은행에서 강요된 보험",
    statement:
      "2022년 11월에 대출을 받는데 은행에서 보험을 들어야 대출이 나온다고 해서 어쩔 수 없이 들었습니다 이래도 되는 겁니까",
    expect: { channel: "BANCA_HS", contract_ym: "2022-11" },
    absent: ["age"],
  },
  {
    id: "r-vague-memory",
    probe: "기억 흐림 — 확실한 단서가 하나도 없다",
    statement:
      "하도 오래전 일이라 기억이 가물가물한데 누가 권해서 보험을 하나 들었던 것 같은데 서류를 찾아봐야 알 것 같아요 이런 것도 상담이 됩니까",
    absent: ["channel", "age", "contract_ym"],
  },
  {
    id: "r-mixed-numbers",
    probe: "금액·기간 숫자가 많다 — 슬롯과 무관한 숫자를 끌어 쓰면 안 된다",
    statement:
      "매달 삼십만원씩 오년을 부었는데 해지하면 천만원도 못 받는다고 합니다 십년은 부어야 원금이 된다는 말은 처음 듣습니다 은행 창구에서 저축이라고 해서 든 건데요",
    expect: { channel: "BANCA_HS" },
    absent: ["age", "contract_ym"],
  },
] as const;
