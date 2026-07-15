import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import { buildLeaveLedgerWorkbook, type LeaveLedgerEmployeeInfo } from "@/lib/leave/ledger-excel";
import type { LeaveLedgerPeriod } from "@/lib/leave/queries";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const employee: LeaveLedgerEmployeeInfo = {
  name: "テスト太郎",
  email: "test@example.com",
  hireDate: utc(2023, 4, 1),
};

async function loadSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("年次有給休暇管理簿");
  if (!sheet) {
    throw new Error("シートが見つかりません");
  }
  return sheet;
}

function rowTexts(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const row = sheet.getRow(rowNumber);
  const values: string[] = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    values.push(String(cell.value ?? ""));
  });
  return values;
}

describe("buildLeaveLedgerWorkbook", () => {
  it("義務対象期間が無い場合、社員情報と「義務対象期間なし」の行だけを含むシートを返す", async () => {
    const buffer = await buildLeaveLedgerWorkbook(employee, [], utc(2025, 1, 1));
    const sheet = await loadSheet(buffer);

    const allText = sheet
      .getSheetValues()
      .flat()
      .map((v) => String(v ?? ""))
      .join("\n");

    expect(allText).toContain("テスト太郎");
    expect(allText).toContain("義務対象期間なし");
  });

  it("取得日が0件の期間は、基準日・付与日数・期末残のみの1行になる", async () => {
    const periods: LeaveLedgerPeriod[] = [
      {
        start: utc(2024, 7, 1),
        end: utc(2025, 6, 30),
        baseGrantDays: 10,
        entries: [],
        takenDays: 0,
        plannedDays: 0,
        balanceAsOf: utc(2024, 12, 1),
        remainingDays: 10,
      },
    ];
    const buffer = await buildLeaveLedgerWorkbook(employee, periods, utc(2024, 12, 1));
    const sheet = await loadSheet(buffer);

    const headerRowNumber = [...Array(sheet.rowCount).keys()]
      .map((i) => i + 1)
      .find((n) => rowTexts(sheet, n).includes("基準日"));
    expect(headerRowNumber).toBeDefined();

    const dataRow = rowTexts(sheet, headerRowNumber! + 1);
    expect(dataRow[0]).toBe("2024-07-01");
    expect(dataRow.join(" ")).not.toContain("full_day");
  });

  it("取得日ありの行は、区分ラベル・状態(実績/予定)・備考(重複)が正しく出力される", async () => {
    const periods: LeaveLedgerPeriod[] = [
      {
        start: utc(2024, 7, 1),
        end: utc(2025, 6, 30),
        baseGrantDays: 10,
        entries: [
          {
            targetDate: utc(2024, 8, 1),
            unit: "full_day",
            consumedDays: 1,
            isFuture: false,
            isOverlap: false,
          },
          {
            targetDate: utc(2025, 1, 10),
            unit: "am_half",
            consumedDays: 0.5,
            isFuture: true,
            isOverlap: true,
          },
        ],
        takenDays: 1,
        plannedDays: 0.5,
        balanceAsOf: utc(2024, 12, 1),
        remainingDays: 8.5,
      },
    ];
    const buffer = await buildLeaveLedgerWorkbook(employee, periods, utc(2024, 12, 1));
    const sheet = await loadSheet(buffer);

    const allRows = [...Array(sheet.rowCount).keys()].map((i) => rowTexts(sheet, i + 1));
    const pastRow = allRows.find((r) => r.includes("2024-08-01"));
    const futureRow = allRows.find((r) => r.includes("2025-01-10"));

    expect(pastRow).toBeDefined();
    expect(pastRow).toContain("全休");
    expect(pastRow).toContain("実績");

    expect(futureRow).toBeDefined();
    expect(futureRow).toContain("午前半休");
    expect(futureRow).toContain("予定");
    expect(futureRow).toContain("重複義務期間により再掲");
  });
});
