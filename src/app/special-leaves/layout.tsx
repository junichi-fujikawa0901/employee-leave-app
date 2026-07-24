import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { requireSession } from "@/lib/auth/guards";

export default async function SpecialLeavesLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader session={session} />
      <main className="flex-1 bg-gray-50 p-6">{children}</main>
    </div>
  );
}
