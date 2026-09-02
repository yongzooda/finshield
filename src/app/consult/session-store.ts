/**
 * 봉인된 세션을 화면 사이에 나르는 통로 — `sessionStorage`를 쓰되 막히면 버틴다.
 *
 * URL 질의 문자열에 두지 않는다. 주소창·브라우저 기록·공유 링크에 남으면 안 되고,
 * 길이도 URL에 담기에 크다. `sessionStorage`는 탭을 닫으면 사라지므로
 * 「저장하지 않는다」는 약속과도 어긋나지 않는다.
 *
 * ⚠️ **세션 본체가 여기 있다.** 서버는 아무것도 들고 있지 않다(`seal.ts`).
 * 다만 서버 키로 봉인돼 있어 브라우저는 내용을 열어볼 수 없다.
 */

const KEY = "precase.session";

/**
 * 스토리지가 막힌 인앱 브라우저용 대비책 (N-701).
 *
 * 카카오톡 인앱 브라우저처럼 `sessionStorage`가 예외를 던지는 환경이 있다.
 * 예전에는 그 예외를 삼키기만 해서, **상담을 끝까지 마친 뒤 S-04에서
 * 「이어서 볼 상담이 없습니다」로 막다른 길**이 됐다 — 몇 분과 모델 호출을
 * 쓰고 나서야 알게 되는 실패다.
 *
 * S-03 → S-04는 `<Link>` 소프트 내비게이션이라 JS 컨텍스트가 유지된다.
 * 그래서 모듈 변수 하나로 정상 경로는 살아남는다. 새로고침하면 사라지지만
 * 그때는 어차피 `sessionStorage`도 못 읽는 상태다.
 */
let inMemory: string | null = null;

/**
 * 상담에서 판단으로 **방금** 건너왔다는 표시 (T-5).
 *
 * 새로고침·주소 직접 입력은 JS 컨텍스트가 새로 뜨므로 이 값이 false다. 그래서
 * 「소프트 내비게이션으로 넘어온 진입」과 「새로 연 화면」을 구분할 수 있다.
 *
 * 구분이 필요한 이유는 **판단이 90초와 모델 호출을 쓰기 때문**이다. 새로 연
 * 화면에서 자동으로 다시 돌리면, 결과를 보다 새로고침한 사람에게 아무 설명
 * 없이 2분을 더 쓰게 하고 일일 판단 상한(N-203)까지 깎는다.
 *
 * 한 번 쓰면 내린다 — 뒤로/앞으로로 판단 화면에 다시 들어오는 것도 자동
 * 재실행 대상이 아니다.
 */
let handoffArmed = false;

export function keepSession(id: string): void {
  inMemory = id;
  handoffArmed = true;
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    // 스토리지가 막혔다. 위 메모리 사본으로 같은 탭 안에서는 이어진다
  }
}

export function takeSession(): string | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored) return stored;
  } catch {
    // 아래 메모리 사본으로 내려간다
  }
  return inMemory;
}

export function dropSession(): void {
  inMemory = null;
  handoffArmed = false;
  dropReconsult();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* 위와 같다 */
  }
}

// ─────────────────────────── 유보 이어가기 (F-308 확장 · R-07 ①)

/**
 * S-04 유보 → S-03 재진입에 실어 보내는 것: 판단 후 재봉인된 세션과 «필요
 * 자료» 목록. 목록은 **화면 표시용**이다 — 모델에 들어가는 정본은 봉인 안에
 * 있고(`seal.ts`), 서버는 클라이언트가 보낸 목록을 받지 않는다.
 *
 * **읽으면 지운다.** 남겨 두면 나중에 홈에서 새 상담을 열었을 때 이어가기로
 * 잘못 부팅한다. 재진입 화면을 새로고침하면 사라지는데, 그때는 처음부터가
 * 맞다 — 어차피 쓰던 진술도 새로고침에 사라져 있다.
 */
const RECONSULT_KEY = "precase.reconsult";
let reconsultInMemory: { token: string; needed: string[] } | null = null;

export function keepReconsult(token: string, needed: readonly string[]): void {
  reconsultInMemory = { token, needed: [...needed] };
  try {
    sessionStorage.setItem(RECONSULT_KEY, JSON.stringify(reconsultInMemory));
  } catch {
    // 스토리지가 막혔다 — 메모리 사본으로 소프트 내비게이션은 건넌다 (N-701)
  }
}

export function takeReconsult(): { token: string; needed: string[] } | null {
  let found = reconsultInMemory;
  try {
    const raw = sessionStorage.getItem(RECONSULT_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { token?: unknown; needed?: unknown };
      if (typeof v.token === "string" && Array.isArray(v.needed)) {
        found = {
          token: v.token,
          needed: v.needed.filter((x): x is string => typeof x === "string"),
        };
      }
    }
  } catch {
    // 메모리 사본으로 내려간다
  }
  dropReconsult();
  return found;
}

export function dropReconsult(): void {
  reconsultInMemory = null;
  try {
    sessionStorage.removeItem(RECONSULT_KEY);
  } catch {
    /* 위와 같다 */
  }
}

/**
 * 판단 화면에 어떻게 들어왔는지.
 *
 * - `HANDOFF` 상담을 마치고 넘어왔다. 바로 판단을 시작한다
 * - `RESTORED` 새로고침·직접 진입. **세션은 살아 있지만 자동으로 돌리지 않는다** (T-5)
 * - `NONE` 이어서 볼 상담이 없다
 */
export type SessionEntry =
  | { kind: "NONE" }
  | { kind: "HANDOFF"; token: string }
  | { kind: "RESTORED"; token: string };

export function takeEntry(): SessionEntry {
  const token = takeSession();
  if (!token) return { kind: "NONE" };
  if (handoffArmed) {
    handoffArmed = false;
    return { kind: "HANDOFF", token };
  }
  return { kind: "RESTORED", token };
}
