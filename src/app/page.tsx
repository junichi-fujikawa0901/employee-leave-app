import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/guards";

/** spec.md 4.1: ログイン成功後、管理者は社員一覧画面へ、社員は自分の詳細画面(マイページ)へ遷移する */
export default async function Home() {
  const session = await requireSession();

  if (session.user.role === "admin") {
    redirect("/employees");
  }
  redirect(`/employees/${session.user.id}`);
}
