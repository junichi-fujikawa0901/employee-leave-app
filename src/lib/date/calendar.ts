export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addMonthsUTC(date: Date, months: number): Date {
  const result = toUtcMidnight(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

export function addYearsUTC(date: Date, years: number): Date {
  return addMonthsUTC(date, years * 12);
}

export function addDaysUTC(date: Date, days: number): Date {
  const result = toUtcMidnight(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function startOfTodayUTC(): Date {
  return toUtcMidnight(new Date());
}

/** startからendまで(両端含む)を1日ずつ列挙する。start > end の場合はErrorを投げる */
export function enumerateDatesUTC(start: Date, end: Date): Date[] {
  const normalizedStart = toUtcMidnight(start);
  const normalizedEnd = toUtcMidnight(end);
  if (normalizedStart.getTime() > normalizedEnd.getTime()) {
    throw new Error("start must be earlier than or equal to end");
  }

  const dates: Date[] = [];
  let cursor = normalizedStart;
  while (cursor.getTime() <= normalizedEnd.getTime()) {
    dates.push(cursor);
    cursor = addDaysUTC(cursor, 1);
  }
  return dates;
}

export function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** 対象月の月末日(利用可能な最終日)を返す。月初起点で計算するため月末日を直接addMonthsUTCに渡さないこと */
export function endOfMonthUTC(date: Date): Date {
  return addDaysUTC(addMonthsUTC(startOfMonthUTC(date), 1), -1);
}

export interface MonthGridCell {
  date: Date;
  inCurrentMonth: boolean;
}

/**
 * year/month(1-12)の月を含む、日曜始まりの6週×7日=42マスのカレンダーグリッドを返す。
 * 前後月にはみ出す日付もinCurrentMonth: falseとして含める(グレーアウト表示用)。
 */
export function buildMonthGrid(year: number, month: number): MonthGridCell[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = addDaysUTC(firstOfMonth, -firstOfMonth.getUTCDay());

  const cells: MonthGridCell[] = [];
  let cursor = gridStart;
  for (let i = 0; i < 42; i += 1) {
    cells.push({ date: cursor, inCurrentMonth: cursor.getUTCMonth() === month - 1 });
    cursor = addDaysUTC(cursor, 1);
  }
  return cells;
}
