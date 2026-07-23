import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guards";
import { OBLIGATION_STATUS_BADGE_CLASSES, OBLIGATION_STATUS_LABELS } from "@/lib/leave/labels";
import { getEmployeeSummaries } from "@/lib/leave/queries";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

import { AutoGrantPanel } from "./auto-grant-panel";
import { EmployeeRow } from "./employee-row";

/** spec.md 4.2: 社員一覧画面(管理者専用) */
export default async function EmployeesPage() {
  await requireAdminPage();
  const employees = await getEmployeeSummaries();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="w-fit">
          <h1 className="text-2xl font-bold text-gray-900">社員一覧</h1>
          <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
        </div>
        <div className="flex gap-2">
          <Link
            href="/holidays"
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            休日マスタ
          </Link>
          <Link
            href="/employees/new"
            className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light"
          >
            社員を新規登録
          </Link>
        </div>
      </div>

      <AutoGrantPanel />

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">氏名</th>
              <th className="px-4 py-3 font-medium">有給残日数</th>
              <th className="px-4 py-3 font-medium">次回有給付与年月</th>
              <th className="px-4 py-3 font-medium">年5日取得義務</th>
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
                <td className="px-4 py-3 text-gray-700">
                  {employee.obligation &&
                  (employee.obligation.status !== "overdue" || employee.obligation.isRecentlyOverdue) ? (
                    <div className="flex flex-col gap-1">
                      {employee.obligation.status === "on_track" ? (
                        <span>
                          取得義務残{employee.obligation.remaining}日(義務期限{" "}
                          {formatDate(employee.obligation.deadline)})
                        </span>
                      ) : (
                        <span
                          className={`w-fit rounded-full px-2 py-1 text-xs font-medium ${OBLIGATION_STATUS_BADGE_CLASSES[employee.obligation.status]}`}
                        >
                          {OBLIGATION_STATUS_LABELS[employee.obligation.status]} 取得義務残
                          {employee.obligation.remaining}日(義務期限 {formatDate(employee.obligation.deadline)}
                          {employee.obligation.status === "overdue" && "を経過済み"})
                        </span>
                      )}
                      {employee.obligation.otherUnmetCount > 0 && (
                        <span className="text-xs text-gray-400">
                          ほか{employee.obligation.otherUnmetCount}件未達
                        </span>
                      )}
                    </div>
                  ) : (
                    "-"
                  )}
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
