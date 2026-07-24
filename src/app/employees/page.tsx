import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guards";
import { OBLIGATION_STATUS_BADGE_CLASSES, OBLIGATION_STATUS_LABELS } from "@/lib/leave/labels";
import { getEmployeeSummaries, type EmployeeSummary } from "@/lib/leave/queries";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 年5日取得義務の表示(テーブル・カード共通)。overdueかつ直近14日以内でなければ「-」扱い */
function ObligationSummary({ obligation }: { obligation: EmployeeSummary["obligation"] }) {
  if (!obligation || (obligation.status === "overdue" && !obligation.isRecentlyOverdue)) {
    return <>-</>;
  }
  return (
    <div className="flex flex-col gap-1">
      {obligation.status === "on_track" ? (
        <span>
          取得義務残{obligation.remaining}日(義務期限 {formatDate(obligation.deadline)})
        </span>
      ) : (
        <span
          className={`w-fit rounded-full px-2 py-1 text-xs font-medium ${OBLIGATION_STATUS_BADGE_CLASSES[obligation.status]}`}
        >
          {OBLIGATION_STATUS_LABELS[obligation.status]} 取得義務残
          {obligation.remaining}日(義務期限 {formatDate(obligation.deadline)}
          {obligation.status === "overdue" && "を経過済み"})
        </span>
      )}
      {obligation.otherUnmetCount > 0 && (
        <span className="text-xs text-gray-400">ほか{obligation.otherUnmetCount}件未達</span>
      )}
    </div>
  );
}

import { AutoGrantPanel } from "./auto-grant-panel";
import { EmployeeCard, EmployeeRow } from "./employee-row";

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
        <Link
          href="/employees/new"
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light"
        >
          社員を新規登録
        </Link>
      </div>

      <AutoGrantPanel />

      <div className="hidden overflow-hidden rounded-lg bg-white shadow md:block">
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
                  <ObligationSummary obligation={employee.obligation} />
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

      <div className="space-y-3 md:hidden">
        {employees.map((employee) => (
          <EmployeeCard
            key={employee.id}
            href={`/employees/${employee.id}`}
            highlighted={employee.hasPendingRequest}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-gray-900">
                {employee.name}
                {employee.status === "terminated" && (
                  <span className="ml-2 text-xs text-gray-400">(退職済み)</span>
                )}
              </p>
              {employee.hasPendingRequest && (
                <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800">
                  申請中
                </span>
              )}
            </div>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">有給残日数</dt>
                <dd className="text-gray-700">{employee.remainingDays}日</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">次回有給付与年月</dt>
                <dd className="text-gray-700">
                  {employee.nextGrantYearMonth
                    ? `${employee.nextGrantYearMonth.year}年${employee.nextGrantYearMonth.month}月`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">年5日取得義務</dt>
                <dd className="mt-1 text-gray-700">
                  <ObligationSummary obligation={employee.obligation} />
                </dd>
              </div>
            </dl>
          </EmployeeCard>
        ))}
      </div>
    </div>
  );
}
