/**
 * 개인정보 처리방침 (N-504).
 *
 * ## 이 문서를 쓰는 방식
 *
 * 명세는 「**수집하지 않는 구조를 그대로 서술**」하라고 한다. 보통의 처리방침처럼
 * "필요 최소한으로 수집하며 안전하게 보관합니다"라고 쓰면 **거짓말이 된다** —
 * 이 서비스는 애초에 보관하지 않는다.
 *
 * 그래서 여기 적힌 내용은 전부 코드에서 확인한 사실이다. 코드가 바뀌면 이 문서도
 * 바뀌어야 하고, 어긋나면 그 자체가 결함이다 (N-801 동시 갱신).
 *
 * 주 사용자가 고령층이라 법률 용어를 그대로 쓰지 않는다 — 「파기」가 아니라
 * 「지웁니다」, 「제3자 제공」이 아니라 「어디로 보내지는지」로 쓴다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PII_TEST_SET_SIZE } from "@/lib/types";

export const metadata: Metadata = {
  title: "개인정보 처리방침 — 프리케이스",
  description:
    "프리케이스는 상담 내용을 저장하지 않습니다. 무엇을 받고, 어디로 보내고, 언제 지우는지 그대로 적었습니다.",
};

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="rounded-md border border-border px-4 py-4">
      <p className="font-bold text-fg">{label}</p>
      <p className="mt-1 leading-relaxed text-fg-muted">{children}</p>
    </li>
  );
}

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg">
        개인정보 처리방침
      </h1>

      <p className="mt-4 rounded-md border-l-4 border-accent bg-bg-subtle px-4 py-4 text-[1.05rem] leading-relaxed">
        <strong className="text-fg">프리케이스는 상담 내용을 저장하지 않습니다.</strong>{" "}
        회원가입이 없고, 로그인이 없고, 상담 이력이 남지 않습니다. 아래는 그 구조를
        그대로 적은 것입니다.
      </p>

      <Section id="not-collected" title="받지 않는 것">
        <p className="text-fg-muted">
          아래 정보는 <strong className="text-fg">입력받지 않습니다.</strong> 넣을 자리가
          화면에 없습니다.
        </p>
        <ul className="space-y-3">
          <Row label="이름·연락처·주민등록번호·계좌번호">
            판단에 필요하지 않습니다. 말씀 중에 섞여 들어오면 저희 쪽으로 보내기 전에
            자동으로 가립니다.
          </Row>
          <Row label="아이디·비밀번호">회원가입과 로그인이 없습니다.</Row>
          <Row label="파일">
            약관이나 서류를 파일로 올리는 기능이 없습니다. 필요하면 내용을 글로 옮겨
            적어 주시면 됩니다.
          </Row>
          <Row label="위치정보">쓰지 않습니다.</Row>
        </ul>
      </Section>

      <Section id="masking" title="가려서 보냅니다">
        <p>
          말씀하신 내용에 이름·연락처·주민등록번호·계좌번호·카드번호·이메일·주소가 있으면
          <strong className="text-fg"> 저희 서버를 떠나기 전에 자동으로 가립니다.</strong>{" "}
          가린 자리는 「[이름]」처럼 표시됩니다.
        </p>
        <p>
          가리지 못한 것이 남아 있다고 의심되면{" "}
          <strong className="text-fg">아예 보내지 않고</strong> 무엇을 지워 달라고 알려
          드립니다. 확신이 없을 때는 진행하지 않는 쪽을 택했습니다.
        </p>
        <p className="text-fg-muted">
          가상의 사례 {PII_TEST_SET_SIZE}건으로 시험해 하나도 놓치지 않은 것을 확인했고, 그 결과는{" "}
          <Link href="/verification" className="text-accent underline">
            검증 결과
          </Link>
          에 공개하고 있습니다.
        </p>
      </Section>

      <Section id="storage" title="어디에 남는가 — 남지 않습니다">
        <p>
          말씀하신 내용, 확인된 항목, 판단 결과, 판단 과정 기록은{" "}
          <strong className="text-fg">저희 서버나 데이터베이스에 저장되지 않습니다.</strong>{" "}
          암호로 잠근 채 이용자의 브라우저에만 머물고, 저희는 그것을 열어볼 때만 잠깐
          풀어 봅니다.
        </p>
        <p>
          <strong className="text-fg">30분 동안 입력이 없으면 사라집니다.</strong> 창을
          닫아도 사라집니다. 그래서 이전 상담을 다시 불러오는 기능이 없습니다 — 만들 수
          없어서가 아니라, 남기지 않기로 했기 때문입니다.
        </p>
        <p className="text-fg-muted">
          아래 세 가지는 <strong className="text-fg">이용자의 기기 안에서만</strong>{" "}
          움직입니다. 저희 쪽으로 오지 않으니 저장할 것도 없고, 새로고침하면 사라집니다.
        </p>
        <ul className="space-y-3">
          <Row label="읽어주기 음성">
            브라우저에 이미 들어 있는 음성 기능을 그대로 씁니다. 화면에 적힌 문장을 그
            자리에서 소리로 바꾸는 것이라{" "}
            <strong className="text-fg">저희 서버도 인공지능도 관여하지 않습니다.</strong>{" "}
            녹음하지 않고, 마이크를 쓰지도 않습니다.
          </Row>
          <Row label="해피콜 연습에서 고르신 답">
            연습 화면에서 어떤 답을 고르셨는지는 화면 안에만 있습니다. 보내지지 않고,
            채점되지도 않습니다.
          </Row>
          <Row label="자료 체크리스트의 「가지고 있어요」 표시">
            어떤 자료를 갖고 계신지 체크하신 것도 화면 안에만 있습니다. 인쇄하시면 체크한
            그대로 종이에 나옵니다.
          </Row>
        </ul>
      </Section>

      <Section id="ip" title="IP 주소 — 잠깐만 씁니다">
        <p>
          한 사람이 지나치게 많은 요청을 보내 서비스가 멈추는 것을 막기 위해 접속 주소를
          잠깐 확인합니다. <strong className="text-fg">주소를 그대로 두지 않고</strong>{" "}
          알아볼 수 없는 형태로 바꿔 횟수만 셉니다.
        </p>
        <p>
          <strong className="text-fg">데이터베이스에 저장하지 않고</strong>, 서버가 잠시
          기억했다가 <strong className="text-fg">24시간 안에 저절로 사라집니다.</strong>{" "}
          서버 기록에도 남기지 않습니다.
        </p>
      </Section>

      <Section id="third-party" title="어디로 보내지는가">
        <ul className="space-y-3">
          <Row label="Anthropic (미국) — 인공지능 판단">
            개인정보를 가린 뒤의 말씀 내용이 판단을 위해 전달됩니다. 이름·연락처 같은
            정보는 가려진 상태로 나갑니다.
          </Row>
          <Row label="법제처 국가법령정보 (대한민국) — 법령 조회">
            법령 이름과 조문 번호만 보냅니다. 말씀하신 내용은 보내지 않습니다.
          </Row>
        </ul>
        <p className="text-fg-muted">
          그 밖의 곳으로는 보내지 않습니다. 광고나 분석을 위한 추적 도구를 쓰지 않습니다.
        </p>
      </Section>

      <Section id="kept" title="남기는 것 — 누구인지 알 수 없는 것만">
        <ul className="space-y-3">
          <Row label="오류 신고 내용">
            「이 판단이 사실과 다릅니다」로 보내주신 글입니다. 개인정보를 가린 뒤 저장하며,
            누가 보냈는지 알 수 있는 정보는 함께 저장하지 않습니다. 정정한 내용은{" "}
            <Link href="/verification" className="text-accent underline">
              검증 결과
            </Link>
            에 공개합니다.
          </Row>
          <Row label="날짜별 이용 횟수">
            「오늘 판단이 몇 번 있었는지」 같은 숫자만 셉니다. 누가·언제·무엇을 했는지는
            남지 않아, 이 숫자로 특정한 분을 되짚을 수 없습니다.
          </Row>
          <Row label="법령·판례 원문">
            법제처에서 받아온 공개 자료를 하루 동안 보관했다가 다시 받아옵니다. 이용자
            정보와 관계가 없습니다.
          </Row>
        </ul>
      </Section>

      <Section id="sensitive" title="건강에 관한 정보">
        <p>
          보험금 지급을 다투는 경우 병명이나 진료 사실이 함께 나올 수 있습니다. 이런
          정보는 <strong className="text-fg">상담을 시작하기 전에 따로 동의</strong>를
          받습니다(개인정보보호법 제23조).
        </p>
        <p>
          동의하지 않으셔도 서비스를 쓰실 수 있습니다. 그 경우 병명·진료 내용은 빼고
          말씀해 주시면 됩니다. <strong className="text-fg">동의하셨다는 기록도 남기지
          않습니다</strong> — 상담이 끝나면 함께 사라집니다.
        </p>
      </Section>

      <Section id="rights" title="열람·삭제 요청">
        <p>
          <strong className="text-fg">요청하실 것이 없습니다.</strong> 이용자를 식별할 수
          있는 정보를 보관하지 않기 때문에, 무엇을 열람하거나 삭제해 드릴 대상이
          존재하지 않습니다.
        </p>
        <p>
          오류 신고를 보내신 뒤 그 내용을 지우고 싶으시면, 접수하실 때 받으신 접수번호와
          함께 아래 연락처로 알려주시면 확인 후 처리해 드립니다.
        </p>
      </Section>

      <Section id="contact" title="문의">
        <p>
          이 서비스는 2026 금융 AI Challenge 출품작으로, 개인이 만들어 운영합니다.
          개인정보와 관련해 궁금하신 점은 저장소의{" "}
          <a
            href="https://github.com/yongzooda/precase/issues"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            문의 창구
          </a>
          로 알려주시면 됩니다.
        </p>
        <p className="text-fg-muted">
          금융 분쟁 자체에 관한 상담은 금융감독원 금융민원센터{" "}
          <strong className="text-fg">1332</strong>(평일 09:00~18:00)를 이용하실 수
          있습니다.
        </p>
      </Section>

      <p className="mt-12 text-fg-muted">
        이 방침은 서비스가 실제로 동작하는 방식을 적은 것입니다. 동작이 바뀌면 이 글도
        함께 바뀝니다.
      </p>
    </article>
  );
}
