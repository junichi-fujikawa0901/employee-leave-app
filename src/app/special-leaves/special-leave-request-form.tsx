"use client";

import { useActionState, useState } from "react";

import type { ActionState } from "./actions";
import { submitSpecialLeaveRequestAction } from "./actions";

const initialState: ActionState = {};

export function SpecialLeaveRequestForm({ summerRemainingDays }: { summerRemainingDays: number }) {
  const [state, formAction, isPending] = useActionState(submitSpecialLeaveRequestAction, initialState);
  const [type, setType] = useState("ceremonial");

  return (
    <section className="rounded-lg bg-white p-6 shadow">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">特別休暇を申請</h2>
      <form action={formAction} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="type" className="block text-sm font-medium text-gray-700">
              種別
            </label>
            <select
              id="type"
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="ceremonial">慶弔休暇</option>
              <option value="maternity">産前産後</option>
              <option value="childcare">育児</option>
              <option value="summer">夏季休暇</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
              開始日
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
              終了日
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              required
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
          >
            {isPending ? "申請中..." : "申請する"}
          </button>
        </div>
        {type === "summer" && (
          <p className="text-xs text-gray-500">
            夏季休暇は今年(7〜9月)分は残り{summerRemainingDays}日です。上限は開始日が属する年の7〜9月ごとに判定されます(翌年以降の分は別枠です)。
          </p>
        )}
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.message && <p className="text-sm text-green-700">{state.message}</p>}
      </form>
    </section>
  );
}
