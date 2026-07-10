import Link from "next/link";
import { notFound } from "next/navigation";

import { isAdmin, requireSelfOrAdminPage } from "@/lib/auth/guards";
import { startOfTodayUTC } from "@/lib/date/calendar";
import { STATUS_BADGE_CLASSES, STATUS_LABELS, UNIT_LABELS } from "@/lib/leave/labels";
import { getEmployeeDetail } from "@/lib/leave/queries";
import { isWithinWithdrawalWindow } from "@/lib/leave/request-rules";

import { LeaveRequestForm } from "./leave-request-form";
import {
  ApproveRequestButton,
  CancelRequestButton,
  RejectRequestButton,
  WithdrawRequestButton,
} from "./request-action-buttons";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** spec.md 4.3: 社員詳細画面(社員本人にとってはマイページを兼ねる) */
export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { id } = await params;
  const { year: yearParam } = await searchParams;
  const session = await requireSelfOrAdminPage(id);
  const employee = await getEmployeeDetail(id);

  if (!employee) {
    notFound();
  }

  const viewerIsAdmin = isAdmin(session);
  const viewerIsSelf = session.user.id === employee.id;
  const asOf = startOfTodayUTC();

  const availableYears = Array.from(
    new Set(employee.requests.map((request) => request.targetDate.getUTCFullYear())),
  ).sort((a, b) => b - a);
  const selectedYear =
    yearParam && availableYears.includes(Number(yearParam)) ? Number(yearParam) : null;
  const visibleRequests = selectedYear
    ? employee.requests.filter((request) => request.targetDate.getUTCFullYear() === selectedYear)
    : employee.requests;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {viewerIsAdmin && (
        <Link href="/employees" className="text-sm text-gray-500 hover:text-gray-700">
          ← 社員一覧に戻る
        </Link>
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {employee.name}
            {employee.status === "terminated" && (
              <span className="ml-2 text-sm font-normal text-gray-400">(退職済み)</span>
            )}
          </h1>
          <p className="text-sm text-gray-500">{employee.email}</p>
          <p className="text-sm text-gray-500">入社日: {formatDate(employee.hireDate)}</p>
        </div>
        {viewerIsAdmin && (
          <Link
            href={`/employees/${employee.id}/edit`}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
          >
            社員情報を編集・退職処理
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg bg-white p-6 shadow">
        <div>
          <p className="text-xs text-gray-500">有給残日数</p>
          <p className="text-2xl font-semibold text-gray-900">{employee.remainingDays}日</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">次回有給付与年月</p>
          <p className="text-2xl font-semibold text-gray-900">
            {employee.nextGrantYearMonth
              ? `${employee.nextGrantYearMonth.year}年${employee.nextGrantYearMonth.month}月`
              : "-"}
          </p>
        </div>
      </div>

      {viewerIsSelf && <LeaveRequestForm employeeId={employee.id} />}

      <section className="rounded-lg bg-white p-6 shadow">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">有給取得履歴</h2>
          {availableYears.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <Link
                href={`/employees/${employee.id}`}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  selectedYear === null
                    ? "bg-gray-900 text-white"
                    : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                全期間
              </Link>
              {availableYears.map((year) => (
                <Link
                  key={year}
                  href={`/employees/${employee.id}?year=${year}`}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    selectedYear === year
                      ? "bg-gray-900 text-white"
                      : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {year}年
                </Link>
              ))}
            </div>
          )}
        </div>
        {visibleRequests.length === 0 ? (
          <p className="text-sm text-gray-400">
            {selectedYear ? `${selectedYear}年の申請履歴はありません` : "申請履歴はありません"}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="py-2 font-medium">対象日</th>
                <th className="py-2 font-medium">区分</th>
                <th className="py-2 font-medium">ステータス</th>
                <th className="py-2 font-medium">理由</th>
                <th className="py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((request) => (
                <tr key={request.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 text-gray-900">{formatDate(request.targetDate)}</td>
                  <td className="py-2 text-gray-700">{UNIT_LABELS[request.unit]}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[request.status]}`}
                    >
                      {STATUS_LABELS[request.status]}
                    </span>
                  </td>
                  <td className="py-2 text-gray-500">
                    {request.rejectReason && <p>却下理由: {request.rejectReason}</p>}
                    {request.cancelReason && <p>取消理由: {request.cancelReason}</p>}
                    {request.status === "cancelled" && !request.cancelReason && (
                      <p>
                        {request.cancelledBy === "system"
                          ? "退職処理による自動取消"
                          : "本人による取消"}
                      </p>
                    )}
                  </td>
                  <td className="py-2">
                    {request.status === "pending" && viewerIsSelf && (
                      <CancelRequestButton employeeId={employee.id} requestId={request.id} />
                    )}
                    {request.status === "pending" && viewerIsAdmin && !viewerIsSelf && (
                      <div className="flex gap-2">
                        <ApproveRequestButton employeeId={employee.id} requestId={request.id} />
                        <RejectRequestButton employeeId={employee.id} requestId={request.id} />
                      </div>
                    )}
                    {request.status === "approved" &&
                      viewerIsSelf &&
                      (isWithinWithdrawalWindow(request.targetDate, asOf) ? (
                        <WithdrawRequestButton employeeId={employee.id} requestId={request.id} />
                      ) : (
                        <p className="text-xs text-gray-400">取得日の3日前を過ぎたため取り下げ不可</p>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">有給付与履歴</h2>
        {employee.grants.length === 0 ? (
          <p className="text-sm text-gray-400">付与履歴はありません</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="py-2 font-medium">付与日</th>
                <th className="py-2 font-medium">付与日数</th>
                <th className="py-2 font-medium">失効予定日</th>
              </tr>
            </thead>
            <tbody>
              {employee.grants.map((grant) => (
                <tr key={grant.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 text-gray-900">{formatDate(grant.grantedDate)}</td>
                  <td className="py-2 text-gray-700">{grant.grantedDays}日</td>
                  <td className="py-2 text-gray-700">{formatDate(grant.expireDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
