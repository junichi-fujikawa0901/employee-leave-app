import type { ReactNode } from "react";

import { signOut } from "@/auth";
import { requireSession } from "@/lib/auth/guards";

export default async function EmployeesLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-brand-navy px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-block h-6 w-1.5 bg-brand-accent" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-wide text-white">
            有給休暇管理アプリ
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-medium text-white">{session.user.name}</p>
            <p className="text-xs text-white/60">
              {session.user.role === "admin" ? "管理者" : "社員"}
            </p>
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
      <main className="flex-1 bg-gray-50 p-6">{children}</main>
    </div>
  );
}
