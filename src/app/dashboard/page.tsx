import Link from "next/link";

import {
  countPendingRequests,
  countUnmetObligationEmployees,
  getCompanyWideUtilization,
  getExpiringDaysThisMonth,
  getTrailingYearRange,
} from "@/lib/dashboard/queries";
import { requireAdminPage } from "@/lib/auth/guards";
import { startOfTodayUTC } from "@/lib/date/calendar";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

/** 管理者ダッシュボード。承認待ち件数・今月失効日数・年5日未達人数・全社取得率を1枚に集約する */
export default async function DashboardPage() {
  await requireAdminPage();

  const asOf = startOfTodayUTC();
  const { from: utilizationFrom, to: utilizationTo } = getTrailingYearRange(asOf);

  const [pendingCount, expiringDays, unmetObligationCount, utilization] = await Promise.all([
    countPendingRequests(),
    getExpiringDaysThisMonth(asOf),
    countUnmetObligationEmployees(),
    getCompanyWideUtilization(utilizationFrom, utilizationTo),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="w-fit">
        <h1 className="text-2xl font-bold text-gray-900">ダッシュボード</h1>
        <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/dashboard/pending-requests"
          className="rounded-lg border border-gray-200 bg-white p-6 shadow transition-colors hover:bg-gray-50"
        >
          <p className="text-sm font-medium text-gray-500">承認待ち件数</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{pendingCount}件</p>
          <p className="mt-1 text-xs text-gray-400">クリックして一覧・承認へ →</p>
        </Link>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
          <p className="text-sm font-medium text-gray-500">今月失効する有給日数</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{formatDays(expiringDays)}日</p>
          <p className="mt-1 text-xs text-gray-400">{formatDate(asOf).slice(0, 7)}中に失効予定の合計残日数</p>
        </div>

        <div
          className={`rounded-lg border p-6 shadow ${
            unmetObligationCount > 0 ? "border-yellow-200 bg-yellow-50" : "border-gray-200 bg-white"
          }`}
        >
          <p className="text-sm font-medium text-gray-500">年5日取得義務の未達人数</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{unmetObligationCount}名</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
          <p className="text-sm font-medium text-gray-500">全社の有給取得率</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {utilization.rate === null ? "—" : `${(utilization.rate * 100).toFixed(1)}%`}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {formatDate(utilization.from)}〜{formatDate(utilization.to)}(直近12ヶ月) / 消化{" "}
            {formatDays(utilization.consumedDays)}日 ÷ 付与 {formatDays(utilization.grantedDays)}日
          </p>
        </div>
      </div>
    </div>
  );
}
