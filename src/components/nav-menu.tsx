"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

export interface NavItem {
  label: string;
  href: string;
}

/** pathnameにマッチするhrefのうち最長のものだけをactiveとみなす(親子関係にあるルート同士の重複activeを避ける) */
function findActiveHref(pathname: string, items: NavItem[]): string | null {
  const matches = items.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((longest, item) => (item.href.length > longest.href.length ? item : longest)).href;
}

function NavLink({
  item,
  active,
  mobile,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  mobile?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`rounded font-medium whitespace-nowrap transition-colors ${mobile ? "px-3 py-2.5 text-sm" : "px-3 py-2 text-sm"} ${
        active ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      {item.label}
    </Link>
  );
}

/**
 * デスクトップ(lg以上)では横並びのグローバルナビ、それ未満ではハンバーガーボタン+
 * 開閉パネルを表示する。session由来のnavItemsは呼び出し元(AppHeader)で組み立てる。
 * 管理者向け6項目+ユーザー情報+ログアウトが768px(md)では収まりきらないため、
 * 横並び切り替えはmdではなくlgを採用している。
 */
export function NavMenu({ items, userName, roleLabel }: { items: NavItem[]; userName: string; roleLabel: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // pathname変更時にパネルを閉じる(Reactの推奨パターン: effectではなくrender中に比較する)
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  const activeHref = findActiveHref(pathname, items);
  const panelId = useId();

  return (
    <>
      <nav className="hidden items-center gap-1 lg:flex">
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={item.href === activeHref} />
        ))}
      </nav>

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "メニューを閉じる" : "メニューを開く"}
        className="rounded p-2 text-white hover:bg-white/10 lg:hidden"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className="absolute inset-x-0 top-full z-10 border-t border-white/10 bg-brand-navy px-4 py-4 shadow-lg lg:hidden"
        >
          <div className="mb-3 border-b border-white/10 pb-3 sm:hidden">
            <p className="text-sm font-medium text-white">{userName}</p>
            <p className="text-xs text-white/60">{roleLabel}</p>
          </div>
          <nav className="flex flex-col gap-1">
            {items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={item.href === activeHref}
                mobile
                onClick={() => setOpen(false)}
              />
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
