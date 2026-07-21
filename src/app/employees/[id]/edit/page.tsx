import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminPage } from "@/lib/auth/guards";
import { getEmployeeForEdit } from "@/lib/employees/queries";
import { hasAnyGrant } from "@/lib/leave/queries";

import { EditEmployeeForm } from "./edit-employee-form";
import { TerminateSection } from "./terminate-section";

/** spec.md 4.4: 社員情報の編集・退職処理(管理者専用) */
export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;

  const [employee, grantExists] = await Promise.all([getEmployeeForEdit(id), hasAnyGrant(id)]);

  if (!employee) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link
        href={`/employees/${employee.id}`}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        ← 詳細画面に戻る
      </Link>

      <div className="w-fit">
        <h1 className="text-2xl font-bold text-gray-900">{employee.name} さんの管理</h1>
        <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
      </div>

      <EditEmployeeForm
        employeeId={employee.id}
        name={employee.name}
        email={employee.email}
        hireDate={employee.hireDate.toISOString().slice(0, 10)}
        hireDateEditable={!grantExists}
      />

      {employee.status === "active" && <TerminateSection employeeId={employee.id} />}
    </div>
  );
}
