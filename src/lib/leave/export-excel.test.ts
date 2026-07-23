import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import { buildExportWorkbook } from "@/lib/leave/export-excel";
import type { ExportConsumptionRow, ExportGrantRow, ExportSummaryRow } from "@/lib/leave/queries";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

function rowTexts(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const row = sheet.getRow(rowNumber);
  const values: string[] = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    values.push(String(cell.value ?? ""));
  });
  return values;
}

function allRows(sheet: ExcelJS.Worksheet): string[][] {
  return [...Array(sheet.rowCount).keys()].map((i) => rowTexts(sheet, i + 1));
}

describe("buildExportWorkbook", () => {
  it("サマリー/付与明細/消化明細の3シートを生成する", async () => {
    const summary: ExportSummaryRow[] = [
      {
        userId: "u1",
        name: "テスト太郎",
        email: "taro@example.com",
        status: "active",
        grantedDaysInPeriod: 10,
        consumedDaysInPeriod: 2,
        remainingDaysAtTo: 8,
      },
      {
        userId: "u2",
        name: "退職花子",
        email: "hanako@example.com",
        status: "terminated",
        grantedDaysInPeriod: 0,
        consumedDaysInPeriod: 1,
        remainingDaysAtTo: 3,
      },
    ];
    const grants: ExportGrantRow[] = [
      {
        userName: "テスト太郎",
        userEmail: "taro@example.com",
        grantedDate: utc(2026, 1, 1),
        grantedDays: 10,
        expireDate: utc(2028, 1, 1),
        grantType: "annual_auto",
      },
    ];
    const consumptions: ExportConsumptionRow[] = [
      {
        userName: "テスト太郎",
        userEmail: "taro@example.com",
        targetDate: utc(2026, 1, 15),
        unit: "full_day",
        hours: null,
        consumedDays: 1,
      },
      {
        userName: "テスト太郎",
        userEmail: "taro@example.com",
        targetDate: utc(2026, 1, 20),
        unit: "hourly",
        hours: 4,
        consumedDays: 0.5,
      },
    ];

    const buffer = await buildExportWorkbook(
      summary,
      grants,
      consumptions,
      { from: utc(2026, 1, 1), to: utc(2026, 1, 31) },
      utc(2026, 2, 1),
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const summarySheet = workbook.getWorksheet("サマリー");
    const grantSheet = workbook.getWorksheet("付与明細");
    const consumptionSheet = workbook.getWorksheet("消化明細");
    expect(summarySheet).toBeDefined();
    expect(grantSheet).toBeDefined();
    expect(consumptionSheet).toBeDefined();

    const summaryRows = allRows(summarySheet!);
    expect(summaryRows.some((r) => r.includes("テスト太郎") && r.includes("在職中"))).toBe(true);
    expect(summaryRows.some((r) => r.includes("退職花子") && r.includes("退職済み"))).toBe(true);

    const grantRows = allRows(grantSheet!);
    expect(grantRows.some((r) => r.includes("2026-01-01") && r.includes("法定自動付与"))).toBe(true);

    const consumptionRows = allRows(consumptionSheet!);
    expect(consumptionRows.some((r) => r.includes("2026-01-15") && r.includes("全休"))).toBe(true);
    const hourlyRow = consumptionRows.find((r) => r.includes("2026-01-20"));
    expect(hourlyRow).toContain("時間単位");
    expect(hourlyRow).toContain("4");
  });

  it("明細が0件の場合もヘッダー行のみで例外を投げない", async () => {
    const buffer = await buildExportWorkbook([], [], [], { from: utc(2026, 1, 1), to: utc(2026, 1, 31) }, utc(2026, 2, 1));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet("サマリー")).toBeDefined();
  });
});
