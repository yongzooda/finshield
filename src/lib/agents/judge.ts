/**
 * ③ 판단 계층 (F-304 · F-305 · SR-402·403).
 *
 * 두 가지가 이 계층을 규정한다.
 *
 * **하나. 원문을 받지 않는다.** `JudgeInput`에 원문 계열 필드가 없어서 넘길 수
 * 없다 (types.ts의 컴파일 시점 단언). 감정적 호소·요구가 결론을 흔드는 경로를
 * 타입으로 끊는 것이다.
 *
 * **둘. 유사 조정례를 프롬프트에 넣지 않는다.** 이건 취향이 아니라 측정 결과다
 * (기획서 6.5) — 유사사례를 주입하면 정확도는 그대로인데(91/120, McNemar p=1.000)
 * 확신도 4점 이상 사건이 85 → 71건으로 줄고 유보 구간이 baseline과 구분되지
 * 않는 상태로 돌아간다(p=0.044). 표면이 비슷한 분쟁일수록 사실관계의 미세한
 * 차이로 결론이 갈리기 때문에, 상충하는 선례가 판단을 흔든다.
 * 조정례는 이용자에게 **참고 자료로 보여줄 뿐**이며 아래 `judgePrompt`가
 * `evidence.cases`를 읽지 않는 것이 그 구현이다.
 *
 * 확신도는 프롬프트 자기평가 1~5 정수다 (U-1). 로그확률이 아니다. 임계는
 * `env.CONFIDENCE_THRESHOLD`에서만 읽는다 — 하드코딩은 절대 규칙 4 위반이다.
 *
 * ⚠️ **확신도 지시문을 임의로 늘리지 마라 (2026.08.17 실측).**
 *
 * 한때 이 프롬프트에 5단계 루브릭이 붙어 있었다(「4: 결론이 서지만 일부 사실이
 * 확인되지 않았다 / 3: 사실관계가 갈리면 결론이 뒤집힐 수 있다 … 근거 공백이
 * 있거나 확인되지 않은 사실이 결론을 좌우한다면 3점 이하를 준다」 + 「후하게 주지
 * 마라」). **명세에 없는 문구였고, 측정된 적도 없다.**
 *
 * 결과는 심각했다 — 서로 다른 사실관계 5종을 태운 실주행에서 **전부 유보**가
 * 나왔다. 근거가 완비된 교과서적 적합성원칙 위반(고령·설문 대리작성·손실설명
 * 없음, 법령 5·조정례 5·공백 0)조차 확신도 3이었다. 분쟁은 **정의상** 사실관계가
 * 갈리므로, 마지막 줄이 4점 구간을 통째로 삼킨 것이다.
 *
 * 공개 수치(커버리지 66~71%)를 만든 검증 하네스(`pilot_law.py`)의 확신도 지시는
 * **한 줄뿐이다** — 「결론이 불확실하면 확신도를 낮게 매긴다. 억지로 확신하지
 * 마라.」 지금 문구는 그것과 같다. 수치를 유리하게 굴린 것이 아니라 **측정된
 * 대상과 구현을 일치시킨 것**이다.
 *
 * ⚠️ **위원회 법리는 옮겼고, 법령 목록은 옮기지 않았다 (2026.08.17).**
 *
 * 같은 사건(제2010-32호)에 같은 입력 1,290자를 넣었을 때 하네스는 확신도 4,
 * 이 구현은 3이었다. 입력 차이도 루브릭도 아니었고, **하네스 프롬프트에 있는
 * 「위원회의 확립된 판단 원칙」이 여기 없다는 것**이 남은 차이였다. 조문 텍스트는
 * 도구가 가져다주지만, 그 조문을 **어떻게 적용하는지**에 관한 기준이 없으면
 * 모델이 결론에 확신을 갖기 어렵다. 그래서 원칙 부분만 그대로 옮겼다.
 *
 * **법령 목록은 옮기지 않았다.** 하네스 프롬프트는 시점별 적용 법령을 나열하는데,
 * 그러면 모델이 기억에 있는 조문을 인용하게 되어 「도구가 반환한 것만 인용한다」가
 * 무너진다(절대 규칙 1). 조문의 출처는 계속 도구뿐이다.
 *
 * 남는 긴장 — 위 원칙 서술에 조문 성격의 표현이 섞여 있다. 그것이 화면으로
 * 새지 않는 것은 N-405 대조가 ④ 안내 계층과 렌더 계층 양쪽에서 막는다.
 *
 * ⚠️ 남은 차이 — 하네스는 **완결된 조정례의 사실관계**를 넣고 위원회 결정을
 * 예측했고, 이 서비스는 **소비자 진술에서 정제한 사실관계**를 넣는다. 정보량이
 * 다르므로 실제 커버리지는 공개 수치와 다를 수 있다. 그 조건을 `validation_stats`
 * 단서에 밝혀 두었다.
 */

import "server-only";
import { z } from "zod";
import { callStructured, ModelFormatError } from "./model";
import { env } from "../env";
import type { Trace } from "./trace";
import type { Evidence, JudgeInput, Judgment, JudgmentOutcome } from "./types";

/**
 * 판단이 볼 수 있는 근거의 부분집합. **`cases`가 없다** (기획서 6.5).
 * 필드를 추가하려면 그 근거가 판단을 개선한다는 측정이 먼저 있어야 한다.
 */
type JudgeVisibleEvidence = Pick<
  Evidence,
  "statutes" | "precedents" | "documents" | "riskPattern" | "gaps"
>;

// 조정례가 판단 프롬프트로 새는 경로를 컴파일 시점에 막는다.
type _AssertNoCases = "cases" extends keyof JudgeVisibleEvidence
  ? ["기획서 6.5 위반: 유사 조정례가 판단 입력에 들어갔다"]
  : true;
export const _judgeSeesNoCases: _AssertNoCases = true;

const JudgeOutput = z.object({
  /** 위반 가능성. 채점 매핑은 높음↔UPHELD / 낮음↔REJECTED (데이터 3장) */
  conclusion: z.enum(["LIKELY", "UNLIKELY"]),
  /** 1~5 정수 자기평가. 근거가 부족하면 낮게 매기는 것이 정상 동작이다 */
  confidence: z.number().int().min(1).max(5),
  /** 판단이 선 쟁점 */
  issues: z.array(z.string()),
  /** 결론에 이른 이유. 법령은 위에 제시된 조문만 인용한다 */
  reasoning: z.string(),
  /** 판단이 뒤집힐 수 있는 조건 (F-306 ④) */
  changesIf: z.array(z.string()),
  /** 확신도를 4점 미만으로 준 경우, 무엇이 있으면 판단 가능한지 (F-307) */
  needed: z.array(z.string()),
});

const SYSTEM = `당신은 금융 분쟁조정 사건에서 금융회사의 판매 과정에 법령 위반 가능성이 있는지 판단한다.
금융분쟁조정위원회의 판단 기준을 따른다.

## 판단 범위
- 결론은 두 가지뿐이다. LIKELY(위반 가능성 높음) 또는 UNLIKELY(위반 가능성 낮음).
- 배상액·배상비율을 산정하지 않는다.
- 법률 자문을 하지 않는다. 소송 전망을 말하지 않는다.

## 법령 인용
- **아래 「근거 법령」에 제시된 조문만 인용한다.** 제시되지 않은 법령·조문은 기억에 있더라도 쓰지 않는다.
- 조문 번호를 새로 만들지 않는다. 조문 내용을 지어내지 않는다.
- 제시된 조문이 사건에 맞지 않으면 그 사실을 reasoning에 적는다.

## 위원회의 확립된 판단 원칙
조문을 어떻게 적용하는지에 관한 기준이다. 아래 원칙에 비추어 사실관계를 평가한다.

- **약관 해석** — 신의성실의 원칙에 따라 공정하게, 평균적 고객의 이해가능성을 기준으로
  객관적·획일적으로 해석한다. 약관의 뜻이 명백하지 않으면 고객에게 유리하게 해석한다
  (작성자 불이익 원칙).
- **고지의무** — 위반이 성립하려면 ① 중요한 사항이고 ② 계약자에게 고의 또는 중대한
  과실이 있어야 한다. 둘 다 필요하다. 고지의무 위반과 보험사고 사이에 인과관계가 없으면
  계약을 해지하더라도 보험금은 지급하여야 한다.
- **자기책임** — 투자 손실 그 자체는 배상 대상이 아니다. 판매 과정에서 법령 위반이
  인정되어야 비로소 배상책임이 성립한다.
- **입증책임** — 주장하는 쪽이 입증한다. 다만 금융소비자보호법 시행(2021.3.25) 이후
  사건에서 설명의무 위반이 인정되면 금융회사가 무과실을 입증해야 한다.

## 판단 태도
- 신청인의 감정적 호소가 아니라 사실관계와 법리로만 판단한다.
- 사실관계에 없는 내용을 추정하지 않는다.

## 확신도 (1~5 정수)
당신이 이 결론을 얼마나 확신하는지 스스로 매긴다.
결론이 불확실하면 확신도를 낮게 매긴다. 억지로 확신하지 마라.

## needed
확신도가 4점 미만이면, 무엇이 확인되면 판단할 수 있는지 이용자가 구할 수 있는 자료 단위로 적는다.
예: "가입 당시 서명한 상품설명서", "해피콜 녹취". 4점 이상이면 빈 배열.

## changesIf
결론이 뒤집힐 수 있는 조건을 적는다. 어느 결론이든 적는다.`;

/**
 * **측정 전용** — 확신도 절만 바꾼 시스템 프롬프트를 만든다 (D-7 루브릭
 * 본실험 · 01-scope 9.1 R-04 파생 기준). 제품 경로는 이 함수를 거치지
 * 않으므로 운영 프롬프트는 바이트 단위로 무변경이다 — 공개 수치가 유효한
 * 근거다.
 *
 * 절 경계는 「## 확신도」 헤더부터 「## needed」 직전까지. 경계를 못 찾으면
 * 던진다 — 변형이 적용되지 않은 채 측정되는 것이 조용한 최악이다.
 */
export function buildJudgeSystemWithRubric(rubric: string): string {
  const start = SYSTEM.indexOf("## 확신도");
  const end = SYSTEM.indexOf("## needed");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("확신도 절 경계를 찾지 못했다 — SYSTEM 구조가 바뀌었는지 확인할 것");
  }
  return SYSTEM.slice(0, start) + rubric.trimEnd() + "\n\n" + SYSTEM.slice(end);
}

/** 근거를 프롬프트 텍스트로 만든다. **조정례는 여기 들어오지 않는다** */
function evidenceText(e: JudgeVisibleEvidence): string {
  const parts: string[] = [];

  parts.push("## 근거 법령");
  if (e.statutes.length === 0) {
    parts.push("확보된 조문이 없다. 법령을 인용하지 말고 그 사실을 밝혀라.");
  } else {
    for (const s of e.statutes) {
      const moved = s.transferredTo
        ? `\n(이관: ${s.transferredTo.lawName} ${s.transferredTo.articleNo}${s.transferredTo.note ? " — " + s.transferredTo.note : ""})`
        : "";
      parts.push(
        `### ${s.lawName} ${s.articleNo}${s.articleTitle ? ` ${s.articleTitle}` : ""}` +
          ` [출처 ${s.source}, 확인 ${s.checkedAt}]${moved}\n${s.articleText}`,
      );
    }
  }

  parts.push("\n## 판례");
  parts.push(
    e.precedents.length === 0
      ? "대조에 성공한 판례가 없다. 판례를 인용하지 마라."
      : e.precedents
          .map((p) => `- ${p.caseNo} ${p.caseName}${p.judgmentDate ? ` (${p.judgmentDate})` : ""}`)
          .join("\n"),
  );

  if (e.documents) {
    parts.push("\n## 통상 필요한 증빙");
    parts.push(e.documents.required.map((d) => `- ${d.label}: ${d.why}`).join("\n"));
    if (e.documents.relatedClauses.length) {
      parts.push("\n## 관련 약관 조항 (과거 조정례에서 인용된 것)");
      parts.push(
        e.documents.relatedClauses.map((c) => `- [${c.issueCode}] ${c.clauseText}`).join("\n"),
      );
    }
  }

  if (e.riskPattern) {
    parts.push(`\n## 유사 조건 쟁점 집계 (${e.riskPattern.statBasis})`);
    parts.push(
      e.riskPattern.issues
        .map(
          (i) =>
            `- ${i.issueLabel}: ${i.nCases}건 중 인정 ${i.nUpheld} · 기각 ${i.nRejected}`,
        )
        .join("\n"),
    );
    parts.push(
      "이 집계는 빈도이지 이 사건의 결론이 아니다. 결론의 근거로 쓰지 말고 참고만 하라.",
    );
  }

  if (e.gaps.length) {
    parts.push("\n## 근거 공백");
    parts.push(e.gaps.map((g) => `- ${g}`).join("\n"));
    parts.push("공백은 확신도에 반영하라.");
  }

  return parts.join("\n");
}

/**
 * 판단 프롬프트를 만든다. **테스트가 이 함수를 직접 호출한다** —
 * 기획서 6.5(조정례 미주입)는 타입만으로는 못 지킨다. `evidence.cases`를
 * 실수로 문자열에 끼워 넣는 회귀를 잡으려면 완성된 프롬프트를 검사해야 한다.
 */
export function buildJudgePrompt(input: JudgeInput): string {
  const s = input.slots;
  return `## 사건
- 상품군: ${s.product}
- 판매채널: ${s.channel}
- 가입 연월: ${s.contract_ym}
- 가입 당시 나이: ${s.age}
- 소비자 특성: ${s.traits.join(", ")}
${s.confirm_call ? `- 사후확인콜: ${s.confirm_call}\n` : ""}${
    s.survey_writer ? `- 적합성 설문 작성자: ${s.survey_writer}\n` : ""
  }${s.explained_loss ? `- 원금손실 설명 수령: ${s.explained_loss}\n` : ""}
## 쟁점
${input.facts.issues.join(", ") || "미확정"}

## 사실관계
${input.facts.statements.map((x) => `- ${x}`).join("\n")}

${
  input.facts.unresolved.length
    ? `## 확인되지 않은 사실\n${input.facts.unresolved.map((x) => `- ${x}`).join("\n")}\n확인되지 않은 사실이 결론을 좌우한다면 확신도를 낮춰라.\n`
    : ""
}
${evidenceText(input.evidence)}`;
}

/**
 * **측정 전용** — 임계를 적용하기 전의 판단을 그대로 돌려준다.
 *
 * 임계가 제자리인지 보려면 4점 미만 사건이 «무엇이라고 답했을 것인가»를 알아야
 * 한다(기획서 3.3의 「4점 미만 구간 정확도 57%」가 그렇게 나온 값이다).
 * 그런데 제품 경로인 `judge()`는 임계 미만이면 결론을 **버린다** — 절대 규칙 4가
 * 「4점 미만 결론 미표시」이므로 결론을 들고 다니면 화면으로 샐 여지가 생긴다.
 *
 * 그래서 측정만 이 함수를 쓴다. **`src/app` 아래에서 import하면 테스트가 깨진다.**
 * 형식 오류는 null이다.
 *
 * `systemOverride`도 측정 전용이다 — 루브릭 변형 실험이
 * `buildJudgeSystemWithRubric` 결과를 넣는 자리이며, 제품 경로 `judge()`는
 * 이 인자를 노출하지 않는다.
 */
export async function judgeRaw(
  input: JudgeInput,
  trace: Trace,
  systemOverride?: string,
): Promise<Judgment | null> {
  const outcome = await judgeInternal(input, trace, systemOverride);
  return outcome.raw;
}

export async function judge(input: JudgeInput, trace: Trace): Promise<JudgmentOutcome> {
  return (await judgeInternal(input, trace)).outcome;
}

async function judgeInternal(
  input: JudgeInput,
  trace: Trace,
  systemOverride?: string,
): Promise<{ outcome: JudgmentOutcome; raw: Judgment | null }> {
  // SR-402를 로그에도 남긴다 — 판단이 받은 것은 정제 사실관계와 근거뿐이라는 사실은
  // 타입(JudgeInput)이 강제하지만, 이용자·심사자가 보는 실행 로그에는 그동안 이 줄이
  // 없었다. 기획서 6.7의 「사용자 원문 미접근」과 제품 로그를 일치시킨다. 코드가 찍는
  // 정적 문장이라 환각 여지가 없다
  trace.info("JUDGE", "정제된 사실관계와 수집한 근거만 전달받았습니다 · 사용자 원문 미접근");
  let out: z.infer<typeof JudgeOutput>;
  try {
    out = await callStructured({
      system: systemOverride ?? SYSTEM,
      user: buildJudgePrompt(input),
      schema: JudgeOutput,
      // 판단이 가장 깊다. 근거를 대조하고 반대 결론까지 검토해야 한다.
      effort: "high",
      maxTokens: 12_000,
    });
  } catch (e) {
    if (!(e instanceof ModelFormatError)) throw e;
    // 형식이 깨진 판단을 억지로 해석하면 그게 환각이다. 유보로 보낸다 (EX-303).
    // ⚠️ 예외 메시지를 싣지 않는다 (N-403). 형식 오류 메시지에는 모델이 낸
    // 깨진 출력 조각이 섞여 들어오고, 그 출력은 사실관계에서 파생된 것이다.
    trace.warn("JUDGE", "판단 결과를 형식대로 받지 못해 유보합니다");
    return {
      outcome: { kind: "WITHHELD", reason: "FORMAT_ERROR", needed: [], confidence: null },
      raw: null,
    };
  }

  const judgment: Judgment = {
    conclusion: out.conclusion,
    confidence: out.confidence as Judgment["confidence"],
    issues: out.issues,
    reasoning: out.reasoning,
    changesIf: out.changesIf,
  };

  // 확신도는 유보든 아니든 항상 기록한다 — 임계 재보정의 원자료다 (A-6).
  trace.info("JUDGE", "판단을 마쳤습니다", {
    confidence: judgment.confidence,
    threshold: env.CONFIDENCE_THRESHOLD,
    statutes: input.evidence.statutes.length,
    gaps: input.evidence.gaps.length,
  });

  if (judgment.confidence < env.CONFIDENCE_THRESHOLD) {
    trace.warn("JUDGE", "확신도가 기준에 미치지 않아 결론을 표시하지 않습니다", {
      confidence: judgment.confidence,
      threshold: env.CONFIDENCE_THRESHOLD,
    });
    return {
      outcome: {
        kind: "WITHHELD",
        // 근거 자체가 비었으면 사유를 그렇게 잡는다 — 안내 문구가 달라진다 (F-307)
        reason: input.evidence.statutes.length === 0 ? "INSUFFICIENT_EVIDENCE" : "LOW_CONFIDENCE",
        needed: out.needed,
        confidence: judgment.confidence,
      },
      raw: judgment,
    };
  }

  return { outcome: { kind: "CONCLUDED", judgment }, raw: judgment };
}
