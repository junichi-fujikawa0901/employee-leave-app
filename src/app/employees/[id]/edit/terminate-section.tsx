"use client";

import { useActionState, useState } from "react";

import type { ActionState } from "./actions";
import { terminateEmployeeAction } from "./actions";

const initialState: ActionState = {};

export function TerminateSection({ employeeId }: { employeeId: string }) {
  const action = terminateEmployeeAction.bind(null, employeeId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">退職処理</h2>
        <p className="mb-4 text-xs text-gray-500">
          アカウントを無効化し、以降のログイン・有給付与を停止します。申請中の申請は自動的に却下、
          退職日より後の承認済み申請は自動的に取消されます(データは履歴として保持されます)。
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
        >
          退職処理を行う
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-red-200 bg-white p-6 shadow"
    >
      <h2 className="text-sm font-semibold text-gray-900">退職処理の確認</h2>
      <div className="space-y-1">
        <label htmlFor="terminationDate" className="block text-sm font-medium text-gray-700">
          退職日
        </label>
        <input
          id="terminationDate"
          name="terminationDate"
          type="date"
          required
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? "処理中..." : "退職処理を確定する"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
