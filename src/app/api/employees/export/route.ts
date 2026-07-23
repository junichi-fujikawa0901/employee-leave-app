import { NextResponse } from "next/server";

import { RouteAuthError, requireAdminForRoute } from "@/lib/auth/guards";
import { buildConsumptionDetailsCsv, buildGrantDetailsCsv, buildSummaryCsv } from "@/lib/leave/export-csv";
import { buildExportWorkbook } from "@/lib/leave/export-excel";
import { isValidExportFormat, parseExportDate } from "@/lib/leave/export-request";
import { getExportConsumptionDetails, getExportGrantDetails, getExportSummary } from "@/lib/leave/queries";

function formatDateForFilename(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 給与・勤怠システム連携用エクスポート(CSV/Excel)のダウンロード。管理者限定 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireAdminForRoute();
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const formatParam = searchParams.get("format");
  const from = parseExportDate(searchParams.get("from"));
  const to = parseExportDate(searchParams.get("to"));

  if (!isValidExportFormat(formatParam)) {
    return NextResponse.json({ error: "formatが不正です" }, { status: 400 });
  }
  if (!from || !to) {
    return NextResponse.json({ error: "from/toの日付が不正です" }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: "終了日は開始日以降にしてください" }, { status: 400 });
  }

  const filenameDateRange = `${formatDateForFilename(from)}_${formatDateForFilename(to)}`;

  if (formatParam === "excel") {
    const [summary, grants, consumptions] = await Promise.all([
      getExportSummary(from, to),
      getExportGrantDetails(from, to),
      getExportConsumptionDetails(from, to),
    ]);
    const buffer = await buildExportWorkbook(summary, grants, consumptions, { from, to }, new Date());
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(
          `有給エクスポート_${filenameDateRange}.xlsx`,
        )}`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  let csv: string;
  let label: string;
  if (formatParam === "csv-summary") {
    csv = buildSummaryCsv(await getExportSummary(from, to));
    label = "サマリー";
  } else if (formatParam === "csv-grants") {
    csv = buildGrantDetailsCsv(await getExportGrantDetails(from, to));
    label = "付与明細";
  } else {
    csv = buildConsumptionDetailsCsv(await getExportConsumptionDetails(from, to));
    label = "消化明細";
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(
        `有給エクスポート_${label}_${filenameDateRange}.csv`,
      )}`,
      "Cache-Control": "private, no-store",
    },
  });
}
