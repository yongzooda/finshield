/**
 * 해피콜 응답 연습 — 정적 분기 시나리오 (R-06 · SR-214).
 *
 * **모델을 부르지 않는다.** 문장은 전부 코드 상수다(S-12·브리핑과 같은 규약).
 * 서버에 아무것도 저장하지 않는다 — 진행·답변은 화면 상태에만 있다 (P-3).
 *
 * ## 왜 이 연습이 있나
 *
 * 코퍼스의 실제 사건에서 **확인콜(해피콜) 응답이 설명의무 이행의 증거로
 * 사용됐다**(기획서 5장 채널 분석). 상담 슬롯에 `confirm_call`이 있고 보험 +
 * 설명의무 쟁점에서 필수로 승격되는 이유도 같다 — 해피콜 녹취는 나중에
 * 분쟁에서 양쪽 모두가 꺼내 드는 기록이다.
 *
 * 그래서 이 연습의 중심 메시지는 요령이 아니라 **「사실대로 답하라」**다.
 * 듣지 않은 설명을 들었다고 답하면 그 녹취가 남는다. 해피콜은 시험이
 * 아니고, 「아니요」나 「기억나지 않는다」도 답이다.
 *
 * ## 표현 규칙 (P-2 · SR-X02)
 *
 * 특정 답변을 하면 유리하다·이긴다는 서술 금지. 판매자·보험사를 가해자로
 * 단정하는 톤 금지. 법률 자문 아님 — 무엇이 기록으로 남는지만 말한다.
 *
 * 축소 순서 0-2 — 일정이 밀리면 라우트·시나리오만 제거한다 (01-scope R-06).
 */

export type HappycallAnswer = {
  /** 선택지 버튼 문구 */
  label: string;
  /**
   * 이 답을 골랐을 때 보이는 해설 — 연습의 본체. 「이 답이 무엇으로
   * 기록되는가」를 말하고, 유불리 단정은 하지 않는다.
   */
  meaning: string;
  /** 다음 질문. null이면 마무리로 간다 */
  next: string | null;
};

export type HappycallNode = {
  id: string;
  /** 상담원이 실제로 묻는 형태 */
  question: string;
  /** 이 질문이 해피콜에 있는 이유 — 근거 병기 (브리핑 basis와 같은 원칙) */
  why: string;
  answers: readonly HappycallAnswer[];
};

export type HappycallScenario = {
  id: string;
  title: string;
  /** 시작 전 안내 */
  intro: readonly string[];
  start: string;
  nodes: readonly HappycallNode[];
  /** 마무리 정리 — 답변 recap과 함께 보인다 */
  outro: readonly string[];
};

/** 「기억이 안 나요」 계열의 공통 해설 — 세 질문에서 같은 원칙이라 한 번만 적는다 */
const UNSURE_MEANING =
  "기억이 나지 않으면 그렇게 답하셔도 됩니다. 해피콜은 시험이 아니라 확인 절차라서, " +
  "불확실한 것을 「네」로 덮는 것보다 사실대로 남기는 쪽이 나중에 기록을 다툴 일을 줄입니다.";

export const TM_INSURANCE: HappycallScenario = {
  id: "TM_INSURANCE",
  title: "전화(TM)로 보험에 가입한 경우",
  intro: [
    "보험에 가입하면 며칠 안에 보험사에서 확인 전화(해피콜)가 옵니다. 가입 과정에 문제가 없었는지 묻고, 통화는 녹음됩니다.",
    "이 녹음은 나중에 분쟁이 생기면 양쪽 모두가 꺼내 보는 기록이 됩니다. 실제 분쟁조정 사례에서 확인콜 응답이 설명을 들었다는 증거로 쓰인 일이 있습니다.",
    "그래서 미리 한 번 연습해 봅니다. 정답을 맞히는 연습이 아니라, 사실대로 답해도 된다는 것을 확인하는 연습입니다.",
  ],
  start: "self-sign",
  nodes: [
    {
      id: "self-sign",
      question: "청약서에 고객님께서 직접 서명하셨습니까?",
      why: "자필 서명 여부는 계약이 본인 뜻으로 이루어졌는지의 기본 확인 항목입니다.",
      answers: [
        {
          label: "네, 제가 직접 했습니다",
          meaning:
            "「직접 서명했다」는 답변이 녹음으로 남습니다. 사실과 같다면 그대로 답하시면 됩니다.",
          next: "explain",
        },
        {
          label: "아니요, 다른 사람이 대신 했습니다",
          meaning:
            "대신 서명한 사실이 있다면 그대로 말씀하는 것이 맞습니다. 여기서 「네」라고 덮으면, " +
            "나중에 대리 서명을 다투려 할 때 본인 음성으로 반대 기록이 남아 있게 됩니다.",
          next: "explain",
        },
        {
          label: "기억이 잘 안 나요",
          meaning: UNSURE_MEANING,
          next: "explain",
        },
      ],
    },
    {
      id: "explain",
      question: "상품의 주요 내용과 유의사항에 대한 설명을 들으셨습니까?",
      why:
        "실제 분쟁조정 사례에서 이 질문에 대한 답변이 설명의무 이행의 증거로 사용됐습니다. " +
        "이 연습에서 가장 중요한 질문입니다.",
      answers: [
        {
          label: "네, 들었습니다",
          meaning:
            "「설명을 들었다」는 답변이 녹음으로 남고, 나중에 설명 부족을 다투게 되면 이 녹음과 " +
            "마주하게 됩니다. 실제로 충분히 들으셨다면 그대로 답하시면 됩니다.",
          next: "refund",
        },
        {
          label: "아니요, 못 들었습니다",
          meaning:
            "듣지 않았다면 그렇게 답하는 것이 맞습니다. 들은 만큼만 답하면 되고, " +
            "듣지 않은 설명을 들었다고 답할 이유가 없습니다.",
          next: "refund",
        },
        {
          label: "일부만 들었습니다",
          meaning:
            "들은 부분과 못 들은 부분을 나눠 말씀하셔도 됩니다. 「대체로 들었으니 네」로 " +
            "합치는 것보다 정확한 기록이 남습니다.",
          next: "refund",
        },
      ],
    },
    {
      id: "refund",
      question: "중도에 해지하면 돌려받는 금액이 납입한 보험료보다 적을 수 있다는 안내를 받으셨습니까?",
      why:
        "해지환급금은 공개 조정례에서 반복되는 다툼 지점입니다. 사전 점검의 「판매자에게 확인할 것」 " +
        "첫 질문이 이것인 이유이기도 합니다.",
      answers: [
        {
          label: "네, 들었습니다",
          meaning: "안내받은 사실이 있다면 그대로 답하시면 됩니다. 그 답변이 녹음으로 남습니다.",
          next: "docs",
        },
        {
          label: "아니요, 처음 듣는 얘기입니다",
          meaning:
            "처음 듣는 내용이라면 지금 이 통화에서 되물으셔도 됩니다 — 「얼마나 적어질 수 " +
            "있습니까?」. 해피콜은 확인 절차라서, 확인이 안 된 것을 확인됐다고 답할 필요가 없습니다.",
          next: "docs",
        },
        {
          label: "기억이 잘 안 나요",
          meaning: UNSURE_MEANING,
          next: "docs",
        },
      ],
    },
    {
      id: "docs",
      question: "약관과 청약서 부본, 상품설명서를 받으셨습니까?",
      why:
        "전화 가입은 서류가 나중에 오는 구조라, 서류를 받았는지가 확인 항목에 들어 있습니다. " +
        "실제로 계약서류가 가입 한 달 뒤에야 도착해 다툼이 된 사례가 있습니다.",
      answers: [
        {
          label: "네, 받았습니다",
          meaning: "받으신 것이 맞다면 그대로 답하시면 됩니다.",
          next: null,
        },
        {
          label: "아직 못 받았습니다",
          meaning:
            "받지 않으셨다면 그렇게 답하고 보내 달라고 요청하시면 됩니다. 서류가 언제 왔는지는 " +
            "나중에 확인 가능한 사실이라, 받지 않은 것을 받았다고 답하면 기록끼리 어긋나게 됩니다.",
          next: null,
        },
        {
          label: "왔는지 확인을 못 해봤어요",
          meaning: UNSURE_MEANING,
          next: null,
        },
      ],
    },
  ],
  outro: [
    "해피콜은 시험이 아니라 기록입니다. 잘 답하는 요령보다, 사실과 다른 「네」를 만들지 않는 것이 중요합니다.",
    "실제 통화가 기억나지 않으면 — 해피콜 녹음은 보험사가 보관하며, 분쟁조정이나 소송 같은 권리구제 목적이라면 자료 열람을 요구할 수 있습니다.",
    "이 연습은 교육용이며, 실제 해피콜의 질문 순서·문구는 회사와 상품에 따라 다릅니다.",
  ],
};


/**
 * 방카슈랑스(은행에서 가입한 보험) 시나리오 — **분기 구조를 실제로 쓴다.**
 *
 * 「예금인 줄 알고 가입한 보험」은 공개 조정례에서 반복되는 방카 분쟁의
 * 전형 서사다(사전 점검 멈춤 신호·상담 측정 실전형 세트가 같은 서사를
 * 다룬다). 그래서 첫 질문에서 갈린다 — 보험인 줄 몰랐다는 답이 나오면
 * 바로 다음 질문으로 넘어가지 않고, **지금 이 통화에서 확인하는 길**을
 * 한 단계 거쳐 간다.
 */
export const BANCA_INSURANCE: HappycallScenario = {
  id: "BANCA_INSURANCE",
  title: "은행 창구에서 보험에 가입한 경우",
  intro: [
    "은행 창구에서 가입했더라도 보험이라면 보험사에서 확인 전화(해피콜)가 옵니다. 통화는 녹음됩니다.",
    "은행에서 가입하면 예금이나 적금으로 알기 쉽습니다. 실제 분쟁조정 사례에서 「예금인 줄 알았는데 보험이었다」는 다툼이 반복됩니다.",
    "이 연습도 정답 맞히기가 아닙니다. 모르는 것을 모른다고, 못 들은 것을 못 들었다고 답해도 된다는 것을 확인하는 연습입니다.",
  ],
  start: "is-insurance",
  nodes: [
    {
      id: "is-insurance",
      question: "가입하신 상품이 예금·적금이 아니라 보험 상품이라는 안내를 받으셨습니까?",
      why:
        "은행에서 판 보험(방카슈랑스)에서 가장 자주 다투는 지점입니다. 공개 조정례에 " +
        "「예금인 줄 알고 가입했다」는 서사가 반복됩니다.",
      answers: [
        {
          label: "네, 보험이라고 안내받았습니다",
          meaning: "안내받으신 것이 맞다면 그대로 답하시면 됩니다. 그 답변이 녹음으로 남습니다.",
          next: "refund",
        },
        {
          label: "아니요, 지금 처음 듣습니다",
          meaning:
            "지금 처음 들으셨다면 그대로 말씀하는 것이 맞습니다. 「네」로 답하면 보험임을 " +
            "알고 가입했다는 본인 음성이 남습니다. 다음 단계에서 이 통화로 확인하는 길을 보겠습니다.",
          next: "clarify",
        },
        {
          label: "기억이 잘 안 나요",
          meaning: UNSURE_MEANING,
          next: "clarify",
        },
      ],
    },
    {
      id: "clarify",
      question: "그러면 지금 이 통화에서 확인해 보시겠습니까? — 「이 상품이 예금입니까, 보험입니까?」",
      why:
        "해피콜은 확인 절차라서, 이용자가 되묻는 것도 절차의 일부입니다. 확인하지 않은 " +
        "것을 확인했다고 답할 필요가 없습니다.",
      answers: [
        {
          label: "네, 지금 물어보겠습니다",
          meaning:
            "되물으신 내용과 상담원의 답변이 함께 녹음에 남습니다. 무엇이 애매했는지가 " +
            "기록되는 것이라, 나중에 사실관계를 확인할 때 기준이 됩니다.",
          next: "refund",
        },
        {
          label: "나중에 서류로 확인하겠습니다",
          meaning:
            "상품설명서와 약관의 상품 종류·명칭 부분에서 확인하실 수 있습니다. 서류가 아직 " +
            "없다면 이 통화에서 보내 달라고 요청하셔도 됩니다.",
          next: "refund",
        },
        {
          label: "잘 모르겠습니다",
          meaning: UNSURE_MEANING,
          next: "refund",
        },
      ],
    },
    {
      id: "refund",
      question: "중도해지 시 돌려받는 금액이 납입한 돈보다 적을 수 있다는 설명을 들으셨습니까?",
      why:
        "예금·적금과 달리 일부 보험은 중도해지 시 낸 돈보다 적게 돌려받을 수 있습니다. " +
        "공개 조정례에서 반복되는 다툼 지점입니다.",
      answers: [
        {
          label: "네, 들었습니다",
          meaning: "들으신 것이 맞다면 그대로 답하시면 됩니다.",
          next: "period",
        },
        {
          label: "아니요, 예금처럼 언제든 찾을 수 있다고 들었습니다",
          meaning:
            "들은 대로 답하시면 됩니다. 「언제든 찾을 수 있다」고 들었다는 답변 자체가 " +
            "판매 과정에서 어떤 설명이 있었는지의 기록이 됩니다.",
          next: "period",
        },
        {
          label: "기억이 잘 안 나요",
          meaning: UNSURE_MEANING,
          next: "period",
        },
      ],
    },
    {
      id: "period",
      question: "오래 유지해야 하는 상품이라는 안내(납입 기간·유지 조건)를 받으셨습니까?",
      why:
        "저축성 보험은 일정 기간을 유지해야 낸 돈에 도달하는 구조가 흔해서, 기간 안내가 " +
        "확인 항목에 들어 있습니다.",
      answers: [
        {
          label: "네, 들었습니다",
          meaning: "들으신 것이 맞다면 그대로 답하시면 됩니다.",
          next: null,
        },
        {
          label: "아니요, 기간 얘기는 못 들었습니다",
          meaning:
            "못 들으셨다면 그렇게 답하고, 몇 년을 유지해야 하는지 지금 되물으셔도 됩니다.",
          next: null,
        },
        {
          label: "기억이 잘 안 나요",
          meaning: UNSURE_MEANING,
          next: null,
        },
      ],
    },
  ],
  outro: [
    "해피콜은 시험이 아니라 기록입니다. 예금인 줄 알았다면 그 사실 자체를 말해도 됩니다 — 그 답변이 가장 정확한 기록입니다.",
    "실제 통화가 기억나지 않으면 — 해피콜 녹음은 보험사가 보관하며, 분쟁조정이나 소송 같은 권리구제 목적이라면 자료 열람을 요구할 수 있습니다.",
    "이 연습은 교육용이며, 실제 해피콜의 질문 순서·문구는 회사와 상품에 따라 다릅니다.",
  ],
};

/** 시나리오 목록 */
export const HAPPYCALL_SCENARIOS: readonly HappycallScenario[] = [TM_INSURANCE, BANCA_INSURANCE];

/**
 * 시나리오 무결성 — 테스트가 호출한다. 깨진 참조가 있으면 연습이 중간에
 * 끊기므로, 화면이 아니라 자료 단계에서 막는다.
 */
export function validateScenario(s: HappycallScenario): string[] {
  const errors: string[] = [];
  const ids = new Set(s.nodes.map((n) => n.id));
  if (ids.size !== s.nodes.length) errors.push("노드 id 중복");
  if (!ids.has(s.start)) errors.push(`start가 가리키는 노드 없음: ${s.start}`);
  for (const n of s.nodes) {
    if (n.answers.length < 2) errors.push(`${n.id}: 선택지가 2개 미만`);
    for (const a of n.answers) {
      if (a.next !== null && !ids.has(a.next)) errors.push(`${n.id}: 깨진 참조 ${a.next}`);
      if (!a.meaning.trim()) errors.push(`${n.id}: 해설 없는 선택지 「${a.label}」`);
    }
  }
  // 모든 노드가 start에서 도달 가능한가
  const seen = new Set<string>();
  const walk = (id: string | null) => {
    if (id === null || seen.has(id)) return;
    seen.add(id);
    const node = s.nodes.find((n) => n.id === id);
    for (const a of node?.answers ?? []) walk(a.next);
  };
  walk(s.start);
  for (const n of s.nodes) if (!seen.has(n.id)) errors.push(`도달 불가 노드: ${n.id}`);
  return errors;
}
