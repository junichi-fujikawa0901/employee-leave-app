import Link from "next/link";

import { getPendingRequestsOverview } from "@/lib/dashboard/queries";
import { requireAdminPage } from "@/lib/auth/guards";
import { UNIT_LABELS } from "@/lib/leave/labels";

import {
  ApprovePendingRequestBatchButton,
  ApprovePendingRequestButton,
  RejectPendingRequestBatchButton,
  RejectPendingRequestButton,
} from "./pending-request-action-buttons";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/** 管理者ダッシュボード配下、承認待ち申請の一覧・承認/却下画面 */
export default async function PendingRequestsPage() {
  const session = await requireAdminPage();
  const viewerId = session.user.id;
  const { batchGroups, singleRequests } = await getPendingRequestsOverview();
  const isEmpty = batchGroups.length === 0 && singleRequests.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
        ← ダッシュボードに戻る
      </Link>

      <div className="w-fit">
        <h1 className="text-2xl font-bold text-gray-900">承認待ち一覧</h1>
        <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
      </div>

      {isEmpty ? (
        <p className="text-sm text-gray-400">承認待ちの申請はありません</p>
      ) : (
        <>
          {batchGroups.length > 0 && (
            <section className="rounded-lg bg-white p-6 shadow">
              <h2 className="mb-4 text-sm font-semibold text-gray-900">一括申請</h2>
              <div className="space-y-3">
                {batchGroups.map((group) => (
                  <div
                    key={group.batchId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-100 p-3"
                  >
                    <div className="text-sm text-gray-700">
                      <Link
                        href={`/employees/${group.userId}`}
                        className="font-medium text-brand-navy hover:underline"
                      >
                        {group.userName}
                      </Link>
                      <p>対象日: {group.dates.map((date) => formatDate(date)).join(", ")}</p>
                      <p className="text-xs text-gray-400">申請中{group.requestIds.length}件</p>
                    </div>
                    {group.userId === viewerId ? (
                      <p className="text-xs text-gray-400">自分自身の申請は承認できません</p>
                    ) : (
                      <div className="flex gap-2">
                        <ApprovePendingRequestBatchButton userId={group.userId} batchId={group.batchId} />
                        <RejectPendingRequestBatchButton userId={group.userId} batchId={group.batchId} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {singleRequests.length > 0 && (
            <section className="overflow-hidden rounded-lg bg-white shadow">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">申請者</th>
                    <th className="px-4 py-3 font-medium">対象日</th>
                    <th className="px-4 py-3 font-medium">区分</th>
                    <th className="px-4 py-3 font-medium">申請日時</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {singleRequests.map((request) => (
                    <tr key={request.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-3 text-gray-900">
                        <Link
                          href={`/employees/${request.userId}`}
                          className="text-brand-navy hover:underline"
                        >
                          {request.userName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                        {formatDate(request.targetDate)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {UNIT_LABELS[request.unit]}
                        {request.unit === "hourly" && request.hours != null ? `(${request.hours}時間)` : ""}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                        {formatDateTime(request.requestedAt)}
                      </td>
                      <td className="px-4 py-3">
                        {request.userId === viewerId ? (
                          <p className="text-xs text-gray-400">自分自身の申請は承認できません</p>
                        ) : (
                          <div className="flex gap-2">
                            <ApprovePendingRequestButton userId={request.userId} requestId={request.id} />
                            <RejectPendingRequestButton userId={request.userId} requestId={request.id} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
