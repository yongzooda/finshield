/**
 * F-606 도구 반환값 필터 (기획서 9.4 · EC-2).
 *
 * **반환값은 인용 대상이지 지시 대상이 아니다.** 도구가 가져온 텍스트에 모델을
 * 겨냥한 명령문이 섞여 있어도 그것은 자료일 뿐이며, 실행 대상이 되어선 안 된다.
 *
 * EC-2는 "모든 외부 반환값"을 대상으로 하지만 여기서는 DB 조회 결과에도 적용한다.
 * 조정례 원문·약관 조항은 우리가 작성한 문장이 아니라 외부 문서에서 추출한
 * 텍스트이고, 적재 경로가 바뀌면 무엇이 들어올지 보장할 수 없기 때문이다.
 *
 * 방식은 삭제가 아니라 **표시**다. 근거 원문을 임의로 잘라내면 인용의 정확성이
 * 깨지고(C-6), 무엇이 걸렸는지 실행 로그에 남길 수도 없다. 걸린 텍스트는
 * 무해화 표기로 감싸 "이것은 자료다"를 명시하고, 걸렸다는 사실을 함께 반환한다.
 */

/** 모델에게 행동을 지시하려는 형태의 패턴. 한국어·영어 양쪽을 본다 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  // 역할·지시 주입
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)/gi,
  /you\s+are\s+now\s+a\b/gi,
  /system\s*(prompt|message)\s*[:：]/gi,
  /\b(assistant|user|system)\s*[:：]\s*$/gim,
  /<\s*\/?\s*(system|assistant|user|instructions?)\s*>/gi,
  // 한국어 지시문
  // 조사는 을/를 둘 다 받는다 — 「지시를 무시」가 「지시을 무시」보다 흔하다
  /(이전|위|앞)의?\s*(모든\s*)?(지시|명령|지침|프롬프트)(사항)?[을를]?\s*(무시|잊)/g,
  /(너는|당신은)\s*(이제|지금부터)\s*[^\s]{1,20}(이다|입니다|야)/g,
  /(반드시|무조건)\s*[^\n]{0,30}(하라|해라|하시오|출력하라)/g,
  // 출력 조작
  /(출력|응답|답변)(을|를)?\s*(대신|다음으로|아래와\s*같이)\s*(하라|해라|바꿔)/g,
  /print\s+the\s+following\s+verbatim/gi,
];

export type FilteredText = {
  /** 무해화된 텍스트. 걸린 구간은 표기로 감싸여 있다 */
  text: string;
  /** 걸린 패턴 수. 0이 아니면 실행 로그에 남긴다 (EP-6) */
  flagged: number;
};

const OPEN = "〔자료〕";
const CLOSE = "〔/자료〕";

/**
 * 명령문 패턴을 무해화 표기로 감싼다. 원문 자체는 보존한다.
 * 이미 감싼 표기가 텍스트에 들어 있으면 먼저 제거한다 — 표기를 위조해
 * 필터를 통과한 것처럼 보이게 만드는 경로를 막는다.
 */
export function filterToolText(raw: string): FilteredText {
  let text = raw.split(OPEN).join("").split(CLOSE).join("");
  let flagged = 0;

  for (const pattern of INSTRUCTION_PATTERNS) {
    text = text.replace(new RegExp(pattern.source, pattern.flags), (m) => {
      flagged += 1;
      return `${OPEN}${m}${CLOSE}`;
    });
  }
  return { text, flagged };
}

/**
 * 객체의 지정 필드를 일괄 필터링한다. 도구가 반환 직전에 부른다.
 * 걸린 총 횟수를 함께 돌려주므로 호출부가 실행 로그에 기록할 수 있다.
 */
export function filterFields<T extends object>(
  row: T,
  fields: readonly (keyof T)[],
): { row: T; flagged: number } {
  let flagged = 0;
  const out = { ...row };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === "string") {
      const r = filterToolText(v);
      flagged += r.flagged;
      out[f] = r.text as T[keyof T];
    }
  }
  return { row: out, flagged };
}
