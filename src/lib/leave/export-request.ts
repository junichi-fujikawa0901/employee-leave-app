export const EXPORT_FORMATS = ["excel", "csv-summary", "csv-grants", "csv-consumptions"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isValidExportFormat(value: string | null): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value ?? "");
}

/**
 * "YYYY-MM-DD"形式のみを受理する。存在しない暦日(例: 2026-02-31)はDate.UTCが自動繰り上げてしまい
 * 別日として解釈されるため、生成したDateから構成要素を読み戻して入力値と一致するか確認する
 * (national-holiday-source.tsのparseNationalHolidayCsvと同じ対策)。
 */
export function parseExportDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const yearNum = Number(year);
  const monthNum = Number(month);
  const dayNum = Number(day);
  const date = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== yearNum ||
    date.getUTCMonth() !== monthNum - 1 ||
    date.getUTCDate() !== dayNum
  ) {
    return null;
  }
  return date;
}
