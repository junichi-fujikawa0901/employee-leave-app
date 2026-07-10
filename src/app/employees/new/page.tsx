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

      <h1 className="text-xl font-semibold text-gray-900">社員の新規登録</h1>
      <NewEmployeeForm />
    </div>
  );
}
