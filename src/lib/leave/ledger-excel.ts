import ExcelJS from "exceljs";

import { UNIT_LABELS } from "@/lib/leave/labels";
import type { LeaveLedgerPeriod } from "@/lib/leave/queries";

export interface LeaveLedgerEmployeeInfo {
  name: string;
  email: string;
  hireDate: Date;
}

const SHEET_NAME = "年次有給休暇管理簿";

const COLUMNS: { header: string; key: string; width: number }[] = [
  { header: "基準日", key: "start", width: 12 },
  { header: "義務期限", key: "end", width: 12 },
  { header: "付与日数", key: "baseGrantDays", width: 10 },
  { header: "取得日", key: "targetDate", width: 12 },
  { header: "区分", key: "unit", width: 10 },
  { header: "時間数", key: "hours", width: 8 },
  { header: "消化日数", key: "consumedDays", width: 10 },
  { header: "状態", key: "state", width: 8 },
  { header: "期間内取得済み合計", key: "takenDays", width: 18 },
  { header: "期間内取得予定合計", key: "plannedDays", width: 18 },
  { header: "期末残日数", key: "remainingDays", width: 12 },
  { header: "残日数基準日", key: "balanceAsOf", width: 14 },
  { header: "備考", key: "note", width: 24 },
];

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 義務期間(Phase 2のObligationPeriod)ごとの管理簿データからExcelワークブックを生成する。
 * DBには依存しない(テスト容易性のため、queries.tsから取得済みのデータを受け取るだけ)。
 */
export async function buildLeaveLedgerWorkbook(
  employee: LeaveLedgerEmployeeInfo,
  periods: LeaveLedgerPeriod[],
  generatedAt: Date,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);

  sheet.addRow(["氏名", employee.name]);
  sheet.addRow(["メールアドレス", employee.email]);
  sheet.addRow(["入社日", formatDate(employee.hireDate)]);
  sheet.addRow(["出力日時", formatDateTime(generatedAt)]);
  sheet.addRow([]);
  sheet.addRow(["本帳票は承認済み(approved)の取得記録のみを対象とし、取消・却下・退職時自動取消の履歴は含みません。"]);
  sheet.addRow([
    "基準日が重複する期間では、同一の取得日が複数の基準日に計上される場合があります(該当行は備考欄に明示)。",
  ]);
  sheet.addRow([]);

  const headerRowNumber = sheet.rowCount + 1;
  sheet.addRow(COLUMNS.map((column) => column.header));
  sheet.getRow(headerRowNumber).font = { bold: true };
  sheet.columns = COLUMNS.map((column) => ({ key: column.key, width: column.width }));

  if (periods.length === 0) {
    sheet.addRow(["義務対象期間なし"]);
  }

  for (const period of periods) {
    const baseCells = {
      start: formatDate(period.start),
      end: formatDate(period.end),
      baseGrantDays: period.baseGrantDays,
      takenDays: period.takenDays,
      plannedDays: period.plannedDays,
      remainingDays: period.remainingDays,
      balanceAsOf: formatDate(period.balanceAsOf),
    };

    if (period.entries.length === 0) {
      sheet.addRow(baseCells);
      continue;
    }

    for (const entry of period.entries) {
      sheet.addRow({
        ...baseCells,
        targetDate: formatDate(entry.targetDate),
        unit: UNIT_LABELS[entry.unit],
        hours: entry.hours ?? "",
        consumedDays: entry.consumedDays,
        state: entry.isFuture ? "予定" : "実績",
        note: entry.isOverlap ? "重複義務期間により再掲" : "",
      });
    }
  }

  // exceljsの型定義はモジュール内で独自の緩いBufferを宣言しておりNode.jsの正規のBuffer型と
  // 構造的に衝突するため、Buffer.fromで正規のBufferに変換してから返す。
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
