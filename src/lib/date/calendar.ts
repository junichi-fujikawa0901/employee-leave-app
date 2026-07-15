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
