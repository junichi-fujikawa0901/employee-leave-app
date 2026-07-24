import type { Session } from "next-auth";

import { signOut } from "@/auth";

import { NavMenu, type NavItem } from "./nav-menu";

/** ロールに応じたグローバルナビ項目を組み立てる。管理者向け画面と本人専用画面で構成を分ける */
function buildNavItems(session: Session): NavItem[] {
  if (session.user.role === "admin") {
    return [
      { label: "社員一覧", href: "/employees" },
      { label: "ダッシュボード", href: "/dashboard" },
      { label: "特別休暇", href: "/special-leaves" },
      { label: "休日マスタ", href: "/holidays" },
      { label: "監査ログ", href: "/audit-logs" },
      { label: "データエクスポート", href: "/employees/export" },
    ];
  }
  return [
    { label: "マイページ", href: `/employees/${session.user.id}` },
    { label: "特別休暇", href: "/special-leaves" },
  ];
}

/** /employees・/holidays など各ルートセグメントのlayout.tsxから共有される共通ヘッダー */
export function AppHeader({ session }: { session: Session }) {
  const navItems = buildNavItems(session);
  const roleLabel = session.user.role === "admin" ? "管理者" : "社員";

  return (
    <header className="relative bg-brand-navy px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="inline-block h-6 w-1.5 shrink-0 bg-brand-accent" aria-hidden="true" />
          <span className="text-sm font-semibold whitespace-nowrap text-white">有給休暇管理アプリ</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <NavMenu items={navItems} userName={session.user.name ?? ""} roleLabel={roleLabel} />
          <div className="hidden text-right sm:block">
            <p className="max-w-[10rem] truncate text-sm font-medium text-white">{session.user.name}</p>
            <p className="text-xs whitespace-nowrap text-white/60">{roleLabel}</p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="rounded border border-white/20 px-3 py-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-white/10 sm:px-4"
            >
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
