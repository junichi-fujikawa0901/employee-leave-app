import { describe, it, expect } from "vitest";

import { buildConsumptionDetailsCsv, buildGrantDetailsCsv, buildSummaryCsv } from "@/lib/leave/export-csv";
import type { ExportConsumptionRow, ExportGrantRow, ExportSummaryRow } from "@/lib/leave/queries";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("buildSummaryCsv", () => {
  it("UTF-8 BOMで始まり、ヘッダーとデータ行をCRLF区切りで出力する", () => {
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
    ];
    const csv = buildSummaryCsv(summary);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("氏名,メールアドレス,在職状況,期間内付与日数,期間内消化日数,期末残日数\r\n");
    expect(csv).toContain("テスト太郎,taro@example.com,在職中,10,2,8\r\n");
  });

  it("氏名にカンマ・ダブルクォート・改行が含まれる場合は正しくエスケープする", () => {
    const summary: ExportSummaryRow[] = [
      {
        userId: "u1",
        name: '山田,"太郎"\n',
        email: "yamada@example.com",
        status: "active",
        grantedDaysInPeriod: 0,
        consumedDaysInPeriod: 0,
        remainingDaysAtTo: 0,
      },
    ];
    const csv = buildSummaryCsv(summary);
    expect(csv).toContain('"山田,""太郎""\n"');
  });

  it("氏名が=,+,-,@で始まる場合、CSVインジェクション対策としてシングルクォートを付与する", () => {
    const cases = ["=SUM(A1:A9)", "+1234", "-1234", "@example"];
    for (const name of cases) {
      const summary: ExportSummaryRow[] = [
        {
          userId: "u1",
          name,
          email: "test@example.com",
          status: "active",
          grantedDaysInPeriod: 0,
          consumedDaysInPeriod: 0,
          remainingDaysAtTo: 0,
        },
      ];
      const csv = buildSummaryCsv(summary);
      expect(csv).toContain(`'${name}`);
    }
  });

  it("在職状況が退職済みの場合、日本語ラベルで出力される", () => {
    const summary: ExportSummaryRow[] = [
      {
        userId: "u1",
        name: "退職花子",
        email: "hanako@example.com",
        status: "terminated",
        grantedDaysInPeriod: 0,
        consumedDaysInPeriod: 0,
        remainingDaysAtTo: 0,
      },
    ];
    expect(buildSummaryCsv(summary)).toContain("退職済み");
  });
});

describe("buildGrantDetailsCsv", () => {
  it("付与日・失効予定日をYYYY-MM-DD形式、付与区分を日本語ラベルで出力する", () => {
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
    const csv = buildGrantDetailsCsv(grants);
    expect(csv).toContain("2026-01-01");
    expect(csv).toContain("2028-01-01");
    expect(csv).toContain("法定自動付与");
  });

  it("特別付与は「特別付与」ラベルで出力される", () => {
    const grants: ExportGrantRow[] = [
      {
        userName: "テスト太郎",
        userEmail: "taro@example.com",
        grantedDate: utc(2026, 1, 1),
        grantedDays: 0.5,
        expireDate: utc(2028, 1, 1),
        grantType: "special",
      },
    ];
    expect(buildGrantDetailsCsv(grants)).toContain("特別付与");
  });
});

describe("buildConsumptionDetailsCsv", () => {
  it("時間単位年休は区分「時間単位」と時間数が出力される", () => {
    const consumptions: ExportConsumptionRow[] = [
      {
        userName: "テスト太郎",
        userEmail: "taro@example.com",
        targetDate: utc(2026, 1, 20),
        unit: "hourly",
        hours: 4,
        consumedDays: 0.5,
      },
    ];
    const csv = buildConsumptionDetailsCsv(consumptions);
    expect(csv).toContain("時間単位");
    expect(csv).toContain("2026-01-20,時間単位,4,0.5");
  });

  it("全休の場合、時間数列は空になる", () => {
    const consumptions: ExportConsumptionRow[] = [
      {
        userName: "テスト太郎",
        userEmail: "taro@example.com",
        targetDate: utc(2026, 1, 15),
        unit: "full_day",
        hours: null,
        consumedDays: 1,
      },
    ];
    const csv = buildConsumptionDetailsCsv(consumptions);
    expect(csv).toContain("2026-01-15,全休,,1");
  });
});
