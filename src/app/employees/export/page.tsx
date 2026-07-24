import { requireAdminPage } from "@/lib/auth/guards";
import { startOfTodayUTC } from "@/lib/date/calendar";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 給与・勤怠システム連携用データエクスポート画面(管理者専用) */
export default async function ExportPage() {
  await requireAdminPage();

  const today = startOfTodayUTC();
  const defaultFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="w-fit">
        <h1 className="text-2xl font-bold text-gray-900">データエクスポート</h1>
        <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
      </div>

      <p className="text-xs text-gray-500">
        全社員(在職中・退職済み含む)を対象に、指定期間の有給付与・消化・残高をエクスポートします(給与・勤怠システム連携用)。
      </p>

      <form method="get" action="/api/employees/export" className="space-y-4 rounded-lg bg-white p-6 shadow">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1 space-y-1">
            <label htmlFor="from" className="block text-sm font-medium text-gray-700">
              開始日
            </label>
            <input
              id="from"
              name="from"
              type="date"
              required
              defaultValue={formatDate(defaultFrom)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label htmlFor="to" className="block text-sm font-medium text-gray-700">
              終了日
            </label>
            <input
              id="to"
              name="to"
              type="date"
              required
              defaultValue={formatDate(today)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="submit"
            name="format"
            value="excel"
            className="w-full rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light"
          >
            Excelでダウンロード(サマリー・付与明細・消化明細)
          </button>
          <button
            type="submit"
            name="format"
            value="csv-summary"
            className="w-full rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            CSVでダウンロード(サマリー)
          </button>
          <button
            type="submit"
            name="format"
            value="csv-grants"
            className="w-full rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            CSVでダウンロード(付与明細)
          </button>
          <button
            type="submit"
            name="format"
            value="csv-consumptions"
            className="w-full rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            CSVでダウンロード(消化明細)
          </button>
        </div>
      </form>
    </div>
  );
}
