"use client";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";

import { buildMonthGrid } from "@/lib/date/calendar";

import {
  type CalendarActionState,
  createHolidayFromCalendarAction,
  deleteHolidayFromCalendarAction,
  updateHolidayFromCalendarAction,
} from "./actions";

// Client ComponentからはPrisma生成クライアント(@/generated/prisma/client)をimportしない
// (Node.js専用の依存を含みビルドエラーになるため、既存のClient Component群も同様に避けている)。
// propsで渡されるPrismaのHoliday型は必要なフィールドを満たすため構造的に代入可能
export interface CalendarHolidayItem {
  id: string;
  date: Date;
  name: string;
  type: "national_holiday" | "company_day_off";
}

const HOLIDAY_TYPE_BADGE_CLASSES: Record<CalendarHolidayItem["type"], string> = {
  national_holiday: "bg-red-100 text-red-800",
  company_day_off: "bg-purple-100 text-purple-800",
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 土曜は青、日曜・祝日・会社休日は赤で表示する(前後月のグレーアウトを優先) */
function getDateColorClass(cell: { date: Date; inCurrentMonth: boolean }, holiday: CalendarHolidayItem | undefined): string {
  if (!cell.inCurrentMonth) {
    return "text-gray-300";
  }
  if (holiday || cell.date.getUTCDay() === 0) {
    return "text-red-600";
  }
  if (cell.date.getUTCDay() === 6) {
    return "text-blue-600";
  }
  return "text-gray-900";
}

/** セル背景も土曜=薄い青、日曜・祝日・会社休日=薄い赤に広げる(前後月は色付けしない) */
function getCellBackgroundClass(cell: { date: Date; inCurrentMonth: boolean }, holiday: CalendarHolidayItem | undefined): string {
  if (!cell.inCurrentMonth) {
    return "";
  }
  if (holiday || cell.date.getUTCDay() === 0) {
    return "bg-red-50";
  }
  if (cell.date.getUTCDay() === 6) {
    return "bg-blue-50";
  }
  return "";
}

const initialCalendarState: CalendarActionState = {};

/** 休日マスタのカレンダー表示。祝日はクリック不可、会社休日は選択してその場で編集・削除できる */
export function HolidayCalendar({
  year,
  month,
  holidays,
}: {
  year: number;
  month: number;
  holidays: CalendarHolidayItem[];
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const onDone = useCallback(() => setSelectedDate(null), []);

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const holidayByDate = useMemo(() => {
    const map = new Map<string, CalendarHolidayItem>();
    for (const holiday of holidays) {
      map.set(formatDate(holiday.date), holiday);
    }
    return map;
  }, [holidays]);

  const weeks = Array.from({ length: 6 }, (_, week) => grid.slice(week * 7, week * 7 + 7));
  const selectedHoliday = selectedDate ? holidayByDate.get(selectedDate) : undefined;

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <table className="w-full table-fixed text-center text-sm">
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((label, index) => (
              <th
                key={label}
                className={`pb-2 font-medium ${
                  index === 0 ? "text-red-600" : index === 6 ? "text-blue-600" : "text-gray-500"
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((cell) => {
                const key = formatDate(cell.date);
                const holiday = holidayByDate.get(key);
                const isSelected = selectedDate === key;
                const clickable =
                  cell.inCurrentMonth && (!holiday || holiday.type === "company_day_off");

                return (
                  <td key={key} className="h-20 border border-gray-100 p-1 align-top">
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => setSelectedDate(isSelected ? null : key)}
                      className={`h-full w-full rounded p-1 text-left text-xs transition-colors ${getCellBackgroundClass(cell, holiday)} ${
                        clickable ? "cursor-pointer hover:brightness-95" : "cursor-default"
                      } ${isSelected ? "ring-2 ring-brand-navy" : ""}`}
                    >
                      <div className={getDateColorClass(cell, holiday)}>{cell.date.getUTCDate()}</div>
                      {holiday && (
                        <span
                          className={`mt-1 block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-medium ${HOLIDAY_TYPE_BADGE_CLASSES[holiday.type]}`}
                        >
                          {holiday.name}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {selectedDate &&
        (selectedHoliday ? (
          <EditHolidayInline holiday={selectedHoliday} onDone={onDone} />
        ) : (
          <NewHolidayInline date={selectedDate} onDone={onDone} />
        ))}
    </div>
  );
}

function NewHolidayInline({ date, onDone }: { date: string; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState(createHolidayFromCalendarAction, initialCalendarState);

  useEffect(() => {
    if (state.success) {
      onDone();
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="mt-4 space-y-2 border-t border-gray-100 pt-4">
      <p className="text-sm font-medium text-gray-900">{date} を会社休日として登録</p>
      <input type="hidden" name="date" value={date} />
      <input
        name="name"
        required
        placeholder="例: 創立記念日"
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          {isPending ? "登録中..." : "登録する"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600"
        >
          閉じる
        </button>
      </div>
    </form>
  );
}

function EditHolidayInline({ holiday, onDone }: { holiday: CalendarHolidayItem; onDone: () => void }) {
  const updateAction = updateHolidayFromCalendarAction.bind(null, holiday.id);
  const deleteAction = deleteHolidayFromCalendarAction.bind(null, holiday.id);
  const [updateState, updateFormAction, isUpdatePending] = useActionState(updateAction, initialCalendarState);
  const [deleteState, deleteFormAction, isDeletePending] = useActionState(deleteAction, initialCalendarState);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (updateState.success || deleteState.success) {
      onDone();
    }
  }, [updateState.success, deleteState.success, onDone]);

  return (
    <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
      <p className="text-sm font-medium text-gray-900">{formatDate(holiday.date)} の会社休日を編集</p>
      <form action={updateFormAction} className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          required
          defaultValue={holiday.name}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isUpdatePending}
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          {isUpdatePending ? "更新中..." : "更新する"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600"
        >
          閉じる
        </button>
      </form>
      {updateState.error && <p className="text-sm text-red-600">{updateState.error}</p>}

      {!confirmingDelete ? (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700"
        >
          削除
        </button>
      ) : (
        <form action={deleteFormAction} className="flex items-center gap-2">
          <span className="text-xs text-gray-500">本当に削除しますか?</span>
          <button
            type="submit"
            disabled={isDeletePending}
            className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            削除を確定
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-500"
          >
            やめる
          </button>
        </form>
      )}
      {deleteState.error && <p className="text-sm text-red-600">{deleteState.error}</p>}
    </div>
  );
}
