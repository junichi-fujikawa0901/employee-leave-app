function toUtcMidnight(date: Date): Date {
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
