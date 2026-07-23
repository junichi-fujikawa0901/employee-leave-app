import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guards";
import { addMonthsUTC, buildMonthGrid, startOfTodayUTC } from "@/lib/date/calendar";
import { getHolidaysInRange, getHolidayYears } from "@/lib/holidays/queries";

import { HolidayCalendar } from "./holiday-calendar";
import { NationalHolidaySyncPanel } from "./national-holiday-sync-panel";
import { YearJumpSelect } from "./year-jump-select";

/** 会社カレンダー / 休日マスタ画面(管理者専用)。祝日・会社独自休日を同じマスタでカレンダー表示する */
export default async function HolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  await requireAdminPage();
  const { year: yearParam, month: monthParam } = await searchParams;

  const today = startOfTodayUTC();
  const targetYear = Number(yearParam) || today.getUTCFullYear();
  const targetMonthRaw = Number(monthParam) || today.getUTCMonth() + 1;
  const targetMonth = targetMonthRaw >= 1 && targetMonthRaw <= 12 ? targetMonthRaw : today.getUTCMonth() + 1;

  const grid = buildMonthGrid(targetYear, targetMonth);
  const rangeStart = grid[0].date;
  const rangeEnd = grid[grid.length - 1].date;
  const [calendarHolidays, holidayYears] = await Promise.all([
    getHolidaysInRange(rangeStart, rangeEnd),
    getHolidayYears(),
  ]);
  const availableYears = Array.from(
    new Set([...holidayYears, today.getUTCFullYear(), targetYear]),
  ).sort((a, b) => a - b);

  const targetMonthFirstDay = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
  const prevMonth = addMonthsUTC(targetMonthFirstDay, -1);
  const nextMonth = addMonthsUTC(targetMonthFirstDay, 1);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/employees" className="text-sm text-gray-500 hover:text-gray-700">
        ← 社員一覧に戻る
      </Link>

      <div className="w-fit">
        <h1 className="text-2xl font-bold text-gray-900">休日マスタ</h1>
        <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
      </div>

      <p className="text-xs text-gray-500">
        ここに登録した日は、有給申請(単日・期間一括申請とも)で申請できなくなります。祝日は内閣府データの取り込みで管理し、会社独自の休日はカレンダー上で直接登録・編集・削除できます。
      </p>

      <NationalHolidaySyncPanel />

      <div className="space-y-3">
        <div className="flex items-center justify-center gap-4">
          <Link
            href={`/holidays?year=${prevMonth.getUTCFullYear()}&month=${prevMonth.getUTCMonth() + 1}`}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            ← 前月
          </Link>
          <div className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <YearJumpSelect currentYear={targetYear} month={targetMonth} availableYears={availableYears} />
            <span>{targetMonth}月</span>
          </div>
          <Link
            href={`/holidays?year=${nextMonth.getUTCFullYear()}&month=${nextMonth.getUTCMonth() + 1}`}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            次月 →
          </Link>
        </div>
        <HolidayCalendar year={targetYear} month={targetMonth} holidays={calendarHolidays} />
      </div>
    </div>
  );
}
