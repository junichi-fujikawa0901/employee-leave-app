import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guards";
import { getEmployeeSummaries } from "@/lib/leave/queries";

import { EmployeeRow } from "./employee-row";

/** spec.md 4.2: 社員一覧画面(管理者専用) */
export default async function EmployeesPage() {
  await requireAdminPage();
  const employees = await getEmployeeSummaries();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">社員一覧</h1>
        <Link
          href="/employees/new"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          社員を新規登録
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">氏名</th>
              <th className="px-4 py-3 font-medium">有給残日数</th>
              <th className="px-4 py-3 font-medium">次回有給付与年月</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <EmployeeRow
                key={employee.id}
                href={`/employees/${employee.id}`}
                highlighted={employee.hasPendingRequest}
              >
                <td className="px-4 py-3 text-gray-900">
                  {employee.name}
                  {employee.status === "terminated" && (
                    <span className="ml-2 text-xs text-gray-400">(退職済み)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700">{employee.remainingDays}日</td>
                <td className="px-4 py-3 text-gray-700">
                  {employee.nextGrantYearMonth
                    ? `${employee.nextGrantYearMonth.year}年${employee.nextGrantYearMonth.month}月`
                    : "-"}
                </td>
                <td className="px-4 py-3">
                  {employee.hasPendingRequest && (
                    <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800">
                      申請中
                    </span>
                  )}
                </td>
              </EmployeeRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
