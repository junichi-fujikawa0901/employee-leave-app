import type { Session } from "next-auth";

import { signOut } from "@/auth";

/** /employees・/holidays など各ルートセグメントのlayout.tsxから共有される共通ヘッダー */
export function AppHeader({ session }: { session: Session }) {
  return (
    <header className="flex items-center justify-between bg-brand-navy px-6 py-4">
      <div className="flex items-center gap-3">
        <span className="inline-block h-6 w-1.5 bg-brand-accent" aria-hidden="true" />
        <span className="text-sm font-semibold tracking-wide text-white">有給休暇管理アプリ</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-white">{session.user.name}</p>
          <p className="text-xs text-white/60">{session.user.role === "admin" ? "管理者" : "社員"}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="rounded border border-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            ログアウト
          </button>
        </form>
      </div>
    </header>
  );
}
