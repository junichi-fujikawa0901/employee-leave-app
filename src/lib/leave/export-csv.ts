import { EXPORT_GRANT_TYPE_LABELS, EXPORT_USER_STATUS_LABELS } from "@/lib/leave/export-labels";
import { UNIT_LABELS } from "@/lib/leave/labels";
import type { ExportConsumptionRow, ExportGrantRow, ExportSummaryRow } from "@/lib/leave/queries";

/** ExcelでCSVを開いた際の文字化けを防ぐためのUTF-8 BOM */
const BOM = "﻿";

function escapeCsvField(value: string | number): string {
  let text = String(value);
  // CSVインジェクション対策: 氏名・メールアドレス等が=, +, -, @で始まると、Excel等で開いた際に
  // 数式として解釈される恐れがあるため、先頭にシングルクォートを付与し文字列として扱わせる。
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildSummaryCsv(summary: ExportSummaryRow[]): string {
  const headers = ["氏名", "メールアドレス", "在職状況", "期間内付与日数", "期間内消化日数", "期末残日数"];
  const rows = summary.map((row) => [
    row.name,
    row.email,
    EXPORT_USER_STATUS_LABELS[row.status],
    row.grantedDaysInPeriod,
    row.consumedDaysInPeriod,
    row.remainingDaysAtTo,
  ]);
  return buildCsv(headers, rows);
}

export function buildGrantDetailsCsv(grants: ExportGrantRow[]): string {
  const headers = ["氏名", "メールアドレス", "付与日", "付与日数", "失効予定日", "付与区分"];
  const rows = grants.map((row) => [
    row.userName,
    row.userEmail,
    formatDate(row.grantedDate),
    row.grantedDays,
    formatDate(row.expireDate),
    EXPORT_GRANT_TYPE_LABELS[row.grantType],
  ]);
  return buildCsv(headers, rows);
}

export function buildConsumptionDetailsCsv(consumptions: ExportConsumptionRow[]): string {
  const headers = ["氏名", "メールアドレス", "対象日", "区分", "時間数", "消化日数"];
  const rows = consumptions.map((row) => [
    row.userName,
    row.userEmail,
    formatDate(row.targetDate),
    UNIT_LABELS[row.unit],
    row.hours ?? "",
    row.consumedDays,
  ]);
  return buildCsv(headers, rows);
}
