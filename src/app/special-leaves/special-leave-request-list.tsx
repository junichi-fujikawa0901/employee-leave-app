"use client";

import { useActionState, useState } from "react";

import { SPECIAL_LEAVE_STATUS_BADGE_CLASSES, SPECIAL_LEAVE_STATUS_LABELS, SPECIAL_LEAVE_TYPE_LABELS } from "@/lib/special-leave/labels";
import type { SpecialLeaveRequestItem } from "@/lib/special-leave/queries";

import type { ActionState } from "./actions";
import { cancelSpecialLeaveRequestAction } from "./actions";

const initialState: ActionState = {};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function CancelButton({ requestId }: { requestId: string }) {
  const action = cancelSpecialLeaveRequestAction.bind(null, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [showReason, setShowReason] = useState(false);

  if (!showReason) {
    return (
      <button
        type="button"
        onClick={() => setShowReason(true)}
        className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
      >
        取消
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input
        name="reason"
        placeholder="取消理由(任意)"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-navy px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          取消を確定
        </button>
        <button
          type="button"
          onClick={() => setShowReason(false)}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-500"
        >
          やめる
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

/** 自分の特別休暇申請履歴(pendingのみ取消可能) */
export function SpecialLeaveRequestList({ items }: { items: SpecialLeaveRequestItem[] }) {
  return (
    <section className="overflow-hidden rounded-lg bg-white shadow">
      <h2 className="p-6 pb-0 text-sm font-semibold text-gray-900">申請履歴</h2>
      {items.length === 0 ? (
        <p className="p-6 text-sm text-gray-400">申請履歴はありません</p>
      ) : (
        <>
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">種別</th>
                <th className="px-4 py-3 font-medium">期間</th>
                <th className="px-4 py-3 font-medium">日数</th>
                <th className="px-4 py-3 font-medium">ステータス</th>
                <th className="px-4 py-3 font-medium">理由</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 text-gray-900">{SPECIAL_LEAVE_TYPE_LABELS[item.type]}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                    {formatDate(item.startDate)}〜{formatDate(item.endDate)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{item.days}日</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${SPECIAL_LEAVE_STATUS_BADGE_CLASSES[item.status]}`}
                    >
                      {SPECIAL_LEAVE_STATUS_LABELS[item.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {item.rejectReason && <p>却下理由: {item.rejectReason}</p>}
                    {item.cancelReason && <p>取消理由: {item.cancelReason}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {item.status === "pending" && <CancelButton requestId={item.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-3 p-6 pt-0 md:hidden">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-gray-900">{SPECIAL_LEAVE_TYPE_LABELS[item.type]}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${SPECIAL_LEAVE_STATUS_BADGE_CLASSES[item.status]}`}
                  >
                    {SPECIAL_LEAVE_STATUS_LABELS[item.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-700">
                  {formatDate(item.startDate)}〜{formatDate(item.endDate)}({item.days}日)
                </p>
                {(item.rejectReason || item.cancelReason) && (
                  <div className="mt-1 text-xs text-gray-500">
                    {item.rejectReason && <p>却下理由: {item.rejectReason}</p>}
                    {item.cancelReason && <p>取消理由: {item.cancelReason}</p>}
                  </div>
                )}
                {item.status === "pending" && (
                  <div className="mt-3">
                    <CancelButton requestId={item.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
