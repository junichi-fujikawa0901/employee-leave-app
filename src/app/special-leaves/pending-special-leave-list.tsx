"use client";

import { useActionState, useState } from "react";

import { SPECIAL_LEAVE_TYPE_LABELS } from "@/lib/special-leave/labels";
import type { PendingSpecialLeaveRequestItem } from "@/lib/special-leave/queries";

import type { ActionState } from "./actions";
import { approveSpecialLeaveRequestAction, rejectSpecialLeaveRequestAction } from "./actions";

const initialState: ActionState = {};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ApproveButton({ requestId }: { requestId: string }) {
  const action = approveSpecialLeaveRequestAction.bind(null, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="inline-block">
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        承認
      </button>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

function RejectButton({ requestId }: { requestId: string }) {
  const action = rejectSpecialLeaveRequestAction.bind(null, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [showReason, setShowReason] = useState(false);

  if (!showReason) {
    return (
      <button
        type="button"
        onClick={() => setShowReason(true)}
        className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700"
      >
        却下
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input
        name="reason"
        placeholder="却下理由(任意)"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          却下を確定
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

/** 管理者向け: 全社の特別休暇承認待ち一覧(自分自身の申請は呼び出し側で除外済み) */
export function PendingSpecialLeaveList({ items }: { items: PendingSpecialLeaveRequestItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-900">承認待ち</h2>

      <div className="hidden overflow-hidden rounded-lg bg-white shadow md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">申請者</th>
              <th className="px-4 py-3 font-medium">種別</th>
              <th className="px-4 py-3 font-medium">期間</th>
              <th className="px-4 py-3 font-medium">日数</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-gray-900">{item.userName}</td>
                <td className="px-4 py-3 text-gray-700">{SPECIAL_LEAVE_TYPE_LABELS[item.type]}</td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                  {formatDate(item.startDate)}〜{formatDate(item.endDate)}
                </td>
                <td className="px-4 py-3 text-gray-700">{item.days}日</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <ApproveButton requestId={item.id} />
                    <RejectButton requestId={item.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-gray-900">{item.userName}</p>
              <span className="shrink-0 text-xs text-gray-500">{SPECIAL_LEAVE_TYPE_LABELS[item.type]}</span>
            </div>
            <p className="mt-1 text-sm text-gray-700">
              {formatDate(item.startDate)}〜{formatDate(item.endDate)}({item.days}日)
            </p>
            <div className="mt-3 flex gap-2">
              <ApproveButton requestId={item.id} />
              <RejectButton requestId={item.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
