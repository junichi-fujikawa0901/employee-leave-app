"use client";

import { useActionState, useMemo, useState } from "react";

import { buildBulkRequestDates, MAX_BULK_REQUEST_DAYS } from "@/lib/leave/date-range";

import type { ActionState } from "./actions";
import { submitLeaveRequestAction, submitLeaveRequestBatchAction } from "./actions";

const initialState: ActionState = {};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateWithWeekday(date: Date): string {
  return `${date.toISOString().slice(0, 10)}(${WEEKDAY_LABELS[date.getUTCDay()]})`;
}

export function LeaveRequestForm({ employeeId }: { employeeId: string }) {
  const [mode, setMode] = useState<"single" | "batch">("single");

  return (
    <div className="space-y-3 rounded-lg bg-white p-6 shadow">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">有給申請</h2>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`rounded px-2 py-1 font-medium ${
              mode === "single" ? "bg-brand-navy text-white" : "border border-gray-300 text-gray-600"
            }`}
          >
            1日ずつ申請
          </button>
          <button
            type="button"
            onClick={() => setMode("batch")}
            className={`rounded px-2 py-1 font-medium ${
              mode === "batch" ? "bg-brand-navy text-white" : "border border-gray-300 text-gray-600"
            }`}
          >
            期間でまとめて申請
          </button>
        </div>
      </div>
      {mode === "single" ? <SingleDayForm employeeId={employeeId} /> : <BatchForm employeeId={employeeId} />}
    </div>
  );
}

function SingleDayForm({ employeeId }: { employeeId: string }) {
  const action = submitLeaveRequestAction.bind(null, employeeId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [unit, setUnit] = useState("full_day");

  return (
    <form action={formAction} className="space-y-3">
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
          <select
            id="unit"
            name="unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="full_day">全休</option>
            <option value="am_half">午前半休</option>
            <option value="pm_half">午後半休</option>
            <option value="hourly">時間単位</option>
          </select>
        </div>
        {unit === "hourly" && (
          <div className="space-y-1">
            <label htmlFor="hours" className="block text-sm font-medium text-gray-700">
              時間数
            </label>
            <input
              id="hours"
              name="hours"
              type="number"
              min={1}
              max={8}
              step={1}
              required
              className="w-20 rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          {isPending ? "申請中..." : "申請する"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="text-sm text-green-700">{state.message}</p>}
    </form>
  );
}

/** spec.md 6章: 期間一括申請(Phase 5)。全休のみ対象、上限MAX_BULK_REQUEST_DAYS日 */
function BatchForm({ employeeId }: { employeeId: string }) {
  const action = submitLeaveRequestBatchAction.bind(null, employeeId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [skipWeekends, setSkipWeekends] = useState(true);

  const previewDates = useMemo(() => {
    if (!startDate || !endDate) {
      return [];
    }
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() > end.getTime()) {
      return [];
    }
    return buildBulkRequestDates(start, end, { skipWeekends });
  }, [startDate, endDate, skipWeekends]);

  const exceedsLimit = previewDates.length > MAX_BULK_REQUEST_DAYS;

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
            開始日
          </label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
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
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-1 pb-2 text-sm text-gray-700">
          <input
            type="checkbox"
            name="skipWeekends"
            checked={skipWeekends}
            onChange={(event) => setSkipWeekends(event.target.checked)}
          />
          土日を除外する
        </label>
        <button
          type="submit"
          disabled={isPending || previewDates.length === 0 || exceedsLimit}
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          {isPending ? "申請中..." : "まとめて申請する"}
        </button>
      </div>
      <p className="text-xs text-gray-400">
        まとめて申請できるのは全休のみです(半休・時間単位は1日ずつ申請してください)。土日除外は入力の便利機能であり、実際の勤務日を保証するものではありません。
      </p>
      {previewDates.length > 0 && (
        <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
          <p className="mb-1 font-medium">
            対象日: {previewDates.length}日
            {exceedsLimit && (
              <span className="ml-2 text-red-600">上限{MAX_BULK_REQUEST_DAYS}日を超えています</span>
            )}
          </p>
          <p className="flex flex-wrap gap-x-2 gap-y-1">
            {previewDates.map((date) => (
              <span key={date.toISOString()}>{formatDateWithWeekday(date)}</span>
            ))}
          </p>
        </div>
      )}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="text-sm text-green-700">{state.message}</p>}
    </form>
  );
}
