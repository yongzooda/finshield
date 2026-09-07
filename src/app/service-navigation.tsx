"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FsIcon, type FsIconName } from "./fs-icon";

const NAV: { href: string; label: string; icon: FsIconName }[] = [
  { href: "/", label: "홈", icon: "home" },
  { href: "/verify", label: "새 검증", icon: "search" },
  { href: "/cases", label: "내 기록", icon: "folder" },
  { href: "/precase", label: "가입 후 보호", icon: "shield" },
];

export function ServiceNavigation() {
  const path = usePathname();
  const active = (href: string) => {
    if (href === "/precase") return path === href || /\/cases\/[^/]+\/(aftercare|journey)/.test(path);
    if (href === "/cases" && /\/(aftercare|journey)$/.test(path)) return false;
    return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  };
  const items = NAV.map((item) => {
    const contents = <><FsIcon name={item.icon} /><span>{item.label}</span></>;
    // /verify는 입력·Claim·실행 결과를 메모리에 보관한다. 이미 같은 경로에 있을 때
    // Next의 client navigation이 컴포넌트를 재사용하지 않도록 새 문서로 연다.
    if (item.href === "/verify") {
      return <a key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined}>{contents}</a>;
    }
    return (
      <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined}>
        {contents}
      </Link>
    );
  });
  return (
    <>
      <header className="fs fs-header">
        <div className="fs-header-inner">
          <Link href="/" className="fs-brand-link" aria-label="FinShield 홈">
            <span className="fs-brand-mark"><FsIcon name="shield" /></span>FinShield
          </Link>
          <nav aria-label="주 메뉴" className="fs-desktop-nav">{items}</nav>
          <div className="fs-header-tools">
            <Link href="/notifications" aria-label="알림" title="알림"><FsIcon name="bell" /></Link>
            <Link href="/profile" aria-label="금융 프로필" title="금융 프로필"><FsIcon name="user" /></Link>
          </div>
        </div>
      </header>
      <nav aria-label="모바일 주 메뉴" className="fs fs-mobile-nav">{items}</nav>
    </>
  );
}
