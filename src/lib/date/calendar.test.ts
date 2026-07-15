import { describe, it, expect } from "vitest";
import { addMonthsUTC, addYearsUTC, addDaysUTC, enumerateDatesUTC } from "@/lib/date/calendar";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("addMonthsUTC", () => {
  it("1/31に1ヶ月加算すると2月に31日が無いため3/3にロールオーバーする(JS Dateのオーバーフロー挙動を固定する回帰テスト)", () => {
    expect(addMonthsUTC(utc(2025, 1, 31), 1)).toEqual(utc(2025, 3, 3));
  });

  it("通常の月加算はそのまま日を維持する", () => {
    expect(addMonthsUTC(utc(2024, 1, 1), 6)).toEqual(utc(2024, 7, 1));
  });
});

describe("addYearsUTC", () => {
  it("年数×12ヶ月として加算する", () => {
    expect(addYearsUTC(utc(2024, 7, 1), 2)).toEqual(utc(2026, 7, 1));
  });
});

describe("addDaysUTC", () => {
  it("日数を加算する(月またぎ)", () => {
    expect(addDaysUTC(utc(2026, 6, 30), 1)).toEqual(utc(2026, 7, 1));
  });

  it("負の日数で減算できる", () => {
    expect(addDaysUTC(utc(2026, 7, 1), -1)).toEqual(utc(2026, 6, 30));
  });
});

describe("enumerateDatesUTC", () => {
  it("開始日=終了日の場合は1件だけ返す", () => {
    expect(enumerateDatesUTC(utc(2026, 8, 1), utc(2026, 8, 1))).toEqual([utc(2026, 8, 1)]);
  });

  it("複数日を月またぎで列挙する", () => {
    expect(enumerateDatesUTC(utc(2026, 6, 29), utc(2026, 7, 2))).toEqual([
      utc(2026, 6, 29),
      utc(2026, 6, 30),
      utc(2026, 7, 1),
      utc(2026, 7, 2),
    ]);
  });

  it("開始日が終了日より後だとErrorを投げる", () => {
    expect(() => enumerateDatesUTC(utc(2026, 8, 2), utc(2026, 8, 1))).toThrow();
  });
});
