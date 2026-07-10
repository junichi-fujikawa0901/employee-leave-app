import type { ReactNode } from "react";

import { signOut } from "@/auth";
import { requireSession } from "@/lib/auth/guards";

export default async function EmployeesLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">{session.user.name}</p>
          <p className="text-xs text-gray-500">
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
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            ログアウト
          </button>
        </form>
      </header>
      <main className="flex-1 bg-gray-50 p-6">{children}</main>
    </div>
  );
}
