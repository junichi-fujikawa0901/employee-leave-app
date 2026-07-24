import { describe, it, expect } from "vitest";
import { checkSummerCap, countDays, getSummerWindowForYear, isWithinWindow } from "@/lib/special-leave/rules";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("countDays", () => {
  it("単日(startDate=endDate)は1日", () => {
    expect(countDays(utc(2026, 8, 1), utc(2026, 8, 1))).toBe(1);
  });

  it("複数日は両端を含めて数える", () => {
    expect(countDays(utc(2026, 8, 1), utc(2026, 8, 3))).toBe(3);
  });

  it("月をまたぐ期間も正しく数える", () => {
    expect(countDays(utc(2026, 7, 30), utc(2026, 8, 2))).toBe(4);
  });
});

describe("getSummerWindowForYear", () => {
  it("指定した暦年の7/1〜9/30を返す", () => {
    const window = getSummerWindowForYear(2026);
    expect(window.start).toEqual(utc(2026, 7, 1));
    expect(window.end).toEqual(utc(2026, 9, 30));
  });
});

describe("isWithinWindow", () => {
  const window = getSummerWindowForYear(2026);

  it("窓内に完全に収まっていればtrue", () => {
    expect(isWithinWindow(utc(2026, 7, 1), utc(2026, 7, 3), window)).toBe(true);
    expect(isWithinWindow(utc(2026, 9, 30), utc(2026, 9, 30), window)).toBe(true);
  });

  it("開始日が窓の前月にはみ出す場合はfalse", () => {
    expect(isWithinWindow(utc(2026, 6, 30), utc(2026, 7, 2), window)).toBe(false);
  });

  it("終了日が窓の翌月にはみ出す場合はfalse", () => {
    expect(isWithinWindow(utc(2026, 9, 29), utc(2026, 10, 2), window)).toBe(false);
  });
});

describe("checkSummerCap", () => {
  it("既存0日+新規3日はちょうど上限のためok", () => {
    expect(checkSummerCap(0, 3)).toEqual({ ok: true });
  });

  it("既存2日+新規1日はちょうど上限のためok", () => {
    expect(checkSummerCap(2, 1)).toEqual({ ok: true });
  });

  it("既存2日+新規2日は上限超過", () => {
    expect(checkSummerCap(2, 2)).toEqual({ ok: false, reason: "exceeds_summer_cap" });
  });

  it("既存0日+新規4日は単発でも上限超過", () => {
    expect(checkSummerCap(0, 4)).toEqual({ ok: false, reason: "exceeds_summer_cap" });
  });
});
