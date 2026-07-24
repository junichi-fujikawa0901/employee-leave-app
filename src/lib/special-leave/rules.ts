import { toUtcMidnight } from "@/lib/date/calendar";

/** 夏季休暇(暦年7/1〜9/30)の上限日数 */
export const SUMMER_LEAVE_MAX_DAYS = 3;

export interface DateWindow {
  start: Date;
  end: Date;
}

/** startDate〜endDate(両端含む)の日数を返す */
export function countDays(startDate: Date, endDate: Date): number {
  const start = toUtcMidnight(startDate);
  const end = toUtcMidnight(endDate);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/** 指定した暦年の夏季休暇対象期間(7/1〜9/30)を返す */
export function getSummerWindowForYear(year: number): DateWindow {
  return {
    start: new Date(Date.UTC(year, 6, 1)),
    end: new Date(Date.UTC(year, 8, 30)),
  };
}

/** startDate〜endDateがwindow内(両端含む)に完全に収まっているか判定する */
export function isWithinWindow(startDate: Date, endDate: Date, window: DateWindow): boolean {
  const start = toUtcMidnight(startDate);
  const end = toUtcMidnight(endDate);
  return start.getTime() >= window.start.getTime() && end.getTime() <= window.end.getTime();
}

export type SummerCapCheckResult = { ok: true } | { ok: false; reason: "exceeds_summer_cap" };

/**
 * 夏季休暇の年間上限(SUMMER_LEAVE_MAX_DAYS)を超えないか判定する。
 * existingDaysは同一ユーザー・同一年でstatusがpending/approvedの既存申請の合計日数。
 */
export function checkSummerCap(existingDays: number, newDays: number): SummerCapCheckResult {
  if (existingDays + newDays > SUMMER_LEAVE_MAX_DAYS) {
    return { ok: false, reason: "exceeds_summer_cap" };
  }
  return { ok: true };
}
