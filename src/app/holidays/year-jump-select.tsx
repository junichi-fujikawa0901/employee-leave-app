"use client";

/** 年を選択すると、その年の同じ月にジャンプする(JavaScriptなしでもform submitで動作する) */
export function YearJumpSelect({
  currentYear,
  month,
  availableYears,
}: {
  currentYear: number;
  month: number;
  availableYears: number[];
}) {
  return (
    <form method="get" action="/holidays">
      <input type="hidden" name="month" value={month} />
      <select
        name="year"
        defaultValue={currentYear}
        onChange={(event) => event.currentTarget.form?.submit()}
        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
      >
        {availableYears.map((year) => (
          <option key={year} value={year}>
            {year}年
          </option>
        ))}
      </select>
    </form>
  );
}
