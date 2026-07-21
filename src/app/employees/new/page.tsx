import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guards";

import { NewEmployeeForm } from "./new-employee-form";

/** spec.md 4.4: 社員の新規登録(管理者専用) */
export default async function NewEmployeePage() {
  await requireAdminPage();

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href="/employees" className="text-sm text-gray-500 hover:text-gray-700">
        ← 社員一覧に戻る
      </Link>

      <div className="w-fit">
        <h1 className="text-2xl font-bold text-gray-900">社員の新規登録</h1>
        <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
      </div>
      <NewEmployeeForm />
    </div>
  );
}
