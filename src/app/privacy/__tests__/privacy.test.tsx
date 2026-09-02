/**
 * N-504 개인정보 처리방침 검증.
 *
 * 처리방침은 **코드가 실제로 하는 일**을 적은 문서다. 어긋나면 그 자체가 결함이고,
 * 보통은 코드가 바뀔 때 문서만 남는다. 그래서 명세가 요구한 항목이 실제로 적혀
 * 있는지, 그리고 **하지 않는 일을 한다고 쓰지 않았는지**를 검사한다.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PII_TEST_SET_SIZE } from "@/lib/types";
import PrivacyPage from "../page";

const html = renderToStaticMarkup(<PrivacyPage />);

describe("N-504 필수 고지", () => {
  it("저장하지 않는다는 것을 밝힌다", () => {
    expect(html).toContain("저장하지 않습니다");
    expect(html).toContain("30분");
  });

  it("마스킹을 밝힌다", () => {
    expect(html).toContain("자동으로 가립니다");
    expect(html).toContain("아예 보내지 않고");
  });

  it("⚠️ IP 일시 처리를 밝힌다 — 명세가 콕 집어 요구한 항목이다", () => {
    expect(html).toContain("24시간");
    expect(html).toContain("저장하지 않고");
    // 「알아볼 수 없는 형태로」 = 해시. 원본을 두지 않는다는 사실
    expect(html).toContain("알아볼 수 없는 형태");
  });

  it("어디로 나가는지 밝힌다 — 마스킹된 진술이 외부 모델로 간다", () => {
    expect(html).toContain("Anthropic");
    expect(html).toContain("법제처");
  });

  it("민감정보 별도 동의와 이력 미보존을 밝힌다 (F-602 · N-503)", () => {
    expect(html).toContain("개인정보보호법 제23조");
    expect(html).toContain("동의하셨다는 기록도 남기지");
  });
});

describe("실제로 남기는 것을 빠짐없이 적었다", () => {
  // 런타임 롤이 쓸 수 있는 테이블은 4종뿐이다 (마이그레이션 0002·0006).
  // 그중 이용자에게 알려야 하는 것이 아래 셋이다 — 캐시는 공개 자료다.
  it("오류 신고 · 날짜별 횟수 · 법령 캐시", () => {
    expect(html).toContain("오류 신고");
    expect(html).toContain("날짜별 이용 횟수");
    expect(html).toContain("법령·판례 원문");
  });
});

describe("기기 안에서만 움직이는 것도 적었다", () => {
  /**
   * 읽어주기·해피콜 연습·체크리스트 보유 표시는 전부 클라이언트 상태다. 서버로
   * 오지 않으니 「저장한다」에도 「받지 않는다」에도 들어가지 않는데, **적지 않으면
   * 이용자는 음성이 어디론가 나간다고 읽는다.** 특히 음성은 마이크를 떠올리게 한다.
   */
  it("읽어주기 · 해피콜 연습 답 · 체크리스트 표시", () => {
    expect(html).toContain("읽어주기 음성");
    expect(html).toContain("해피콜 연습");
    expect(html).toContain("가지고 있어요");
  });

  it("읽어주기가 서버·모델·마이크와 무관하다는 것을 밝힌다", () => {
    expect(html).toContain("저희 서버도 인공지능도 관여하지 않습니다");
    expect(html).toContain("마이크를 쓰지도 않습니다");
  });
});

describe("시험 세트 크기를 화면과 코드가 같이 본다", () => {
  it("처리방침의 「가상의 사례 n건」이 실제 세트 크기다", () => {
    // 117로 박혀 있다가 세트가 132가 된 뒤에도 화면만 117을 말하고 있었다 (2026.08.31).
    expect(html).toContain(`가상의 사례 ${PII_TEST_SET_SIZE}건`);
  });
});

describe("하지 않는 일을 한다고 쓰지 않았다", () => {
  it("「안전하게 보관」류의 상투구가 없다 — 보관하지 않는 서비스다", () => {
    for (const bad of ["안전하게 보관", "필요 최소한으로 수집", "암호화하여 보관", "보관 기간"]) {
      expect(html, `상투구 「${bad}」가 있다`).not.toContain(bad);
    }
  });

  it("만들지 않기로 한 것을 있다고 쓰지 않는다 (SR-X06·X07·X12)", () => {
    expect(html).toContain("회원가입이 없");
    expect(html).toContain("파일로 올리는 기능이 없");
    expect(html).toContain("위치정보");
  });

  it("법률 자문처럼 읽히지 않는다", () => {
    expect(html).not.toContain("법적 책임을 지지 않습니다");
  });
});

describe("고령 이용자가 읽을 수 있게", () => {
  it("법률 용어 대신 일상어를 쓴다", () => {
    for (const jargon of ["파기", "제3자 제공", "위탁", "정보주체", "고유식별정보"]) {
      expect(html, `법률 용어 「${jargon}」가 있다`).not.toContain(jargon);
    }
  });

  it("1332 안내가 있다", () => {
    expect(html).toContain("1332");
  });
});
