import ExcelJS from "exceljs";

import { EXPORT_GRANT_TYPE_LABELS, EXPORT_USER_STATUS_LABELS } from "@/lib/leave/export-labels";
import { UNIT_LABELS } from "@/lib/leave/labels";
import type { ExportConsumptionRow, ExportGrantRow, ExportSummaryRow } from "@/lib/leave/queries";

type ColumnDef = { header: string; key: string; width: number };

const SUMMARY_COLUMNS: ColumnDef[] = [
  { header: "氏名", key: "name", width: 16 },
  { header: "メールアドレス", key: "email", width: 28 },
  { header: "在職状況", key: "status", width: 12 },
  { header: "期間内付与日数", key: "grantedDaysInPeriod", width: 16 },
  { header: "期間内消化日数", key: "consumedDaysInPeriod", width: 16 },
  { header: "期末残日数", key: "remainingDaysAtTo", width: 12 },
];

const GRANT_COLUMNS: ColumnDef[] = [
  { header: "氏名", key: "userName", width: 16 },
  { header: "メールアドレス", key: "userEmail", width: 28 },
  { header: "付与日", key: "grantedDate", width: 12 },
  { header: "付与日数", key: "grantedDays", width: 10 },
  { header: "失効予定日", key: "expireDate", width: 12 },
  { header: "付与区分", key: "grantType", width: 14 },
];

const CONSUMPTION_COLUMNS: ColumnDef[] = [
  { header: "氏名", key: "userName", width: 16 },
  { header: "メールアドレス", key: "userEmail", width: 28 },
  { header: "対象日", key: "targetDate", width: 12 },
  { header: "区分", key: "unit", width: 10 },
  { header: "時間数", key: "hours", width: 8 },
  { header: "消化日数", key: "consumedDays", width: 10 },
];

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addHeaderRow(sheet: ExcelJS.Worksheet, columns: ColumnDef[]): void {
  const headerRowNumber = sheet.rowCount + 1;
  sheet.addRow(columns.map((column) => column.header));
  sheet.getRow(headerRowNumber).font = { bold: true };
  sheet.columns = columns.map((column) => ({ key: column.key, width: column.width }));
}

/**
 * 給与・勤怠システム連携用エクスポートのExcelワークブックを生成する
 * (サマリー/付与明細/消化明細の3シート構成)。DBには依存しない
 * (テスト容易性のため、queries.tsから取得済みのデータを受け取るだけ)。
 */
export async function buildExportWorkbook(
  summary: ExportSummaryRow[],
  grants: ExportGrantRow[],
  consumptions: ExportConsumptionRow[],
  period: { from: Date; to: Date },
  generatedAt: Date,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("サマリー");
  summarySheet.addRow(["対象期間", `${formatDate(period.from)} 〜 ${formatDate(period.to)}`]);
  summarySheet.addRow(["出力日時", formatDate(generatedAt)]);
  summarySheet.addRow([]);
  addHeaderRow(summarySheet, SUMMARY_COLUMNS);
  for (const row of summary) {
    summarySheet.addRow({
      name: row.name,
      email: row.email,
      status: EXPORT_USER_STATUS_LABELS[row.status],
      grantedDaysInPeriod: row.grantedDaysInPeriod,
      consumedDaysInPeriod: row.consumedDaysInPeriod,
      remainingDaysAtTo: row.remainingDaysAtTo,
    });
  }

  const grantSheet = workbook.addWorksheet("付与明細");
  addHeaderRow(grantSheet, GRANT_COLUMNS);
  for (const row of grants) {
    grantSheet.addRow({
      userName: row.userName,
      userEmail: row.userEmail,
      grantedDate: formatDate(row.grantedDate),
      grantedDays: row.grantedDays,
      expireDate: formatDate(row.expireDate),
      grantType: EXPORT_GRANT_TYPE_LABELS[row.grantType],
    });
  }

  const consumptionSheet = workbook.addWorksheet("消化明細");
  addHeaderRow(consumptionSheet, CONSUMPTION_COLUMNS);
  for (const row of consumptions) {
    consumptionSheet.addRow({
      userName: row.userName,
      userEmail: row.userEmail,
      targetDate: formatDate(row.targetDate),
      unit: UNIT_LABELS[row.unit],
      hours: row.hours ?? "",
      consumedDays: row.consumedDays,
    });
  }

  // exceljsの型定義はモジュール内で独自の緩いBufferを宣言しておりNode.jsの正規のBuffer型と
  // 構造的に衝突するため、Buffer.fromで正規のBufferに変換してから返す。
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
