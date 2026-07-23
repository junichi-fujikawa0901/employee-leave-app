import { describe, it, expect } from "vitest";
import {
  addMonthsUTC,
  addYearsUTC,
  addDaysUTC,
  enumerateDatesUTC,
  startOfMonthUTC,
  endOfMonthUTC,
  buildMonthGrid,
} from "@/lib/date/calendar";

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

describe("startOfMonthUTC", () => {
  it("月の途中の日付から月初日を返す", () => {
    expect(startOfMonthUTC(utc(2026, 8, 15))).toEqual(utc(2026, 8, 1));
  });
});

describe("endOfMonthUTC", () => {
  it("31日ある月の月末日を返す", () => {
    expect(endOfMonthUTC(utc(2026, 8, 1))).toEqual(utc(2026, 8, 31));
  });

  it("30日までの月の月末日を返す", () => {
    expect(endOfMonthUTC(utc(2026, 4, 10))).toEqual(utc(2026, 4, 30));
  });

  it("うるう年2月の月末日(29日)を返す", () => {
    expect(endOfMonthUTC(utc(2028, 2, 1))).toEqual(utc(2028, 2, 29));
  });

  it("うるう年でない2月の月末日(28日)を返す", () => {
    expect(endOfMonthUTC(utc(2026, 2, 1))).toEqual(utc(2026, 2, 28));
  });

  it("12月から翌年1月をまたいでも正しく12月末を返す(addMonthsUTCの1/31繰り上がり挙動に影響されない)", () => {
    expect(endOfMonthUTC(utc(2026, 12, 15))).toEqual(utc(2026, 12, 31));
  });
});

describe("buildMonthGrid", () => {
  it("42マス(6週×7日)を返す", () => {
    expect(buildMonthGrid(2026, 8)).toHaveLength(42);
  });

  it("2026年8月は土曜始まりのため、グリッドは7/26(日)から始まる", () => {
    const grid = buildMonthGrid(2026, 8);
    expect(grid[0].date).toEqual(utc(2026, 7, 26));
    expect(grid[0].inCurrentMonth).toBe(false);
  });

  it("対象月内の日付はinCurrentMonth=trueになる", () => {
    const grid = buildMonthGrid(2026, 8);
    const augustCells = grid.filter((cell) => cell.inCurrentMonth);
    expect(augustCells).toHaveLength(31);
    expect(augustCells[0].date).toEqual(utc(2026, 8, 1));
    expect(augustCells[augustCells.length - 1].date).toEqual(utc(2026, 8, 31));
  });

  it("最終セルは翌月の日付で、日曜始まりの並びを維持する", () => {
    const grid = buildMonthGrid(2026, 8);
    const lastCell = grid[grid.length - 1];
    expect(lastCell.date.getUTCDay()).toBe(6); // 土曜
    expect(lastCell.inCurrentMonth).toBe(false);
  });

  it("うるう年2月(2028年)でも正しくグリッドを生成する", () => {
    const grid = buildMonthGrid(2028, 2);
    const febCells = grid.filter((cell) => cell.inCurrentMonth);
    expect(febCells).toHaveLength(29);
  });

  it("12月は年をまたいで翌年1月の日付を含む", () => {
    const grid = buildMonthGrid(2026, 12);
    const lastCell = grid[grid.length - 1];
    expect(lastCell.date.getUTCFullYear()).toBe(2027);
  });
});
