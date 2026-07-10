"use client";

import { useActionState } from "react";

import type { ActionState } from "./actions";
import { submitLeaveRequestAction } from "./actions";

const initialState: ActionState = {};

export function LeaveRequestForm({ employeeId }: { employeeId: string }) {
  const action = submitLeaveRequestAction.bind(null, employeeId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-3 rounded-lg bg-white p-6 shadow">
      <h2 className="text-sm font-semibold text-gray-900">有給申請</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="targetDate" className="block text-sm font-medium text-gray-700">
            対象日
          </label>
          <input
            id="targetDate"
            name="targetDate"
            type="date"
            required
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="unit" className="block text-sm font-medium text-gray-700">
            区分
          </label>
          <select id="unit" name="unit" className="rounded border border-gray-300 px-3 py-2 text-sm">
            <option value="full_day">全休</option>
            <option value="am_half">午前半休</option>
            <option value="pm_half">午後半休</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? "申請中..." : "申請する"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
